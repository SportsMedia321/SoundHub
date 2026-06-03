const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

// ── Clips ──────────────────────────────────────────────────────────────────
export const getClips = (category?: string) =>
  req<{ clips: Clip[] }>(`/clips?limit=150${category ? `&category=${category}` : ""}`);

export const getClipStats = () => req<ClipStats>("/clips/stats");

export const triggerScrape = () =>
  req("/scrape/trigger", { method: "POST" });

// ── Compose ────────────────────────────────────────────────────────────────
export const composeClip = (payload: ComposePayload) =>
  req<{ status: string; post_ids: string[] }>("/compose", {
    method: "POST",
    body: JSON.stringify(payload),
  });

// ── Queue ──────────────────────────────────────────────────────────────────
export const getQueue = () => req<{ posts: Post[] }>("/queue");

export const approvePost = (postId: string) =>
  req(`/queue/approve/${postId}`, { method: "POST" });

export const approvePosts = (postIds: string[]) =>
  req("/queue/approve", { method: "POST", body: JSON.stringify({ post_ids: postIds }) });

export const editPost = (payload: EditPostPayload) =>
  req("/queue/edit", { method: "PATCH", body: JSON.stringify(payload) });

// ── Audio ──────────────────────────────────────────────────────────────────
export const getAudio = () => req<{ tracks: AudioTrack[] }>("/audio");

export const uploadAudio = async (file: File) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${BASE}/audio/upload`, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
};

export const deleteAudio = (audioId: string) =>
  req(`/audio/${audioId}`, { method: "DELETE" });

export const updateAudioTags = (
  audioId: string,
  leaguePref: string[],
  platformNative: Record<string, string>
) =>
  req(`/audio/${audioId}/tags`, {
    method: "PATCH",
    body: JSON.stringify({ league_preference: leaguePref, platform_native: platformNative }),
  });

// ── Agents ─────────────────────────────────────────────────────────────────
export const getAgentState = () => req<AgentState>("/agents/state");

export const getTrainingNotes = (agent?: string) =>
  req<{ notes: TrainingNote[] }>(`/agents/training${agent ? `?agent=${agent}` : ""}`);

export const addTrainingNote = (agent: string, action: string, note: string) =>
  req("/agents/training", {
    method: "POST",
    body: JSON.stringify({ agent, action, note }),
  });

export const triggerSeedRefresh = () =>
  req("/seeds/refresh", { method: "POST" });

export const getSeeds = (category?: string) =>
  req<{ seeds: AccountSeed[] }>(`/seeds${category ? `?category=${category}` : ""}`);

// ── Types ──────────────────────────────────────────────────────────────────
export interface Clip {
  id: string;
  source_platform: string;
  source_account: string;
  sport_category: string;
  tier: number;
  original_post_url: string;
  video_r2_key: string;
  preview_url?: string;
  caption: string;
  hashtags: string[];
  duration_seconds: number;
  views_at_ingest: number;
  likes_at_ingest: number;
  shares_at_ingest: number;
  engagement_rate: number;
  viral_score: number;
  post_event_hours: number;
  status: string;
  expires_at: string;
  ingested_at: string;
}

export interface ClipStats {
  total_active: number;
  tier1_count: number;
  misc_count: number;
  expiring_soon: number;
  scrape_last_run: string;
  scrape_next_run: string;
}

export interface Post {
  id: string;
  clip_id: string;
  platform: string;
  format: string;
  video_r2_key: string;
  audio_track_id: string;
  audio_new_volume: number;
  audio_original_volume: number;
  use_platform_native_audio: boolean;
  platform_native_sound_id: string;
  caption_generated: string;
  caption_final: string;
  hashtags_generated: string[];
  approval_status: string;
  approved_at: string;
  scheduled_post_time: string;
  within_priority_window: boolean;
  clips?: Clip;
  audio_library?: AudioTrack;
}

export interface AudioTrack {
  id: string;
  name: string;
  r2_key: string;
  duration_seconds: number;
  format: string;
  league_preference: string[];
  platform_native: Record<string, string>;
  use_count: number;
  avg_eng_boost: number;
  best_performing_with: string;
  preview_url?: string;
  uploaded_at: string;
}

export interface AgentState {
  scrape_last_run: string;
  scrape_next_run: string;
  seed_last_refresh: string;
  seed_next_refresh: string;
  total_clips_24hr: number;
  total_posts_pending: number;
}

export interface TrainingNote {
  id: number;
  agent: string;
  action: string;
  note: string;
  created_at: string;
}

export interface AccountSeed {
  id: string;
  handle: string;
  platform: string;
  category: string;
  account_type: string;
  is_pinned_official: boolean;
  seed_rank: number;
  avg_eng_rate_14d: number;
  trend_direction: string;
  status: string;
}

export interface ComposePayload {
  clip_id: string;
  audio_id?: string;
  new_vol: number;
  orig_vol: number;
}

export interface EditPostPayload {
  post_id: string;
  caption?: string;
  hashtags?: string[];
  training_note?: string;
}
