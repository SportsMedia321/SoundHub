import React, { useState } from "react";
import useSWR from "swr";
import { getAgentState, triggerScrape, type Clip } from "../lib/api";
import { humanDate } from "../lib/utils";

const BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Tab = "scrape" | "library" | "compose" | "queue" | "agents";

const TABS: { id: Tab; label: string }[] = [
  { id: "scrape", label: "Scrape feed" },
  { id: "library", label: "Audio library" },
  { id: "compose", label: "Compose" },
  { id: "queue", label: "Post queue" },
  { id: "agents", label: "Agents" },
];

class ErrorBoundary extends React.Component<
  { children: React.ReactNode; label: string },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: 24, fontFamily: "monospace", color: "#e4e6e9",
          background: "#0b0d0f", flex: 1,
        }}>
          <div style={{ color: "#00e87a", marginBottom: 8 }}>sound/hub</div>
          <div style={{ color: "#e74c3c", marginBottom: 8 }}>
            {this.props.label} crashed:
          </div>
          <div style={{ color: "#fbbf24", marginBottom: 16, fontSize: 11 }}>
            {this.state.error}
          </div>
          <button
            onClick={() => this.setState({ hasError: false, error: "" })}
            style={{
              background: "#00e87a", color: "#000", border: "none",
              padding: "8px 16px", cursor: "pointer", borderRadius: 6,
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function LazyTab({ tabId, activeTab, label, children }: {
  tabId: Tab;
  activeTab: Tab;
  label: string;
  children: React.ReactNode;
}) {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    if (activeTab === tabId) setLoaded(true);
  }, [activeTab, tabId]);

  if (!loaded) return null;

  return (
    <div style={{
      display: activeTab === tabId ? "flex" : "none",
      flex: 1,
      overflow: "hidden",
      minHeight: 0,
    }}>
      <ErrorBoundary label={label}>
        {children}
      </ErrorBoundary>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("scrape");
  const [composeClips, setComposeClips] = useState<Clip[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const { data: agentState } = useSWR("agent-state-nav", getAgentState, {
    refreshInterval: 30000,
    onError: () => {},
  });

  const nextRun = agentState?.scrape_next_run ?? "";
  const isRunning = nextRun === "running";

  const handleCompose = (clips: Clip[]) => {
    setComposeClips(clips);
    setTab("compose");
  };

  const handleQueued = () => setTab("queue");

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await triggerScrape(); } catch {}
    setTimeout(() => setRefreshing(false), 2000);
  };

  // Lazy imports to prevent any component from crashing on initial load
  const ScrapeFeed = React.lazy(() => import("../components/scrape/ScrapeFeed"));
  const AudioLibrary = React.lazy(() => import("../components/library/AudioLibrary"));
  const Compose = React.lazy(() => import("../components/compose/Compose"));
  const PostQueue = React.lazy(() => import("../components/queue/PostQueue"));
  const AgentsPage = React.lazy(() => import("../components/agents/AgentsPage"));

  return (
    <div style={{
      background: "#0b0d0f",
      color: "#e4e6e9",
      height: "100vh",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
      fontFamily: "'Syne', sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;700&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; background: #0b0d0f; color: #e4e6e9; }
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
        select { appearance: none; }
      `}</style>

      <nav style={{
        display: "flex", alignItems: "center", padding: "0 16px",
        height: 48, flexShrink: 0, background: "#111417",
        borderBottom: "0.5px solid rgba(255,255,255,0.07)",
      }}>
        <div style={{
          fontSize: 13, fontWeight: 700, marginRight: 20,
          color: "#00e87a", fontFamily: "'DM Mono', monospace",
        }}>
          sound<span style={{ color: "#6e7680" }}>/</span>hub
        </div>

        <div style={{ display: "flex", gap: 1 }}>
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                padding: "5px 11px", borderRadius: 6, fontSize: 11,
                fontWeight: 500, cursor: "pointer",
                fontFamily: "'Syne', sans-serif", whiteSpace: "nowrap",
                color: tab === id ? "#00e87a" : "#6e7680",
                background: tab === id ? "rgba(0,232,122,0.12)" : "transparent",
                border: tab === id
                  ? "0.5px solid rgba(0,232,122,0.28)"
                  : "0.5px solid transparent",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, fontFamily: "'DM Mono', monospace",
            color: "#00e87a", padding: "3px 8px", borderRadius: 20,
            border: "0.5px solid rgba(0,232,122,0.28)",
            background: "rgba(0,232,122,0.12)",
          }}>
            ● Live
          </span>
          <span style={{
            fontSize: 9, fontFamily: "'DM Mono', monospace",
            color: "#fbbf24", padding: "3px 8px", borderRadius: 20,
            border: "0.5px solid rgba(251,191,36,0.3)",
            background: "rgba(251,191,36,0.08)",
          }}>
            {isRunning ? "Scraping..." : `Next: ${nextRun ? humanDate(nextRun) : "—"}`}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing || isRunning}
            style={{
              fontSize: 10, fontWeight: 500, background: "#181c20",
              color: "#e4e6e9", padding: "4px 9px", borderRadius: 6,
              border: "0.5px solid rgba(255,255,255,0.07)",
              cursor: "pointer", fontFamily: "'Syne', sans-serif",
            }}
          >
            {refreshing ? "Triggering..." : "↺ Refresh now"}
          </button>
        </div>
      </nav>

      <main style={{
        display: "flex", flex: 1, overflow: "hidden",
        minHeight: 0, background: "#0b0d0f", position: "relative",
      }}>
        <React.Suspense fallback={
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#6e7680", fontFamily: "monospace" }}>
            Loading...
          </div>
        }>
          <LazyTab tabId="scrape" activeTab={tab} label="Scrape Feed">
            <ScrapeFeed onCompose={handleCompose} />
          </LazyTab>

          <LazyTab tabId="library" activeTab={tab} label="Audio Library">
            <AudioLibrary />
          </LazyTab>

          <LazyTab tabId="compose" activeTab={tab} label="Compose">
            <Compose initialClips={composeClips} onQueued={handleQueued} />
          </LazyTab>

          <LazyTab tabId="queue" activeTab={tab} label="Post Queue">
            <PostQueue />
          </LazyTab>

          <LazyTab tabId="agents" activeTab={tab} label="Agents">
            <AgentsPage />
          </LazyTab>
        </React.Suspense>
      </main>
    </div>
  );
}
