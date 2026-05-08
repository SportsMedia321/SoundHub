"""
soundhub FastAPI backend — main.py
Runs on Render free tier.
Kept alive by UptimeRobot pinging /health every 5 minutes.
"""
import os
import json
import uuid
import tempfile
from pathlib import Path
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import sys
sys.path.insert(0, str(Path(__file__).parent))
from db.client import (
    get_active_clips, get_pending_posts, get_approved_posts,
    approve_post, get_audio_library, insert_post, get_state,
    set_state, get_training_notes, add_training_note, generate_id, now_iso
)
from utils.r2 import upload_audio, presigned_url, delete_file


app = FastAPI(title="soundhub API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_URL", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ─────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "time": now_iso()}


# ── Clips ──────────────────────────────────────────────────────────────────

@app.get("/clips")
def get_clips(category: str = None, limit: int = 60):
    clips = get_active_clips(category=category, limit=limit)
    # Add presigned URLs for thumbnails
    for clip in clips:
        if clip.get("video_r2_key"):
            clip["preview_url"] = presigned_url(clip["video_r2_key"], expires=1800)
    return {"clips": clips}


@app.get("/clips/stats")
def clip_stats():
    from db.client import get_db
    db = get_db()
    active = db.table("clips").select("id, sport_category, source_platform, viral_score, expires_at").eq("status", "queued").execute().data or []
    now = datetime.now(timezone.utc)
    expiring_soon = [
        c for c in active
        if c.get("expires_at") and
        (datetime.fromisoformat(c["expires_at"].replace("Z","+00:00")) - now).total_seconds() < 14400
    ]
    tier1 = [c for c in active if c.get("sport_category") in ("NFL", "NBA")]
    misc = [c for c in active if c.get("sport_category") == "MISC"]
    return {
        "total_active": len(active),
        "tier1_count": len(tier1),
        "misc_count": len(misc),
        "expiring_soon": len(expiring_soon),
        "scrape_last_run": get_state("scrape_last_run"),
        "scrape_next_run": get_state("scrape_next_run"),
    }


# ── Compose ────────────────────────────────────────────────────────────────

class ComposePayload(BaseModel):
    clip_id: str
    audio_id: str | None = None
    new_vol: float = 1.0
    orig_vol: float = 0.0


@app.post("/compose")
async def compose(payload: ComposePayload, background_tasks: BackgroundTasks):
    from agents.compose_agent import handle_compose_request
    from db.client import get_db
    db = get_db()
    clip_result = db.table("clips").select("*").eq("id", payload.clip_id).execute()
    if not clip_result.data:
        raise HTTPException(404, "Clip not found")
    clip_data = clip_result.data[0]

    background_tasks.add_task(
        handle_compose_request,
        {
            "clip_id": payload.clip_id,
            "clip_data": clip_data,
            "audio_id": payload.audio_id,
            "new_vol": payload.new_vol,
            "orig_vol": payload.orig_vol,
        }
    )
    return {"status": "composing", "clip_id": payload.clip_id}


# ── Post Queue ─────────────────────────────────────────────────────────────

@app.get("/queue")
def get_queue():
    posts = get_pending_posts()
    return {"posts": posts}


class ApprovePayload(BaseModel):
    post_ids: list[str]


@app.post("/queue/approve")
async def approve_posts(payload: ApprovePayload, background_tasks: BackgroundTasks):
    from agents.syndication_agent import calculate_optimal_time, run_syndication
    approved = []
    for post_id in payload.post_ids:
        from db.client import get_db
        db = get_db()
        post_result = db.table("posts").select("*").eq("id", post_id).execute()
        if not post_result.data:
            continue
        post = post_result.data[0]
        scheduled, priority = calculate_optimal_time(post["platform"], now_iso())
        approve_post(post_id, scheduled, priority)
        approved.append(post_id)

    background_tasks.add_task(run_syndication, approved)
    add_training_note("syndication_agent", "batch_approved", f"Approved {len(approved)} posts.")
    return {"approved": approved}


@app.post("/queue/approve/{post_id}")
async def approve_single(post_id: str, background_tasks: BackgroundTasks):
    return await approve_posts(ApprovePayload(post_ids=[post_id]), background_tasks)


class EditPostPayload(BaseModel):
    post_id: str
    caption: str | None = None
    hashtags: list[str] | None = None
    training_note: str | None = None


@app.patch("/queue/edit")
def edit_post(payload: EditPostPayload):
    from db.client import get_db
    db = get_db()
    updates = {"caption_user_edited": True}
    if payload.caption:
        updates["caption_final"] = payload.caption
    if payload.hashtags:
        updates["hashtags_generated"] = json.dumps(payload.hashtags)
    db.table("posts").update(updates).eq("id", payload.post_id).execute()

    if payload.training_note:
        add_training_note("compose_agent", "user_edit", payload.training_note)

    return {"updated": payload.post_id}


# ── Audio Library ──────────────────────────────────────────────────────────

@app.get("/audio")
def get_audio():
    tracks = get_audio_library()
    for t in tracks:
        if t.get("r2_key"):
            t["preview_url"] = presigned_url(t["r2_key"], expires=3600)
    return {"tracks": tracks}


@app.post("/audio/upload")
async def upload_audio_file(file: UploadFile = File(...)):
    allowed = {"audio/mpeg", "audio/wav", "audio/mp4", "audio/aac", "audio/x-m4a"}
    if file.content_type not in allowed:
        raise HTTPException(400, f"Unsupported audio type: {file.content_type}")

    audio_id = generate_id("audio")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "mp3"

    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    r2_key = upload_audio(tmp_path, audio_id, ext)
    Path(tmp_path).unlink(missing_ok=True)

    from db.client import get_db
    db = get_db()
    record = {
        "id": audio_id,
        "name": file.filename.rsplit(".", 1)[0],
        "r2_key": r2_key,
        "file_size_bytes": len(content),
        "format": ext,
        "league_preference": "[]",
        "platform_native": "{}",
        "use_count": 0,
        "status": "active",
        "uploaded_at": now_iso(),
    }
    db.table("audio_library").insert(record).execute()
    return {"audio_id": audio_id, "name": record["name"]}


@app.delete("/audio/{audio_id}")
def delete_audio(audio_id: str):
    from db.client import get_audio_by_id, get_db
    track = get_audio_by_id(audio_id)
    if not track:
        raise HTTPException(404, "Track not found")
    delete_file(track["r2_key"])
    get_db().table("audio_library").update({"status": "deleted"}).eq("id", audio_id).execute()
    return {"deleted": audio_id}


@app.patch("/audio/{audio_id}/tags")
def update_audio_tags(audio_id: str, league_preference: list[str], platform_native: dict = {}):
    from db.client import get_db
    get_db().table("audio_library").update({
        "league_preference": json.dumps(league_preference),
        "platform_native": json.dumps(platform_native),
    }).eq("id", audio_id).execute()
    return {"updated": audio_id}


# ── Agent State ────────────────────────────────────────────────────────────

@app.get("/agents/state")
def agents_state():
    return {
        "scrape_last_run": get_state("scrape_last_run"),
        "scrape_next_run": get_state("scrape_next_run"),
        "seed_last_refresh": get_state("seed_last_refresh"),
        "seed_next_refresh": get_state("seed_next_refresh"),
        "total_clips_24hr": get_state("total_clips_24hr"),
        "total_posts_pending": get_state("total_posts_pending"),
    }


@app.get("/agents/training")
def training_notes(agent: str = None, limit: int = 20):
    return {"notes": get_training_notes(agent, limit)}


@app.post("/agents/training")
def add_note(agent: str, action: str, note: str):
    add_training_note(agent, action, note)
    return {"saved": True}


# ── Manual refresh trigger ─────────────────────────────────────────────────

@app.post("/scrape/trigger")
async def trigger_scrape():
    """Manual scrape trigger — runs in separate thread."""
    import threading
    try:
        current = get_state("scrape_next_run")
        if current == "running":
            return {"status": "already running"}
    except Exception:
        pass
    
    def run():
        print("SCRAPE THREAD STARTED")
        try:
            print("Importing scrape agent...")
            from agents.scrape_agent import run_scrape_cycle
            print("Import successful, starting cycle...")
            run_scrape_cycle()
        except Exception as e:
            print(f"SCRAPE ERROR: {e}")
            import traceback
            traceback.print_exc()
    
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    return {"status": "scrape triggered"}


# ── Seed refresh trigger ───────────────────────────────────────────────────

@app.post("/seeds/refresh")
async def trigger_seed_refresh(background_tasks: BackgroundTasks):
    from agents.seed_refresh_agent import run_seed_refresh
    background_tasks.add_task(run_seed_refresh)
    return {"status": "seed refresh triggered"}


@app.get("/seeds")
def get_seeds(category: str = None):
    from db.client import load_seeds
    seeds = load_seeds(tiktok_first=True)
    if category:
        seeds = [s for s in seeds if s["category"] == category]
    return {"seeds": seeds}
