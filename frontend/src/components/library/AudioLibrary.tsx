import React, { useState, useRef } from "react";
import useSWR from "swr";
import {
  getAudio, uploadAudio, deleteAudio, updateAudioTags, type AudioTrack,
} from "../../lib/api";
import { fmtDur, timeAgo, platformColor } from "../../lib/utils";
import { Btn, SectionLabel, Toggle, Empty, Spinner, Pill } from "../ui";

const LEAGUES = ["NFL", "NBA", "MLB", "NHL", "MLS", "US Intl", "MISC"];
const PLATFORMS = ["tiktok", "instagram", "youtube"];
const PLAT_LABELS: Record<string, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };

const WF_HEIGHTS = [22, 35, 50, 38, 58, 28, 45, 33, 55, 40, 30, 48, 36, 52, 29, 42, 38, 55, 30, 46];

function MiniWaveform({ active }: { active: boolean }) {
  return (
    <div className="flex items-end gap-[2px]" style={{ height: 20 }}>
      {WF_HEIGHTS.slice(0, 12).map((h, i) => (
        <div
          key={i}
          className="rounded-sm"
          style={{
            width: 2,
            height: Math.round((h / 58) * 20),
            background: active ? "rgba(0,232,122,0.6)" : "rgba(255,255,255,0.25)",
          }}
        />
      ))}
    </div>
  );
}

function PreviewWaveform({ played }: { played: number }) {
  return (
    <div
      className="flex items-end gap-[3px] px-3 cursor-pointer"
      style={{ height: 52, background: "var(--s3)" }}
    >
      {WF_HEIGHTS.map((h, i) => (
        <div
          key={i}
          className="rounded-sm"
          style={{
            width: 4,
            height: Math.round((h / 58) * 44),
            background:
              i / WF_HEIGHTS.length < played
                ? "var(--br)"
                : "rgba(0,232,122,0.25)",
          }}
        />
      ))}
    </div>
  );
}

export default function AudioLibrary() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<AudioTrack | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [search, setSearch] = useState("");

  const { data, mutate, isLoading } = useSWR("audio", getAudio, {
    refreshInterval: 0,
  });
  const tracks = (data?.tracks ?? []).filter((t) =>
    search ? t.name.toLowerCase().includes(search.toLowerCase()) : true
  );

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        await uploadAudio(file);
      }
      mutate();
    } catch (e) {
      console.error("Upload error", e);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (track: AudioTrack) => {
    await deleteAudio(track.id);
    if (selected?.id === track.id) setSelected(null);
    mutate();
  };

  const handleTagToggle = async (
    track: AudioTrack,
    type: "league" | "platform",
    value: string
  ) => {
    const leagues = type === "league"
      ? track.league_preference.includes(value)
        ? track.league_preference.filter((l) => l !== value)
        : [...track.league_preference, value]
      : track.league_preference;

    const platformNative = { ...(track.platform_native ?? {}) };
    if (type === "platform") {
      if (platformNative[value]) delete platformNative[value];
      else platformNative[value] = "detected";
    }

    await updateAudioTags(track.id, leagues, platformNative);
    mutate();
  };

  return (
    <div
      className="flex flex-1 overflow-hidden min-h-0"
      style={{ borderTop: "0.5px solid var(--bo)" }}
    >
      {/* Main list */}
      <div className="flex flex-col flex-1 overflow-hidden min-h-0">
        {/* Topbar */}
        <div
          className="flex items-center gap-2 p-[10px_16px] border-b flex-shrink-0"
          style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
        >
          <span className="text-[13px] font-bold" style={{ color: "var(--t)" }}>
            Audio library
          </span>
          <input
            className="rounded-[7px] px-[10px] py-[6px] text-[11px] outline-none w-44"
            style={{
              background: "var(--s2)",
              border: "0.5px solid var(--bo)",
              color: "var(--t)",
              fontFamily: "var(--fh)",
            }}
            placeholder="Search tracks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="ml-auto flex gap-[6px]">
            <Btn onClick={() => fileRef.current?.click()} variant="primary">
              {uploading ? "Uploading..." : "+ Upload"}
            </Btn>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-[14px_16px]">
          {/* Drop zone */}
          <div
            className="rounded-xl border p-[28px_20px] text-center cursor-pointer mb-[14px] transition-all"
            style={{
              borderStyle: "dashed",
              borderColor: dragOver ? "var(--br)" : "var(--brb)",
              background: "var(--brd)",
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center mx-auto mb-[10px] border"
              style={{
                background: "rgba(0,232,122,0.15)",
                borderColor: "var(--brb)",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 12V4M6 7l3-3 3 3" stroke="#00e87a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M3 13v1a1 1 0 001 1h10a1 1 0 001-1v-1" stroke="#00e87a" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <div className="text-[12px] font-medium mb-[4px]" style={{ color: "var(--t)" }}>
              Drop audio files or click to browse
            </div>
            <div className="text-[10px] font-mono" style={{ color: "var(--t2)" }}>
              MP3 · WAV · M4A · AAC · max 50MB per file
            </div>
          </div>

          {/* Track list */}
          <SectionLabel>Your tracks ({tracks.length})</SectionLabel>
          {isLoading ? (
            <div className="flex justify-center pt-8"><Spinner /></div>
          ) : tracks.length === 0 ? (
            <Empty label="No audio tracks yet — upload your first snippet above" />
          ) : (
            <div className="flex flex-col gap-[6px]">
              {tracks.map((track) => (
                <div
                  key={track.id}
                  onClick={() => setSelected(track)}
                  className="flex items-center gap-[10px] rounded-[9px] border cursor-pointer transition-all px-[12px] py-[10px]"
                  style={{
                    background: selected?.id === track.id ? "var(--brd)" : "var(--s2)",
                    borderColor: selected?.id === track.id ? "var(--brb)" : "var(--bo)",
                  }}
                >
                  {/* Initials */}
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 text-[11px] font-bold font-mono border"
                    style={{
                      background: "rgba(0,232,122,0.1)",
                      borderColor: "var(--brb)",
                      color: "var(--br)",
                    }}
                  >
                    {track.name.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-[11px] font-medium truncate"
                      style={{ color: "var(--t)" }}
                    >
                      {track.name}
                    </div>
                    <div className="flex items-center gap-[6px] mt-[3px] flex-wrap">
                      {track.duration_seconds && (
                        <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
                          {fmtDur(Math.round(track.duration_seconds))}
                        </span>
                      )}
                      {Object.keys(track.platform_native ?? {}).map((p) => (
                        <Pill key={p} color={platformColor(p)}>
                          {PLAT_LABELS[p] ?? p} native
                        </Pill>
                      ))}
                      {(track.league_preference ?? []).map((l) => (
                        <Pill key={l} className="bg-[var(--s3)] text-[var(--t2)] border-[var(--bo)]">
                          {l}
                        </Pill>
                      ))}
                      {track.use_count > 0 && (
                        <span className="text-[8px] font-mono" style={{ color: "var(--t3)" }}>
                          Used {track.use_count}x
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Waveform */}
                  <MiniWaveform active={selected?.id === track.id} />

                  {/* Duration */}
                  <span
                    className="text-[9px] font-mono w-7 text-right flex-shrink-0"
                    style={{ color: "var(--t2)" }}
                  >
                    {track.duration_seconds ? fmtDur(Math.round(track.duration_seconds)) : "—"}
                  </span>

                  {/* Delete */}
                  <button
                    className="w-[22px] h-[22px] rounded-md flex items-center justify-center flex-shrink-0 border border-transparent transition-all hover:border-[rgba(231,76,60,0.3)] hover:bg-[rgba(231,76,60,0.1)]"
                    onClick={(e) => { e.stopPropagation(); handleDelete(track); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 2l8 8M10 2l-8 8" stroke="#e74c3c" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
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
            <span style={{ color: "var(--br)" }}>{tracks.length}</span> tracks in pool · agent uses these for all compose suggestions
          </span>
        </div>
      </div>

      {/* Side panel */}
      <div
        className="w-[280px] flex-shrink-0 border-l flex flex-col gap-[12px] p-[14px] overflow-y-auto"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        {!selected ? (
          <div className="flex items-center justify-center flex-1 text-[10px] font-mono" style={{ color: "var(--t3)" }}>
            Select a track to configure
          </div>
        ) : (
          <>
            <div className="text-[11px] font-medium" style={{ color: "var(--t)" }}>
              {selected.name}
            </div>

            {/* Waveform preview */}
            <div
              className="rounded-[9px] overflow-hidden border"
              style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
            >
              <div className="p-[9px_12px] border-b" style={{ borderColor: "var(--bo)" }}>
                <div className="text-[11px] font-medium mb-[1px]" style={{ color: "var(--t)" }}>
                  {selected.name}
                </div>
                <div className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
                  {selected.duration_seconds ? fmtDur(Math.round(selected.duration_seconds)) : "—"} · {timeAgo(selected.uploaded_at)}
                </div>
              </div>
              <PreviewWaveform played={0.4} />
              <div
                className="flex items-center gap-[7px] p-[9px_12px] border-t"
                style={{ borderColor: "var(--bo)" }}
              >
                <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>0:07</span>
                <div className="flex-1 h-[3px] rounded-full" style={{ background: "var(--s3)" }}>
                  <div className="h-full w-[40%] rounded-full" style={{ background: "var(--br)" }} />
                </div>
                <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
                  {selected.duration_seconds ? fmtDur(Math.round(selected.duration_seconds)) : "—"}
                </span>
              </div>
            </div>

            {/* League preference tags */}
            <div
              className="rounded-[9px] border p-[11px]"
              style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
            >
              <div className="text-[10px] font-medium mb-[8px]" style={{ color: "var(--t)" }}>
                League preference
              </div>
              <div className="flex flex-wrap gap-[5px] mb-[8px]">
                {LEAGUES.map((l) => {
                  const on = (selected.league_preference ?? []).includes(l);
                  return (
                    <button
                      key={l}
                      onClick={() => handleTagToggle(selected, "league", l)}
                      className="text-[9px] font-mono px-[8px] py-[3px] rounded-[20px] border transition-all cursor-pointer"
                      style={{
                        background: on ? "var(--brd)" : "var(--s3)",
                        color: on ? "var(--br)" : "var(--t2)",
                        borderColor: on ? "var(--brb)" : "var(--bo)",
                      }}
                    >
                      {l}
                    </button>
                  );
                })}
              </div>
              <p className="text-[9px] leading-[1.4]" style={{ color: "var(--t2)" }}>
                Tagged leagues become the agent's default suggestion for that content.
              </p>
            </div>

            {/* Platform native */}
            <div
              className="rounded-[9px] border p-[11px]"
              style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
            >
              <div className="text-[10px] font-medium mb-[8px]" style={{ color: "var(--t)" }}>
                Platform native status
              </div>
              {PLATFORMS.map((p) => {
                const native = !!(selected.platform_native ?? {})[p];
                return (
                  <div
                    key={p}
                    className="flex items-center justify-between py-[5px] border-b last:border-0"
                    style={{ borderColor: "var(--bo)" }}
                  >
                    <span className="text-[10px]" style={{ color: "var(--t)" }}>
                      {PLAT_LABELS[p]}
                    </span>
                    <div className="flex items-center gap-[6px]">
                      <span
                        className="text-[8px] font-mono px-[6px] py-[2px] rounded-[10px] border"
                        style={
                          native
                            ? { background: "rgba(29,155,240,0.12)", color: "#1d9bf0", borderColor: "rgba(29,155,240,0.3)" }
                            : { background: "var(--s3)", color: "var(--t3)", borderColor: "var(--bo)" }
                        }
                      >
                        {native ? "Native" : "Upload only"}
                      </span>
                      <Toggle
                        size="sm"
                        on={native}
                        onChange={() => handleTagToggle(selected, "platform", p)}
                      />
                    </div>
                  </div>
                );
              })}
              <p className="text-[9px] mt-[8px] leading-[1.4]" style={{ color: "var(--t2)" }}>
                When native, agent uses platform sound for TikTok algorithm boost.
              </p>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-[6px]">
              {[
                { label: "Total uses", value: selected.use_count },
                { label: "Avg eng boost", value: selected.avg_eng_boost ? `+${(selected.avg_eng_boost * 100).toFixed(1)}%` : "—" },
                { label: "Best with", value: selected.best_performing_with || "—" },
                { label: "Platforms", value: `${PLATFORMS.length} / ${PLATFORMS.length}` },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  className="rounded-[7px] border p-[8px_10px]"
                  style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
                >
                  <div className="text-[8px] font-mono uppercase tracking-[0.6px] mb-[2px]" style={{ color: "var(--t3)" }}>
                    {label}
                  </div>
                  <div className="text-[15px] font-bold font-mono" style={{ color: "var(--t)" }}>
                    {String(value)}
                  </div>
                </div>
              ))}
            </div>

            <Btn
              variant="danger"
              className="w-full text-center"
              onClick={() => handleDelete(selected)}
            >
              Remove from library
            </Btn>
          </>
        )}
      </div>
    </div>
  );
}
