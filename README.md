# soundhub

Sports highlight scrape → compose → syndication platform.
Fully automated. Three posting accounts: TikTok, Instagram, YouTube.
Entirely free infrastructure.

---

## Architecture

```
GitHub Actions (cron)     →  scrape_agent.py       (every 12hrs)
GitHub Actions (cron)     →  seed_refresh_agent.py (every 14 days)
Render (free web service) →  FastAPI backend        (always-on, kept alive by UptimeRobot)
Vercel (free)             →  Next.js frontend
Supabase (free 500MB)     →  PostgreSQL database
Cloudflare R2 (free 10GB) →  Video + audio storage  (auto-deleted after publish)
```

---

## Step 1 — Create accounts (you do these)

### 1a. TikTok developer app
1. Go to https://developers.tiktok.com
2. Create a developer account
3. Create a new app → apply for **Content Posting API**
4. Note your `client_key` and `client_secret`
5. Approval takes 2–5 business days

### 1b. Meta developer app (Instagram)
1. Go to https://developers.facebook.com
2. Create a new app → select **Business** type
3. Add **Instagram Graph API** product
4. Connect your Instagram Business account (must be Business, not Personal)
5. Connect a Facebook Page to the Instagram account
6. Generate a long-lived access token
7. Note your `access_token` and `instagram_user_id`

### 1c. Google Cloud project (YouTube)
1. Go to https://console.cloud.google.com
2. Create a new project
3. Enable **YouTube Data API v3**
4. Create OAuth2 credentials → Desktop app
5. Download the credentials JSON
6. Run the OAuth flow once locally to generate a refresh token:
   ```bash
   cd backend
   python utils/youtube_auth.py
   ```
7. Copy the full credentials JSON output

---

## Step 2 — Set up free services

### Supabase
1. Go to https://supabase.com → create free project
2. Go to SQL Editor → paste contents of `backend/db/schema.sql` → Run
3. Note your `Project URL` and `service_role` key from Settings → API
4. Enable Realtime for tables: `clips`, `posts`, `agent_state`

### Cloudflare R2
1. Go to https://dash.cloudflare.com → R2 → Create bucket named `soundhub`
2. Create R2 API token with Read + Write permissions
3. Note: endpoint URL, access key ID, secret access key

### Render (backend)
1. Go to https://render.com → New Web Service
2. Connect your GitHub repo
3. Render will auto-detect `render.yaml`
4. Add all environment variables from `backend/.env.example`
5. Deploy — note your service URL (e.g. `https://soundhub-api.onrender.com`)

### Vercel (frontend)
1. Go to https://vercel.com → Import project from GitHub
2. Set root directory to `frontend`
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = your Render URL
4. Deploy

### UptimeRobot (keeps Render alive — prevents cold starts)
1. Go to https://uptimerobot.com → free account
2. Create monitor → HTTP → URL: `https://your-render-url.onrender.com/health`
3. Interval: every 5 minutes
4. This prevents Render from spinning down between requests

---

## Step 3 — Set up GitHub Actions

1. Go to your GitHub repo → Settings → Secrets and variables → Actions
2. Add each secret from `.github/secrets.example`
3. The scrape cron will run automatically at 12:00 AM and 12:00 PM UTC
4. Manually trigger a first run: Actions → Scrape Agent → Run workflow

---

## Step 4 — Load initial account seeds

```bash
cd backend
python utils/seed_loader.py
```

This reads `config/account_seeds.json` and inserts all 140 accounts into Supabase.

---

## Step 5 — First run

1. Open your Vercel frontend URL
2. Click **↺ Refresh now** to trigger the first scrape
3. Wait 5–10 minutes for clips to populate the feed
4. Select clips → Compose → add audio → Add to queue
5. Review queue → Approve posts
6. Agent publishes within 12–24hrs automatically

---

## Day-to-day workflow

- Scrape feed auto-refreshes every 12hrs
- Clips expire at 48hrs if not used
- Audio library: upload new snippets any time via the Audio Library tab
- Post queue: approve posts before they go live
- Agents tab: adjust thresholds, add training notes

---

## Adding X/Twitter later

1. Get X Basic API access ($100/mo) at https://developer.x.com
2. Add `TWITTER_BEARER_TOKEN` and `TWITTER_ACCESS_TOKEN` to env vars
3. Add `twitter` to `PLATFORM_SPECS` in `compose_agent.py`
4. Add `publish_twitter()` function to `syndication_agent.py`
5. Update the UI platform list in `PostQueue.tsx` and `Compose.tsx`

---

## File structure

```
soundhub/
├── .github/
│   └── workflows/
│       ├── scrape.yml          ← runs every 12hrs
│       └── seed_refresh.yml    ← runs every 14 days
├── backend/
│   ├── agents/
│   │   ├── scrape_agent.py     ← Agent 1: discover + download clips
│   │   ├── compose_agent.py    ← Agent 2: FFmpeg AV merge + platform versions
│   │   ├── syndication_agent.py← Agent 3: publish to TikTok/IG/YT
│   │   └── seed_refresh_agent.py← Agent 4: bi-weekly account re-ranking
│   ├── api/
│   │   └── main.py             ← FastAPI server (runs on Render)
│   ├── db/
│   │   ├── schema.sql          ← Supabase database schema
│   │   └── client.py           ← Database helper functions
│   ├── utils/
│   │   ├── r2.py               ← Cloudflare R2 storage
│   │   ├── scoring.py          ← Viral score + threshold evaluation
│   │   └── caption_gen.py      ← Claude API caption generator
│   ├── .env.example            ← Backend secrets template
│   └── requirements.txt
├── config/
│   ├── thresholds.json         ← All tier thresholds + platform specs
│   └── account_seeds.json      ← 140 seeded accounts across 7 categories
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── scrape/         ← Scrape feed gallery
│   │   │   ├── library/        ← Audio library manager
│   │   │   ├── compose/        ← AV compose studio
│   │   │   ├── queue/          ← Post approval queue
│   │   │   ├── agents/         ← Agent config + seed list
│   │   │   └── ui/             ← Shared components
│   │   ├── lib/
│   │   │   ├── api.ts          ← API client
│   │   │   └── utils.ts        ← Formatters + helpers
│   │   └── pages/
│   │       └── index.tsx       ← Main app
│   ├── .env.example
│   └── package.json
├── render.yaml                 ← Render deployment config
└── README.md
```

---

## Environment variables reference

See `backend/.env.example` and `frontend/.env.example` for all required values.
