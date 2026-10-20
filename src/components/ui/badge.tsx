import type { ReactNode } from "react";
import type { RequestStatus } from "@/db/schema";
import { STATUS_BADGE_CLASSES, STATUS_LABELS } from "@/lib/status";
import { cn } from "./cn";

export type BadgeTone = "slate" | "blue" | "green" | "amber" | "red" | "violet";

const TONES: Record<BadgeTone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
  blue: "bg-brand-50 text-brand-800 ring-brand-600/20",
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  violet: "bg-violet-50 text-violet-800 ring-violet-600/20",
};

export function Badge({ tone = "slate", children, className }: { tone?: BadgeTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusBadge({ status, className }: { status: RequestStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap",
        STATUS_BADGE_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
