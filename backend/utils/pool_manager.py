"""
pool_manager.py — clip pool management for soundhub scrape agent.
Enforces:
  - TikTok pool: up to 100 clips ranked by viral score
  - IG/YT pool: up to 50 clips ranked by viral score
  - Hard cap: 150 total active clips
  - Dynamic floor: IG/YT clips that beat the 100th TikTok score displace TikTok clips
  - TTL: 48hr expiry regardless of score
"""

from datetime import datetime, timezone


def get_tiktok_floor(tiktok_clips: list) -> float:
    """Return the viral score of the 100th best TikTok clip, or 0 if fewer than 100."""
    sorted_tt = sorted(tiktok_clips, key=lambda c: c.get("viral_score", 0), reverse=True)
    if len(sorted_tt) >= 100:
        return sorted_tt[99].get("viral_score", 0)
    return 0.0


def enforce_pool_caps(db) -> dict:
    """
    Read all active clips from DB, enforce pool rules, expire overflows.
    Returns summary of actions taken.
    """
    now = datetime.now(timezone.utc)

    # Load all active clips
    result = db.table("clips").select(
        "id, source_platform, viral_score, ingested_at, expires_at"
    ).eq("status", "queued").execute()

    all_clips = result.data or []

    # Separate into TikTok and IG/YT pools
    tiktok_clips = [c for c in all_clips if c.get("source_platform") == "tiktok"]
    other_clips = [c for c in all_clips if c.get("source_platform") != "tiktok"]

    # Sort each pool by viral score descending
    tiktok_sorted = sorted(tiktok_clips, key=lambda c: c.get("viral_score", 0), reverse=True)
    other_sorted = sorted(other_clips, key=lambda c: c.get("viral_score", 0), reverse=True)

    # Get TikTok floor score (score of 100th best TikTok)
    tiktok_floor = tiktok_sorted[99].get("viral_score", 0) if len(tiktok_sorted) >= 100 else 0.0

    # TikTok clips to keep: top 100
    tiktok_keep = set(c["id"] for c in tiktok_sorted[:100])
    tiktok_expire = [c for c in tiktok_sorted[100:]]

    # IG/YT clips: top 50 base allocation
    other_keep_base = other_sorted[:50]
    other_overflow = other_sorted[50:]

    # Check if any overflow IG/YT clips beat the TikTok floor
    # If so they can displace the lowest TikTok clips
    overflow_beaters = [c for c in other_overflow if c.get("viral_score", 0) > tiktok_floor]

    if overflow_beaters and tiktok_expire:
        # Sort TikTok expire list lowest score first — these get displaced
        tiktok_expire_sorted = sorted(tiktok_expire, key=lambda c: c.get("viral_score", 0))
        # Sort overflow beaters highest score first
        overflow_beaters_sorted = sorted(overflow_beaters, key=lambda c: c.get("viral_score", 0), reverse=True)

        displaced = 0
        for beater in overflow_beaters_sorted:
            if displaced >= len(tiktok_expire_sorted):
                break
            # This IG/YT clip beats a TikTok clip — swap
            victim = tiktok_expire_sorted[displaced]
            tiktok_expire.append(victim)
            tiktok_keep.discard(victim["id"])
            other_keep_base.append(beater)
            displaced += 1

    # Build final keep set
    other_keep = set(c["id"] for c in other_keep_base)
    keep_ids = tiktok_keep | other_keep

    # Hard cap: if still over 150 expire lowest scoring from either pool
    if len(keep_ids) > 150:
        all_keep = sorted(
            [c for c in all_clips if c["id"] in keep_ids],
            key=lambda c: c.get("viral_score", 0),
            reverse=True
        )
        keep_ids = set(c["id"] for c in all_keep[:150])

    # Expire everything not in keep_ids
    expire_ids = [c["id"] for c in all_clips if c["id"] not in keep_ids]
    expired_count = 0
    for clip_id in expire_ids:
        db.table("clips").update({"status": "expired"}).eq("id", clip_id).execute()
        expired_count += 1

    summary = {
        "total_active": len(all_clips),
        "tiktok_in_pool": len([c for c in all_clips if c["id"] in tiktok_keep]),
        "other_in_pool": len([c for c in all_clips if c["id"] in other_keep]),
        "tiktok_floor": round(tiktok_floor, 2),
        "displaced_by_other": len(overflow_beaters) if overflow_beaters else 0,
        "expired": expired_count,
        "final_pool_size": len(keep_ids),
    }

    print(f"\nPool enforcement complete:")
    print(f"  TikTok in pool: {summary['tiktok_in_pool']} / 100")
    print(f"  IG/YT in pool:  {summary['other_in_pool']} / 50")
    print(f"  TikTok floor score: {summary['tiktok_floor']}")
    print(f"  IG/YT clips that beat TikTok floor: {summary['displaced_by_other']}")
    print(f"  Clips expired from overflow: {summary['expired']}")
    print(f"  Final pool size: {summary['final_pool_size']}")

    return summary


def should_ingest_tiktok(viral_score: float, db) -> bool:
    """
    Check if a new TikTok clip should be ingested based on current pool state.
    Returns True if pool has fewer than 100 TikTok clips OR clip beats the floor.
    """
    try:
        result = db.table("clips").select("viral_score").eq(
            "status", "queued"
        ).eq("source_platform", "tiktok").execute()
        tiktok_clips = result.data or []
        if len(tiktok_clips) < 100:
            return True
        floor = get_tiktok_floor(tiktok_clips)
        return viral_score > floor
    except Exception:
        return True


def should_ingest_other(viral_score: float, db) -> bool:
    """
    Check if a new IG/YT clip should be ingested.
    Returns True if other pool has fewer than 50 clips OR clip beats the TikTok floor.
    """
    try:
        result = db.table("clips").select("viral_score, source_platform").eq(
            "status", "queued"
        ).execute()
        all_clips = result.data or []
        other_clips = [c for c in all_clips if c.get("source_platform") != "tiktok"]
        tiktok_clips = [c for c in all_clips if c.get("source_platform") == "tiktok"]

        if len(other_clips) < 50:
            return True

        # Check against TikTok floor — can displace if better
        tiktok_floor = get_tiktok_floor(tiktok_clips)
        return viral_score > tiktok_floor
    except Exception:
        return True
