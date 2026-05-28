import React, { useState, useEffect } from "react";
import useSWR from "swr";
import { getAudio, composeClip, type Clip, type AudioTrack } from "../../lib/api";
import { fmtViews, fmtPct, platformColor, categoryColor, timeAgo } from "../../lib/utils";
import { Btn, Toggle, Empty, Spinner } from "../ui";

const PLATFORMS = [
  { key: "tiktok", label: "TikTok", fmt: "9:16 · ≤60s · native sound check" },
  { key: "instagram", label: "Instagram Reel", fmt: "9:16 · ≤90s · caption auto-gen" },
  { key: "youtube", label: "YouTube Short", fmt: "9:16 · ≤60s · title gen" },
];

const WF = [22, 35, 50, 38, 58, 28, 45, 33, 55, 40, 30, 48];

export default function Compose({
  initialClips,
  onQueued,
}: {
  initialClips?: Clip[];
  onQueued: () => void;
}) {
  const [activeClip, setActiveClip] = useState<Clip | null>(null);

  useEffect(() => {
    if (initialClips && initialClips.length > 0) {
      setActiveClip(initialClips[0]);
    }
  }, [initialClips]);
  const [activeAudio, setActiveAudio] = useState<AudioTrack | null>(null);
  const [newVol, setNewVol] = useState(100);
  const [origVol, setOrigVol] = useState(0);
  const [stripOrig, setStripOrig] = useState(true);
  const [layerOrig, setLayerOrig] = useState(false);
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState<"idle" | "composing" | "done" | "error">("idle");

  const { data: audioData, isLoading: audioLoading } = useSWR("audio", getAudio);
  const tracks = audioData?.tracks ?? [];

  useEffect(() => {
    if (tracks.length > 0 && !activeAudio) setActiveAudio(tracks[0]);
  }, [tracks]);

  useEffect(() => {
    if (stripOrig) {
      setOrigVol(0);
      setLayerOrig(false);
    }
  }, [stripOrig]);

  useEffect(() => {
    if (layerOrig) {
      setStripOrig(false);
      if (origVol === 0) setOrigVol(20);
    }
  }, [layerOrig]);

  const handleCompose = async () => {
    if (!activeClip) return;
    setStatus("composing");
    try {
      await composeClip({
        clip_id: activeClip.id,
        audio_id: activeAudio?.id,
        new_vol: newVol / 100,
        orig_vol: origVol / 100,
      });
      setStatus("done");
      setTimeout(() => { onQueued(); }, 1200);
    } catch {
      setStatus("error");
    }
  };

  if (!activeClip) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-4">
        <Empty label="No clip selected — go to Scrape Feed and select clips to compose" />
      </div>
    );
  }

  const pc = platformColor(activeClip.source_platform);
  const cc = categoryColor(activeClip.sport_category);

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <div className="flex-1 overflow-y-auto p-[14px] flex flex-col gap-[12px] min-h-0">

        {/* Clip selector (if multiple) */}
        {(initialClips ?? []).length > 1 && (
          <div className="flex gap-[6px] overflow-x-auto pb-[4px]">
            {initialClips!.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveClip(c)}
                className="flex-shrink-0 text-[9px] font-mono px-[8px] py-[4px] rounded-md border transition-all"
                style={{
                  background: activeClip.id === c.id ? "var(--brd)" : "var(--s2)",
                  color: activeClip.id === c.id ? "var(--br)" : "var(--t2)",
                  borderColor: activeClip.id === c.id ? "var(--brb)" : "var(--bo)",
                }}
              >
                {c.sport_category} · {c.source_platform.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {/* Video preview */}
        <div
          className="rounded-[9px] border overflow-hidden"
          style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
        >
          <div
            className="flex items-center gap-[8px] p-[9px_12px] border-b"
            style={{ borderColor: "var(--bo)" }}
          >
            <div className="w-2 h-2 rounded-full" style={{ background: cc }} />
            <span className="text-[11px] font-medium flex-1 truncate" style={{ color: "var(--t)" }}>
              {activeClip.caption?.slice(0, 80) || "Untitled clip"}
            </span>
            <span className="text-[8px] font-mono flex-shrink-0" style={{ color: "var(--t2)" }}>
              {activeClip.sport_category} · {fmtViews(activeClip.views_at_ingest)} views · {timeAgo(activeClip.ingested_at)}
            </span>
          </div>

          {/* Thumb / Video Preview */}
          <div
            className="w-full flex items-center justify-center relative overflow-hidden"
            style={{ height: 400, background: "var(--s3)" }}
          >
            {activeClip.preview_url ? (
              <video
                src={activeClip.preview_url}
                className="w-full h-full object-contain"
                controls
                playsInline
                style={{ zIndex: 10, maxHeight: 400, width: "100%" }}
              />
            ) : (
              <>
                <div className="flex items-end gap-[2px] h-8 z-10 relative px-2">
                  {WF.map((h, i) => (
                    <div key={i} className="w-[2px] rounded-sm" style={{ height: h, background: "rgba(255,255,255,0.4)" }} />
                  ))}
                </div>
                <div
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center z-20"
                  style={{ background: "rgba(0,0,0,0.55)" }}
                >
                  <div className="ml-[2px]" style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "9px solid #fff" }} />
                </div>
                <div
                  className="absolute bottom-[8px] left-[8px] text-[8px] font-mono"
                  style={{ color: "rgba(255,255,255,0.4)" }}
                >
                  No preview — video stored in R2
                </div>
              </>
            )}
            <div
              className="absolute bottom-[8px] right-[8px] text-[8px] font-mono"
              style={{ color: "rgba(255,255,255,0.4)", zIndex: 20 }}
            >
              Orig. audio: {stripOrig ? "stripped" : "active"}
            </div>
          </div>

          {/* Playback bar */}
          <div
            className="flex items-center gap-[7px] p-[9px_12px] border-t"
            style={{ borderColor: "var(--bo)" }}
          >
            <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>0:00</span>
            <div className="flex-1 h-[3px] rounded-full" style={{ background: "var(--s3)" }}>
              <div className="h-full w-[30%] rounded-full" style={{ background: "var(--br)" }} />
            </div>
            <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
              0:{activeClip.duration_seconds ?? 23}
            </span>
            <Btn size="sm">Preview</Btn>
            <Btn size="sm">Trim ✂</Btn>
          </div>
        </div>

        {/* Audio mix panel */}
        <div
          className="rounded-[9px] border p-[11px]"
          style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
        >
          <div className="text-[11px] font-medium mb-[8px]" style={{ color: "var(--t)" }}>
            Audio mix
          </div>
          {[
            { label: "New audio", val: newVol, set: setNewVol },
            { label: "Original audio", val: origVol, set: setOrigVol },
          ].map(({ label, val, set }) => (
            <div key={label} className="flex items-center gap-[8px] mb-[7px]">
              <span className="text-[10px] w-[90px] flex-shrink-0" style={{ color: "var(--t2)" }}>{label}</span>
              <input
                type="range" min={0} max={100} step={1} value={val}
                onChange={(e) => set(Number(e.target.value))}
                className="flex-1"
              />
              <span className="text-[9px] font-mono w-[32px] text-right" style={{ color: "var(--t)" }}>
                {val}%
              </span>
            </div>
          ))}
          <div
            className="pt-[4px] mt-[4px] border-t flex gap-[16px]"
            style={{ borderColor: "var(--bo)" }}
          >
            {[
              { label: "Strip original", val: stripOrig, set: setStripOrig },
              { label: "Layer original under", val: layerOrig, set: setLayerOrig },
            ].map(({ label, val, set }) => (
              <div key={label} className="flex items-center gap-[8px]">
                <span className="text-[10px]" style={{ color: "var(--t)" }}>{label}</span>
                <Toggle on={val} onChange={set} />
              </div>
            ))}
          </div>
        </div>

        {/* Platform versions */}
        <div
          className="rounded-[9px] border overflow-hidden"
          style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
        >
          <div
            className="flex items-center justify-between p-[9px_12px] border-b"
            style={{ borderColor: "var(--bo)" }}
          >
            <span className="text-[11px] font-medium" style={{ color: "var(--t)" }}>
              Platform versions
            </span>
            <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
              Auto-formatted per platform
            </span>
          </div>
          {PLATFORMS.map(({ key, label, fmt }) => (
            <div
              key={key}
              className="flex items-center gap-[8px] p-[7px_12px] border-b last:border-0"
              style={{ borderColor: "var(--bo)" }}
            >
              <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: platformColor(key) }} />
              <span className="text-[10px] flex-1" style={{ color: "var(--t)" }}>{label}</span>
              <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>{fmt}</span>
              <span className="text-[8px] font-mono" style={{ color: "var(--br)" }}>Ready</span>
            </div>
          ))}
        </div>

        {/* Action */}
        <div className="flex gap-[8px]">
          <Btn size="md" className="flex-1">Save draft</Btn>
          <Btn
            size="md"
            variant="primary"
            className="flex-1"
            disabled={composing || status === "composing"}
            onClick={handleCompose}
          >
            {status === "composing" ? "Composing..." : status === "done" ? "Added to queue ✓" : "Add to queue ↗"}
          </Btn>
        </div>
      </div>

      {/* Audio sidebar */}
      <div
        className="w-[220px] flex-shrink-0 border-l flex flex-col gap-[10px] p-[12px] overflow-y-auto"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        <div className="text-[11px] font-medium" style={{ color: "var(--t)" }}>Audio library</div>
        <div className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>Tap to select · active track highlighted</div>

        {audioLoading ? (
          <Spinner />
        ) : tracks.length === 0 ? (
          <Empty label="Upload audio tracks first" />
        ) : (
          <div className="flex flex-col gap-0">
            {tracks.map((track, idx) => {
              const active = activeAudio?.id === track.id;
              const hasNative = Object.keys(track.platform_native ?? {}).length > 0;
              return (
                <div
                  key={track.id}
                  onClick={() => setActiveAudio(track)}
                  className="flex items-center gap-[8px] px-[10px] py-[8px] cursor-pointer transition-all border-b last:border-0"
                  style={{
                    background: active ? "var(--brd)" : "transparent",
                    borderColor: "var(--bo)",
                    borderLeft: active ? "2px solid var(--br)" : "2px solid transparent",
                  }}
                >
                  <div
                    className="w-7 h-7 rounded-[6px] flex items-center justify-center flex-shrink-0 text-[10px] font-bold font-mono border"
                    style={{
                      background: active ? "rgba(0,232,122,0.1)" : "var(--s3)",
                      borderColor: active ? "var(--brb)" : "var(--bo)",
                      color: active ? "var(--br)" : "var(--t2)",
                    }}
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium truncate" style={{ color: "var(--t)" }}>
                      {track.name}
                    </div>
                    <div className="flex items-center gap-[4px] mt-[2px]">
                      <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
                        {track.duration_seconds ? `0:${String(Math.round(track.duration_seconds)).padStart(2, "0")}` : "—"}
                      </span>
                      {hasNative && (
                        <span
                          className="text-[7px] font-mono px-[4px] py-[1px] rounded-[8px] border"
                          style={{
                            background: "rgba(29,155,240,0.1)",
                            color: "#1d9bf0",
                            borderColor: "rgba(29,155,240,0.25)",
                          }}
                        >
                          native
                        </span>
                      )}
                    </div>
                  </div>
                  {/* mini play */}
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: active ? "var(--brd)" : "var(--s3)" }}
                  >
                    <div
                      className="ml-[1px]"
                      style={{
                        width: 0, height: 0,
                        borderTop: "4px solid transparent",
                        borderBottom: "4px solid transparent",
                        borderLeft: `7px solid ${active ? "var(--br)" : "var(--t2)"}`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Clip trim */}
        <div
          className="pt-[10px] mt-[2px] border-t flex flex-col gap-[6px]"
          style={{ borderColor: "var(--bo)" }}
        >
          <div className="text-[11px] font-medium" style={{ color: "var(--t)" }}>Clip trim</div>
          {[
            { label: "In", val: 0, max: 100 },
            { label: "Out", val: 100, max: 100 },
          ].map(({ label, val, max }) => (
            <div key={label} className="flex items-center gap-[8px]">
              <span className="text-[11px] w-[20px]" style={{ color: "var(--t2)" }}>{label}</span>
              <input type="range" min={0} max={max} defaultValue={val} step={1} className="flex-1" />
              <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
                0:{label === "In" ? "00" : String(activeClip.duration_seconds ?? 23)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
