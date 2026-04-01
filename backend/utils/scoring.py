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
    Returns True if a post clears all threshold gates for its tier.
    """
    tier_cfg, _ = get_tier_config(category, thresholds)
    tt_mult = thresholds["global"]["tiktok_velocity_multiplier"] if platform == "tiktok" else 1.0

    views = post.get("views_at_ingest", 0)
    eng_rate = post.get("engagement_rate", 0.0)
    shares_4hr = post.get("share_velocity_4hr", 0)
    post_age_hr = post.get("post_event_hours", 999)

    # Apply TikTok velocity multiplier — lower effective threshold for TT posts
    effective_views_threshold = tier_cfg["min_views_in_6hr"] / tt_mult
    effective_shares_threshold = tier_cfg["min_shares_in_4hr"] / tt_mult

    if views < effective_views_threshold:
        return False
    if eng_rate < tier_cfg["min_engagement_rate"]:
        return False
    if shares_4hr < effective_shares_threshold:
        return False
    if post_age_hr > tier_cfg["recency_gate_hours"]:
        return False

    return True


def get_tier_number(tier_name: str) -> int:
    return {"tier_1": 1, "tier_2": 2, "misc": 3}.get(tier_name, 3)
