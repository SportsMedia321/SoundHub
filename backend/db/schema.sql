-- soundhub database schema
-- Run this in Supabase SQL editor to initialize

-- CLIPS table
CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  source_platform TEXT NOT NULL,
  source_account TEXT NOT NULL,
  source_account_type TEXT,
  discovery_method TEXT DEFAULT 'account_seed',
  sport_category TEXT NOT NULL,
  tier INTEGER NOT NULL,
  original_post_url TEXT,
  video_r2_key TEXT,
  thumbnail_url TEXT,
  caption TEXT,
  hashtags JSONB DEFAULT '[]',
  duration_seconds INTEGER,
  views_at_ingest BIGINT DEFAULT 0,
  views_velocity_per_hr BIGINT DEFAULT 0,
  likes_at_ingest BIGINT DEFAULT 0,
  comments_at_ingest BIGINT DEFAULT 0,
  shares_at_ingest BIGINT DEFAULT 0,
  saves_at_ingest BIGINT DEFAULT 0,
  engagement_rate FLOAT DEFAULT 0,
  share_velocity_4hr BIGINT DEFAULT 0,
  threshold_cleared BOOLEAN DEFAULT FALSE,
  viral_score FLOAT DEFAULT 0,
  post_event_hours INTEGER,
  status TEXT DEFAULT 'queued',
  ingested_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ACCOUNT_SEEDS table
CREATE TABLE IF NOT EXISTS account_seeds (
  id TEXT PRIMARY KEY,
  handle TEXT NOT NULL,
  platform TEXT NOT NULL,
  category TEXT NOT NULL,
  account_type TEXT,
  is_pinned_official BOOLEAN DEFAULT FALSE,
  seed_rank INTEGER DEFAULT 99,
  avg_eng_rate_14d FLOAT DEFAULT 0,
  avg_views_per_post_14d BIGINT DEFAULT 0,
  posts_per_day_avg FLOAT DEFAULT 0,
  clips_contributed_this_cycle INTEGER DEFAULT 0,
  trend_direction TEXT DEFAULT 'flat',
  last_evaluated TIMESTAMPTZ,
  next_evaluation TIMESTAMPTZ,
  added_to_seed TIMESTAMPTZ DEFAULT NOW(),
  consecutive_cycles_below_threshold INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  UNIQUE(handle, platform, category)
);

-- AUDIO_LIBRARY table
CREATE TABLE IF NOT EXISTS audio_library (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  duration_seconds FLOAT,
  file_size_bytes BIGINT,
  format TEXT,
  league_preference JSONB DEFAULT '[]',
  platform_native JSONB DEFAULT '{}',
  use_count INTEGER DEFAULT 0,
  avg_eng_boost FLOAT DEFAULT 0,
  best_performing_with TEXT,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'active'
);

-- POSTS table
CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  clip_id TEXT REFERENCES clips(id),
  platform TEXT NOT NULL,
  target_account TEXT,
  format TEXT,
  duration_seconds INTEGER,
  video_r2_key TEXT,
  audio_track_id TEXT REFERENCES audio_library(id),
  audio_new_volume FLOAT DEFAULT 1.0,
  audio_original_volume FLOAT DEFAULT 0.0,
  use_platform_native_audio BOOLEAN DEFAULT FALSE,
  platform_native_sound_id TEXT,
  caption_generated TEXT,
  hashtags_generated JSONB DEFAULT '[]',
  caption_user_edited BOOLEAN DEFAULT FALSE,
  caption_final TEXT,
  approval_status TEXT DEFAULT 'pending',
  approved_at TIMESTAMPTZ,
  scheduled_post_time TIMESTAMPTZ,
  within_priority_window BOOLEAN DEFAULT FALSE,
  drafted_on_platform BOOLEAN DEFAULT FALSE,
  platform_post_id TEXT,
  published_at TIMESTAMPTZ,
  post_views_1hr BIGINT,
  post_views_6hr BIGINT,
  post_views_24hr BIGINT,
  post_eng_rate FLOAT,
  post_shares BIGINT,
  deleted_after_publish BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRAINING_NOTES table
CREATE TABLE IF NOT EXISTS training_notes (
  id BIGSERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT NOT NULL,
  applied BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AGENT_STATE table
CREATE TABLE IF NOT EXISTS agent_state (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_clips_status ON clips(status);
CREATE INDEX IF NOT EXISTS idx_clips_category ON clips(sport_category);
CREATE INDEX IF NOT EXISTS idx_clips_expires ON clips(expires_at);
CREATE INDEX IF NOT EXISTS idx_clips_viral_score ON clips(viral_score DESC);
CREATE INDEX IF NOT EXISTS idx_posts_approval ON posts(approval_status);
CREATE INDEX IF NOT EXISTS idx_posts_platform ON posts(platform);
CREATE INDEX IF NOT EXISTS idx_posts_scheduled ON posts(scheduled_post_time);
CREATE INDEX IF NOT EXISTS idx_seeds_category ON account_seeds(category, seed_rank);

-- Realtime subscriptions (enable in Supabase dashboard for these tables)
-- clips, posts, agent_state

-- Insert initial agent state
INSERT INTO agent_state (key, value) VALUES
  ('scrape_last_run', '"never"'),
  ('scrape_next_run', '"pending"'),
  ('seed_last_refresh', '"never"'),
  ('seed_next_refresh', '"pending"'),
  ('total_clips_24hr', '0'),
  ('total_posts_pending', '0')
ON CONFLICT (key) DO NOTHING;
