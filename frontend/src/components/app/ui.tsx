"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { ChevronDown, Loader2 } from "lucide-react";

export const cn = (...args: Parameters<typeof clsx>) => twMerge(clsx(...args));

/* ─── Surfaces ─────────────────────────────────────────────────────────── */

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-12px_rgba(15,23,42,0.08)]", className)}>
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          <h3 className="font-[Bricolage_Grotesque] text-[15px] font-bold leading-tight text-slate-900 sm:text-base">{title}</h3>
          {description && <p className="mt-1 text-[13px] leading-relaxed text-slate-500">{description}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("p-5 sm:p-6", className)}>{children}</div>;
}

/* ─── Buttons ──────────────────────────────────────────────────────────── */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "soft";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
};

const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-gradient-to-b from-indigo-500 to-indigo-600 text-white shadow-[0_1px_0_rgba(255,255,255,0.2)_inset,0_6px_16px_-6px_rgba(79,70,229,0.6)] hover:from-indigo-500 hover:to-indigo-700 focus-visible:ring-indigo-500",
  secondary: "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:ring-slate-400",
  soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100 focus-visible:ring-indigo-500",
  danger: "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 focus-visible:ring-rose-500",
  ghost: "text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
};
const sizes = {
  sm: "h-8 px-3 text-xs gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-11 px-5 text-sm gap-2",
};

export function Button({ variant = "primary", size = "md", loading, icon, block, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap rounded-xl font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant],
        sizes[size],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

/* ─── Form controls ────────────────────────────────────────────────────── */

export const controlCls =
  "block w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 transition focus:border-indigo-500 focus:outline-none focus:ring-4 focus:ring-indigo-500/10 disabled:bg-slate-50";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-slate-500">{hint}</span>}
    </label>
  );
}

export function SelectWrap({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  );
}

export const selectCls = cn(controlCls, "appearance-none pr-10");

/* ─── Status ───────────────────────────────────────────────────────────── */

const tones = {
  green: { chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/15", dot: "bg-emerald-500" },
  red: { chip: "bg-rose-50 text-rose-700 ring-rose-600/15", dot: "bg-rose-500" },
  amber: { chip: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500" },
  slate: { chip: "bg-slate-100 text-slate-600 ring-slate-500/10", dot: "bg-slate-400" },
  indigo: { chip: "bg-indigo-50 text-indigo-700 ring-indigo-600/15", dot: "bg-indigo-500" },
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "slate", dot = true, children, className }: { tone?: Tone; dot?: boolean; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset", tones[tone].chip, className)}>
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full", tones[tone].dot)} />}
      {children}
    </span>
  );
}

export function Alert({ tone = "slate", icon, children }: { tone?: "amber" | "red" | "green" | "indigo" | "slate"; icon?: ReactNode; children: ReactNode }) {
  const map = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-rose-200 bg-rose-50 text-rose-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    indigo: "border-indigo-200 bg-indigo-50 text-indigo-900",
    slate: "border-slate-200 bg-slate-50 text-slate-700",
  };
  return (
    <div role="note" className={cn("flex gap-3 rounded-xl border p-3.5 text-[13px] leading-relaxed", map[tone])}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Toast({ message }: { message: { text: string; type: "success" | "error" } | null }) {
  if (!message) return null;
  return (
    <div role="status" aria-live="polite" className={cn("rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset", message.type === "success" ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20" : "bg-rose-50 text-rose-700 ring-rose-600/20")}>
      {message.text}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">{icon}</div>}
      <div className="text-sm font-semibold text-slate-800">{title}</div>
      <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">{text}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function StatCard({ label, value, hint, icon, tone = "indigo" }: { label: string; value: ReactNode; hint?: string; icon: ReactNode; tone?: "indigo" | "emerald" | "rose" | "amber" }) {
  const t = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    rose: "bg-rose-50 text-rose-600",
    amber: "bg-amber-50 text-amber-600",
  }[tone];
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-slate-500">{label}</span>
        <span className={cn("flex h-9 w-9 items-center justify-center rounded-xl", t)}>{icon}</span>
      </div>
      <div className="mt-3 font-[Bricolage_Grotesque] text-3xl font-bold tracking-tight text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </Card>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-slate-100", className)} />;
}

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-800">{children}</dd>
    </div>
  );
}
