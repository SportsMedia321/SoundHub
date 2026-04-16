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
    """Use yt-dlp to get TikTok account videos and metadata."""
    try:
        url = f"https://www.tiktok.com/{handle}"
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--print-json",
                "--playlist-end", "15",
                "--no-warnings",
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
                    "views_at_ingest": p.get("view_count", 0) or 0,
                    "likes_at_ingest": p.get("like_count", 0) or 0,
                    "comments_at_ingest": p.get("comment_count", 0) or 0,
                    "shares_at_ingest": p.get("repost_count", 0) or 0,
                    "saves_at_ingest": p.get("collect_count", 0) or 0,
                    "caption": p.get("description", "")[:500],
                    "duration_seconds": int(p.get("duration", 0) or 0),
                    "posted_at": str(p.get("upload_date", "")),
                    "platform": "tiktok",
                    "source_account": handle,
                })
            except Exception:
                continue
        return posts
    except Exception as e:
        print(f"yt-dlp failed for {handle}: {e}")
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
    """Scrape YouTube Shorts via yt-dlp using both account and search."""
    posts = []

    # Try account page first
    try:
        channel_url = f"https://www.youtube.com/@{handle.lstrip('@')}/shorts"
        result = subprocess.run(
            [
                "yt-dlp",
                "--flat-playlist",
                "--print-json",
                "--playlist-end", "10",
                "--no-warnings",
                "--socket-timeout", "15",
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

    # If account scrape returned nothing use search fallback
    if not posts:
        try:
            category = handle.lstrip('@').replace('highlights', '').strip()
            search_url = f"ytsearch10:{category} sports highlights shorts"
            result = subprocess.run(
                [
                    "yt-dlp",
                    "--flat-playlist",
                    "--print-json",
                    "--no-warnings",
                    "--socket-timeout", "15",
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
    """Use yt-dlp to search TikTok hashtags for MISC viral content."""
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
                    "--socket-timeout", "15",
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

def passes_threshold(post: dict, category: str, platform: str, thresholds: dict) -> bool:
    """
    Primary filter: viral score with TikTok boost.
    Falls back to raw threshold checks if viral score is zero.
    """
    viral_score = post.get("viral_score", 0)
    post_age_hr = post.get("post_event_hours", 999)
    views = post.get("views_at_ingest", 0)

    tier_cfg, tier_name = get_tier_config(category, thresholds)

    # Always reject posts older than recency gate
    if post_age_hr > tier_cfg["recency_gate_hours"]:
        return False

    # Always reject posts with fewer than 1000 views
    if views < 1000:
        return False

    # Primary filter — viral score with TikTok boost
    if viral_score > 0:
        min_score = {
            "tier_1": 19.5,
            "tier_2": 24.5,
            "misc":   27.0,
        }
        cutoff = min_score.get(tier_name, 19.5)
        tiktok_score_boost = 1.35 if platform == "tiktok" else 1.0
        adjusted_score = viral_score * tiktok_score_boost
        return adjusted_score >= cutoff

    # Fallback to raw thresholds if viral score could not be calculated
    tt_mult = thresholds["global"]["tiktok_velocity_multiplier"] if platform == "tiktok" else 1.0
    effective_views_threshold = tier_cfg["min_views_in_6hr"] / tt_mult
    effective_shares_threshold = tier_cfg["min_shares_in_4hr"] / tt_mult
    eng_rate = post.get("engagement_rate", 0.0)
    shares_4hr = post.get("share_velocity_4hr", 0)

    if views < effective_views_threshold:
        return False
    if eng_rate < tier_cfg["min_engagement_rate"] and eng_rate > 0:
        return False
    if shares_4hr < effective_shares_threshold and shares_4hr > 0:
        return False

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
                posts = []
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

        time.sleep(1.5)

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
