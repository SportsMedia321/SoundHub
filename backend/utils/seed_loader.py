"""
seed_loader.py
Run once to load account_seeds.json into Supabase.
Usage: python backend/utils/seed_loader.py
"""
import sys, os, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent))
from db.client import upsert_seed, generate_id

def load():
    path = Path(__file__).parent.parent.parent / "config" / "account_seeds.json"
    seeds = json.loads(path.read_text())
    total = 0
    for category, accounts in seeds.items():
        for rank, acc in enumerate(accounts, 1):
            for platform in acc["platform"]:
                record = {
                    "id": generate_id("seed"),
                    "handle": acc["handle"],
                    "platform": platform,
                    "category": category,
                    "account_type": acc.get("type", "unknown"),
                    "is_pinned_official": acc.get("pinned", False),
                    "seed_rank": rank,
                    "avg_eng_rate_14d": 0.0,
                    "trend_direction": "flat",
                    "status": "active",
                }
                upsert_seed(record)
                total += 1
                print(f"  Loaded: {category} | {platform} | {acc['handle']}")
    print(f"\nDone. {total} seed records loaded.")

if __name__ == "__main__":
    load()
