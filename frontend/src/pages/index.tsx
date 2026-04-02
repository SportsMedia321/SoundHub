import React, { useState, useEffect } from "react";
import useSWR from "swr";
import { getClipStats, getAgentState, triggerScrape, type Clip } from "../lib/api";
import { humanDate } from "../lib/utils";
import ScrapeFeed from "../components/scrape/ScrapeFeed";
import AudioLibrary from "../components/library/AudioLibrary";
import Compose from "../components/compose/Compose";
import PostQueue from "../components/queue/PostQueue";
import AgentsPage from "../components/agents/AgentsPage";

type Tab = "scrape" | "library" | "compose" | "queue" | "agents";

const TABS: { id: Tab; label: string }[] = [
  { id: "scrape", label: "Scrape feed" },
  { id: "library", label: "Audio library" },
  { id: "compose", label: "Compose" },
  { id: "queue", label: "Post queue" },
  { id: "agents", label: "Agents" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("scrape");
  const [composeClips, setComposeClips] = useState<Clip[]>([]);
  const [queueCount, setQueueCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const { data: stats } = useSWR("clip-stats-nav", getClipStats, { refreshInterval: 60000 });
  const { data: agentState } = useSWR("agent-state-nav", getAgentState, { refreshInterval: 30000 });

  // Estimate next scrape from agent state
  const nextRun = agentState?.scrape_next_run;
  const isRunning = nextRun === "running";

  const handleCompose = (clips: Clip[]) => {
    setComposeClips(clips);
    setTab("compose");
  };

  const handleQueued = () => {
    setTab("queue");
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await triggerScrape(); } catch {}
    setTimeout(() => setRefreshing(false), 2000);
  };

  return (
    <div
      style={{
        "--br": "#00e87a",
        "--brd": "rgba(0,232,122,0.12)",
        "--brb": "rgba(0,232,122,0.28)",
        "--boh": "rgba(0,232,122,0.28)",
        "--s0": "#0b0d0f",
        "--s1": "#111417",
        "--s2": "#181c20",
        "--s3": "#1e2328",
        "--bo": "rgba(255,255,255,0.07)",
        "--t": "#e4e6e9",
        "--t2": "#6e7680",
        "--t3": "#2e353d",
        "--fh": "'Syne', sans-serif",
        "--fm": "'DM Mono', monospace",
      } as React.CSSProperties}
      className="flex flex-col h-screen overflow-hidden font-sans"
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0b0d0f; color: #e4e6e9; font-family: 'Syne', sans-serif; }
        :root {
          --br: #00e87a; --brd: rgba(0,232,122,0.12); --brb: rgba(0,232,122,0.28);
          --boh: rgba(0,232,122,0.28); --s0: #0b0d0f; --s1: #111417; --s2: #181c20;
          --s3: #1e2328; --bo: rgba(255,255,255,0.07); --t: #e4e6e9; --t2: #6e7680;
          --t3: #2e353d; --fh: 'Syne', sans-serif; --fm: 'DM Mono', monospace;
        }
        input[type=range] { accent-color: var(--br); }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: var(--s3); border-radius: 2px; }
        select { appearance: none; -webkit-appearance: none; }
        textarea { font-family: var(--fh); }
      `}</style>

      {/* Navbar */}
      <nav
        className="flex items-center px-[16px] h-[48px] flex-shrink-0 border-b"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        {/* Logo */}
        <div
          className="text-[13px] font-bold mr-[20px] tracking-[-0.3px]"
          style={{ color: "var(--br)", fontFamily: "var(--fm)" }}
        >
          sound<span style={{ color: "var(--t2)" }}>/</span>hub
        </div>

        {/* Tabs */}
        <div className="flex gap-[1px]">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className="px-[11px] py-[5px] rounded-md text-[11px] font-medium border transition-all whitespace-nowrap"
              style={{
                background: tab === id ? "var(--brd)" : "transparent",
                color: tab === id ? "var(--br)" : "var(--t2)",
                borderColor: tab === id ? "var(--brb)" : "transparent",
                fontFamily: "var(--fh)",
              }}
            >
              {label}
              {id === "queue" && queueCount > 0 && (
                <span
                  className="ml-[4px] text-[8px] font-mono px-[5px] py-[1px] rounded-[10px] border"
                  style={{
                    background: "var(--brd)",
                    color: "var(--br)",
                    borderColor: "var(--brb)",
                  }}
                >
                  {queueCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Right pills */}
        <div className="ml-auto flex items-center gap-[6px]">
          <span
            className="text-[9px] font-mono px-[8px] py-[3px] rounded-[20px] border"
            style={{
              color: "var(--br)",
              borderColor: "var(--brb)",
              background: "var(--brd)",
            }}
          >
            ● Live
          </span>
          <span
            className="text-[9px] font-mono px-[8px] py-[3px] rounded-[20px] border"
            style={{
              color: "#fbbf24",
              borderColor: "rgba(251,191,36,0.3)",
              background: "rgba(251,191,36,0.08)",
            }}
          >
            {isRunning ? "Scraping..." : `Refresh: ${nextRun ? humanDate(nextRun) : "—"}`}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing || isRunning}
            className="text-[10px] font-medium px-[9px] py-[4px] rounded-md border transition-all"
            style={{
              background: "var(--s2)",
              color: "var(--t)",
              borderColor: "var(--bo)",
              fontFamily: "var(--fh)",
            }}
          >
            {refreshing ? "Refreshing..." : "↺ Refresh now"}
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="flex flex-1 overflow-hidden min-h-0" style={{ background: "var(--s0)" }}>
        <div className={`flex flex-1 overflow-hidden min-h-0 ${tab !== "scrape" ? "hidden" : ""}`}>
          <ScrapeFeed onCompose={handleCompose} />
        </div>
        <div className={`flex flex-1 overflow-hidden min-h-0 ${tab !== "library" ? "hidden" : ""}`}>
          <AudioLibrary />
        </div>
        <div className={`flex flex-1 overflow-hidden min-h-0 ${tab !== "compose" ? "hidden" : ""}`}>
          <Compose initialClips={composeClips} onQueued={handleQueued} />
        </div>
        <div className={`flex flex-1 overflow-hidden min-h-0 ${tab !== "queue" ? "hidden" : ""}`}>
          <PostQueue />
        </div>
        <div className={`flex flex-1 overflow-hidden min-h-0 ${tab !== "agents" ? "hidden" : ""}`}>
          <AgentsPage />
        </div>
      </main>
    </div>
  );
}
