"""
insights_poller.py
Runs hourly via GitHub Actions.
Polls IG + YT for performance data on published posts at 1hr/6hr/24hr windows.
"""
import os
import sys
import json
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import get_db, update_post_insights, add_training_note


def get_published_posts_needing_poll() -> list:
    """Find posts published 1h, 6h, or 24h ago that haven't been polled yet."""
    db = get_db()
    now = datetime.now(timezone.utc)
    windows = [
        (1,  "post_views_1hr"),
        (6,  "post_views_6hr"),
        (24, "post_views_24hr"),
    ]
    to_poll = []
    for hrs, field in windows:
        window_start = now - timedelta(hours=hrs + 0.5)
        window_end   = now - timedelta(hours=hrs - 0.5)
        result = (
            db.table("posts")
            .select("id, platform, platform_post_id, published_at")
            .eq("approval_status", "published")
            .is_(field, "null")
            .gte("published_at", window_start.isoformat())
            .lte("published_at", window_end.isoformat())
            .execute()
        )
        for row in result.data or []:
            to_poll.append({**row, "window_hr": hrs})
    return to_poll


def poll_instagram(platform_post_id: str) -> dict:
    token = os.environ.get("INSTAGRAM_ACCESS_TOKEN")
    if not token:
        return {}
    try:
        resp = requests.get(
            f"https://graph.facebook.com/v19.0/{platform_post_id}/insights",
            params={"metric": "plays,likes,comments,shares", "access_token": token},
            timeout=15,
        )
        if resp.status_code != 200:
            return {}
        data = {d["name"]: d["values"][0]["value"] for d in resp.json().get("data", [])}
        views  = data.get("plays", 0)
        likes  = data.get("likes", 0)
        comments = data.get("comments", 0)
        shares = data.get("shares", 0)
        eng_rate = round((likes + comments + shares) / max(views, 1), 4)
        return {"views": views, "eng_rate": eng_rate, "shares": shares}
    except Exception as e:
        print(f"IG insights error: {e}")
        return {}


def poll_youtube(platform_post_id: str) -> dict:
    creds_json = os.environ.get("YOUTUBE_CREDENTIALS_JSON")
    if not creds_json:
        return {}
    try:
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
        creds_data = json.loads(creds_json)
        creds = Credentials(
            token=creds_data.get("token"),
            refresh_token=creds_data.get("refresh_token"),
            client_id=creds_data.get("client_id"),
            client_secret=creds_data.get("client_secret"),
            token_uri="https://oauth2.googleapis.com/token",
        )
        yt = build("youtube", "v3", credentials=creds)
        resp = yt.videos().list(part="statistics", id=platform_post_id).execute()
        items = resp.get("items", [])
        if not items:
            return {}
        stats  = items[0]["statistics"]
        views  = int(stats.get("viewCount", 0))
        likes  = int(stats.get("likeCount", 0))
        comments = int(stats.get("commentCount", 0))
        eng_rate = round((likes + comments) / max(views, 1), 4)
        return {"views": views, "eng_rate": eng_rate, "shares": 0}
    except Exception as e:
        print(f"YT insights error: {e}")
        return {}


def run():
    posts = get_published_posts_needing_poll()
    print(f"Polling insights for {len(posts)} post windows...")

    for p in posts:
        post_id    = p["id"]
        platform   = p["platform"]
        pid        = p.get("platform_post_id", "")
        window_hr  = p["window_hr"]

        if not pid:
            continue

        data = {}
        if platform == "instagram":
            data = poll_instagram(pid)
        elif platform == "youtube":
            data = poll_youtube(pid)
        # TikTok insights API requires extra approval — skipped for now

        if data:
            update_post_insights(
                post_id,
                window_hr,
                data.get("views", 0),
                data.get("eng_rate", 0.0),
                data.get("shares", 0),
            )
            print(f"  ✓ {platform} {window_hr}hr: {data.get('views', 0):,} views, {data.get('eng_rate', 0):.1%} eng")
            add_training_note(
                "syndication_agent",
                "insights_polled",
                f"{platform} post {post_id} at {window_hr}hr: "
                f"{data.get('views', 0):,} views, {data.get('eng_rate', 0):.1%} eng rate",
            )

    print("Insights poll complete.")


if __name__ == "__main__":
    run()
