import React, { useState, useEffect, useRef, useCallback } from "react";
import useSWR from "swr";
import { getAudio, composeClip, type Clip, type AudioTrack } from "../../lib/api";
import { fmtViews, platformColor, categoryColor, timeAgo, fmtDur } from "../../lib/utils";
import { Btn, Toggle, Empty, Spinner } from "../ui";

const PLATFORMS = [
  { key: "tiktok", label: "TikTok", fmt: "9:16 · ≤60s · native sound check" },
  { key: "instagram", label: "Instagram Reel", fmt: "9:16 · ≤90s · caption auto-gen" },
  { key: "youtube", label: "YouTube Short", fmt: "9:16 · ≤60s · title gen" },
];

const WF = [22, 35, 50, 38, 58, 28, 45, 33, 55, 40, 30, 48];

function WaveformBar({
  heights, progress, color, label,
  inPoint, outPoint, onInChange, onOutChange,
  trackDuration,
  showInTimeLabel,
}: {
  heights: number[]; progress: number; color: string; label: string;
  inPoint: number; outPoint: number;
  onInChange: (v: number) => void; onOutChange: (v: number) => void;
  trackDuration?: number;
  showInTimeLabel?: boolean;
}) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<"in" | "out" | null>(null);
  const [hovering, setHovering] = React.useState<string | null>(null);

  const getPct = useCallback((clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const pct = getPct(e.clientX);
      if (dragging.current === "in") onInChange(Math.min(pct, outPoint - 5));
      else onOutChange(Math.max(pct, inPoint + 5));
    };
    const handleUp = () => { dragging.current = null; };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    return () => { window.removeEventListener("mousemove", handleMove); window.removeEventListener("mouseup", handleUp); };
  }, [inPoint, outPoint, onInChange, onOutChange, getPct]);

  const inTimeSec = trackDuration ? (inPoint / 100) * trackDuration : null;
  const outTimeSec = trackDuration ? (outPoint / 100) * trackDuration : null;
  const inTimeLabel = inTimeSec !== null ? fmtDur(Math.round(inTimeSec)) : `${Math.round(inPoint)}%`;
  const outTimeLabel = outTimeSec !== null ? fmtDur(Math.round(outTimeSec)) : `${Math.round(outPoint)}%`;

  return (
    <div>
      {/* Label row with live time indicators */}
      <div className="flex items-center justify-between mb-[4px]">
        <div className="text-[8px] font-mono" style={{ color: "var(--t3)" }}>{label}</div>
        {showInTimeLabel && (
          <div className="flex items-center gap-[8px]">
            <span className="text-[8px] font-mono px-[5px] py-[1px] rounded" style={{ background: `${color}22`, color, border: `0.5px solid ${color}55` }}>
              in: {inTimeLabel}
            </span>
            <span className="text-[8px] font-mono px-[5px] py-[1px] rounded" style={{ background: "rgba(255,255,255,0.05)", color: "var(--t2)", border: "0.5px solid var(--bo)" }}>
              out: {outTimeLabel}
            </span>
          </div>
        )}
      </div>

      <div ref={barRef} className="relative rounded-md" style={{ height: 40, background: "var(--s3)", cursor: "crosshair" }}>
        {/* Waveform bars */}
        <div className="flex items-end gap-[1px] h-full px-[4px] absolute inset-0">
          {heights.map((h, i) => {
            const pct = (i / heights.length) * 100;
            const inTrim = pct >= inPoint && pct <= outPoint;
            const played = (i / heights.length) <= progress;
            return (
              <div key={i} className="flex-1 rounded-sm transition-colors" style={{
                height: `${Math.round((h / 58) * 80)}%`,
                background: played && inTrim ? color : inTrim ? `${color}55` : "rgba(255,255,255,0.07)",
              }} />
            );
          })}
        </div>

        {/* Darkened regions outside trim */}
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: 0, width: `${inPoint}%`, background: "rgba(0,0,0,0.55)", borderRadius: "6px 0 0 6px" }} />
        <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: `${outPoint}%`, right: 0, background: "rgba(0,0,0,0.55)", borderRadius: "0 6px 6px 0" }} />

        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-[1.5px] pointer-events-none" style={{ left: `${progress * 100}%`, background: color, zIndex: 5, boxShadow: `0 0 4px ${color}80` }} />

        {/* IN handle — clean thin bar with time tooltip */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: `${inPoint}%`, width: 16, transform: "translateX(-50%)", zIndex: 8, cursor: "ew-resize" }}
          onMouseDown={(e) => { e.stopPropagation(); dragging.current = "in"; }}
          onMouseEnter={() => setHovering("in")}
          onMouseLeave={() => setHovering(null)}
        >
          {/* The bar itself */}
          <div className="absolute top-0 bottom-0" style={{ left: "50%", transform: "translateX(-50%)", width: 2, background: color, borderRadius: 2 }} />
          {/* Top cap */}
          <div className="absolute" style={{ top: 0, left: "50%", transform: "translateX(-50%)", width: 8, height: 4, background: color, borderRadius: "0 0 3px 3px" }} />
          {/* Bottom cap */}
          <div className="absolute" style={{ bottom: 0, left: "50%", transform: "translateX(-50%)", width: 8, height: 4, background: color, borderRadius: "3px 3px 0 0" }} />
          {/* Time tooltip */}
          {(hovering === "in" || dragging.current === "in") && (
            <div className="absolute pointer-events-none" style={{ bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", background: color, color: "#000", fontSize: 8, fontFamily: "var(--fm)", fontWeight: 600, padding: "2px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>
              {inTimeLabel}
            </div>
          )}
        </div>

        {/* OUT handle — same clean design */}
        <div
          className="absolute top-0 bottom-0"
          style={{ left: `${outPoint}%`, width: 16, transform: "translateX(-50%)", zIndex: 8, cursor: "ew-resize" }}
          onMouseDown={(e) => { e.stopPropagation(); dragging.current = "out"; }}
          onMouseEnter={() => setHovering("out")}
          onMouseLeave={() => setHovering(null)}
        >
          <div className="absolute top-0 bottom-0" style={{ left: "50%", transform: "translateX(-50%)", width: 2, background: color, borderRadius: 2 }} />
          <div className="absolute" style={{ top: 0, left: "50%", transform: "translateX(-50%)", width: 8, height: 4, background: color, borderRadius: "0 0 3px 3px" }} />
          <div className="absolute" style={{ bottom: 0, left: "50%", transform: "translateX(-50%)", width: 8, height: 4, background: color, borderRadius: "3px 3px 0 0" }} />
          {(hovering === "out" || dragging.current === "out") && (
            <div className="absolute pointer-events-none" style={{ bottom: "calc(100% + 4px)", left: "50%", transform: "translateX(-50%)", background: color, color: "#000", fontSize: 8, fontFamily: "var(--fm)", fontWeight: 600, padding: "2px 5px", borderRadius: 3, whiteSpace: "nowrap" }}>
              {outTimeLabel}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Compose({ initialClips, onQueued }: { initialClips?: Clip[]; onQueued: () => void; }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [activeClip, setActiveClip] = useState<Clip | null>(null);
  const [activeAudio, setActiveAudio] = useState<AudioTrack | null>(null);
  const [newVol, setNewVol] = useState(100);
  const [origVol, setOrigVol] = useState(0);
  const [stripOrig, setStripOrig] = useState(true);
  const [layerOrig, setLayerOrig] = useState(false);
  const [status, setStatus] = useState<"idle" | "composing" | "done" | "error">("idle");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [clipIn, setClipIn] = useState(0);
  const [clipOut, setClipOut] = useState(100);
  const [audioIn, setAudioIn] = useState(0);
  const [audioOut, setAudioOut] = useState(100);

  useEffect(() => { if (initialClips && initialClips.length > 0) setActiveClip(initialClips[0]); }, [initialClips]);

  const { data: audioData, isLoading: audioLoading } = useSWR("audio", getAudio);
  const tracks = Array.isArray(audioData?.tracks) ? audioData.tracks : [];

  useEffect(() => { if (tracks.length > 0 && !activeAudio) setActiveAudio(tracks[0]); }, [tracks]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = origVol / 100; }, [origVol]);
  useEffect(() => { if (audioRef.current) audioRef.current.volume = newVol / 100; }, [newVol]);
  useEffect(() => { if (stripOrig) { setOrigVol(0); setLayerOrig(false); } }, [stripOrig]);
  useEffect(() => { if (layerOrig) { setStripOrig(false); if (origVol === 0) setOrigVol(20); } }, [layerOrig]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const check = () => {
      if (!a.duration) return;
      const outSec = (audioOut / 100) * a.duration;
      const inSec = (audioIn / 100) * a.duration;
      if (a.currentTime >= outSec) a.currentTime = inSec;
    };
    a.addEventListener("timeupdate", check);
    return () => a.removeEventListener("timeupdate", check);
  }, [audioIn, audioOut]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const check = () => {
      if (!v.duration) return;
      const outSec = (clipOut / 100) * v.duration;
      const inSec = (clipIn / 100) * v.duration;
      if (v.currentTime >= outSec) { v.currentTime = inSec; if (!playing) { v.pause(); audioRef.current?.pause(); setPlaying(false); } }
    };
    v.addEventListener("timeupdate", check);
    return () => v.removeEventListener("timeupdate", check);
  }, [clipOut, clipIn, playing]);

  const stopAudio = useCallback(() => {
    const a = audioRef.current;
    if (a) { a.pause(); a.currentTime = (audioIn / 100) * (a.duration || 0); }
  }, [audioIn]);

  const handleTogglePlay = useCallback(async () => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v) return;
    if (playing) {
      v.pause();
      if (a) a.pause();
      setPlaying(false);
    } else {
      if (v.duration) v.currentTime = (clipIn / 100) * v.duration;
      if (a && a.duration) a.currentTime = (audioIn / 100) * a.duration;
      try {
        await v.play();
        if (a) a.play().catch(() => {});
        setPlaying(true);
      } catch (e) { console.warn("Playback error:", e); }
    }
  }, [playing, clipIn, audioIn]);

  const handleTimeUpdate = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.duration) return;
    setCurrentTime(v.currentTime);
    const inSec = (clipIn / 100) * v.duration;
    const outSec = (clipOut / 100) * v.duration;
    setProgress(Math.max(0, Math.min(1, (v.currentTime - inSec) / (outSec - inSec))));
  }, [clipIn, clipOut]);

  const handleLoadedMetadata = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    setDuration(v.duration);
    v.volume = origVol / 100;
    v.currentTime = (clipIn / 100) * v.duration;
  }, [clipIn, origVol]);

  const handleSeek = useCallback((pct: number) => {
    const v = videoRef.current;
    const a = audioRef.current;
    if (!v || !v.duration) return;
    const inSec = (clipIn / 100) * v.duration;
    const outSec = (clipOut / 100) * v.duration;
    const seekTo = inSec + pct * (outSec - inSec);
    v.currentTime = seekTo;
    if (a && a.duration) {
      const aIn = (audioIn / 100) * a.duration;
      const aOut = (audioOut / 100) * a.duration;
      const aTrim = aOut - aIn;
      if (aTrim > 0) a.currentTime = aIn + ((seekTo - inSec) % aTrim);
    }
  }, [clipIn, clipOut, audioIn, audioOut]);

  const handleCompose = async () => {
    if (!activeClip) return;
    setStatus("composing");
    try {
      await composeClip({ clip_id: activeClip.id, audio_id: activeAudio?.id, new_vol: newVol / 100, orig_vol: origVol / 100 });
      setStatus("done");
      setTimeout(() => { onQueued(); }, 1200);
    } catch { setStatus("error"); }
  };

  if (!activeClip) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center gap-4">
        <Empty label="No clip selected — go to Scrape Feed and select clips to compose" />
      </div>
    );
  }

  const cc = categoryColor(activeClip.sport_category);
  const clipDuration = duration || activeClip.duration_seconds || 0;
  const trimmedDuration = ((clipOut - clipIn) / 100) * clipDuration;
  const audioTrackDuration = activeAudio?.duration_seconds || 0;
  const audioTrimmedDuration = ((audioOut - audioIn) / 100) * audioTrackDuration;
  const loopCount = audioTrimmedDuration > 0 ? Math.ceil(trimmedDuration / audioTrimmedDuration) : 1;
  const clipWF = [...WF, 45, 30, 52, 38, 48, 22, 55, 33, 44, 28, 50, 36];
  const audioWF = [30, 48, 22, 55, 38, 42, 28, 50, 35, 45, 20, 52, 40, 33, 48, 25, 55, 38, 44, 30, 50, 22, 45, 35];

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      {activeAudio?.preview_url && (
        <audio ref={audioRef} src={activeAudio.preview_url} preload="auto"
          onLoadedMetadata={() => { if (audioRef.current) audioRef.current.volume = newVol / 100; }} />
      )}

      <div className="flex-1 overflow-y-auto p-[14px] flex flex-col gap-[10px] min-h-0">
        {(initialClips ?? []).length > 1 && (
          <div className="flex gap-[6px] overflow-x-auto pb-[2px]">
            {initialClips!.map((c) => (
              <button key={c.id} onClick={() => { setActiveClip(c); setProgress(0); setPlaying(false); setClipIn(0); setClipOut(100); }}
                className="flex-shrink-0 text-[9px] font-mono px-[8px] py-[4px] rounded-md border transition-all"
                style={{ background: activeClip.id === c.id ? "var(--brd)" : "var(--s2)", color: activeClip.id === c.id ? "var(--br)" : "var(--t2)", borderColor: activeClip.id === c.id ? "var(--brb)" : "var(--bo)" }}>
                {c.sport_category} · {c.source_platform.toUpperCase()}
              </button>
            ))}
          </div>
        )}

        {/* Video card */}
        <div className="rounded-[9px] border overflow-hidden" style={{ background: "var(--s2)", borderColor: "var(--bo)" }}>
          <div className="flex items-center gap-[8px] p-[8px_12px] border-b" style={{ borderColor: "var(--bo)" }}>
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cc }} />
            <span className="text-[11px] font-medium flex-1 truncate" style={{ color: "var(--t)" }}>{activeClip.caption?.slice(0, 70) || "Untitled clip"}</span>
            <span className="text-[8px] font-mono flex-shrink-0" style={{ color: "var(--t2)" }}>{activeClip.sport_category} · {fmtViews(activeClip.views_at_ingest)} views · {timeAgo(activeClip.ingested_at)}</span>
          </div>

          {/* Video */}
          <div className="relative w-full" style={{ height: 520, background: "#000" }}
            onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
            {activeClip.preview_url ? (
              <video ref={videoRef} src={activeClip.preview_url} className="w-full h-full" style={{ objectFit: "contain", maxHeight: 520 }}
                playsInline onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => { stopAudio(); setPlaying(false); setProgress(0); }} onClick={handleTogglePlay} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2">
                <div className="flex items-end gap-[2px] h-8">{WF.map((h, i) => <div key={i} className="w-[2px] rounded-sm" style={{ height: h, background: "rgba(255,255,255,0.3)" }} />)}</div>
                <span className="text-[9px] font-mono" style={{ color: "var(--t3)" }}>Video stored in R2</span>
              </div>
            )}

            {/* Play/pause overlay — shows on hover or when paused */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-200"
              style={{ opacity: hovered || !playing ? 1 : 0 }}>
              <div className="w-12 h-12 rounded-full flex items-center justify-center pointer-events-auto cursor-pointer"
                style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }} onClick={handleTogglePlay}>
                {playing ? (
                  <div className="flex gap-[3px]">
                    <div style={{ width: 4, height: 14, background: "#fff", borderRadius: 1 }} />
                    <div style={{ width: 4, height: 14, background: "#fff", borderRadius: 1 }} />
                  </div>
                ) : (
                  <div style={{ width: 0, height: 0, borderTop: "10px solid transparent", borderBottom: "10px solid transparent", borderLeft: "18px solid #fff", marginLeft: 3 }} />
                )}
              </div>
            </div>

            {/* Bottom gradient with timestamp + audio status */}
            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-[10px] py-[8px] pointer-events-none"
              style={{ background: "linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)" }}>
              <span className="text-[11px] font-mono font-medium" style={{ color: "#fff", textShadow: "0 1px 4px rgba(0,0,0,1)" }}>
                {fmtDur(Math.round(currentTime))} / {fmtDur(Math.round(clipDuration))}
              </span>
              <span className="text-[9px] font-mono px-[7px] py-[3px] rounded"
                style={{ background: "rgba(0,0,0,0.6)", color: origVol > 0 ? "#fbbf24" : "var(--br)", border: "0.5px solid rgba(255,255,255,0.15)" }}>
                {origVol > 0 ? `orig ${origVol}% · new ${newVol}%` : `new audio ${newVol}%`}
              </span>
            </div>
          </div>

          {/* Transport */}
          <div className="flex items-center gap-[8px] p-[8px_12px] border-t" style={{ borderColor: "var(--bo)" }}>
            <button onClick={handleTogglePlay} className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 border transition-all"
              style={{ background: "var(--brd)", borderColor: "var(--brb)" }}>
              {playing ? (
                <div className="flex gap-[2px]">
                  <div style={{ width: 3, height: 9, background: "var(--br)", borderRadius: 1 }} />
                  <div style={{ width: 3, height: 9, background: "var(--br)", borderRadius: 1 }} />
                </div>
              ) : (
                <div style={{ width: 0, height: 0, borderTop: "5px solid transparent", borderBottom: "5px solid transparent", borderLeft: "8px solid var(--br)", marginLeft: 2 }} />
              )}
            </button>
            <div className="flex-1 h-[5px] rounded-full cursor-pointer relative group" style={{ background: "var(--s3)" }}
              onClick={(e) => { const rect = e.currentTarget.getBoundingClientRect(); handleSeek((e.clientX - rect.left) / rect.width); }}>
              <div className="h-full rounded-full" style={{ width: `${progress * 100}%`, background: "var(--br)" }} />
              <div className="absolute top-1/2 w-[13px] h-[13px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ left: `${progress * 100}%`, transform: "translate(-50%, -50%)", background: "var(--br)" }} />
            </div>
            <span className="text-[9px] font-mono flex-shrink-0" style={{ color: "var(--t2)" }}>{fmtDur(Math.round(trimmedDuration))} trimmed</span>
          </div>
        </div>

        {/* Timeline */}
        <div className="rounded-[9px] border p-[12px] flex flex-col gap-[10px]" style={{ background: "var(--s2)", borderColor: "var(--bo)" }}>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium" style={{ color: "var(--t)" }}>Timeline editor</span>
            <span className="text-[8px] font-mono" style={{ color: "var(--t3)" }}>Drag handles to trim</span>
          </div>
          <WaveformBar heights={clipWF} progress={progress} color="#00e87a"
            label={`Clip · ${fmtDur(Math.round(trimmedDuration))} of ${fmtDur(Math.round(clipDuration))} selected`}
            inPoint={clipIn} outPoint={clipOut} onInChange={setClipIn} onOutChange={setClipOut}
            trackDuration={clipDuration} showInTimeLabel={true} />
          {activeAudio ? (
            <WaveformBar heights={audioWF} progress={progress} color="#1d9bf0"
              label={`Audio: ${activeAudio.name} · ${fmtDur(Math.round(audioTrimmedDuration))} selected`}
              inPoint={audioIn} outPoint={audioOut} onInChange={setAudioIn} onOutChange={setAudioOut}
              trackDuration={audioTrackDuration} showInTimeLabel={true} />
          ) : (
            <div className="text-[9px] font-mono" style={{ color: "var(--t3)" }}>Select an audio track to enable audio timeline</div>
          )}
          {activeAudio && loopCount > 1 && (
            <div className="text-[8px] font-mono px-[8px] py-[4px] rounded-md"
              style={{ background: "rgba(29,155,240,0.1)", color: "#1d9bf0", border: "0.5px solid rgba(29,155,240,0.3)" }}>
              Audio loops {loopCount}x · trimmed audio {fmtDur(Math.round(audioTrimmedDuration))} fills {fmtDur(Math.round(trimmedDuration))} clip
            </div>
          )}
        </div>

        {/* Audio mix */}
        <div className="rounded-[9px] border p-[11px]" style={{ background: "var(--s2)", borderColor: "var(--bo)" }}>
          <div className="text-[11px] font-medium mb-[8px]" style={{ color: "var(--t)" }}>Audio mix</div>
          {[
            { label: "New audio", val: newVol, set: setNewVol, color: "#1d9bf0" },
            { label: "Original audio", val: origVol, set: setOrigVol, color: "#fbbf24" },
          ].map(({ label, val, set, color }) => (
            <div key={label} className="flex items-center gap-[8px] mb-[7px]">
              <div className="w-[8px] h-[8px] rounded-full flex-shrink-0" style={{ background: color }} />
              <span className="text-[10px] w-[100px] flex-shrink-0" style={{ color: "var(--t2)" }}>{label}</span>
              <input type="range" min={0} max={100} step={1} value={val} onChange={(e) => set(Number(e.target.value))} className="flex-1" />
              <span className="text-[9px] font-mono w-[32px] text-right" style={{ color: "var(--t)" }}>{val}%</span>
            </div>
          ))}
          <div className="pt-[6px] mt-[2px] border-t flex gap-[16px]" style={{ borderColor: "var(--bo)" }}>
            {[{ label: "Strip original", val: stripOrig, set: setStripOrig }, { label: "Layer original", val: layerOrig, set: setLayerOrig }].map(({ label, val, set }) => (
              <div key={label} className="flex items-center gap-[8px]">
                <span className="text-[10px]" style={{ color: "var(--t)" }}>{label}</span>
                <Toggle on={val} onChange={set} />
              </div>
            ))}
          </div>
          <div className="mt-[6px] text-[8px] font-mono" style={{ color: "var(--t3)" }}>
            Sliders control live preview · same settings sent to FFmpeg on compose
          </div>
        </div>

        {/* Platforms */}
        <div className="rounded-[9px] border overflow-hidden" style={{ background: "var(--s2)", borderColor: "var(--bo)" }}>
          <div className="flex items-center justify-between p-[8px_12px] border-b" style={{ borderColor: "var(--bo)" }}>
            <span className="text-[11px] font-medium" style={{ color: "var(--t)" }}>Platform versions</span>
            <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>Auto-formatted per platform</span>
          </div>
          {PLATFORMS.map(({ key, label, fmt }) => (
            <div key={key} className="flex items-center gap-[8px] p-[6px_12px] border-b last:border-0" style={{ borderColor: "var(--bo)" }}>
              <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: platformColor(key) }} />
              <span className="text-[10px] flex-1" style={{ color: "var(--t)" }}>{label}</span>
              <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>{fmt}</span>
              <span className="text-[8px] font-mono" style={{ color: "var(--br)" }}>Ready</span>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-[8px]">
          <Btn size="md" className="flex-1">Save draft</Btn>
          <Btn size="md" variant="primary" className="flex-1" disabled={status === "composing"} onClick={handleCompose}>
            {status === "composing" ? "Composing..." : status === "done" ? "Added to queue ✓" : "Add to queue ↗"}
          </Btn>
        </div>
      </div>

      {/* Audio sidebar */}
      <div className="w-[220px] flex-shrink-0 border-l flex flex-col gap-[10px] p-[12px] overflow-y-auto" style={{ background: "var(--s1)", borderColor: "var(--bo)" }}>
        <div className="text-[11px] font-medium" style={{ color: "var(--t)" }}>Audio library</div>
        <div className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>Select track · preview mixes live</div>
        {audioLoading ? <Spinner /> : tracks.length === 0 ? <Empty label="Upload audio tracks first" /> : (
          <div className="flex flex-col gap-0">
            {tracks.map((track, idx) => {
              const active = activeAudio?.id === track.id;
              const hasNative = Object.keys(track.platform_native ?? {}).length > 0;
              return (
                <div key={track.id} onClick={() => { setActiveAudio(track); setAudioIn(0); setAudioOut(100); if (playing) { videoRef.current?.pause(); audioRef.current?.pause(); setPlaying(false); } }}
                  className="flex items-center gap-[8px] px-[10px] py-[8px] cursor-pointer transition-all border-b last:border-0"
                  style={{ background: active ? "var(--brd)" : "transparent", borderColor: "var(--bo)", borderLeft: active ? "2px solid var(--br)" : "2px solid transparent" }}>
                  <div className="w-7 h-7 rounded-[6px] flex items-center justify-center flex-shrink-0 text-[10px] font-bold font-mono border"
                    style={{ background: active ? "rgba(0,232,122,0.1)" : "var(--s3)", borderColor: active ? "var(--brb)" : "var(--bo)", color: active ? "var(--br)" : "var(--t2)" }}>
                    {String(idx + 1).padStart(2, "0")}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium truncate" style={{ color: "var(--t)" }}>{track.name}</div>
                    <div className="flex items-center gap-[4px] mt-[1px]">
                      <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>{track.duration_seconds ? fmtDur(Math.round(track.duration_seconds)) : "—"}</span>
                      {hasNative && <span className="text-[7px] font-mono px-[4px] py-[1px] rounded-[8px] border" style={{ background: "rgba(29,155,240,0.1)", color: "#1d9bf0", borderColor: "rgba(29,155,240,0.25)" }}>native</span>}
                    </div>
                  </div>
                  <div className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: active ? "var(--brd)" : "var(--s3)" }}>
                    <div style={{ width: 0, height: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `7px solid ${active ? "var(--br)" : "var(--t2)"}` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Trim summary */}
        <div className="pt-[8px] mt-[2px] border-t flex flex-col gap-[5px]" style={{ borderColor: "var(--bo)" }}>
          <div className="text-[10px] font-medium mb-[2px]" style={{ color: "var(--t)" }}>Trim summary</div>
          {[
            { label: "Clip in", val: `${Math.round(clipIn)}%` },
            { label: "Clip out", val: `${Math.round(clipOut)}%` },
            { label: "Clip length", val: fmtDur(Math.round(trimmedDuration)) },
            { label: "Audio in", val: `${Math.round(audioIn)}%` },
            { label: "Audio out", val: `${Math.round(audioOut)}%` },
            { label: "Audio length", val: fmtDur(Math.round(audioTrimmedDuration)) },
            { label: "Audio loops", val: loopCount > 1 ? `${loopCount}x` : "—" },
          ].map(({ label, val }) => (
            <div key={label} className="flex justify-between items-center">
              <span className="text-[9px] font-mono" style={{ color: "var(--t3)" }}>{label}</span>
              <span className="text-[9px] font-mono" style={{ color: "var(--t)" }}>{val}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
