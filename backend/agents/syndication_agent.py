"""
Agent 3 — syndication_agent.py
Triggered by approval webhook via n8n.
Handles TikTok, Instagram, YouTube posting with optimal timing.
Deletes R2 files after confirmed publish.
"""
import os
import sys
import json
import time
import requests
from pathlib import Path
from datetime import datetime, timezone, timedelta

sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import (
    get_approved_posts, mark_post_published, mark_post_deleted,
    update_post_insights, add_training_note, set_state, get_state
)
from utils.r2 import download_file, delete_clip_files


# ── Timing optimizer ───────────────────────────────────────────────────────

PLATFORM_PEAK_HOURS = {
    "tiktok":    [7, 12, 18, 19, 20, 21],
    "instagram": [8, 11, 14, 17, 19, 21],
    "youtube":   [12, 15, 17, 19, 20],
}

def calculate_optimal_time(platform: str, approved_at: str) -> tuple[str, bool]:
    """
    Returns (iso_scheduled_time, within_priority_window).
    Priority window = within 12hrs of approval.
    Hard limit = within 24hrs of approval.
    """
    approved_dt = datetime.fromisoformat(approved_at.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    priority_cutoff = approved_dt + timedelta(hours=12)
    hard_cutoff = approved_dt + timedelta(hours=24)

    peak_hours = PLATFORM_PEAK_HOURS.get(platform, [12, 18, 20])

    # Find next peak hour within priority window
    check = max(now + timedelta(minutes=5), approved_dt)
    while check <= hard_cutoff:
        if check.hour in peak_hours:
            within_priority = check <= priority_cutoff
            return check.isoformat(), within_priority
        check += timedelta(hours=1)

    # Fallback: post at approved + 30min if no peak found
    fallback = approved_dt + timedelta(minutes=30)
    return fallback.isoformat(), True


# ── TikTok publisher ───────────────────────────────────────────────────────

def publish_tiktok(post: dict, video_local: str) -> str | None:
    """
    Publish via TikTok Content Posting API.
    Returns platform_post_id on success, None on failure.
    """
    access_token = os.environ.get("TIKTOK_ACCESS_TOKEN")
    if not access_token:
        print("Missing TIKTOK_ACCESS_TOKEN")
        return None

    caption = post.get("caption_final", "")
    hashtags = post.get("hashtags_generated", [])
    if isinstance(hashtags, str):
        hashtags = json.loads(hashtags)
    full_caption = f"{caption}\n{' '.join(hashtags)}"[:2200]

    # Step 1: Init upload
    init_url = "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/"
    headers = {"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"}
    file_size = os.path.getsize(video_local)

    init_payload = {
        "post_info": {
            "title": full_caption,
            "privacy_level": "PUBLIC_TO_EVERYONE",
            "disable_duet": False,
            "disable_comment": False,
            "disable_stitch": False,
        },
        "source_info": {
            "source": "FILE_UPLOAD",
            "video_size": file_size,
            "chunk_size": file_size,
            "total_chunk_count": 1,
        }
    }

    # If native sound available, attach it
    if post.get("platform_native_sound_id") and post.get("use_platform_native_audio"):
        init_payload["post_info"]["music_id"] = post["platform_native_sound_id"]

    resp = requests.post(init_url, headers=headers, json=init_payload)
    if resp.status_code != 200:
        print(f"TikTok init failed: {resp.text}")
        return None

    data = resp.json().get("data", {})
    publish_id = data.get("publish_id")
    upload_url = data.get("upload_url")

    if not upload_url:
        print("No TikTok upload URL returned")
        return None

    # Step 2: Upload video bytes
    with open(video_local, "rb") as f:
        video_bytes = f.read()

    upload_headers = {
        "Content-Type": "video/mp4",
        "Content-Range": f"bytes 0-{file_size - 1}/{file_size}",
        "Content-Length": str(file_size),
    }
    upload_resp = requests.put(upload_url, data=video_bytes, headers=upload_headers)
    if upload_resp.status_code not in (200, 201, 206):
        print(f"TikTok upload failed: {upload_resp.text}")
        return None

    print(f"  ✓ TikTok published: {publish_id}")
    return publish_id


# ── Instagram publisher ────────────────────────────────────────────────────

def publish_instagram(post: dict, video_local: str) -> str | None:
    """
    Publish Reel via Instagram Graph API.
    Requires video to be publicly accessible (upload to R2 presigned URL first).
    """
    access_token = os.environ.get("INSTAGRAM_ACCESS_TOKEN")
    ig_user_id = os.environ.get("INSTAGRAM_USER_ID")
    if not access_token or not ig_user_id:
        print("Missing IG credentials")
        return None

    # Get presigned URL for the video (Instagram requires a public URL)
    from utils.r2 import presigned_url
    video_url = presigned_url(post["video_r2_key"], expires=3600)

    caption = post.get("caption_final", "")
    hashtags = post.get("hashtags_generated", [])
    if isinstance(hashtags, str):
        hashtags = json.loads(hashtags)
    full_caption = f"{caption}\n{' '.join(hashtags)}"[:2200]

    scheduled_time = post.get("scheduled_post_time")

    # Step 1: Create media container
    container_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media"
    container_payload = {
        "media_type": "REELS",
        "video_url": video_url,
        "caption": full_caption,
        "access_token": access_token,
    }
    if scheduled_time:
        container_payload["published"] = False

    resp = requests.post(container_url, data=container_payload)
    if resp.status_code != 200:
        print(f"IG container failed: {resp.text}")
        return None

    container_id = resp.json().get("id")
    if not container_id:
        return None

    # Wait for video to process
    for _ in range(12):
        time.sleep(10)
        status_resp = requests.get(
            f"https://graph.facebook.com/v19.0/{container_id}",
            params={"fields": "status_code", "access_token": access_token}
        )
        status = status_resp.json().get("status_code")
        if status == "FINISHED":
            break
        if status == "ERROR":
            print("IG video processing error")
            return None

    # Step 2: Publish
    publish_url = f"https://graph.facebook.com/v19.0/{ig_user_id}/media_publish"
    pub_payload = {"creation_id": container_id, "access_token": access_token}
    if scheduled_time:
        pub_payload["scheduled_publish_time"] = int(
            datetime.fromisoformat(scheduled_time.replace("Z", "+00:00")).timestamp()
        )
        pub_payload["published"] = False

    pub_resp = requests.post(publish_url, data=pub_payload)
    if pub_resp.status_code != 200:
        print(f"IG publish failed: {pub_resp.text}")
        return None

    media_id = pub_resp.json().get("id")
    print(f"  ✓ Instagram published: {media_id}")
    return media_id


# ── YouTube publisher ──────────────────────────────────────────────────────

def publish_youtube(post: dict, video_local: str) -> str | None:
    """
    Upload Short via YouTube Data API v3.
    """
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload

    yt_creds_json = os.environ.get("YOUTUBE_CREDENTIALS_JSON")
    if not yt_creds_json:
        print("Missing YOUTUBE_CREDENTIALS_JSON")
        return None

    creds_data = json.loads(yt_creds_json)
    creds = Credentials(
        token=creds_data.get("token"),
        refresh_token=creds_data.get("refresh_token"),
        client_id=creds_data.get("client_id"),
        client_secret=creds_data.get("client_secret"),
        token_uri="https://oauth2.googleapis.com/token",
    )

    youtube = build("youtube", "v3", credentials=creds)

    caption = post.get("caption_final", "")
    hashtags = post.get("hashtags_generated", [])
    if isinstance(hashtags, str):
        hashtags = json.loads(hashtags)

    scheduled_time = post.get("scheduled_post_time")

    body = {
        "snippet": {
            "title": caption[:100],
            "description": f"{caption}\n\n{' '.join(hashtags)}"[:5000],
            "tags": [h.lstrip("#") for h in hashtags],
            "categoryId": "17",  # Sports
        },
        "status": {
            "privacyStatus": "public" if not scheduled_time else "private",
            "selfDeclaredMadeForKids": False,
        }
    }

    if scheduled_time:
        body["status"]["publishAt"] = scheduled_time

    media = MediaFileUpload(video_local, mimetype="video/mp4", resumable=True)
    request = youtube.videos().insert(
        part="snippet,status",
        body=body,
        media_body=media
    )

    response = None
    while response is None:
        _, response = request.next_chunk()

    video_id = response.get("id")
    print(f"  ✓ YouTube published: {video_id}")
    return video_id


# ── Insights polling ───────────────────────────────────────────────────────

def poll_insights(post_id: str, platform: str, platform_post_id: str, window_hr: int):
    """Poll platform insights at 1hr, 6hr, 24hr windows."""
    time.sleep(window_hr * 3600)

    views, eng_rate, shares = 0, 0.0, 0

    try:
        if platform == "instagram":
            access_token = os.environ.get("INSTAGRAM_ACCESS_TOKEN")
            resp = requests.get(
                f"https://graph.facebook.com/v19.0/{platform_post_id}/insights",
                params={
                    "metric": "plays,likes,comments,shares",
                    "access_token": access_token
                }
            )
            if resp.status_code == 200:
                data = resp.json().get("data", [])
                metric_map = {d["name"]: d["values"][0]["value"] for d in data}
                views = metric_map.get("plays", 0)
                likes = metric_map.get("likes", 0)
                comments = metric_map.get("comments", 0)
                shares = metric_map.get("shares", 0)
                eng_rate = round((likes + comments + shares) / max(views, 1), 4)

        elif platform == "youtube":
            yt_creds_json = os.environ.get("YOUTUBE_CREDENTIALS_JSON")
            if yt_creds_json:
                from google.oauth2.credentials import Credentials
                from googleapiclient.discovery import build
                creds_data = json.loads(yt_creds_json)
                creds = Credentials(**creds_data)
                youtube = build("youtube", "v3", credentials=creds)
                resp = youtube.videos().list(
                    part="statistics",
                    id=platform_post_id
                ).execute()
                stats = resp["items"][0]["statistics"] if resp.get("items") else {}
                views = int(stats.get("viewCount", 0))
                likes = int(stats.get("likeCount", 0))
                comments = int(stats.get("commentCount", 0))
                eng_rate = round((likes + comments) / max(views, 1), 4)

    except Exception as e:
        print(f"Insights poll error ({platform} {window_hr}hr): {e}")

    update_post_insights(post_id, window_hr, views, eng_rate, shares)


# ── Main publish flow ──────────────────────────────────────────────────────

def publish_post(post: dict):
    post_id = post["id"]
    platform = post["platform"]
    clip_id = post["clip_id"]
    approved_at = post.get("approved_at") or now_iso()

    scheduled_time, within_priority = calculate_optimal_time(platform, approved_at)
    post["scheduled_post_time"] = scheduled_time
    post["within_priority_window"] = within_priority

    # Download composed video from R2
    import tempfile
    tmp = tempfile.mkdtemp()
    video_local = os.path.join(tmp, f"{post_id}_{platform}.mp4")
    download_file(post["video_r2_key"], video_local)

    # Wait until scheduled time
    scheduled_dt = datetime.fromisoformat(scheduled_time.replace("Z", "+00:00"))
    now = datetime.now(timezone.utc)
    wait_secs = max(0, (scheduled_dt - now).total_seconds())
    if wait_secs > 0:
        print(f"Waiting {int(wait_secs)}s until optimal post time for {platform}...")
        time.sleep(min(wait_secs, 300))  # max 5min wait in single call; scheduler handles longer

    platform_post_id = None
    if platform == "tiktok":
        platform_post_id = publish_tiktok(post, video_local)
    elif platform == "instagram":
        platform_post_id = publish_instagram(post, video_local)
    elif platform == "youtube":
        platform_post_id = publish_youtube(post, video_local)

    # Clean up local file
    if os.path.exists(video_local):
        os.remove(video_local)

    if platform_post_id:
        mark_post_published(post_id, platform_post_id)

        # Delete R2 files after publish (save storage)
        delete_clip_files(clip_id, [platform])
        mark_post_deleted(post_id)

        # Schedule insights polling (background - GitHub Actions handles this)
        print(f"  Post {post_id} published on {platform}. Insights will poll at 1h/6h/24h.")

        add_training_note(
            "syndication_agent",
            "publish_success",
            f"Published {platform} post {post_id} at {scheduled_time}."
        )
    else:
        print(f"  Publish failed for {platform} post {post_id}")
        add_training_note(
            "syndication_agent",
            "publish_failed",
            f"Failed to publish {platform} post {post_id}."
        )


def run_syndication(post_ids: list = None):
    """Run syndication for all approved posts, or specific post_ids."""
    from db.client import now_iso as _now
    posts = get_approved_posts()
    if post_ids:
        posts = [p for p in posts if p["id"] in post_ids]

    print(f"Syndicating {len(posts)} approved posts...")

    # Group by clip, stagger platforms by 5–10min
    stagger = 0
    for post in posts:
        if stagger > 0:
            time.sleep(stagger)
        publish_post(post)
        stagger = 360  # 6min stagger between platform versions

    set_state("total_posts_pending", 0)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--post_ids", nargs="*", help="Specific post IDs to publish")
    args = parser.parse_args()
    run_syndication(args.post_ids)
