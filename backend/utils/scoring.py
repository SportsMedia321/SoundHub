"""
Viral score calculation and threshold evaluation.
TikTok posts receive a velocity multiplier as scrape priority #1.
"""
import json
import os
from datetime import datetime, timezone


def load_thresholds() -> dict:
    path = os.path.join(os.path.dirname(__file__), "../../config/thresholds.json")
    with open(path) as f:
        return json.load(f)


def get_tier_config(category: str, thresholds: dict) -> tuple[dict, str]:
    """Returns (tier_config, tier_name) for a given sport category."""
    for tier_name in ["tier_1", "tier_2", "misc"]:
        cfg = thresholds[tier_name]
        if category in cfg.get("categories", []):
            return cfg, tier_name
    return thresholds["misc"], "misc"


def calculate_engagement_rate(views: int, likes: int, comments: int, shares: int, saves: int = 0) -> float:
    if views == 0:
        return 0.0
    interactions = likes + comments + shares + saves
    return round(interactions / views, 4)


def calculate_viral_score(
    views: int,
    views_velocity_per_hr: int,
    shares_velocity_4hr: int,
    engagement_rate: float,
    post_age_hours: float,
    platform: str,
    thresholds: dict,
) -> float:
    """
    Weighted viral score 0–100.
    TikTok posts get a 1.5x velocity multiplier.
    """
    weights = thresholds["global"]["viral_score_weights"]
    tt_mult = thresholds["global"]["tiktok_velocity_multiplier"] if platform == "tiktok" else 1.0

    # Normalize each signal to 0–1 against rough max values
    views_norm = min(views_velocity_per_hr / 1_000_000, 1.0) * tt_mult
    shares_norm = min(shares_velocity_4hr / 100_000, 1.0) * tt_mult
    eng_norm = min(engagement_rate / 0.20, 1.0)
    # Recency: full score at 0hrs, zero at 48hrs
    recency_norm = max(0.0, 1.0 - (post_age_hours / 48.0))

    score = (
        views_norm   * weights["views_velocity"] +
        shares_norm  * weights["shares_velocity"] +
        eng_norm     * weights["engagement_rate"] +
        recency_norm * weights["recency"]
    ) * 100

    return round(min(score, 100.0), 2)


def passes_threshold(post: dict, category: str, platform: str, thresholds: dict) -> bool:
    """
    Primary filter: viral score with platform boosts.
    Tier 1 (NFL/NBA): cutoff 19.5
    Tier 2 (MLB/NHL/MLS/US Intl): cutoff 22.0
    MISC: cutoff 24.0
    Instagram fast pass: any post with 1M+ views passes regardless of engagement data.
    """
    viral_score = post.get("viral_score", 0)
    post_age_hr = post.get("post_event_hours", 999)
    views = post.get("views_at_ingest", 0)

    tier_cfg, tier_name = get_tier_config(category, thresholds)

    # Recency gate
    if post_age_hr != 999 and post_age_hr > tier_cfg["recency_gate_hours"]:
        return False

    # Views gate
    if views < 1000 and platform != "instagram":
        return False
    if views == 0:
        return False

    # Instagram fast pass — bypass viral score entirely for high-view posts
    # yt-dlp cannot reliably return engagement data from Instagram
    # so we use raw view count as the primary signal
    if platform == "instagram":
        instagram_views_cutoff = {
            "tier_1": 1_000_000,
            "tier_2": 1_500_000,
            "misc":   2_000_000,
        }
        cutoff_views = instagram_views_cutoff.get(tier_name, 1_000_000)
        return views >= cutoff_views

    # Standard viral score path for TikTok and YouTube
    if viral_score > 0:
        min_score = {
            "tier_1": 19.5,
            "tier_2": 22.0,
            "misc":   24.0,
        }
        cutoff = min_score.get(tier_name, 19.5)
        tiktok_boost = 1.35 if platform == "tiktok" else 1.0
        adjusted = viral_score * tiktok_boost
        return adjusted >= cutoff

    # Fallback raw threshold checks
    tt_mult = thresholds["global"]["tiktok_velocity_multiplier"] if platform == "tiktok" else 1.0
    effective_views = tier_cfg["min_views_in_6hr"] / tt_mult
    if views < effective_views:
        return False

    return True


def get_tier_number(tier_name: str) -> int:
    """Convert tier name to integer for database storage."""
    mapping = {"tier_1": 1, "tier_2": 2, "misc": 3}
    return mapping.get(tier_name, 1)
