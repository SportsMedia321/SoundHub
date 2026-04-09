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
from playwright.sync_api import sync_playwright

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

def scrape_tiktok_account_snscrape(handle: str) -> list:
    """Primary: lightweight snscrape for TikTok public posts."""
    try:
        result = subprocess.run(
           ["snscrape", "--jsonl", "--max-results", "15", f"tiktok-user:{handle.lstrip('@')}"],
capture_output=True, text=True, timeout=30
        )
        posts = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                p = json.loads(line)
                posts.append({
                    "url": p.get("url", ""),
                    "views_at_ingest": p.get("playCount", 0),
                    "likes_at_ingest": p.get("diggCount", 0),
                    "comments_at_ingest": p.get("commentCount", 0),
                    "shares_at_ingest": p.get("shareCount", 0),
                    "saves_at_ingest": p.get("collectCount", 0),
                    "caption": p.get("desc", ""),
                    "duration_seconds": p.get("video", {}).get("duration", 0),
                    "posted_at": p.get("createTime", ""),
                    "platform": "tiktok",
                    "source_account": handle,
                })
            except Exception:
                continue
        return posts
    except Exception as e:
        print(f"snscrape failed for {handle}: {e}")
        return []


def scrape_account_playwright(handle: str, platform: str) -> list:
    """Fallback: headless browser scrape for blocked accounts."""
    url_map = {
        "tiktok": f"https://www.tiktok.com/{handle}",
        "instagram": f"https://www.instagram.com/{handle.lstrip('@')}/reels/",
        "youtube": f"https://www.youtube.com/@{handle.lstrip('@')}/shorts",
    }
    url = url_map.get(platform)
    if not url:
        return []

    posts = []
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            )
            page = ctx.new_page()
            page.goto(url, timeout=30000)
            page.wait_for_timeout(3000)

            if platform == "tiktok":
                items = page.query_selector_all('[data-e2e="user-post-item"]')
                for item in items[:15]:
                    try:
                        link = item.query_selector("a")
                        href = link.get_attribute("href") if link else ""
                        views_el = item.query_selector('[data-e2e="video-views"]')
                        views_text = views_el.inner_text() if views_el else "0"
                        views = parse_count(views_text)
                        posts.append({
                            "url": href,
                            "views_at_ingest": views,
                            "likes_at_ingest": 0,
                            "comments_at_ingest": 0,
                            "shares_at_ingest": 0,
                            "saves_at_ingest": 0,
                            "caption": "",
                            "duration_seconds": 0,
                            "posted_at": "",
                            "platform": "tiktok",
                            "source_account": handle,
                        })
                    except Exception:
                        continue
            browser.close()
    except Exception as e:
        print(f"Playwright failed for {handle} ({platform}): {e}")

    return posts


def scrape_instagram_account(handle: str) -> list:
    """Instagram Reels scrape via snscrape."""
    try:
        result = subprocess.run(
            ["snscrape", "--jsonl", "--max-results", "15", f"instagram-user:{handle.lstrip('@')}"],
            capture_output=True, text=True, timeout=45
        )
        posts = []
        for line in result.stdout.strip().split("\n"):
            if not line:
                continue
            try:
                p = json.loads(line)
                if p.get("typename") not in ("GraphVideo", "Reel"):
                    continue
                posts.append({
                    "url": p.get("url", ""),
                    "views_at_ingest": p.get("videoViewCount", 0),
                    "likes_at_ingest": p.get("likeCount", 0),
                    "comments_at_ingest": p.get("commentCount", 0),
                    "shares_at_ingest": 0,
                    "saves_at_ingest": 0,
                    "caption": (p.get("caption") or {}).get("text", ""),
                    "duration_seconds": int(p.get("videoDuration", 0)),
                    "posted_at": str(p.get("timestamp", "")),
                    "platform": "instagram",
                    "source_account": handle,
                })
            except Exception:
                continue
        return posts
    except Exception as e:
        print(f"IG snscrape failed for {handle}: {e}")
        return []


def scrape_youtube_account(handle: str) -> list:
    """YouTube Shorts scrape via yt-dlp metadata only (no download)."""
    try:
        channel_url = f"https://www.youtube.com/@{handle.lstrip('@')}/shorts"
        result = subprocess.run(
            [
                "yt-dlp", "--flat-playlist", "--print-json",
                "--playlist-end", "15",
                "--match-filter", "duration < 61",
                channel_url
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
                    "url": f"https://youtube.com/shorts/{p.get('id', '')}",
                    "views_at_ingest": p.get("view_count", 0),
                    "likes_at_ingest": p.get("like_count", 0),
                    "comments_at_ingest": p.get("comment_count", 0),
                    "shares_at_ingest": 0,
                    "saves_at_ingest": 0,
                    "caption": p.get("title", ""),
                    "duration_seconds": int(p.get("duration", 0)),
                    "posted_at": p.get("upload_date", ""),
                    "platform": "youtube",
                    "source_account": handle,
                })
            except Exception:
                continue
        return posts
    except Exception as e:
        print(f"YT scrape failed for {handle}: {e}")
        return []


# ── MISC hashtag scan ──────────────────────────────────────────────────────

def scan_misc_hashtags() -> list:
    """
    Secondary discovery for MISC category.
    Scans TikTok and IG hashtag pages via Playwright.
    Only runs after account seed pass is complete.
    """
    hashtags = THRESHOLDS["misc"]["hashtags_monitored"]
    found = []

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        ctx = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        )
        for tag in hashtags[:5]:  # limit to 5 hashtags per cycle
            try:
                page = ctx.new_page()
                page.goto(f"https://www.tiktok.com/tag/{tag.lstrip('#')}", timeout=20000)
                page.wait_for_timeout(2500)
                items = page.query_selector_all('[data-e2e="challenge-item"]')
                for item in items[:10]:
                    try:
                        link = item.query_selector("a")
                        href = link.get_attribute("href") if link else ""
                        views_el = item.query_selector('[data-e2e="video-views"]')
                        views = parse_count(views_el.inner_text() if views_el else "0")
                        if views > 0:
                            found.append({
                                "url": href,
                                "views_at_ingest": views,
                                "likes_at_ingest": 0,
                                "comments_at_ingest": 0,
                                "shares_at_ingest": 0,
                                "saves_at_ingest": 0,
                                "caption": tag,
                                "duration_seconds": 0,
                                "posted_at": "",
                                "platform": "tiktok",
                                "source_account": "hashtag_scan",
                                "discovery_method": "hashtag_confirmation",
                                "hashtags": [tag],
                            })
                    except Exception:
                        continue
                page.close()
            except Exception as e:
                print(f"Hashtag scan failed for {tag}: {e}")
                continue
        browser.close()

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
    """Parse '1.2M', '45K', '1,234' etc. to int."""
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
    """Estimate hours since post from timestamp string."""
    if not posted_at:
        return 24.0  # assume 24hrs if unknown
    try:
        formats = ["%Y%m%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"]
        dt = None
        for fmt in formats:
            try:
                dt = datetime.strptime(posted_at[:len(fmt)], fmt).replace(tzinfo=timezone.utc)
                break
            except Exception:
                continue
        if not dt:
            return 24.0
        return (datetime.now(timezone.utc) - dt).total_seconds() / 3600
    except Exception:
        return 24.0


def url_seen(url: str) -> bool:
    h = hashlib.md5(url.encode()).hexdigest()
    if h in SEEN_URLS:
        return True
    SEEN_URLS.add(h)
    return False


def classify_category(account_category: str, caption: str, hashtags: list) -> str:
    """Use account category as primary signal."""
    return account_category


# ── Main cycle ─────────────────────────────────────────────────────────────

def process_post(post: dict, category: str, account_type: str, discovery_method: str) -> bool:
    """Evaluate a post, download if qualifying, write to DB. Returns True if ingested."""
    url = post.get("url", "")
    if not url or url_seen(url):
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

    _, tier_name = get_tier_config(category, THRESHOLDS)
    if not passes_threshold(post_data, category, platform, THRESHOLDS):
        return False

    viral_score = calculate_viral_score(
        views, int(views / max(age_hr, 1)),
        share_vel, eng_rate, age_hr, platform, THRESHOLDS
    )

    clip_id = generate_id("clip")
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=48)

    # Download clip
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


def run_scrape_cycle():
    print(f"\n{'='*60}")
    print(f"Scrape cycle started: {datetime.now(timezone.utc).isoformat()}")
    set_state("scrape_last_run", datetime.now(timezone.utc).isoformat())

    seeds = load_seeds(tiktok_first=True)
    ingested = 0
    target = THRESHOLDS["global"]["target_clips_per_24hr"]

    # ── Account seed pass (TikTok first) ──────────────────────────────────
    for seed in seeds:
        if ingested >= target:
            break

        handle = seed["handle"]
        platform = seed["platform"]
        category = seed["category"]
        account_type = seed.get("account_type", "unknown")

        print(f"\nScraping {category} | {platform} | {handle}")

        if platform == "tiktok":
    posts = scrape_tiktok_account_snscrape(handle)
    if not posts:
            print(f"  snscrape returned no posts for {handle} - skipping playwright on tiktok")
            pass
        elif platform == "instagram":
            posts = scrape_instagram_account(handle)
            if not posts:
                posts = scrape_account_playwright(handle, "instagram")
        elif platform == "youtube":
            posts = scrape_youtube_account(handle)
        else:
            continue

        for post in posts:
            if process_post(post, category, account_type, "account_seed"):
                ingested += 1
                seed["clips_contributed_this_cycle"] = seed.get("clips_contributed_this_cycle", 0) + 1
            if ingested >= target:
                break

        time.sleep(1.5)  # polite delay between accounts

    print(f"\nAccount seed pass complete. Ingested: {ingested}")

    # ── MISC hashtag scan ──────────────────────────────────────────────────
    print("\nRunning MISC hashtag confirmation scan...")
    misc_posts = scan_misc_hashtags()
    for post in misc_posts:
        if process_post(post, "MISC", "hashtag_scan", "hashtag_confirmation"):
            ingested += 1

    # ── TTL expiry janitor ─────────────────────────────────────────────────
    expired = expire_clips()
    print(f"\nExpired {expired} clips past 48hr TTL.")

    # ── Update state ───────────────────────────────────────────────────────
    next_run = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
    set_state("scrape_next_run", next_run)
    set_state("total_clips_24hr", ingested)

    print(f"\nScrape cycle complete. Total ingested: {ingested}. Next: {next_run}")
    add_training_note("scrape_agent", "cycle_complete", f"Ingested {ingested} clips this cycle.")


if __name__ == "__main__":
    run_scrape_cycle()
