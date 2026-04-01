"""
Caption and hashtag generator.
Uses Claude API to generate platform-optimized captions.
"""
import os
import json
import requests

PLATFORM_INSTRUCTIONS = {
    "tiktok": "Short, punchy, energetic. Max 150 chars. Use 3-5 viral hashtags. TikTok style with energy.",
    "instagram": "Engaging caption with context. Max 200 chars. Use 5-8 relevant hashtags.",
    "youtube": "Clear title-style caption. Max 100 chars. Use 3-5 hashtags as tags.",
}

CATEGORY_HASHTAGS = {
    "NFL": ["#NFL", "#Football", "#NFLHighlights", "#AmericanFootball", "#Touchdown"],
    "NBA": ["#NBA", "#Basketball", "#NBAHighlights", "#Hoops", "#Dunk"],
    "MLB": ["#MLB", "#Baseball", "#BaseballHighlights", "#HomeRun"],
    "NHL": ["#NHL", "#Hockey", "#HockeyHighlights", "#IceHockey"],
    "MLS": ["#MLS", "#Soccer", "#MLSSoccer", "#Goal", "#Football"],
    "US Intl": ["#USMNT", "#USWNT", "#TeamUSA", "#USASoccer"],
    "MISC": ["#Sports", "#ViralSports", "#SportsMoment", "#Highlights", "#Athletic"],
}


def generate_caption_and_hashtags(
    category: str,
    platform: str,
    base_caption: str,
    clip_id: str,
) -> tuple[str, list]:
    """Generate caption + hashtags via Claude API. Falls back to template on error."""
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    platform_instr = PLATFORM_INSTRUCTIONS.get(platform, PLATFORM_INSTRUCTIONS["tiktok"])
    base_tags = CATEGORY_HASHTAGS.get(category, CATEGORY_HASHTAGS["MISC"])

    if api_key:
        try:
            prompt = (
                f"Generate a social media caption for a {category} sports highlight clip.\n"
                f"Platform: {platform}\n"
                f"Original caption/context: {base_caption[:200]}\n"
                f"Instructions: {platform_instr}\n"
                f"Base hashtags to include: {' '.join(base_tags[:3])}\n\n"
                f"Return JSON only: {{\"caption\": \"...\", \"hashtags\": [\"#tag1\", \"#tag2\"]}}"
            )
            resp = requests.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": "claude-haiku-4-5-20251001",
                    "max_tokens": 256,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=15,
            )
            if resp.status_code == 200:
                text = resp.json()["content"][0]["text"].strip()
                text = text.replace("```json", "").replace("```", "").strip()
                data = json.loads(text)
                return data.get("caption", ""), data.get("hashtags", base_tags)
        except Exception as e:
            print(f"Caption gen API error: {e}")

    # Fallback: simple template
    templates = {
        "tiktok":    f"🔥 {category} moment! {' '.join(base_tags[:4])}",
        "instagram": f"Epic {category} highlight 🏆 {' '.join(base_tags[:5])}",
        "youtube":   f"{category} Highlight | {base_tags[0] if base_tags else ''}",
    }
    caption = templates.get(platform, templates["tiktok"])
    return caption, base_tags
