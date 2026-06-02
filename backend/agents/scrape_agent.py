"""
Agent 1 — scrape_agent.py
Runs on GitHub Actions cron every 12 hours.
Priority: TikTok account seeds first, then other platforms, then MISC hashtag scan.
"""
import os
import sys
import json
import time
import hashlib
import tempfile
import subprocess
from datetime import datetime, timezone, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import (
    insert_clip, get_active_clips, expire_clips, load_seeds,
    set_state, get_state, add_training_note, generate_id
)
from utils.scoring import (
    load_thresholds, get_tier_config, calculate_engagement_rate,
    calculate_viral_score, passes_threshold, get_tier_number
)
from utils.r2 import upload_raw_clip, delete_file


THRESHOLDS = load_thresholds()
SEEN_URLS: set = set()


# ── Scraping helpers ───────────────────────────────────────────────────────

def scrape_tiktok_account(handle: str) -> list:
    """Use yt-dlp to get TikTok account videos. Falls back to YouTube search."""
    try:
        url = f"https://www.tiktok.com/{handle}"
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--print-json",
                "--playlist-end", "15",
                "--no-warnings",
                "--socket-timeout", "10",
                url,
            ],
            capture_output=True, text=True, timeout=60
        )
        posts = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                p = json.loads(line)
                posts.append({
                    "url": p.get("webpage_url", f"https://www.tiktok.com/{handle}"),
                    "views_at_ingest": p.get("view_count") or 0,
                    "likes_at_ingest": p.get("like_count") or 0,
                    "comments_at_ingest": p.get("comment_count") or 0,
                    "shares_at_ingest": p.get("repost_count") or 0,
                    "saves_at_ingest": p.get("collect_count") or 0,
                    "caption": p.get("description", "")[:500],
                    "duration_seconds": int(p.get("duration") or 0),
                    "posted_at": str(p.get("upload_date", "")),
                    "platform": "tiktok",
                    "source_account": handle,
                })
            except Exception:
                continue
        if posts:
            return posts
    except Exception as e:
        print(f"TikTok yt-dlp failed for {handle}: {e}")

    # Fallback — YouTube search for this account's content
    try:
        search_term = handle.lstrip("@").replace("_", " ")
        search_url = f"ytsearch10:{search_term} sports highlights"
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--print-json",
                "--no-warnings",
                "--socket-timeout", "10",
                search_url,
            ],
            capture_output=True, text=True, timeout=30
        )
        posts = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                p = json.loads(line)
                duration = p.get("duration") or 0
                if duration > 120:
                    continue
                posts.append({
                    "url": f"https://youtube.com/watch?v={p.get('id', '')}",
                    "views_at_ingest": p.get("view_count") or 0,
                    "likes_at_ingest": p.get("like_count") or 0,
                    "comments_at_ingest": p.get("comment_count") or 0,
                    "shares_at_ingest": 0,
                    "saves_at_ingest": 0,
                    "caption": p.get("title", "")[:500],
                    "duration_seconds": int(duration),
                    "posted_at": str(p.get("upload_date", "")),
                    "platform": "tiktok",
                    "source_account": handle,
                })
            except Exception:
                continue
        return posts
    except Exception as e:
        print(f"TikTok YT fallback failed for {handle}: {e}")
        return []


def scrape_instagram_account(handle: str) -> list:
    """Instagram Reels scrape via yt-dlp with multiple fallback strategies."""
    clean_handle = handle.lstrip("@")
    posts = []

    # Strategy 1 — direct reels page
    for url in [
        f"https://www.instagram.com/{clean_handle}/reels/",
        f"https://www.instagram.com/{clean_handle}/",
    ]:
        if posts:
            break
        try:
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--flat-playlist",
                    "--print-json",
                    "--playlist-end", "15",
                    "--no-warnings",
                    "--socket-timeout", "15",
                    "--add-header", "User-Agent:Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
                    "--add-header", "Accept-Language:en-US,en;q=0.9",
                    url,
                ],
                capture_output=True, text=True, timeout=45
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    p = json.loads(line)
                    if not p.get("id"):
                        continue
                    posts.append({
                        "url": p.get("webpage_url") or f"https://www.instagram.com/reel/{p.get('id', '')}/",
                        "views_at_ingest": p.get("view_count") or 0,
                        "likes_at_ingest": p.get("like_count") or 0,
                        "comments_at_ingest": p.get("comment_count") or 0,
                        "shares_at_ingest": 0,
                        "saves_at_ingest": 0,
                        "caption": p.get("title", "")[:500],
                        "duration_seconds": int(p.get("duration") or 0),
                        "posted_at": str(p.get("upload_date", "")),
                        "platform": "instagram",
                        "source_account": handle,
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"IG scrape failed for {handle} ({url}): {e}")

    # Strategy 2 — YouTube search fallback for IG accounts
    if not posts:
        try:
            search_url = f"ytsearch10:{clean_handle} instagram reels highlights"
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--flat-playlist",
                    "--print-json",
                    "--no-warnings",
                    "--socket-timeout", "10",
                    search_url,
                ],
                capture_output=True, text=True, timeout=30
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    p = json.loads(line)
                    duration = p.get("duration") or 0
                    if duration > 120:
                        continue
                    posts.append({
                        "url": f"https://youtube.com/watch?v={p.get('id', '')}",
                        "views_at_ingest": p.get("view_count") or 0,
                        "likes_at_ingest": p.get("like_count") or 0,
                        "comments_at_ingest": p.get("comment_count") or 0,
                        "shares_at_ingest": 0,
                        "saves_at_ingest": 0,
                        "caption": p.get("title", "")[:500],
                        "duration_seconds": int(duration),
                        "posted_at": str(p.get("upload_date", "")),
                        "platform": "instagram",
                        "source_account": handle,
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"IG YT fallback failed for {handle}: {e}")

    return posts


def scrape_youtube_account(handle: str) -> list:
    """Scrape YouTube Shorts via yt-dlp with search fallback."""
    posts = []

    try:
        channel_url = f"https://www.youtube.com/@{handle.lstrip('@')}/shorts"
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--print-json",
                "--playlist-end", "10",
                "--no-warnings",
                "--socket-timeout", "10",
                channel_url,
            ],
            capture_output=True, text=True, timeout=30
        )
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                p = json.loads(line)
                duration = p.get("duration") or 0
                if duration > 61:
                    continue
                posts.append({
                    "url": f"https://youtube.com/shorts/{p.get('id', '')}",
                    "views_at_ingest": p.get("view_count") or 0,
                    "likes_at_ingest": p.get("like_count") or 0,
                    "comments_at_ingest": p.get("comment_count") or 0,
                    "shares_at_ingest": 0,
                    "saves_at_ingest": 0,
                    "caption": p.get("title", "")[:500],
                    "duration_seconds": int(duration),
                    "posted_at": str(p.get("upload_date", "")),
                    "platform": "youtube",
                    "source_account": handle,
                })
            except Exception:
                continue
    except Exception as e:
        print(f"YT account scrape failed for {handle}: {e}")

    if not posts:
        try:
            search_term = handle.lstrip("@").replace("_", " ")
            search_url = f"ytsearch10:{search_term} sports highlights shorts"
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--flat-playlist",
                    "--print-json",
                    "--no-warnings",
                    "--socket-timeout", "10",
                    search_url,
                ],
                capture_output=True, text=True, timeout=30
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    p = json.loads(line)
                    duration = p.get("duration") or 0
                    if duration > 61:
                        continue
                    posts.append({
                        "url": f"https://youtube.com/shorts/{p.get('id', '')}",
                        "views_at_ingest": p.get("view_count") or 0,
                        "likes_at_ingest": p.get("like_count") or 0,
                        "comments_at_ingest": p.get("comment_count") or 0,
                        "shares_at_ingest": 0,
                        "saves_at_ingest": 0,
                        "caption": p.get("title", "")[:500],
                        "duration_seconds": int(duration),
                        "posted_at": str(p.get("upload_date", "")),
                        "platform": "youtube",
                        "source_account": handle,
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"YT search fallback failed for {handle}: {e}")

    return posts


# ── MISC hashtag scan ──────────────────────────────────────────────────────

def scan_misc_hashtags() -> list:
    """Use yt-dlp YouTube search for MISC viral sports content."""
    hashtags = THRESHOLDS["misc"]["hashtags_monitored"]
    found = []
    for tag in hashtags[:5]:
        try:
            search_url = f"ytsearch10:{tag.lstrip('#')} sports viral"
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--flat-playlist",
                    "--print-json",
                    "--no-warnings",
                    "--socket-timeout", "10",
                    search_url,
                ],
                capture_output=True, text=True, timeout=30
            )
            for line in result.stdout.strip().split("\n"):
                if not line:
                    continue
                try:
                    p = json.loads(line)
                    found.append({
                        "url": f"https://youtube.com/watch?v={p.get('id', '')}",
                        "views_at_ingest": p.get("view_count") or 0,
                        "likes_at_ingest": p.get("like_count") or 0,
                        "comments_at_ingest": p.get("comment_count") or 0,
                        "shares_at_ingest": 0,
                        "saves_at_ingest": 0,
                        "caption": p.get("title", "")[:500],
                        "duration_seconds": int(p.get("duration") or 0),
                        "posted_at": str(p.get("upload_date", "")),
                        "platform": "youtube",
                        "source_account": "hashtag_scan",
                        "discovery_method": "hashtag_confirmation",
                        "hashtags": [tag],
                    })
                except Exception:
                    continue
        except Exception as e:
            print(f"Hashtag search failed for {tag}: {e}")
    return found


# ── Download ───────────────────────────────────────────────────────────────

def download_clip(url: str, clip_id: str) -> str | None:
    """Download video with yt-dlp, return local temp path."""
    out = f"/tmp/{clip_id}.mp4"
    try:
        subprocess.run(
            [
                "yt-dlp",
                "-f", "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
                "--merge-output-format", "mp4",
                "-o", out,
                "--no-playlist",
                "--max-filesize", "200m",
                "--socket-timeout", "15",
                url,
            ],
            timeout=120,
            check=True,
            capture_output=True,
        )
        return out if os.path.exists(out) else None
    except Exception as e:
        print(f"Download failed for {url}: {e}")
        return None


# ── Helpers ────────────────────────────────────────────────────────────────

def parse_count(text: str) -> int:
    t = text.strip().replace(",", "").upper()
    try:
        if t.endswith("M"):
            return int(float(t[:-1]) * 1_000_000)
        if t.endswith("K"):
            return int(float(t[:-1]) * 1_000)
        return int(float(t))
    except Exception:
        return 0


def estimate_post_age_hours(posted_at: str) -> float:
    """
    Estimate hours since post from timestamp string.
    Returns 999 (rejected) if date is missing or unparseable
    so posts with unknown age never pass the recency gate.
    """
    if not posted_at or posted_at in ("", "None", "null"):
        return 999.0
    try:
        formats = ["%Y%m%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"]
        dt = None
        for fmt in formats:
            try:
                dt = datetime.strptime(str(posted_at)[:len(fmt)], fmt).replace(tzinfo=timezone.utc)
                break
            except Exception:
                continue
        if not dt:
            return 999.0
        age = (datetime.now(timezone.utc) - dt).total_seconds() / 3600
        return age
    except Exception:
        return 999.0


def url_seen(url: str) -> bool:
    h = hashlib.md5(url.encode()).hexdigest()
    if h in SEEN_URLS:
        return True
    SEEN_URLS.add(h)
    return False


def already_in_db(url: str) -> bool:
    """Check Supabase whether this URL was already ingested previously."""
    try:
        from db.client import get_db
        db = get_db()
        result = db.table("clips").select("id").eq("original_post_url", url).limit(1).execute()
        return len(result.data or []) > 0
    except Exception:
        return False


# ── Process post ───────────────────────────────────────────────────────────

def process_post(post: dict, category: str, account_type: str, discovery_method: str) -> bool:
    """Evaluate a post, download if qualifying, write to DB. Returns True if ingested."""
    url = post.get("url", "")
    if not url or url_seen(url) or already_in_db(url):
        return False

    platform = post.get("platform", "")
    views = post.get("views_at_ingest", 0)
    likes = post.get("likes_at_ingest", 0)
    comments = post.get("comments_at_ingest", 0)
    shares = post.get("shares_at_ingest", 0)
    saves = post.get("saves_at_ingest", 0)
    age_hr = estimate_post_age_hours(post.get("posted_at", ""))

    eng_rate = calculate_engagement_rate(views, likes, comments, shares, saves)
    share_vel = int(shares * min(1.0, 4.0 / max(age_hr, 0.1)))

    post_data = {
        **post,
        "engagement_rate": eng_rate,
        "share_velocity_4hr": share_vel,
        "post_event_hours": int(age_hr),
    }

    viral_score = calculate_viral_score(
        views, int(views / max(age_hr, 1)),
        share_vel, eng_rate, age_hr, platform, THRESHOLDS
    )
    post_data["viral_score"] = viral_score

    _, tier_name = get_tier_config(category, THRESHOLDS)
    # Platform score boosts
    tiktok_boost = 1.35 if platform == "tiktok" else 1.0
    instagram_boost = 1.15 if platform == "instagram" else 1.0
    adjusted = viral_score * tiktok_boost * instagram_boost

    # Tier cutoffs
    _, tier_name = get_tier_config(category, THRESHOLDS)
    tier_cutoffs = {"tier_1": 19.5, "tier_2": 22.0, "misc": 24.0}
    cutoff = tier_cutoffs.get(tier_name, 19.5)

    # Recency gate — skip if age unknown (999), only reject if we have a confirmed old date
    if age_hr != 999 and age_hr > 48:
        print(f"    ✗ Rejected (age): {age_hr:.0f}hrs old category={category}")
        return False

    # Minimum views gate
    if views < 1000:
        print(f"    ✗ Rejected (views): {views:,} views category={category}")
        return False

    # Viral score gate
    if adjusted < cutoff:
        print(f"    ✗ Rejected: raw={viral_score:.1f} adjusted={adjusted:.1f} cutoff={cutoff} views={views:,} platform={platform} category={category}")
        return False

    print(f"    ✓ Passed: raw={viral_score:.1f} adjusted={adjusted:.1f} cutoff={cutoff} views={views:,} platform={platform} category={category}")

    clip_id = generate_id("clip")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=48)

    local_path = download_clip(url, clip_id)
    if not local_path:
        return False

    r2_key = upload_raw_clip(local_path, clip_id)
    os.remove(local_path)

    clip_record = {
        "id": clip_id,
        "source_platform": platform,
        "source_account": post.get("source_account", ""),
        "source_account_type": account_type,
        "discovery_method": discovery_method,
        "sport_category": category,
        "tier": get_tier_number(tier_name),
        "original_post_url": url,
        "video_r2_key": r2_key,
        "caption": post.get("caption", "")[:500],
        "hashtags": json.dumps(post.get("hashtags", [])),
        "duration_seconds": post.get("duration_seconds", 0),
        "views_at_ingest": views,
        "views_velocity_per_hr": int(views / max(age_hr, 1)),
        "likes_at_ingest": likes,
        "comments_at_ingest": comments,
        "shares_at_ingest": shares,
        "saves_at_ingest": saves,
        "engagement_rate": eng_rate,
        "share_velocity_4hr": share_vel,
        "threshold_cleared": True,
        "viral_score": viral_score,
        "post_event_hours": int(age_hr),
        "status": "queued",
        "ingested_at": now.isoformat(),
        "expires_at": expires.isoformat(),
    }

    insert_clip(clip_record)
    print(f"  ✓ Ingested: {category} | {platform} | {url[:60]} | score={viral_score}")
    return True


# ── Main cycle ─────────────────────────────────────────────────────────────

def run_scrape_cycle():
    print(f"\n{'='*60}")
    print(f"Scrape cycle started: {datetime.now(timezone.utc).isoformat()}")
    
    try:
        set_state("scrape_last_run", datetime.now(timezone.utc).isoformat())
        set_state("scrape_next_run", "running")
    except Exception as e:
        print(f"WARNING: Could not update agent state: {e}")

    try:
        seeds = load_seeds(tiktok_first=False)

    by_category = {}
    for s in seeds:
        cat = s["category"]
        if cat not in by_category:
            by_category[cat] = {"tiktok": [], "instagram": [], "youtube": []}
        plat = s["platform"]
        if plat in by_category[cat]:
            by_category[cat][plat].append(s)

    interleaved = []
    for cat in ["NFL", "NBA", "MLB", "NHL", "MLS", "US Intl", "MISC"]:
        if cat not in by_category:
            continue
        tt = by_category[cat]["tiktok"]
        ig = by_category[cat]["instagram"]
        yt = by_category[cat]["youtube"]
        max_len = max(len(tt), len(ig), len(yt), 1)
        for i in range(max_len):
            if i < len(tt):
                interleaved.append(tt[i])
            if i < len(ig):
                interleaved.append(ig[i])
            if i < len(yt):
                interleaved.append(yt[i])

    seeds = interleaved
    except Exception as e:
        print(f"FATAL: Could not load seeds from database: {e}")
        return
    ingested = 0
    target = THRESHOLDS["global"]["target_clips_per_24hr"]

    for seed in seeds:
        if ingested >= target:
            break

        handle = seed["handle"]
        platform = seed["platform"]
        category = seed["category"]
        account_type = seed.get("account_type", "unknown")

        print(f"\nScraping {category} | {platform} | {handle}")

        if platform == "tiktok":
            posts = scrape_tiktok_account(handle)
        elif platform == "instagram":
            posts = scrape_instagram_account(handle)
        elif platform == "youtube":
            posts = scrape_youtube_account(handle)
        else:
            continue

        account_ingested = 0
        max_per_account = 3 if platform == "tiktok" else 4
        for post in posts:
            if account_ingested >= max_per_account:
                break
            if process_post(post, category, account_type, "account_seed"):
                ingested += 1
                account_ingested += 1
                seed["clips_contributed_this_cycle"] = seed.get("clips_contributed_this_cycle", 0) + 1
            if ingested >= target:
                break

        time.sleep(1.0)

    print(f"\nAccount seed pass complete. Ingested: {ingested}")

    print("\nRunning MISC hashtag confirmation scan...")
    misc_posts = scan_misc_hashtags()
    for post in misc_posts:
        if process_post(post, "MISC", "hashtag_scan", "hashtag_confirmation"):
            ingested += 1

    expired = expire_clips()
    print(f"\nExpired {expired} clips past 48hr TTL.")

    next_run = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    try:
        set_state("scrape_next_run", next_run)
        set_state("total_clips_24hr", ingested)
        add_training_note("scrape_agent", "cycle_complete", f"Ingested {ingested} clips this cycle.")
    except Exception as e:
        print(f"WARNING: Could not update final state: {e}")

    print(f"\nScrape cycle complete. Total ingested: {ingested}. Next: {next_run}")


if __name__ == "__main__":
    run_scrape_cycle()
