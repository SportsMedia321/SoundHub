import React, { useState } from "react";
import useSWR from "swr";
import {
  getQueue, approvePost, approvePosts, editPost, type Post,
} from "../../lib/api";
import { platformColor, humanDate, fmtViews } from "../../lib/utils";
import { Btn, Toggle, Empty, Spinner } from "../ui";

const PLATFORM_FMTS: Record<string, string> = {
  tiktok: "9:16 · ≤60s",
  instagram: "9:16 · ≤90s",
  youtube: "9:16 · ≤60s",
};

function PostCard({
  post,
  onApprove,
  onEdit,
}: {
  post: Post;
  onApprove: (id: string) => void;
  onEdit: (id: string, caption: string) => void;
}) {
  const [editMode, setEditMode] = useState(false);
  const [caption, setCaption] = useState(post.caption_final || post.caption_generated || "");
  const [newVol, setNewVol] = useState(Math.round((post.audio_new_volume ?? 1) * 100));
  const [origVol, setOrigVol] = useState(Math.round((post.audio_original_volume ?? 0) * 100));
  const [stripOn, setStripOn] = useState((post.audio_original_volume ?? 0) === 0);
  const [layerOn, setLayerOn] = useState((post.audio_original_volume ?? 0) > 0);

  const statusColor =
    post.approval_status === "approved"
      ? { bg: "var(--brd)", text: "var(--br)", border: "var(--brb)" }
      : post.approval_status === "published"
      ? { bg: "rgba(29,155,240,0.1)", text: "#1d9bf0", border: "rgba(29,155,240,0.3)" }
      : { bg: "rgba(251,191,36,0.1)", text: "#fbbf24", border: "rgba(251,191,36,0.3)" };

  const pc = platformColor(post.platform);
  const clip = (post as any).clips;
  const audio = (post as any).audio_library;

  const handleSaveEdit = async () => {
    await editPost({
      post_id: post.id,
      caption,
      training_note: `User edited caption for ${post.platform} post`,
    });
    setEditMode(false);
    onEdit(post.id, caption);
  };

  return (
    <div
      className="rounded-[10px] border overflow-hidden"
      style={{ background: "var(--s2)", borderColor: "var(--bo)" }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-[9px] p-[10px_13px] border-b"
        style={{ borderColor: "var(--bo)" }}
      >
        <div
          className="w-8 h-8 rounded-[6px] flex-shrink-0"
          style={{ background: "linear-gradient(135deg,#1a0a2b,#2d0a1a)" }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium truncate" style={{ color: "var(--t)" }}>
            {clip?.caption?.slice(0, 60) || "Sports highlight"}
          </div>
          <div className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
            {clip?.sport_category ?? "—"} · {audio?.name ?? "No audio"} · {post.platform}
          </div>
        </div>
        <span
          className="text-[8px] font-mono px-[7px] py-[2px] rounded-[20px] border flex-shrink-0"
          style={{ background: statusColor.bg, color: statusColor.text, borderColor: statusColor.border }}
        >
          {post.approval_status === "pending" ? "Pending" : post.approval_status === "approved" ? "Ready" : "Published"}
        </span>
      </div>

      {/* Platform version row */}
      <div
        className="p-[9px_13px] border-b"
        style={{ borderColor: "var(--bo)" }}
      >
        <div className="flex items-center gap-[6px]">
          <div className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: pc }} />
          <span className="text-[10px] flex-1" style={{ color: "var(--t)" }}>
            {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
          </span>
          <span className="text-[8px] font-mono" style={{ color: "var(--t2)" }}>
            {PLATFORM_FMTS[post.platform] ?? "9:16"}
            {post.use_platform_native_audio ? " · native sound ✓" : ""}
          </span>
          <span className="text-[8px] font-mono" style={{ color: post.within_priority_window ? "var(--br)" : "#fbbf24" }}>
            {post.scheduled_post_time ? humanDate(post.scheduled_post_time) : "Pending timing"}
          </span>
        </div>
      </div>

      {/* Audio mix strip */}
      <div
        className="flex items-center gap-[10px] flex-wrap p-[9px_13px] border-b"
        style={{ background: "var(--s3)", borderColor: "var(--bo)" }}
      >
        <span className="text-[9px] flex-shrink-0" style={{ color: "var(--t2)" }}>Audio:</span>
        <span
          className="text-[9px] font-mono px-[7px] py-[2px] rounded-[10px] border cursor-pointer"
          style={{ background: "var(--brd)", color: "var(--br)", borderColor: "var(--brb)" }}
        >
          {audio?.name ?? "No audio"}
        </span>
        <span className="text-[9px] font-mono" style={{ color: "var(--t2)" }}>
          New: {newVol}% · Orig: {origVol}%
        </span>
        <div className="flex items-center gap-[5px] ml-auto">
          <span className="text-[9px]" style={{ color: "var(--t2)" }}>Layer orig</span>
          <Toggle size="sm" on={layerOn} onChange={setLayerOn} />
          <span className="text-[9px] ml-[8px]" style={{ color: "var(--t2)" }}>Strip orig</span>
          <Toggle size="sm" on={stripOn} onChange={setStripOn} />
        </div>
      </div>

      {/* Caption edit */}
      {editMode && (
        <div className="p-[9px_13px] border-b" style={{ borderColor: "var(--bo)" }}>
          <textarea
            className="w-full rounded-[7px] p-[8px] text-[10px] outline-none resize-none"
            style={{
              background: "var(--s3)",
              border: "0.5px solid var(--boh)",
              color: "var(--t)",
              fontFamily: "var(--fh)",
              minHeight: 70,
            }}
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center gap-[7px] p-[8px_13px]">
        <div className="flex-1 text-[9px] italic truncate" style={{ color: "var(--t2)" }}>
          {post.use_platform_native_audio
            ? `Native audio detected — will use platform version for algo boost`
            : `Posts within 24hrs of approval · priority: 12hr window`}
        </div>
        <div className="flex gap-[6px]">
          {editMode ? (
            <>
              <Btn size="sm" onClick={() => setEditMode(false)}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={handleSaveEdit}>Save</Btn>
            </>
          ) : (
            <>
              <Btn size="sm" onClick={() => setEditMode(true)}>Edit</Btn>
              <Btn size="sm">Reschedule</Btn>
              {post.approval_status === "pending" && (
                <Btn size="sm" variant="primary" onClick={() => onApprove(post.id)}>
                  Approve
                </Btn>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PostQueue() {
  const { data, mutate, isLoading } = useSWR("queue", getQueue, {
    refreshInterval: 15000,
  });
  const posts = data?.posts ?? [];
  const pending = posts.filter((p) => p.approval_status === "pending");
  const approved = posts.filter((p) => p.approval_status === "approved");

  const handleApprove = async (id: string) => {
    await approvePost(id);
    mutate();
  };

  const handleApproveAll = async () => {
    const ids = pending.map((p) => p.id);
    await approvePosts(ids);
    mutate();
  };

  const handleEdit = (id: string, caption: string) => {
    mutate();
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden min-h-0">
      {/* Topbar */}
      <div
        className="flex items-center gap-[8px] p-[10px_16px] border-b flex-shrink-0"
        style={{ background: "var(--s1)", borderColor: "var(--bo)" }}
      >
        <span className="text-[13px] font-bold" style={{ color: "var(--t)" }}>
          Post queue
        </span>
        <span className="text-[10px] font-mono" style={{ color: "var(--t2)" }}>
          {pending.length} pending approval · posts within 24hrs · priority 12hr window
        </span>
        <div className="ml-auto flex gap-[6px]">
          <Btn size="sm">Bulk reschedule</Btn>
          <Btn size="sm" variant="primary" disabled={pending.length === 0} onClick={handleApproveAll}>
            Approve all
          </Btn>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-[14px_16px]">
        {isLoading ? (
          <div className="flex justify-center pt-16"><Spinner /></div>
        ) : posts.length === 0 ? (
          <Empty label="No posts in queue — compose clips to add them here" />
        ) : (
          <div className="flex flex-col gap-[9px]">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onApprove={handleApprove}
                onEdit={handleEdit}
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
          <span style={{ color: "var(--br)" }}>{approved.length}</span> approved ·{" "}
          <span style={{ color: "var(--br)" }}>{pending.length}</span> pending
        </span>
        <Btn size="sm">Export schedule</Btn>
        <Btn
          size="sm"
          variant="primary"
          disabled={pending.length === 0}
          onClick={handleApproveAll}
        >
          Approve all remaining
        </Btn>
      </div>
    </div>
  );
}
