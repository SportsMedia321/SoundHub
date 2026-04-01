"""
Agent 2 — compose_agent.py
Triggered by UI when user selects a clip + audio + mix settings.
Runs FFmpeg server-side, generates all platform versions, writes post records.
"""
import os
import sys
import json
import subprocess
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import (
    get_db, insert_post, mark_clip_composed, get_audio_by_id,
    increment_audio_use, add_training_note, generate_id, now_iso
)
from utils.r2 import download_file, upload_composed_clip, delete_file as r2_delete
from utils.caption_gen import generate_caption_and_hashtags


PLATFORM_SPECS = {
    "tiktok":    {"aspect": "9:16", "max_dur": 59,  "width": 1080, "height": 1920},
    "instagram": {"aspect": "9:16", "max_dur": 89,  "width": 1080, "height": 1920},
    "youtube":   {"aspect": "9:16", "max_dur": 59,  "width": 1080, "height": 1920},
}


# ── FFmpeg core ────────────────────────────────────────────────────────────

def build_ffmpeg_cmd(
    video_path: str,
    audio_path: str | None,
    out_path: str,
    new_vol: float,
    orig_vol: float,
    width: int,
    height: int,
    max_dur: int,
) -> list:
    """Build the FFmpeg command for audio mix + crop + encode."""
    cmd = ["ffmpeg", "-y", "-i", video_path]

    if audio_path:
        cmd += ["-i", audio_path]

    # Video filter: scale + crop to target aspect ratio
    vf = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,"
        f"crop={width}:{height},"
        f"setsar=1"
    )
    cmd += ["-vf", vf]

    # Audio mixing
    if audio_path:
        if orig_vol > 0:
            # Mix original + new audio at respective volumes
            cmd += [
                "-filter_complex",
                f"[0:a]volume={orig_vol}[a0];[1:a]volume={new_vol}[a1];[a0][a1]amix=inputs=2:duration=first[aout]",
                "-map", "0:v",
                "-map", "[aout]",
            ]
        else:
            # Strip original, use only new audio
            cmd += [
                "-filter_complex", f"[1:a]volume={new_vol}[aout]",
                "-map", "0:v",
                "-map", "[aout]",
            ]
    else:
        cmd += ["-an"]  # no audio

    cmd += [
        "-t", str(max_dur),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    return cmd


def run_ffmpeg(cmd: list) -> bool:
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=180)
        if result.returncode != 0:
            print(f"FFmpeg error: {result.stderr.decode()[:500]}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print("FFmpeg timed out")
        return False
    except Exception as e:
        print(f"FFmpeg exception: {e}")
        return False


# ── Platform native sound detection ───────────────────────────────────────

def detect_native_sound(audio_id: str, platform: str) -> str | None:
    """Check if audio track has a known native sound ID on the platform."""
    audio = get_audio_by_id(audio_id)
    native = audio.get("platform_native") or {}
    if isinstance(native, str):
        native = json.loads(native)
    return native.get(platform)


# ── Main compose function ──────────────────────────────────────────────────

def compose_clip(
    clip_id: str,
    clip_data: dict,
    audio_id: str | None,
    new_vol: float = 1.0,
    orig_vol: float = 0.0,
) -> list[str]:
    """
    Compose all platform versions of a clip.
    Returns list of created post_ids.
    """
    post_ids = []
    tmp_dir = tempfile.mkdtemp()

    # Fetch video from R2
    video_r2_key = clip_data["video_r2_key"]
    video_local = os.path.join(tmp_dir, f"{clip_id}_raw.mp4")
    download_file(video_r2_key, video_local)

    # Fetch audio from R2 if provided
    audio_local = None
    if audio_id:
        audio_data = get_audio_by_id(audio_id)
        if audio_data:
            audio_local = os.path.join(tmp_dir, f"{audio_id}_audio")
            download_file(audio_data["r2_key"], audio_local)

    category = clip_data.get("sport_category", "")
    caption_base = clip_data.get("caption", "")

    for platform, spec in PLATFORM_SPECS.items():
        out_local = os.path.join(tmp_dir, f"{clip_id}_{platform}.mp4")

        cmd = build_ffmpeg_cmd(
            video_path=video_local,
            audio_path=audio_local,
            out_path=out_local,
            new_vol=new_vol,
            orig_vol=orig_vol,
            width=spec["width"],
            height=spec["height"],
            max_dur=spec["max_dur"],
        )

        success = run_ffmpeg(cmd)
        if not success or not os.path.exists(out_local):
            print(f"Compose failed for {platform}")
            continue

        # Upload composed clip to R2
        r2_key = upload_composed_clip(out_local, clip_id, platform)
        os.remove(out_local)

        # Detect native sound
        native_sound_id = detect_native_sound(audio_id, platform) if audio_id else None
        use_native = native_sound_id is not None and platform in ("tiktok",)

        # Generate caption + hashtags
        caption, hashtags = generate_caption_and_hashtags(
            category=category,
            platform=platform,
            base_caption=caption_base,
            clip_id=clip_id,
        )

        post_id = generate_id("post")
        post_record = {
            "id": post_id,
            "clip_id": clip_id,
            "platform": platform,
            "format": spec["aspect"],
            "duration_seconds": spec["max_dur"],
            "video_r2_key": r2_key,
            "audio_track_id": audio_id,
            "audio_new_volume": new_vol,
            "audio_original_volume": orig_vol,
            "use_platform_native_audio": use_native,
            "platform_native_sound_id": native_sound_id,
            "caption_generated": caption,
            "hashtags_generated": json.dumps(hashtags),
            "caption_final": caption,
            "approval_status": "pending",
            "created_at": now_iso(),
        }
        insert_post(post_record)
        post_ids.append(post_id)
        print(f"  ✓ Composed {platform} version for clip {clip_id}")

    # Clean up temp video + audio
    if os.path.exists(video_local):
        os.remove(video_local)
    if audio_local and os.path.exists(audio_local):
        os.remove(audio_local)

    # Mark clip as composed
    mark_clip_composed(clip_id)

    # Track audio usage
    if audio_id:
        increment_audio_use(audio_id)

    add_training_note(
        "compose_agent",
        "compose_complete",
        f"Composed {len(post_ids)} platform versions for clip {clip_id} with audio {audio_id}."
    )

    return post_ids


# ── Entrypoint (called via API) ────────────────────────────────────────────

def handle_compose_request(payload: dict) -> dict:
    """
    payload: {
      clip_id, clip_data, audio_id, new_vol, orig_vol
    }
    """
    clip_id = payload["clip_id"]
    clip_data = payload["clip_data"]
    audio_id = payload.get("audio_id")
    new_vol = float(payload.get("new_vol", 1.0))
    orig_vol = float(payload.get("orig_vol", 0.0))

    post_ids = compose_clip(clip_id, clip_data, audio_id, new_vol, orig_vol)
    return {"success": True, "post_ids": post_ids}


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--payload", type=str, help="JSON payload string")
    args = parser.parse_args()
    if args.payload:
        result = handle_compose_request(json.loads(args.payload))
        print(json.dumps(result))
