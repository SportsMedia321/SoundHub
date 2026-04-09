"""
Supabase database client and helper utilities.
"""
import os
import json
import uuid
from datetime import datetime, timezone
from typing import Optional
from supabase import create_client, Client

_client: Optional[Client] = None


def get_db() -> Client:
    global _client
    if _client is None:
        url = os.environ["SUPABASE_URL"]
        key = os.environ["SUPABASE_SERVICE_KEY"]
        _client = create_client(url, key)
    return _clientcreate_client(url, key, options=options)
    return _client


def generate_id(prefix: str = "") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:16]}" if prefix else uuid.uuid4().hex[:16]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── Clips ──────────────────────────────────────────────────────────────────

def insert_clip(clip: dict) -> dict:
    db = get_db()
    result = db.table("clips").insert(clip).execute()
    return result.data[0] if result.data else {}


def get_active_clips(category: str = None, limit: int = 100) -> list:
    db = get_db()
    q = db.table("clips").select("*").eq("status", "queued")
    if category:
        q = q.eq("sport_category", category)
    q = q.order("viral_score", desc=True).limit(limit)
    return q.execute().data or []


def expire_clips() -> int:
    db = get_db()
    now = now_iso()
    result = (
        db.table("clips")
        .update({"status": "expired"})
        .lt("expires_at", now)
        .eq("status", "queued")
        .execute()
    )
    return len(result.data or [])


def mark_clip_composed(clip_id: str):
    db = get_db()
    db.table("clips").update({"status": "composed"}).eq("id", clip_id).execute()


# ── Posts ──────────────────────────────────────────────────────────────────

def insert_post(post: dict) -> dict:
    db = get_db()
    result = db.table("posts").insert(post).execute()
    return result.data[0] if result.data else {}


def get_pending_posts() -> list:
    db = get_db()
    return (
        db.table("posts")
        .select("*, clips(*), audio_library(*)")
        .eq("approval_status", "pending")
        .order("created_at")
        .execute()
        .data or []
    )


def get_approved_posts() -> list:
    db = get_db()
    return (
        db.table("posts")
        .select("*")
        .eq("approval_status", "approved")
        .is_("published_at", "null")
        .order("scheduled_post_time")
        .execute()
        .data or []
    )


def approve_post(post_id: str, scheduled_time: str, priority: bool) -> dict:
    db = get_db()
    result = (
        db.table("posts")
        .update({
            "approval_status": "approved",
            "approved_at": now_iso(),
            "scheduled_post_time": scheduled_time,
            "within_priority_window": priority,
        })
        .eq("id", post_id)
        .execute()
    )
    return result.data[0] if result.data else {}


def mark_post_published(post_id: str, platform_post_id: str):
    db = get_db()
    db.table("posts").update({
        "published_at": now_iso(),
        "platform_post_id": platform_post_id,
        "approval_status": "published",
    }).eq("id", post_id).execute()


def mark_post_deleted(post_id: str):
    db = get_db()
    db.table("posts").update({"deleted_after_publish": True}).eq("id", post_id).execute()


def update_post_insights(post_id: str, window_hr: int, views: int, eng_rate: float, shares: int):
    db = get_db()
    field_map = {1: "post_views_1hr", 6: "post_views_6hr", 24: "post_views_24hr"}
    field = field_map.get(window_hr)
    if field:
        db.table("posts").update({
            field: views,
            "post_eng_rate": eng_rate,
            "post_shares": shares,
        }).eq("id", post_id).execute()


# ── Account Seeds ──────────────────────────────────────────────────────────

def load_seeds(tiktok_first: bool = True) -> list:
    db = get_db()
    result = db.table("account_seeds").select("*").eq("status", "active").execute()
    seeds = result.data or []
    if tiktok_first:
        seeds.sort(key=lambda s: (0 if s["platform"] == "tiktok" else 1, s["seed_rank"]))
    return seeds


def upsert_seed(seed: dict):
    db = get_db()
    db.table("account_seeds").upsert(seed, on_conflict="handle,platform,category").execute()


def update_seed_rank(seed_id: str, rank: int, avg_eng: float, trend: str):
    db = get_db()
    db.table("account_seeds").update({
        "seed_rank": rank,
        "avg_eng_rate_14d": avg_eng,
        "trend_direction": trend,
        "last_evaluated": now_iso(),
    }).eq("id", seed_id).execute()


# ── Audio Library ──────────────────────────────────────────────────────────

def get_audio_library() -> list:
    db = get_db()
    return (
        db.table("audio_library")
        .select("*")
        .eq("status", "active")
        .order("use_count", desc=True)
        .execute()
        .data or []
    )


def get_audio_by_id(audio_id: str) -> dict:
    db = get_db()
    result = db.table("audio_library").select("*").eq("id", audio_id).execute()
    return result.data[0] if result.data else {}


def increment_audio_use(audio_id: str):
    db = get_db()
    audio = get_audio_by_id(audio_id)
    db.table("audio_library").update({
        "use_count": audio.get("use_count", 0) + 1
    }).eq("id", audio_id).execute()


# ── Training Notes ─────────────────────────────────────────────────────────

def add_training_note(agent: str, action: str, note: str):
    db = get_db()
    db.table("training_notes").insert({
        "agent": agent,
        "action": action,
        "note": note,
    }).execute()


def get_training_notes(agent: str = None, limit: int = 20) -> list:
    db = get_db()
    q = db.table("training_notes").select("*")
    if agent:
        q = q.eq("agent", agent)
    return q.order("created_at", desc=True).limit(limit).execute().data or []


# ── Agent State ────────────────────────────────────────────────────────────

def get_state(key: str):
    db = get_db()
    result = db.table("agent_state").select("value").eq("key", key).execute()
    if result.data:
        return result.data[0]["value"]
    return None


def set_state(key: str, value):
    db = get_db()
    db.table("agent_state").upsert({
        "key": key,
        "value": value,
        "updated_at": now_iso(),
    }).execute()
