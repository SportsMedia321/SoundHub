export function fmtViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function fmtDur(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ttlPct(expiresAt: string): number {
  const total = 48 * 60 * 60 * 1000;
  const remaining = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.min(100, Math.round((remaining / total) * 100)));
}

export function ttlColor(pct: number): string {
  if (pct > 50) return "#00e87a";
  if (pct > 20) return "#fbbf24";
  return "#e74c3c";
}

export function timeAgo(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export function platformColor(p: string): string {
  return { tiktok: "#ff2d55", instagram: "#e1306c", youtube: "#ff0000", x: "#1d9bf0" }[p] ?? "#888";
}

export function platformLabel(p: string): string {
  return { tiktok: "TT", instagram: "IG", youtube: "YT", x: "X" }[p] ?? p.toUpperCase().slice(0, 2);
}

export function categoryColor(c: string): string {
  return {
    NFL: "#1a3a6b", NBA: "#c8102e", MLB: "#002D72",
    NHL: "#2d6a4f", MLS: "#00b2a9", "US Intl": "#b8242a", MISC: "#7c3aed",
  }[c] ?? "#888";
}

export function clsx(...args: (string | false | undefined | null)[]): string {
  return args.filter(Boolean).join(" ");
}

export function humanDate(iso: string): string {
  if (!iso || iso === "never" || iso === "pending") return iso ?? "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
