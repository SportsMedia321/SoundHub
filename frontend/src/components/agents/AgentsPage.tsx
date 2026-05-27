import React, { useState } from "react";
import useSWR from "swr";
import {
  getAgentState, getTrainingNotes, getSeeds, triggerSeedRefresh,
  addTrainingNote, type AccountSeed,
} from "../../lib/api";
import { humanDate, categoryColor, platformColor } from "../../lib/utils";
import { Btn, Toggle, SectionLabel, Empty, Spinner } from "../ui";

const CATEGORIES = ["NFL", "NBA", "MLB", "NHL", "MLS", "US Intl", "MISC"];

function AgentCard({
  title,
  description,
  iconColor,
  running,
  config,
  trainingNotes,
  children,
}: {
  title: string;
  description: string;
  iconColor: string;
  running: boolean;
  config: { label: string; value: string }[];
  trainingNotes: string[];
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-[10px] border overflow-hidden"
      style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
    >
      <div
        className="flex items-center gap-[9px] p-[10px_13px] border-b cursor-pointer"
        style={{ borderColor: "var(--bo)" }}
        onClick={() => setOpen(!open)}
      >
        <div
          className="w-[30px] h-[30px] rounded-[7px] flex-shrink-0 border"
          style={{ background: `${iconColor}18`, borderColor: `${iconColor}30` }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-bold" style={{ color: "var(--t)" }}>{title}</div>
          <div className="text-[10px]" style={{ color: "var(--t2)" }}>{description}</div>
        </div>
        <span
          className="text-[8px] font-mono px-[8px] py-[2px] rounded-[20px] flex-shrink-0 border"
          style={
            running
              ? { background: "var(--brd)", color: "var(--br)", borderColor: "var(--brb)" }
              : { background: "var(--s3)", color: "var(--t3)", borderColor: "var(--bo)" }
          }
        >
          {running ? "● Running" : "Idle"}
        </span>
        <span className="text-[9px] ml-[4px]" style={{ color: "var(--t3)" }}>
          {open ? "▲" : "▼"}
        </span>
      </div>

      {open && (
        <div className="p-[12px_13px] flex flex-col gap-[10px]">
          {/* Config grid */}
          <div className="grid grid-cols-2 gap-x-[10px]">
            {config.map(({ label, value }) => (
              <div
                key={label}
                className="flex justify-between items-center py-[4px] border-b"
                style={{ borderColor: "var(--bo)" }}
              >
                <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>{label}</span>
                <span className="text-[9px] font-mono" style={{ color: "var(--t)" }}>{value}</span>
              </div>
            ))}
          </div>

          {/* Custom children (sliders etc) */}
          {children}

          {/* Training notes */}
          {trainingNotes.length > 0 && (
            <div className="pt-[9px] border-t" style={{ borderColor: "var(--bo)" }}>
              <SectionLabel>Training notes</SectionLabel>
              <div className="flex flex-col gap-[5px]">
                {trainingNotes.map((note, i) => (
                  <div
                    key={i}
                    className="text-[9px] rounded-md px-[8px] py-[5px] leading-[1.5] border"
                    style={{
                      background: "var(--brd)",
                      color: "var(--br)",
                      borderColor: "var(--brb)",
                    }}
                  >
                    {note}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SeedList() {
  const [category, setCategory] = useState("NFL");
  const { data, isLoading } = useSWR(
    ["seeds", category],
    () => getSeeds(category),
    { onError: () => {} }
  );
  const seeds = Array.isArray(data?.seeds) ? data.seeds : [];

  return (
    <div
      className="rounded-[10px] border overflow-hidden"
      style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
    >
      <div
        className="flex items-center gap-[8px] p-[10px_13px] border-b"
        style={{ borderColor: "var(--bo)" }}
      >
        <span className="text-[11px] font-bold" style={{ color: "var(--t)" }}>
          Account seed list
        </span>
        <div className="flex gap-[2px] overflow-x-auto ml-auto">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className="text-[9px] font-mono px-[7px] py-[2px] rounded-md border whitespace-nowrap transition-all"
              style={{
                background: category === c ? "var(--brd)" : "transparent",
                color: category === c ? "var(--br)" : "var(--t2)",
                borderColor: category === c ? "var(--brb)" : "transparent",
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div
        className="flex items-center gap-[8px] px-[12px] py-[5px] border-b text-[8px] font-mono"
        style={{ background: "var(--s3)", borderColor: "var(--bo)", color: "var(--t3)" }}
      >
        <span className="w-5">#</span>
        <span className="flex-1">Handle</span>
        <span className="w-[56px]">Type</span>
        <span className="w-[36px] text-right">Eng</span>
        <span className="w-[36px] text-right">Trend</span>
        <span className="w-[60px] text-center">Platform</span>
      </div>

      <div className="max-h-[280px] overflow-y-auto">
        {isLoading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : seeds.length === 0 ? (
          <Empty label="No seeds loaded yet" />
        ) : (
          seeds.map((seed, i) => {
            if (!seed || typeof seed !== "object") return null;
            const trendColor =
              seed.trend_direction === "up"
                ? "var(--br)"
                : seed.trend_direction === "down"
                ? "#e74c3c"
                : "var(--t3)";
            const typeColors: Record<string, string> = {
              official: "var(--br)",
              highlight: "#1d9bf0",
              media: "#a78bfa",
              fan: "#fbbf24",
            };
            return (
              <div
                key={seed.id ?? i}
                className="flex items-center gap-[8px] px-[12px] py-[6px] border-b last:border-0"
                style={{ borderColor: "var(--bo)" }}
              >
                <span
                  className="text-[9px] font-mono w-5 flex-shrink-0"
                  style={{ color: "var(--t3)" }}
                >
                  {i + 1}
                </span>
                <span
                  className="text-[10px] font-mono flex-1 truncate"
                  style={{ color: "var(--t)" }}
                >
                  {seed.handle ?? "—"}
                </span>
                <span
                  className="text-[8px] font-mono px-[5px] py-[1px] rounded-[8px] border w-[56px] text-center flex-shrink-0"
                  style={{
                    background: `${typeColors[seed.account_type] ?? "#888"}18`,
                    color: typeColors[seed.account_type] ?? "var(--t2)",
                    borderColor: `${typeColors[seed.account_type] ?? "#888"}44`,
                  }}
                >
                  {seed.account_type ?? "—"}
                </span>
                <span
                  className="text-[8px] font-mono w-[36px] text-right flex-shrink-0"
                  style={{ color: "var(--t2)" }}
                >
                  {seed.avg_eng_rate_14d
                    ? `${(seed.avg_eng_rate_14d * 100).toFixed(1)}%`
                    : "—"}
                </span>
                <span
                  className="text-[8px] font-mono w-[36px] text-right flex-shrink-0"
                  style={{ color: trendColor }}
                >
                  {seed.trend_direction === "up"
                    ? "↑ up"
                    : seed.trend_direction === "down"
                    ? "↓ dn"
                    : "— flat"}
                </span>
                <div className="flex gap-[2px] w-[60px] justify-center flex-shrink-0">
                  <span
                    className="text-[8px] font-mono"
                    style={{ color: "var(--t2)" }}
                  >
                    {seed.platform ?? "—"}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default function AgentsPage() {
  const { data: stateData } = useSWR("agent-state", getAgentState, { refreshInterval: 30000 });
  const { data: notesData } = useSWR("training-notes", () => getTrainingNotes(), { refreshInterval: 60000 });
  const notes = Array.isArray(notesData?.notes) ? notesData.notes : [];
  const state = stateData;

  const notesByAgent = (agent: string) =>
    notes.filter((n) => n.agent === agent).slice(0, 3).map((n) => n.note);

  const [minViews1, setMinViews1] = useState(500);
  const [minViews2, setMinViews2] = useState(750);
  const [minViewsMisc, setMinViewsMisc] = useState(1500);
  const [targetClips, setTargetClips] = useState(35);

  const handleRefreshSeeds = async () => {
    await triggerSeedRefresh();
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      <div
        className="flex items-center gap-[8px] p-[10px_16px] border-b flex-shrink-0"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        <span className="text-[13px] font-bold" style={{ color: "var(--t)" }}>Agent config</span>
        <span className="text-[10px]" style={{ color: "var(--t2)" }}>
          Edits train agents toward full automation
        </span>
        <div className="ml-auto flex gap-[6px]">
          <Btn size="sm" onClick={handleRefreshSeeds}>↺ Refresh seeds</Btn>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-[14px_16px]">
        <div className="flex flex-col gap-[10px]">

          <AgentCard
            title="Scrape agent"
            description="Account seed monitoring · 12hr auto-refresh · TikTok priority"
            iconColor="#00e87a"
            running={true}
            trainingNotes={notesByAgent("scrape_agent")}
            config={[
              { label: "NFL/NBA threshold", value: `${minViews1}K/6hr` },
              { label: "Tier 2 threshold", value: `${minViews2}K/6hr` },
              { label: "MISC threshold", value: `${minViewsMisc}K/6hr` },
              { label: "TikTok priority", value: "1.5× velocity mult" },
              { label: "Recency gate", value: "24–48hrs post-event" },
              { label: "TTL expiry", value: "48hrs from ingest" },
              { label: "Auto-refresh", value: "Every 12hrs" },
              { label: "MISC discovery", value: "Hashtag confirmation" },
              { label: "Last run", value: humanDate(state?.scrape_last_run ?? "") },
              { label: "Next run", value: humanDate(state?.scrape_next_run ?? "") },
            ]}
          >
            <div
              className="rounded-[8px] border p-[10px] mt-[4px]"
              style={{ background: "var(--s3)", borderColor: "var(--bo)" }}
            >
              <SectionLabel>Threshold sliders (tune clip volume)</SectionLabel>
              {[
                { label: "NFL/NBA min views (K)", val: minViews1, set: setMinViews1, min: 100, max: 2000, step: 50, display: `${minViews1}K` },
                { label: "Tier 2 min views (K)", val: minViews2, set: setMinViews2, min: 200, max: 3000, step: 50, display: `${minViews2}K` },
                { label: "MISC min views (K)", val: minViewsMisc, set: setMinViewsMisc, min: 500, max: 5000, step: 100, display: `${minViewsMisc}K` },
                { label: "Target clips/day", val: targetClips, set: setTargetClips, min: 10, max: 80, step: 5, display: String(targetClips) },
              ].map(({ label, val, set, min, max, step, display }) => (
                <div key={label} className="flex items-center gap-[8px] mb-[6px]">
                  <span className="text-[9px] w-[140px] flex-shrink-0" style={{ color: "var(--t2)" }}>{label}</span>
                  <input
                    type="range" min={min} max={max} step={step} value={val}
                    onChange={(e) => set(Number(e.target.value))}
                    className="flex-1"
                  />
                  <span className="text-[9px] font-mono w-[44px] text-right" style={{ color: "var(--t)" }}>{display}</span>
                </div>
              ))}
            </div>
          </AgentCard>

          <AgentCard
            title="Compose agent"
            description="AV merge · FFmpeg · platform formatting · audio mix"
            iconColor="#a78bfa"
            running={true}
            trainingNotes={notesByAgent("compose_agent")}
            config={[
              { label: "Audio source", value: "User library pool" },
              { label: "Strip original", value: "Default on" },
              { label: "Layer option", value: "Per-clip slider" },
              { label: "Platform sound", value: "Auto-detect native" },
              { label: "TikTok format", value: "9:16 · ≤60s" },
              { label: "Instagram format", value: "9:16 · ≤90s" },
              { label: "YouTube format", value: "9:16 · ≤60s" },
              { label: "Engine", value: "FFmpeg + MoviePy" },
            ]}
          />

          <AgentCard
            title="Syndication agent"
            description="Approval queue · optimal timing · TikTok + IG + YouTube"
            iconColor="#ff2d55"
            running={false}
            trainingNotes={notesByAgent("syndication_agent")}
            config={[
              { label: "Approval gate", value: "Required — you" },
              { label: "Post window", value: "Within 24hrs" },
              { label: "Priority window", value: "Within 12hrs" },
              { label: "Schedule basis", value: "Account insights" },
              { label: "Unapproved posts", value: "Drafted on platforms" },
              { label: "Platform stagger", value: "5–10min gaps" },
              { label: "Caption gen", value: "Claude API · editable" },
              { label: "Post-publish track", value: "1hr / 6hr / 24hr" },
              { label: "R2 delete on publish", value: "Enabled" },
              { label: "Automation level", value: "Training phase" },
            ]}
          />

          <AgentCard
            title="Seed refresh agent"
            description="Bi-weekly account re-ranking · drops underperformers · discovers new"
            iconColor="#1d9bf0"
            running={false}
            trainingNotes={notesByAgent("seed_refresh_agent")}
            config={[
              { label: "Refresh cadence", value: "Every 14 days" },
              { label: "Ranking signal", value: "Avg eng rate 14d" },
              { label: "Min eng to stay", value: "5%" },
              { label: "Grace period", value: "2 cycles" },
              { label: "Official accounts", value: "Pinned — never dropped" },
              { label: "Discovery", value: "TikTok search scan" },
              { label: "Last refresh", value: humanDate(state?.seed_last_refresh ?? "") },
              { label: "Next refresh", value: humanDate(state?.seed_next_refresh ?? "") },
            ]}
          />

          {/* Seed list */}
          <SeedList />

          {/* Add training note */}
          <TrainingNoteInput />
        </div>
      </div>
    </div>
  );
}

function TrainingNoteInput() {
  const [agent, setAgent] = useState("scrape_agent");
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!note.trim()) return;
    await addTrainingNote(agent, "user_instruction", note);
    setSaved(true);
    setNote("");
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div
      className="rounded-[10px] border p-[12px_13px]"
      style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
    >
      <div className="text-[11px] font-bold mb-[8px]" style={{ color: "var(--t)" }}>
        Add training instruction
      </div>
      <div className="flex gap-[8px] mb-[8px]">
        {["scrape_agent", "compose_agent", "syndication_agent"].map((a) => (
          <button
            key={a}
            onClick={() => setAgent(a)}
            className="text-[9px] font-mono px-[8px] py-[3px] rounded-md border transition-all"
            style={{
              background: agent === a ? "var(--brd)" : "var(--s3)",
              color: agent === a ? "var(--br)" : "var(--t2)",
              borderColor: agent === a ? "var(--brb)" : "var(--bo)",
            }}
          >
            {a.replace("_agent", "")}
          </button>
        ))}
      </div>
      <textarea
        className="w-full rounded-[7px] p-[8px] text-[10px] outline-none resize-none mb-[8px]"
        style={{
          background: "var(--s3)",
          border: "0.5px solid var(--bo)",
          color: "var(--t)",
          fontFamily: "var(--fh)",
          minHeight: 60,
        }}
        placeholder="E.g. Prefer NBA clips with 5M+ views, increase MISC threshold to 2M..."
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <Btn variant="primary" size="sm" onClick={handleSave} disabled={!note.trim()}>
        {saved ? "Saved ✓" : "Save instruction"}
      </Btn>
    </div>
  );
}
