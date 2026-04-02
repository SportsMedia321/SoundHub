import React from "react";

// ── Button ─────────────────────────────────────────────────────────────────
interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
}
export function Btn({ variant = "default", size = "sm", className, ...props }: BtnProps) {
  const base = "font-medium rounded-md border transition-all cursor-pointer font-sans";
  const sizes = { sm: "text-[10px] px-[9px] py-[4px]", md: "text-[11px] px-[12px] py-[6px]" };
  const variants = {
    default: "bg-[var(--s2)] text-[var(--t)] border-[var(--bo)] hover:border-[var(--boh)] hover:text-[var(--br)]",
    primary: "bg-[var(--br)] text-black border-[var(--br)] hover:bg-[#00d470]",
    danger: "bg-transparent text-[#e74c3c] border-[rgba(231,76,60,0.3)] hover:bg-[rgba(231,76,60,0.1)]",
    ghost: "bg-transparent text-[var(--t2)] border-transparent hover:bg-[var(--s2)]",
  };
  return (
    <button
      className={clsx(base, sizes[size], variants[variant], className ?? "")}
      {...props}
    />
  );
}

// ── Badge / Pill ───────────────────────────────────────────────────────────
export function Pill({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        "text-[8px] font-mono px-[5px] py-[1px] rounded-[10px] border",
        className ?? ""
      )}
      style={
        color
          ? {
              background: `${color}18`,
              color,
              borderColor: `${color}44`,
            }
          : undefined
      }
    >
      {children}
    </span>
  );
}

// ── Toggle ─────────────────────────────────────────────────────────────────
export function Toggle({
  on,
  onChange,
  size = "md",
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  size?: "sm" | "md";
}) {
  const sm = size === "sm";
  return (
    <div
      onClick={() => onChange(!on)}
      className="relative cursor-pointer flex-shrink-0 rounded-full transition-colors duration-200"
      style={{
        width: sm ? 22 : 28,
        height: sm ? 12 : 16,
        background: on ? "var(--br)" : "var(--s3)",
      }}
    >
      <div
        className="absolute rounded-full bg-white transition-all duration-150"
        style={{
          width: sm ? 10 : 12,
          height: sm ? 10 : 12,
          top: sm ? 1 : 2,
          left: on ? (sm ? 11 : 14) : 2,
        }}
      />
    </div>
  );
}

// ── StatCard ───────────────────────────────────────────────────────────────
export function StatCard({
  label,
  value,
  delta,
}: {
  label: string;
  value: string | number;
  delta?: string;
}) {
  return (
    <div
      className="rounded-lg p-[9px_11px]"
      style={{ background: "var(--s2)" }}
    >
      <div
        className="text-[8px] font-mono uppercase tracking-[0.6px] mb-[2px]"
        style={{ color: "var(--t3)" }}
      >
        {label}
      </div>
      <div
        className="text-[17px] font-bold font-mono"
        style={{ color: "var(--t)" }}
      >
        {value}
      </div>
      {delta && (
        <div className="text-[8px] font-mono mt-[1px]" style={{ color: "var(--br)" }}>
          {delta}
        </div>
      )}
    </div>
  );
}

// ── SectionLabel ───────────────────────────────────────────────────────────
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[9px] font-mono uppercase tracking-[1.1px] block mb-[5px]"
      style={{ color: "var(--t3)" }}
    >
      {children}
    </span>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────
export function Spinner() {
  return (
    <div
      className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
      style={{ borderColor: "var(--br)", borderTopColor: "transparent" }}
    />
  );
}

// ── Empty state ────────────────────────────────────────────────────────────
export function Empty({ label }: { label: string }) {
  return (
    <div
      className="flex items-center justify-center py-16 text-[11px] font-mono"
      style={{ color: "var(--t3)" }}
    >
      {label}
    </div>
  );
}
