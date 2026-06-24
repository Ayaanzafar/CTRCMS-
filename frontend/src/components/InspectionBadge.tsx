import type { InspectionResult } from "@/types/sunrack-receipt";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CONFIG: Record<
  InspectionResult,
  { label: string; className: string }
> = {
  PASS: {
    label: "Pass",
    className: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  CONDITIONAL: {
    label: "Conditional",
    className: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  FAIL: {
    label: "Fail",
    className: "border-red-200 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300",
  },
  PENDING: {
    label: "Pending",
    className: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  },
};

interface InspectionBadgeProps {
  result: InspectionResult;
  className?: string;
}

export function InspectionBadge({ result, className }: InspectionBadgeProps) {
  const cfg = CONFIG[result];
  return (
    <Badge variant="outline" className={cn("font-medium", cfg.className, className)}>
      {cfg.label}
    </Badge>
  );
}
