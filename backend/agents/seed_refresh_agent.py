"""
Agent 4 — seed_refresh_agent.py
Runs on GitHub Actions cron every 14 days.
Re-ranks account seeds by engagement. Drops underperformers. Discovers new accounts.
Pinned official accounts are never dropped.
"""
import os
import sys
import json
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import (
    load_seeds, upsert_seed, update_seed_rank,
    add_training_note, set_state, generate_id
)


def scrape_socialblade_stats(handle: str, platform: str) -> dict:
    """Scrape Social Blade for 14-day avg engagement stats."""
    platform_slug = {"tiktok": "tiktok", "instagram": "instagram", "youtube": "youtube"}.get(platform, platform)
    url = f"https://socialblade.com/{platform_slug}/user/{handle.lstrip('@')}"

    stats = {"avg_eng_rate": 0.0, "avg_views": 0, "trend": "flat"}
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            page.goto(url, timeout=20000)
            page.wait_for_timeout(2000)
            content = page.content()
            browser.close()

            # Parse engagement rate from page content (rough extraction)
            import re
            eng_matches = re.findall(r'(\d+\.?\d*)\s*%\s*(?:engagement|eng)', content, re.I)
            view_matches = re.findall(r'(\d+[KkMm]?)\s*(?:avg|average)\s*(?:views|plays)', content, re.I)

            if eng_matches:
                stats["avg_eng_rate"] = float(eng_matches[0]) / 100
            if view_matches:
                v = view_matches[0].upper()
                if "M" in v:
                    stats["avg_views"] = int(float(v.replace("M", "")) * 1_000_000)
                elif "K" in v:
                    stats["avg_views"] = int(float(v.replace("K", "")) * 1_000)
                else:
                    stats["avg_views"] = int(v)
    except Exception as e:
        print(f"Social Blade scrape failed for {handle}: {e}")

    return stats


def discover_new_accounts(category: str, existing_handles: set) -> list:
    """Search TikTok for high-performing accounts not yet in seed list."""
    search_terms = {
        "NFL": "NFL highlights",
        "NBA": "NBA highlights dunks",
        "MLB": "baseball highlights",
        "NHL": "hockey highlights",
        "MLS": "MLS soccer goals",
        "US Intl": "USMNT USWNT highlights",
        "MISC": "viral sports moments",
    }
    term = search_terms.get(category, f"{category} sports")
    candidates = []

    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            page = browser.new_page(user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            page.goto(f"https://www.tiktok.com/search/user?q={term.replace(' ', '%20')}", timeout=20000)
            page.wait_for_timeout(3000)
            items = page.query_selector_all('[data-e2e="search-user-info-container"]')
            for item in items[:10]:
                try:
                    handle_el = item.query_selector('[data-e2e="search-user-unique-id"]')
                    handle = "@" + handle_el.inner_text() if handle_el else ""
                    if handle and handle not in existing_handles:
                        candidates.append({
                            "handle": handle,
                            "platform": "tiktok",
                            "category": category,
                            "account_type": "highlight",
                        })
                except Exception:
                    continue
            browser.close()
    except Exception as e:
        print(f"Discovery search failed for {category}: {e}")

    return candidates[:3]  # max 3 candidates per category


def run_seed_refresh():
    print(f"\n{'='*60}")
    print(f"Seed refresh started: {datetime.now(timezone.utc).isoformat()}")

    seeds = load_seeds(tiktok_first=False)
    min_eng_threshold = float(os.environ.get("MIN_SEED_ENG_THRESHOLD", "0.05"))
    grace_cycles = int(os.environ.get("SEED_GRACE_CYCLES", "2"))

    # Group seeds by category for re-ranking
    by_category: dict = {}
    for s in seeds:
        cat = s["category"]
        by_category.setdefault(cat, []).append(s)

    for category, cat_seeds in by_category.items():
        print(f"\nRefreshing {category} ({len(cat_seeds)} accounts)...")
        existing_handles = {s["handle"] for s in cat_seeds}
        scored = []

        for seed in cat_seeds:
            handle = seed["handle"]
            platform = seed.get("platform", "tiktok")

            if seed.get("is_pinned_official"):
                scored.append({**seed, "avg_eng_rate_14d": 0.99, "trend": "flat"})
                continue

            stats = scrape_socialblade_stats(handle, platform)
            eng = stats["avg_eng_rate"]

            trend = "flat"
            prev_eng = seed.get("avg_eng_rate_14d", 0)
            if eng > prev_eng * 1.1:
                trend = "up"
            elif eng < prev_eng * 0.9:
                trend = "down"

            below_threshold = eng < min_eng_threshold
            consec = seed.get("consecutive_cycles_below_threshold", 0)
            if below_threshold:
                consec += 1
            else:
                consec = 0

            scored.append({
                **seed,
                "avg_eng_rate_14d": eng,
                "avg_views_per_post_14d": stats["avg_views"],
                "trend_direction": trend,
                "consecutive_cycles_below_threshold": consec,
                "last_evaluated": datetime.now(timezone.utc).isoformat(),
                "next_evaluation": (datetime.now(timezone.utc) + timedelta(days=14)).isoformat(),
            })
            time.sleep(1.0)

        # Sort by engagement desc
        scored.sort(key=lambda s: s.get("avg_eng_rate_14d", 0), reverse=True)
        for i, s in enumerate(scored):
            s["seed_rank"] = i + 1

        # Drop grace-period-exceeded underperformers (non-pinned)
        to_drop = [
            s for s in scored
            if not s.get("is_pinned_official")
            and s.get("consecutive_cycles_below_threshold", 0) >= grace_cycles
        ]

        # Discover replacements
        if to_drop:
            print(f"  Dropping {len(to_drop)} underperformers from {category}")
            replacements = discover_new_accounts(category, existing_handles)

        # Upsert all seeds back
        for s in scored:
            if s in to_drop:
                s["status"] = "inactive"
            upsert_seed(s)

        # Add discovered replacements
        if to_drop:
            for r in replacements:
                r["id"] = generate_id("seed")
                r["status"] = "active"
                r["is_pinned_official"] = False
                r["seed_rank"] = 20
                upsert_seed(r)
                print(f"  + Added new account: {r['handle']}")

        add_training_note(
            "seed_refresh_agent",
            "category_refreshed",
            f"Refreshed {category}: {len(scored)} accounts re-ranked, {len(to_drop)} dropped."
        )

    next_refresh = (datetime.now(timezone.utc) + timedelta(days=14)).isoformat()
    set_state("seed_last_refresh", datetime.now(timezone.utc).isoformat())
    set_state("seed_next_refresh", next_refresh)
    print(f"\nSeed refresh complete. Next: {next_refresh}")


if __name__ == "__main__":
    run_seed_refresh()
