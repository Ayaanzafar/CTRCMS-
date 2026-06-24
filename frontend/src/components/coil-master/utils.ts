import type { Coil, CoilEditFormData, CoilFormData } from "@/types/coil";

export const BANNER_STORAGE_KEY = "coil-master-rules-banner-dismissed";
export const PAGE_SIZE = 25;

export type QuickFilter = "" | "hasDocs" | "inTrace" | "missingMtc";
export type CoilSortField =
  | "createdAt"
  | "coilNumber"
  | "amnsDispatchDate"
  | "receiptDateSlitter"
  | "grade";

export const TABLE_COLUMNS = [
  { id: "coilNumber", label: "Coil number", default: true },
  { id: "status", label: "Status", default: true },
  { id: "grade", label: "Grade", default: true },
  { id: "coating", label: "Coating", default: true },
  { id: "weight", label: "Weight", default: true },
  { id: "supplier", label: "Supplier", default: true },
  { id: "dispatchDate", label: "Dispatch date", default: false },
  { id: "receiptDate", label: "Receipt date", default: false },
  { id: "docs", label: "Docs", default: true },
  { id: "slits", label: "Slits", default: true },
] as const;

export type TableColumnId = (typeof TABLE_COLUMNS)[number]["id"];

export function defaultVisibleColumns(): Record<TableColumnId, boolean> {
  return TABLE_COLUMNS.reduce(
    (acc, col) => {
      acc[col.id] = col.default;
      return acc;
    },
    {} as Record<TableColumnId, boolean>
  );
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusBadgeClass(status?: string) {
  if (status === "ARCHIVED") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

export function validateCoilForm(
  form: CoilFormData | CoilEditFormData,
  mode: "create" | "edit"
): string | null {
  if (mode === "create" && "coilNumber" in form && !form.coilNumber.trim()) {
    return "Coil number is required.";
  }
  if (!form.grade.trim()) return "Grade is required.";
  if (!form.coating.trim()) return "Coating is required.";
  if (!form.size.trim()) return "Size is required.";
  if (!form.weight.trim()) return "Weight is required.";
  const weight = Number(form.weight);
  if (Number.isNaN(weight) || weight <= 0) return "Weight must be a positive number.";
  return null;
}

export function exportCoilsCsv(coils: Coil[], filename = "coil-registry.csv") {
  const headers = [
    "Coil Number",
    "Status",
    "Grade",
    "Coating",
    "Size",
    "Weight (MT)",
    "Supplier",
    "MTC",
    "Invoice",
    "Dispatch Date",
    "Receipt Date",
    "Documents",
    "Slitting Records",
  ];
  const rows = coils.map((c) => [
    c.coilNumber,
    c.status ?? "ACTIVE",
    c.grade,
    c.coating,
    c.size,
    c.weight,
    c.supplier,
    c.mtcNumber ?? "",
    c.invoiceNumber ?? "",
    c.amnsDispatchDate?.slice(0, 10) ?? "",
    c.receiptDateSlitter?.slice(0, 10) ?? "",
    String(c._count?.documents ?? c.documents?.length ?? 0),
    String(c._count?.slittingRecords ?? 0),
  ]);
  const escape = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
