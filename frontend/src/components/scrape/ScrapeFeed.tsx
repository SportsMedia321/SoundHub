import React, { useState, useCallback } from "react";
import useSWR from "swr";
import { getClips, getClipStats, triggerScrape, type Clip } from "../../lib/api";
import {
  fmtViews, fmtPct, ttlPct, ttlColor, timeAgo,
  platformColor, platformLabel, categoryColor,
} from "../../lib/utils";
import { Btn, StatCard, Pill, Empty, Spinner } from "../ui";

const CATEGORIES = ["All", "NFL", "NBA", "MLB", "NHL", "MLS", "US Intl", "MISC"];
const SORTS = ["Viral score", "Views", "Recency", "TTL remaining"];

function wfHeights() {
  return [22, 35, 50, 38, 58, 28, 45, 33, 55, 40, 30, 48];
}

function ClipCard({
  clip,
  selected,
  onToggle,
}: {
  clip: Clip;
  selected: boolean;
  onToggle: () => void;
}) {
  const pct = ttlPct(clip.expires_at);
  const pc = platformColor(clip.source_platform);
  const cc = categoryColor(clip.sport_category);
  const viral = clip.viral_score > 80;

  return (
    <div
      onClick={onToggle}
      className="rounded-[10px] overflow-hidden cursor-pointer transition-all duration-150"
      style={{
        background: "var(--s2)",
        border: `0.5px solid ${selected ? "var(--br)" : "var(--bo)"}`,
        transform: selected ? "translateY(-1px)" : undefined,
      }}
    >
      {/* Thumbnail / Video Preview */}
      <div
        className="w-full relative overflow-hidden flex items-center justify-center"
        style={{ aspectRatio: "9/12", background: "var(--s3)" }}
      >
        {clip.preview_url ? (
          <video
            src={clip.preview_url}
            className="absolute inset-0 w-full h-full object-cover"
            muted
            playsInline
            loop
            onMouseEnter={(e) => (e.target as HTMLVideoElement).play()}
            onMouseLeave={(e) => {
              const v = e.target as HTMLVideoElement;
              v.pause();
              v.currentTime = 0;
            }}
          />
        ) : (
          <div className="flex items-end gap-[2px] h-8 z-10 relative px-2">
            {wfHeights().map((h, i) => (
              <div
                key={i}
                className="w-[2px] rounded-sm"
                style={{ height: h, background: "rgba(255,255,255,0.4)" }}
              />
            ))}
          </div>
        )}
        {/* play button overlay — only show when no video */}
        {!clip.preview_url && (
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center z-20"
            style={{ background: "rgba(0,0,0,0.55)" }}
          >
            <div
              className="ml-[2px]"
              style={{
                width: 0, height: 0,
                borderTop: "5px solid transparent",
                borderBottom: "5px solid transparent",
                borderLeft: "9px solid #fff",
              }}
            />
          </div>
        )}
        {/* platform badge */}
        <div
          className="absolute top-[6px] left-[6px] text-[8px] font-mono font-medium px-[5px] py-[2px] rounded-[20px] z-30"
          style={{ background: `${pc}22`, color: pc, border: `0.5px solid ${pc}55` }}
        >
          {platformLabel(clip.source_platform)}
        </div>
        {/* category badge */}
        <div
          className="absolute top-[6px] right-[6px] text-[8px] font-mono font-medium px-[5px] py-[2px] rounded-[20px] z-30 text-white"
          style={{ background: `${cc}44`, border: `0.5px solid ${cc}77` }}
        >
          {clip.sport_category}
        </div>
        {/* viral badge */}
        {viral && (
          <div
            className="absolute bottom-[14px] right-[6px] text-[8px] font-mono px-[5px] py-[2px] rounded-[20px] z-30"
            style={{
              background: "var(--brd)",
              border: "0.5px solid var(--brb)",
              color: "var(--br)",
            }}
          >
            VIRAL
          </div>
        )}
        {/* TTL bar */}
        <div
          className="absolute bottom-[6px] left-[6px] right-[6px] h-[2px] rounded-sm z-30"
          style={{ background: "rgba(255,255,255,0.1)" }}
        >
          <div
            className="h-full rounded-sm transition-all"
            style={{ width: `${pct}%`, background: ttlColor(pct) }}
          />
        </div>
      </div>

      {/* Body */}
      <div className="p-[6px_8px]">
          <div
            className="text-[9px] font-medium truncate mb-[1px]"
          style={{ color: "var(--t)" }}
        >
          {clip.caption?.slice(0, 60) || "Untitled clip"}
        </div>
        <div className="text-[9px] mb-[5px]" style={{ color: "var(--t2)" }}>
          {clip.source_account} · {timeAgo(clip.ingested_at)}
        </div>
        <div className="flex gap-[7px]">
          <span
            className="text-[8px] font-mono"
            style={{ color: viral ? "var(--br)" : "var(--t2)" }}
          >
            ▶ {fmtViews(clip.views_at_ingest)}
          </span>
          <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
            ↗ {fmtViews(clip.shares_at_ingest)}
          </span>
          <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
            ❋ {fmtPct(clip.engagement_rate)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ScrapeFeed({
  onCompose,
}: {
  onCompose: (clips: Clip[]) => void;
}) {
  const [category, setCategory] = useState("All");
  const [sort, setSort] = useState("Viral score");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [refreshing, setRefreshing] = useState(false);

  const { data: statsData, mutate: mutateStats } = useSWR("clip-stats", getClipStats, {
    refreshInterval: 30000,
  });
  const { data: clipsData, mutate: mutateClips, isLoading } = useSWR(
    ["clips", category],
    () => getClips(category === "All" ? undefined : category),
    { refreshInterval: 60000 }
  );

  const clips = clipsData?.clips ?? [];
  const stats = statsData;

  const sorted = [...clips]
    .filter((c) =>
      search
        ? c.caption?.toLowerCase().includes(search.toLowerCase()) ||
          c.source_account?.toLowerCase().includes(search.toLowerCase()) ||
          c.sport_category?.toLowerCase().includes(search.toLowerCase())
        : true
    )
    .sort((a, b) => {
      if (sort === "Views") return b.views_at_ingest - a.views_at_ingest;
      if (sort === "Recency") return a.post_event_hours - b.post_event_hours;
      if (sort === "TTL remaining")
        return new Date(b.expires_at).getTime() - new Date(a.expires_at).getTime();
      return b.viral_score - a.viral_score;
    });

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await triggerScrape();
      setTimeout(() => {
        mutateClips();
        mutateStats();
        setRefreshing(false);
      }, 2000);
    } catch {
      setRefreshing(false);
    }
  };

  const selectedClips = React.useMemo(
    () => sorted.filter((c) => selected.has(c.id)),
    [sorted, selected]
  );

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      {/* Stats row */}
      <div
        className="grid grid-cols-4 gap-[7px] p-[10px_16px] border-b flex-shrink-0"
        style={{ borderColor: "var(--bo)" }}
      >
        <StatCard
          label="Active clips"
          value={stats?.total_active ?? "—"}
          delta={`target: 35/day`}
        />
        <StatCard
          label="NFL / NBA"
          value={stats?.tier1_count ?? "—"}
          delta="Tier 1 priority"
        />
        <StatCard
          label="MISC viral"
          value={stats?.misc_count ?? "—"}
          delta="≥1.5M · ≥10% eng"
        />
        <StatCard
          label="Expiring <4hrs"
          value={stats?.expiring_soon ?? "—"}
          delta="Act soon"
        />
      </div>

      {/* Topbar */}
      <div
        className="flex items-center gap-2 p-[10px_16px] border-b flex-shrink-0"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        <input
          className="rounded-[7px] px-[10px] py-[6px] text-[11px] outline-none w-48"
          style={{
            background: "var(--s2)",
            border: "0.5px solid var(--bo)",
            color: "var(--t)",
            fontFamily: "var(--fh)",
          }}
          placeholder="Search clips, teams..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="rounded-[7px] px-[8px] py-[5px] text-[10px] outline-none"
          style={{
            background: "var(--s2)",
            border: "0.5px solid var(--bo)",
            color: "var(--t2)",
            fontFamily: "var(--fm)",
          }}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          {SORTS.map((s) => <option key={s}>{s}</option>)}
        </select>
        <div className="ml-auto flex gap-[6px]">
          <Btn onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "↺ Refresh now"}
          </Btn>
          <Btn
            variant="primary"
            disabled={selected.size === 0}
            onClick={() => onCompose(selectedClips)}
          >
            Compose selected ({selected.size}) ↗
          </Btn>
        </div>
      </div>

      {/* Category filter */}
      <div
        className="flex gap-[2px] px-[16px] pt-[10px] pb-[8px] flex-shrink-0 overflow-x-auto"
        style={{ background: "var(--s0)" }}
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setCategory(cat)}
            className="px-[10px] py-[4px] rounded-md text-[10px] font-medium whitespace-nowrap border transition-all"
            style={{
              background: category === cat ? "var(--brd)" : "transparent",
              color: category === cat ? "var(--br)" : "var(--t2)",
              borderColor: category === cat ? "var(--brb)" : "transparent",
              fontFamily: "var(--fh)",
            }}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Gallery */}
      <div className="flex-1 overflow-y-auto px-[16px] pb-[14px]">
        {isLoading ? (
          <div className="flex justify-center pt-16"><Spinner /></div>
        ) : sorted.length === 0 ? (
          <Empty label="No clips found — trigger a scrape to populate the feed" />
        ) : (
          <div className="grid grid-cols-4 gap-[7px]">
            {sorted.map((clip) => (
              <ClipCard
                key={clip.id}
                clip={clip}
                selected={selected.has(clip.id)}
                onToggle={() => toggleSelect(clip.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Bottom bar */}
      <div
        className="flex items-center gap-[7px] p-[9px_16px] border-t flex-shrink-0"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        <span className="text-[10px] font-mono flex-1" style={{ color: "var(--t2)" }}>
          Selected:{" "}
          <span style={{ color: "var(--br)" }}>{selected.size}</span> clips
        </span>
        <Btn
          variant="danger"
          disabled={selected.size === 0}
          onClick={() => setSelected(new Set())}
        >
          Clear selection
        </Btn>
        <Btn
          variant="primary"
          disabled={selected.size === 0}
          onClick={() => onCompose(selectedClips)}
        >
          Send to compose ↗
        </Btn>
      </div>
    </div>
  );
}
