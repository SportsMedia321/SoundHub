import React, { useState } from "react";
import useSWR from "swr";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function fetchClips() {
  try {
    const res = await fetch(`${BASE}/clips`);
    if (!res.ok) return { clips: [] };
    const data = await res.json();
    return { clips: Array.isArray(data?.clips) ? data.clips : [] };
  } catch {
    return { clips: [] };
  }
}

async function fetchStats() {
  try {
    const res = await fetch(`${BASE}/clips/stats`);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

export default function App() {
  const { data: clipsData } = useSWR("clips", fetchClips, { refreshInterval: 60000 });
  const { data: stats } = useSWR("stats", fetchStats, { refreshInterval: 30000 });
  const clips = Array.isArray(clipsData?.clips) ? clipsData.clips : [];

  return (
    <div style={{ background: "#0b0d0f", color: "#e4e6e9", minHeight: "100vh", fontFamily: "monospace", padding: 24 }}>
      <style>{`body { margin: 0; background: #0b0d0f; }`}</style>
      <div style={{ color: "#00e87a", fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
        sound/hub — diagnostic mode
      </div>
      <div style={{ marginBottom: 16, fontSize: 12, color: "#6e7680" }}>
        Backend: {BASE} · Clips loaded: {clips.length} · Stats: {JSON.stringify(stats ?? {})}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {clips.map((clip: any, i: number) => (
          <div
            key={clip.id ?? i}
            style={{
              background: "#181c20",
              border: "0.5px solid rgba(255,255,255,0.07)",
              borderRadius: 8,
              padding: "8px 10px",
            }}
          >
            <div style={{ fontSize: 10, color: "#00e87a", marginBottom: 4 }}>
              {clip.sport_category} · {clip.source_platform}
            </div>
            <div style={{ fontSize: 9, color: "#6e7680", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {clip.caption?.slice(0, 60) || "No caption"}
            </div>
            <div style={{ fontSize: 9, color: "#2e353d" }}>
              score={clip.viral_score} · views={clip.views_at_ingest?.toLocaleString()}
            </div>
          </div>
        ))}
      </div>
      {clips.length === 0 && (
        <div style={{ color: "#6e7680", fontSize: 12, marginTop: 32 }}>
          No clips loaded. Check that backend is running and NEXT_PUBLIC_API_URL is set correctly.
        </div>
      )}
    </div>
  );
}
