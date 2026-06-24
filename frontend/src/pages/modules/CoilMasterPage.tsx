import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus,
  Search,
  Eye,
  FileText,
  Scissors,
  Pencil,
  Trash2,
  Archive,
  Lock,
  Upload,
  Download,
  CircleDot,
  Info,
  Package,
  Link2,
  Loader2,
  Truck,
  Scale,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  FilterX,
  Columns3,
  ArrowUpDown,
  History,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { coilApi, ApiError } from "@/lib/api";
import type { Coil, CoilDocument, CoilEditFormData, CoilFormData, CoilUsage } from "@/types/coil";
import type { AuditLogEntry } from "@/types/dashboard";
import { PageHeader } from "@/components/PageHeader";
import { DocumentUploadZone } from "@/components/DocumentUploadZone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  BANNER_STORAGE_KEY,
  PAGE_SIZE,
  TABLE_COLUMNS,
  defaultVisibleColumns,
  exportCoilsCsv,
  formatDate,
  formatFileSize,
  statusBadgeClass,
  validateCoilForm,
  type CoilSortField,
  type QuickFilter,
} from "@/components/coil-master/utils";

const EMPTY_FORM: CoilFormData = {
  coilNumber: "",
  grade: "",
  coating: "",
  size: "",
  weight: "",
  supplier: "AMNS (Hazira Plant)",
  mtcNumber: "",
  invoiceNumber: "",
  amnsDispatchDate: "",
  vehicleNumber: "",
  transporterName: "",
  receiptDateSlitter: "",
  receivingConditionRemarks: "",
};

function toCreatePayload(form: CoilFormData) {
  return {
    coilNumber: form.coilNumber,
    grade: form.grade,
    coating: form.coating,
    size: form.size,
    weight: Number(form.weight),
    supplier: form.supplier,
    mtcNumber: form.mtcNumber || null,
    invoiceNumber: form.invoiceNumber || null,
    amnsDispatchDate: form.amnsDispatchDate || null,
    vehicleNumber: form.vehicleNumber || null,
    transporterName: form.transporterName || null,
    receiptDateSlitter: form.receiptDateSlitter || null,
    receivingConditionRemarks: form.receivingConditionRemarks || null,
  };
}

function toUpdatePayload(form: CoilEditFormData) {
  return {
    grade: form.grade,
    coating: form.coating,
    size: form.size,
    weight: Number(form.weight),
    supplier: form.supplier,
    mtcNumber: form.mtcNumber || null,
    invoiceNumber: form.invoiceNumber || null,
    amnsDispatchDate: form.amnsDispatchDate || null,
    vehicleNumber: form.vehicleNumber || null,
    transporterName: form.transporterName || null,
    receiptDateSlitter: form.receiptDateSlitter || null,
    receivingConditionRemarks: form.receivingConditionRemarks || null,
  };
}

function coilToEditForm(coil: Coil): CoilEditFormData {
  return {
    grade: coil.grade,
    coating: coil.coating,
    size: coil.size,
    weight: String(coil.weight),
    supplier: coil.supplier,
    mtcNumber: coil.mtcNumber ?? "",
    invoiceNumber: coil.invoiceNumber ?? "",
    amnsDispatchDate: coil.amnsDispatchDate?.slice(0, 10) ?? "",
    vehicleNumber: coil.vehicleNumber ?? "",
    transporterName: coil.transporterName ?? "",
    receiptDateSlitter: coil.receiptDateSlitter?.slice(0, 10) ?? "",
    receivingConditionRemarks: coil.receivingConditionRemarks ?? "",
  };
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="sm:col-span-2 space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <Separator className="flex-1" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function DetailSection({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0 pb-3">
        <div className="rounded-lg bg-accent/10 p-2">
          <Icon className="h-4 w-4 text-accent" />
        </div>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  );
}

function DetailField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1 text-sm font-medium", mono && "font-mono")}>{value}</dd>
    </div>
  );
}

function LockedFieldsPanel({ form }: { form: CoilEditFormData }) {
  return (
    <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-800">
        <Lock className="h-4 w-4" />
        Locked material fields
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <DetailField label="Grade" value={form.grade} />
        <DetailField label="Coating" value={form.coating} />
        <DetailField label="Size" value={form.size} />
        <DetailField label="Weight" value={`${form.weight} MT`} />
        {form.mtcNumber && <DetailField label="MTC number" value={form.mtcNumber} mono />}
      </dl>
    </div>
  );
}

function TableSkeletonRows({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i}>
          {Array.from({ length: cols }).map((_, j) => (
            <TableCell key={j}>
              <div className="h-4 animate-pulse rounded bg-muted" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}

function SortableHead({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
}: {
  label: string;
  field: CoilSortField;
  sortBy: CoilSortField;
  sortOrder: "asc" | "desc";
  onSort: (field: CoilSortField) => void;
}) {
  const active = sortBy === field;
  return (
    <button
      type="button"
      className="inline-flex cursor-pointer items-center gap-1 font-medium hover:text-foreground"
      onClick={() => onSort(field)}
    >
      {label}
      {active ? (
        sortOrder === "asc" ? (
          <ChevronUp className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )
      ) : (
        <ArrowUpDown className="h-3 w-3 opacity-40" />
      )}
    </button>
  );
}

function CoilFormFields({
  form,
  setForm,
  mode,
  criticalLocked,
  hideCriticalFields,
}: {
  form: CoilFormData | CoilEditFormData;
  setForm: (f: CoilFormData | CoilEditFormData) => void;
  mode: "create" | "edit";
  criticalLocked?: boolean;
  hideCriticalFields?: boolean;
}) {
  return (
    <>
      {criticalLocked && !hideCriticalFields && (
        <div className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Traceability-critical fields are locked — this coil is used in slitting or downstream
            processes.
          </p>
        </div>
      )}

      <FormSection title="Identity & material">
        {mode === "create" && "coilNumber" in form && (
          <div className="sm:col-span-2">
            <Label htmlFor="coilNumber">Coil number *</Label>
            <Input
              id="coilNumber"
              value={form.coilNumber}
              onChange={(e) => setForm({ ...form, coilNumber: e.target.value.toUpperCase() })}
              placeholder="e.g. V9888D000M"
              required
              className="mt-1.5 font-mono"
            />
          </div>
        )}
        {!hideCriticalFields && (
          <>
            <div>
              <Label htmlFor="grade">Grade *</Label>
              <Input
                id="grade"
                value={form.grade}
                onChange={(e) => setForm({ ...form, grade: e.target.value })}
                placeholder="AMNS550S"
                required
                disabled={criticalLocked}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="coating">Coating *</Label>
              <Input
                id="coating"
                value={form.coating}
                onChange={(e) => setForm({ ...form, coating: e.target.value })}
                placeholder="ZM150"
                required
                disabled={criticalLocked}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="size">Size (T × W) *</Label>
              <Input
                id="size"
                value={form.size}
                onChange={(e) => setForm({ ...form, size: e.target.value })}
                placeholder="1250 × 0.5 mm"
                required
                disabled={criticalLocked}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="weight">Weight (MT) *</Label>
              <Input
                id="weight"
                type="number"
                step="0.001"
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
                required
                disabled={criticalLocked}
                className="mt-1.5"
              />
            </div>
          </>
        )}
        <div className="sm:col-span-2">
          <Label htmlFor="supplier">Supplier</Label>
          <Input
            id="supplier"
            value={form.supplier}
            onChange={(e) => setForm({ ...form, supplier: e.target.value })}
            className="mt-1.5"
          />
        </div>
        {!hideCriticalFields && (
          <div>
            <Label htmlFor="mtcNumber">MTC number</Label>
            <Input
              id="mtcNumber"
              value={form.mtcNumber}
              onChange={(e) => setForm({ ...form, mtcNumber: e.target.value })}
              disabled={criticalLocked}
              className="mt-1.5 font-mono text-sm"
            />
          </div>
        )}
      </FormSection>

      <FormSection title="Inward & logistics">
        <div>
          <Label htmlFor="invoiceNumber">Invoice number</Label>
          <Input
            id="invoiceNumber"
            value={form.invoiceNumber}
            onChange={(e) => setForm({ ...form, invoiceNumber: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="vehicleNumber">Vehicle number</Label>
          <Input
            id="vehicleNumber"
            value={form.vehicleNumber}
            onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="amnsDispatchDate">AMNS dispatch date</Label>
          <Input
            id="amnsDispatchDate"
            type="date"
            value={form.amnsDispatchDate}
            onChange={(e) => setForm({ ...form, amnsDispatchDate: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div>
          <Label htmlFor="receiptDateSlitter">Slitter receipt date</Label>
          <Input
            id="receiptDateSlitter"
            type="date"
            value={form.receiptDateSlitter}
            onChange={(e) => setForm({ ...form, receiptDateSlitter: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="transporterName">Transporter</Label>
          <Input
            id="transporterName"
            value={form.transporterName}
            onChange={(e) => setForm({ ...form, transporterName: e.target.value })}
            className="mt-1.5"
          />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="remarks">Receiving condition remarks</Label>
          <Textarea
            id="remarks"
            value={form.receivingConditionRemarks}
            onChange={(e) => setForm({ ...form, receivingConditionRemarks: e.target.value })}
            rows={3}
            className="mt-1.5"
          />
        </div>
      </FormSection>
    </>
  );
}

const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "hasDocs", label: "Has documents" },
  { id: "inTrace", label: "In traceability" },
  { id: "missingMtc", label: "Missing MTC" },
];

export function CoilMasterPage() {
  const { token, canWrite, canFullAccess } = useAuth();
  const toast = useToast();
  const writeAccess = canWrite("coil-master");
  const fullAccess = canFullAccess("coil-master");

  const [coils, setCoils] = useState<Coil[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(true);
  const [serverStats, setServerStats] = useState({
    total: 0,
    active: 0,
    archived: 0,
    inTrace: 0,
    withDocs: 0,
  });

  const [search, setSearch] = useState("");
  const [gradeFilter, setGradeFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [fromFilter, setFromFilter] = useState("");
  const [toFilter, setToFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("");
  const [page, setPage] = useState(0);
  const [sortBy, setSortBy] = useState<CoilSortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [visibleColumns, setVisibleColumns] = useState(defaultVisibleColumns);
  const [bannerCollapsed, setBannerCollapsed] = useState(
    () => localStorage.getItem(BANNER_STORAGE_KEY) === "true"
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<CoilFormData>(EMPTY_FORM);
  const [createMtcFile, setCreateMtcFile] = useState<File | null>(null);
  const [createInvoiceFile, setCreateInvoiceFile] = useState<File | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [selectedCoil, setSelectedCoil] = useState<Coil | null>(null);
  const [selectedUsage, setSelectedUsage] = useState<CoilUsage | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingCoil, setEditingCoil] = useState<Coil | null>(null);
  const [editForm, setEditForm] = useState<CoilEditFormData | null>(null);
  const [editUsage, setEditUsage] = useState<CoilUsage | null>(null);

  const [confirmAction, setConfirmAction] = useState<{
    type: "delete" | "archive";
    coil: Coil;
    usage: CoilUsage;
  } | null>(null);
  const [docToRemove, setDocToRemove] = useState<{
    id: string;
    originalName: string;
    documentType: string;
  } | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const listParams = useMemo(
    () => ({
      search: search || undefined,
      grade: gradeFilter || undefined,
      supplier: supplierFilter || undefined,
      from: fromFilter || undefined,
      to: toFilter || undefined,
      includeArchived: showArchived,
      quickFilter: quickFilter || undefined,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      sortBy,
      sortOrder,
    }),
    [
      search,
      gradeFilter,
      supplierFilter,
      fromFilter,
      toFilter,
      showArchived,
      quickFilter,
      page,
      sortBy,
      sortOrder,
    ]
  );

  const hasActiveFilters =
    !!search ||
    !!gradeFilter ||
    !!supplierFilter ||
    !!fromFilter ||
    !!toFilter ||
    showArchived ||
    !!quickFilter;

  const visibleColCount =
    Object.values(visibleColumns).filter(Boolean).length + 1;

  const loadStats = useCallback(async () => {
    if (!token) return;
    setStatsLoading(true);
    try {
      const res = await coilApi.stats(token, showArchived);
      setServerStats(res.stats);
    } catch {
      /* keep previous stats */
    } finally {
      setStatsLoading(false);
    }
  }, [token, showArchived]);

  const loadCoils = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await coilApi.list(token, listParams);
      setCoils(res.coils);
      setTotal(res.total);
    } catch {
      setCoils([]);
      setTotal(0);
      toast.error("Failed to load coil registry.");
    } finally {
      setLoading(false);
    }
  }, [token, listParams, toast]);

  useEffect(() => {
    const t = setTimeout(loadCoils, 300);
    return () => clearTimeout(t);
  }, [loadCoils]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  useEffect(() => {
    setPage(0);
  }, [search, gradeFilter, supplierFilter, fromFilter, toFilter, showArchived, quickFilter]);

  function toggleSort(field: CoilSortField) {
    if (sortBy === field) {
      setSortOrder((o) => (o === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("asc");
    }
  }

  function clearFilters() {
    setSearch("");
    setGradeFilter("");
    setSupplierFilter("");
    setFromFilter("");
    setToFilter("");
    setShowArchived(false);
    setQuickFilter("");
    setPage(0);
  }

  function dismissBanner() {
    setBannerCollapsed(true);
    localStorage.setItem(BANNER_STORAGE_KEY, "true");
  }

  function expandBanner() {
    setBannerCollapsed(false);
    localStorage.removeItem(BANNER_STORAGE_KEY);
  }

  async function openDetail(coilNumber: string) {
    if (!token) return;
    try {
      const [res, auditRes] = await Promise.all([
        coilApi.get(token, coilNumber),
        coilApi.auditLogs(token, coilNumber),
      ]);
      setSelectedCoil(res.coil);
      setSelectedUsage(res.usage);
      setAuditLogs(auditRes.logs);
      setDetailOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load coil");
    }
  }

  async function openEdit(coil: Coil, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!token) return;
    try {
      const res = await coilApi.get(token, coil.coilNumber);
      setEditingCoil(res.coil);
      setEditForm(coilToEditForm(res.coil));
      setEditUsage(res.usage);
      setFormError("");
      setEditDialogOpen(true);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load coil");
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const validationError = validateCoilForm(form, "create");
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      const res = await coilApi.create(token, toCreatePayload(form));
      if (createMtcFile) {
        await coilApi.uploadDocument(token, res.coil.coilNumber, createMtcFile, "MTC");
      }
      if (createInvoiceFile) {
        await coilApi.uploadDocument(token, res.coil.coilNumber, createInvoiceFile, "INVOICE");
      }
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setCreateMtcFile(null);
      setCreateInvoiceFile(null);
      toast.success(`Coil ${res.coil.coilNumber} registered.`);
      await loadCoils();
      await loadStats();
      await openDetail(res.coil.coilNumber);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to create coil");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !editingCoil || !editForm) return;
    const validationError = validateCoilForm(editForm, "edit");
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError("");
    setSubmitting(true);
    try {
      await coilApi.update(token, editingCoil.coilNumber, toUpdatePayload(editForm));
      setEditDialogOpen(false);
      toast.success(`Coil ${editingCoil.coilNumber} updated.`);
      await loadCoils();
      if (detailOpen && selectedCoil?.coilNumber === editingCoil.coilNumber) {
        await openDetail(editingCoil.coilNumber);
      }
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Failed to update coil");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpload(file: File, type: "MTC" | "INVOICE") {
    if (!token || !selectedCoil) return;
    try {
      await coilApi.uploadDocument(token, selectedCoil.coilNumber, file, type);
      toast.success(`${type} uploaded.`);
      await openDetail(selectedCoil.coilNumber);
      await loadCoils();
      await loadStats();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Upload failed");
    }
  }

  async function handleReplaceDocument(doc: CoilDocument, file: File) {
    if (!token || !selectedCoil) return;
    if (doc.documentType !== "MTC" && doc.documentType !== "INVOICE") {
      toast.error("Only MTC and invoice documents can be replaced.");
      return;
    }
    try {
      await coilApi.uploadDocument(token, selectedCoil.coilNumber, file, doc.documentType);
      await coilApi.deleteDocument(token, doc.id);
      toast.success(`${doc.documentType} replaced.`);
      await openDetail(selectedCoil.coilNumber);
      await loadCoils();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Replace failed");
    }
  }

  async function handleOpenDocument(doc: { id: string }) {
    if (!token) return;
    try {
      await coilApi.openDocument(token, doc.id);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to open document");
    }
  }

  async function handleDownloadDocument(doc: { id: string; originalName: string }) {
    if (!token) return;
    try {
      await coilApi.downloadDocument(token, doc.id, doc.originalName);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to download document");
    }
  }

  async function executeRemoveDocument() {
    if (!token || !docToRemove || !selectedCoil) return;
    setActionSubmitting(true);
    try {
      await coilApi.deleteDocument(token, docToRemove.id);
      setDocToRemove(null);
      toast.success("Document removed.");
      await openDetail(selectedCoil.coilNumber);
      await loadCoils();
      await loadStats();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to remove document");
    } finally {
      setActionSubmitting(false);
    }
  }

  async function openConfirm(type: "delete" | "archive", coil: Coil, e?: React.MouseEvent) {
    e?.stopPropagation();
    if (!token) return;
    try {
      const res = await coilApi.usage(token, coil.coilNumber);
      setConfirmAction({ type, coil, usage: res.usage });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load coil usage");
    }
  }

  async function executeConfirmAction() {
    if (!token || !confirmAction) return;
    setActionSubmitting(true);
    try {
      if (confirmAction.type === "delete") {
        await coilApi.delete(token, confirmAction.coil.coilNumber);
        toast.success(`Coil ${confirmAction.coil.coilNumber} deleted.`);
      } else {
        await coilApi.archive(token, confirmAction.coil.coilNumber);
        toast.success(`Coil ${confirmAction.coil.coilNumber} archived.`);
      }
      setConfirmAction(null);
      setDetailOpen(false);
      await loadCoils();
      await loadStats();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Action failed");
    } finally {
      setActionSubmitting(false);
    }
  }

  async function handleExportCsv() {
    if (!token) return;
    setExporting(true);
    try {
      const res = await coilApi.list(token, {
        search: search || undefined,
        grade: gradeFilter || undefined,
        supplier: supplierFilter || undefined,
        from: fromFilter || undefined,
        to: toFilter || undefined,
        includeArchived: showArchived,
        quickFilter: quickFilter || undefined,
        sortBy,
        sortOrder,
      });
      exportCoilsCsv(res.coils);
      toast.success(`Exported ${res.coils.length} record(s).`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const kpiCards = [
    {
      label: "Coils in registry",
      value: serverStats.total,
      sub: showArchived ? "Including archived" : "Active scope",
      icon: CircleDot,
      color: "bg-slate-800",
    },
    {
      label: "Active records",
      value: serverStats.active,
      sub: `${serverStats.archived} archived`,
      icon: Package,
      color: "bg-emerald-600",
    },
    {
      label: "In traceability",
      value: serverStats.inTrace,
      sub: "Linked to slitting",
      icon: Link2,
      color: "bg-accent",
    },
    {
      label: "With documents",
      value: serverStats.withDocs,
      sub: "MTC / invoice attached",
      icon: FileText,
      color: "bg-cyan-700",
    },
  ];

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Coil Master / Inward"
        description="Register AMNS parent coils at the slitter. Coil number is the immutable traceability root — critical fields lock after slitting; unused records can be deleted, linked records can be archived."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {!writeAccess && (
              <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
                Read-only access
              </Badge>
            )}
            {writeAccess && (
              <Dialog
                open={dialogOpen}
                onOpenChange={(open) => {
                  setDialogOpen(open);
                  if (!open) {
                    setForm(EMPTY_FORM);
                    setCreateMtcFile(null);
                    setCreateInvoiceFile(null);
                    setFormError("");
                  }
                }}
              >
                <DialogTrigger asChild>
                  <Button className="cursor-pointer shadow-sm">
                    <Plus className="mr-2 h-4 w-4" />
                    New coil
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto border-0 shadow-xl sm:max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>Register inward coil</DialogTitle>
                    <DialogDescription>
                      Capture material identity and inward logistics. Optionally attach MTC and invoice
                      now, or upload later from the detail panel.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
                    {formError && (
                      <p className="sm:col-span-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {formError}
                      </p>
                    )}
                    <CoilFormFields
                      form={form}
                      setForm={(f) => setForm(f as CoilFormData)}
                      mode="create"
                    />
                    <FormSection title="Optional documents">
                      <div>
                        <DocumentUploadZone
                          label="MTC (PDF)"
                          onUpload={async (f) => {
                            setCreateMtcFile(f);
                          }}
                        />
                        {createMtcFile && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">{createMtcFile.name}</p>
                        )}
                      </div>
                      <div>
                        <DocumentUploadZone
                          label="Invoice (PDF)"
                          onUpload={async (f) => {
                            setCreateInvoiceFile(f);
                          }}
                        />
                        {createInvoiceFile && (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {createInvoiceFile.name}
                          </p>
                        )}
                      </div>
                    </FormSection>
                    <div className="sm:col-span-2 flex justify-end gap-2 border-t pt-4">
                      <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button type="submit" disabled={submitting} className="cursor-pointer">
                        {submitting ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Saving…
                          </>
                        ) : (
                          "Create coil"
                        )}
                      </Button>
                    </div>
                  </form>
                </DialogContent>
              </Dialog>
            )}
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpiCards.map((s) => (
          <Card key={s.label} className="gap-0 border-0 py-0 shadow-sm transition-shadow hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-5">
              <div className={cn("rounded-xl p-3 shadow-sm", s.color)}>
                <s.icon className="h-5 w-5 text-white" />
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums">
                  {statsLoading ? "—" : s.value}
                </p>
                <p className="text-sm font-medium">{s.label}</p>
                <p className="text-xs text-muted-foreground">{s.sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {!bannerCollapsed ? (
        <div className="mb-6 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50/90 to-slate-50 p-4 text-sm text-blue-950">
          <div className="flex gap-3">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium">Master data & traceability rules</p>
              <p className="text-blue-900/80">
                Grade, coating, size, weight, and MTC lock once a coil enters slitting. Business fields
                (invoice, transporter, remarks, documents) stay editable. Delete only unused coils;
                archive coils already linked downstream.
              </p>
            </div>
            <button
              type="button"
              className="cursor-pointer shrink-0 text-blue-700/70 hover:text-blue-900"
              onClick={dismissBanner}
              aria-label="Dismiss rules banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mb-6 flex cursor-pointer items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          onClick={expandBanner}
        >
          <Info className="h-4 w-4" />
          Show traceability rules
        </button>
      )}

      <Card className="mb-4 gap-3 border-0 py-0 shadow-sm">
        <CardHeader className="px-6 pb-2 pt-5">
          <CardTitle className="flex items-center gap-2 text-base font-medium">
            <Search className="h-4 w-4 text-muted-foreground" />
            Search registry
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 px-6 pb-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="border-muted-foreground/20 pl-9"
                placeholder="Coil number, MTC, invoice…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Input
              placeholder="Filter by grade"
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="border-muted-foreground/20"
            />
            <Input
              placeholder="Filter by supplier"
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="border-muted-foreground/20"
            />
            <Input
              type="date"
              value={fromFilter}
              onChange={(e) => setFromFilter(e.target.value)}
              className="border-muted-foreground/20"
              aria-label="Dispatch from date"
            />
            <Input
              type="date"
              value={toFilter}
              onChange={(e) => setToFilter(e.target.value)}
              className="border-muted-foreground/20"
              aria-label="Dispatch to date"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {QUICK_FILTERS.map((qf) => (
              <Button
                key={qf.id}
                type="button"
                size="sm"
                variant={quickFilter === qf.id ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setQuickFilter((prev) => (prev === qf.id ? "" : qf.id))}
              >
                {qf.label}
              </Button>
            ))}
            {hasActiveFilters && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="cursor-pointer text-muted-foreground"
                onClick={clearFilters}
              >
                <FilterX className="mr-1.5 h-3.5 w-3.5" />
                Clear filters
              </Button>
            )}
          </div>

          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-3 py-2 text-sm transition-colors hover:bg-muted/40">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="size-4 rounded border-border accent-accent"
            />
            <span className="text-muted-foreground">Include archived coils in results</span>
          </label>
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden border-0 py-0 shadow-sm">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b bg-muted/30 px-6 py-4">
          <div>
            <CardTitle className="text-base font-medium">Coil registry</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {loading ? "Loading…" : `${total} record${total === 1 ? "" : "s"} · page ${page + 1} of ${totalPages}`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="cursor-pointer">
                  <Columns3 className="mr-2 h-4 w-4" />
                  Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {TABLE_COLUMNS.map((col) => (
                  <DropdownMenuCheckboxItem
                    key={col.id}
                    checked={visibleColumns[col.id]}
                    onCheckedChange={(checked) =>
                      setVisibleColumns((prev) => ({ ...prev, [col.id]: !!checked }))
                    }
                  >
                    {col.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              disabled={exporting || loading}
              onClick={handleExportCsv}
            >
              {exporting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {visibleColumns.coilNumber && (
                  <TableHead>
                    <SortableHead
                      label="Coil number"
                      field="coilNumber"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                    />
                  </TableHead>
                )}
                {visibleColumns.status && <TableHead>Status</TableHead>}
                {visibleColumns.grade && (
                  <TableHead>
                    <SortableHead
                      label="Grade"
                      field="grade"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                    />
                  </TableHead>
                )}
                {visibleColumns.coating && <TableHead>Coating</TableHead>}
                {visibleColumns.weight && <TableHead className="text-right">Weight</TableHead>}
                {visibleColumns.supplier && <TableHead>Supplier</TableHead>}
                {visibleColumns.dispatchDate && (
                  <TableHead>
                    <SortableHead
                      label="Dispatch"
                      field="amnsDispatchDate"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                    />
                  </TableHead>
                )}
                {visibleColumns.receiptDate && (
                  <TableHead>
                    <SortableHead
                      label="Receipt"
                      field="receiptDateSlitter"
                      sortBy={sortBy}
                      sortOrder={sortOrder}
                      onSort={toggleSort}
                    />
                  </TableHead>
                )}
                {visibleColumns.docs && <TableHead className="text-center">Docs</TableHead>}
                {visibleColumns.slits && <TableHead className="text-center">Slits</TableHead>}
                <TableHead className="w-16 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableSkeletonRows cols={visibleColCount} />
              ) : coils.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColCount} className="py-16 text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                      <CircleDot className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="mt-4 font-medium">No coils found</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {writeAccess
                        ? "Adjust filters or register your first inward coil."
                        : "Try adjusting your search filters."}
                    </p>
                    {writeAccess && (
                      <Button
                        className="mt-4 cursor-pointer"
                        size="sm"
                        onClick={() => setDialogOpen(true)}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        New coil
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ) : (
                coils.map((coil) => (
                  <TableRow
                    key={coil.coilNumber}
                    className="cursor-pointer transition-colors hover:bg-accent/5"
                    onClick={() => openDetail(coil.coilNumber)}
                  >
                    {visibleColumns.coilNumber && (
                      <TableCell className="font-mono text-sm font-semibold">{coil.coilNumber}</TableCell>
                    )}
                    {visibleColumns.status && (
                      <TableCell>
                        <Badge variant="outline" className={cn("font-normal", statusBadgeClass(coil.status))}>
                          {coil.status ?? "ACTIVE"}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.grade && <TableCell>{coil.grade}</TableCell>}
                    {visibleColumns.coating && <TableCell>{coil.coating}</TableCell>}
                    {visibleColumns.weight && (
                      <TableCell className="text-right tabular-nums">{coil.weight} MT</TableCell>
                    )}
                    {visibleColumns.supplier && (
                      <TableCell className="max-w-[140px] truncate text-muted-foreground">
                        {coil.supplier}
                      </TableCell>
                    )}
                    {visibleColumns.dispatchDate && (
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(coil.amnsDispatchDate)}
                      </TableCell>
                    )}
                    {visibleColumns.receiptDate && (
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(coil.receiptDateSlitter)}
                      </TableCell>
                    )}
                    {visibleColumns.docs && (
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="tabular-nums">
                          {coil._count?.documents ?? coil.documents?.length ?? 0}
                        </Badge>
                      </TableCell>
                    )}
                    {visibleColumns.slits && (
                      <TableCell className="text-center">
                        <Badge
                          variant="outline"
                          className={cn(
                            "tabular-nums",
                            (coil._count?.slittingRecords ?? 0) > 0 &&
                              "border-accent/30 bg-accent/5 text-accent"
                          )}
                        >
                          {coil._count?.slittingRecords ?? 0}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 cursor-pointer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                          <DropdownMenuItem
                            className="cursor-pointer"
                            onClick={() => openDetail(coil.coilNumber)}
                          >
                            <Eye className="mr-2 h-4 w-4" />
                            View details
                          </DropdownMenuItem>
                          {writeAccess && coil.status !== "ARCHIVED" && (
                            <DropdownMenuItem
                              className="cursor-pointer"
                              onClick={(e) => openEdit(coil, e as unknown as React.MouseEvent)}
                            >
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="cursor-pointer" asChild>
                            <Link to={`/traceability?q=${encodeURIComponent(coil.coilNumber)}`}>
                              <Link2 className="mr-2 h-4 w-4" />
                              Traceability
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem className="cursor-pointer" asChild>
                            <Link to={`/slitting?parentCoil=${encodeURIComponent(coil.coilNumber)}`}>
                              <Scissors className="mr-2 h-4 w-4" />
                              Slitting records
                            </Link>
                          </DropdownMenuItem>
                          {fullAccess && coil.status !== "ARCHIVED" && (
                            <>
                              <DropdownMenuSeparator />
                              {(coil._count?.slittingRecords ?? 0) > 0 ? (
                                <DropdownMenuItem
                                  className="cursor-pointer text-amber-800"
                                  onClick={(e) => openConfirm("archive", coil, e as unknown as React.MouseEvent)}
                                >
                                  <Archive className="mr-2 h-4 w-4" />
                                  Archive
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  className="cursor-pointer text-destructive focus:text-destructive"
                                  onClick={(e) => openConfirm("delete", coil, e as unknown as React.MouseEvent)}
                                >
                                  <Trash2 className="mr-2 h-4 w-4" />
                                  Delete
                                </DropdownMenuItem>
                              )}
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {!loading && total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="cursor-pointer"
                  disabled={page >= totalPages - 1}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto border-l-0 p-0 sm:max-w-xl">
          {selectedCoil && (
            <>
              <div className="border-b bg-gradient-to-br from-slate-900 to-slate-800 px-6 py-6 text-white">
                <SheetHeader className="space-y-3 p-0 text-left">
                  <div className="flex items-start gap-3">
                    <div className="rounded-xl bg-white/10 p-2.5 backdrop-blur">
                      <CircleDot className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <SheetTitle className="font-mono text-xl text-white">
                        {selectedCoil.coilNumber}
                      </SheetTitle>
                      <SheetDescription className="text-slate-300">
                        Parent coil · {selectedCoil.supplier}
                      </SheetDescription>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 border-white/20 bg-white/10 text-white",
                        selectedCoil.status === "ARCHIVED" && "bg-slate-600/50"
                      )}
                    >
                      {selectedCoil.status ?? "ACTIVE"}
                    </Badge>
                  </div>
                </SheetHeader>
              </div>

              <div className="space-y-4 p-6">
                {selectedUsage && (
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">Slitting: {selectedUsage.slittingRecords}</Badge>
                    <Badge variant="secondary">Production: {selectedUsage.productionBatches}</Badge>
                    <Badge variant="secondary">Dispatches: {selectedUsage.dispatches}</Badge>
                    <Badge variant="secondary">Documents: {selectedUsage.documents}</Badge>
                    {!selectedUsage.canEditCriticalFields && (
                      <Badge variant="outline" className="border-amber-300 text-amber-800">
                        Critical fields locked
                      </Badge>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                    <Link to={`/traceability?q=${encodeURIComponent(selectedCoil.coilNumber)}`}>
                      <Link2 className="mr-2 h-3.5 w-3.5" />
                      Traceability
                      <ExternalLink className="ml-1.5 h-3 w-3 opacity-50" />
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" className="cursor-pointer" asChild>
                    <Link to={`/slitting?parentCoil=${encodeURIComponent(selectedCoil.coilNumber)}`}>
                      <Scissors className="mr-2 h-3.5 w-3.5" />
                      Slitting
                    </Link>
                  </Button>
                </div>

                {selectedUsage && !selectedUsage.canEditCriticalFields && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <p>
                      Linked to {selectedUsage.slittingRecords} slit coil(s)
                      {selectedUsage.productionBatches > 0 &&
                        ` · ${selectedUsage.productionBatches} batch(es)`}
                      {selectedUsage.dispatches > 0 && ` · ${selectedUsage.dispatches} dispatch(es)`}.
                      Critical fields are locked.
                    </p>
                  </div>
                )}

                <DetailSection title="Material specification" icon={Scale}>
                  <dl className="grid grid-cols-2 gap-4">
                    <DetailField label="Grade" value={selectedCoil.grade} />
                    <DetailField label="Coating" value={selectedCoil.coating} />
                    <DetailField label="Size" value={selectedCoil.size} />
                    <DetailField label="Weight" value={`${selectedCoil.weight} MT`} />
                    {selectedCoil.mtcNumber && (
                      <DetailField label="MTC" value={selectedCoil.mtcNumber} mono />
                    )}
                  </dl>
                </DetailSection>

                <DetailSection title="Inward & logistics" icon={Truck}>
                  <dl className="grid grid-cols-2 gap-4">
                    <DetailField label="Invoice" value={selectedCoil.invoiceNumber ?? "—"} />
                    <DetailField label="Dispatch date" value={formatDate(selectedCoil.amnsDispatchDate)} />
                    <DetailField label="Receipt date" value={formatDate(selectedCoil.receiptDateSlitter)} />
                    <DetailField label="Vehicle" value={selectedCoil.vehicleNumber ?? "—"} mono />
                    <DetailField
                      label="Transporter"
                      value={selectedCoil.transporterName ?? "—"}
                      mono={!!selectedCoil.transporterName}
                    />
                    {selectedCoil.receivingConditionRemarks && (
                      <div className="col-span-2">
                        <DetailField label="Remarks" value={selectedCoil.receivingConditionRemarks} />
                      </div>
                    )}
                  </dl>
                </DetailSection>

                {selectedCoil.documents && selectedCoil.documents.length > 0 && (
                  <DetailSection title="Attached documents" icon={FileText}>
                    <ul className="space-y-2">
                      {selectedCoil.documents.map((doc) => (
                        <li
                          key={doc.id}
                          className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2.5"
                        >
                          <FileText className="h-4 w-4 shrink-0 text-accent" />
                          <div className="min-w-0 flex-1">
                            <Badge variant="outline" className="mb-1 text-[10px]">
                              {doc.documentType}
                            </Badge>
                            <p className="truncate text-sm">{doc.originalName}</p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(doc.size)} · uploaded {formatDate(doc.createdAt)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="icon"
                            title="View"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => handleOpenDocument(doc)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="icon"
                            title="Download"
                            className="h-8 w-8 shrink-0 cursor-pointer"
                            onClick={() => handleDownloadDocument(doc)}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                          {writeAccess && (
                            <>
                              <label title="Replace">
                                <input
                                  type="file"
                                  accept=".pdf,application/pdf"
                                  className="hidden"
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) void handleReplaceDocument(doc, file);
                                    e.target.value = "";
                                  }}
                                />
                                <Button
                                  variant="outline"
                                  size="icon"
                                  className="h-8 w-8 shrink-0 cursor-pointer"
                                  asChild
                                >
                                  <span>
                                    <RefreshCw className="h-4 w-4" />
                                  </span>
                                </Button>
                              </label>
                              <Button
                                variant="outline"
                                size="icon"
                                title="Remove"
                                className="h-8 w-8 shrink-0 cursor-pointer text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() =>
                                  setDocToRemove({
                                    id: doc.id,
                                    originalName: doc.originalName,
                                    documentType: doc.documentType,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  </DetailSection>
                )}

                {selectedCoil.slittingRecords && selectedCoil.slittingRecords.length > 0 && (
                  <DetailSection title="Slitting records" icon={Scissors}>
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Slit coil ID</TableHead>
                            <TableHead className="text-xs">Size</TableHead>
                            <TableHead className="text-xs text-right">Weight</TableHead>
                            <TableHead className="text-xs">Date</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selectedCoil.slittingRecords.map((s) => (
                            <TableRow key={s.slitCoilId}>
                              <TableCell className="font-mono text-xs">{s.slitCoilId}</TableCell>
                              <TableCell className="text-xs">{s.slitWidthSize}</TableCell>
                              <TableCell className="text-right text-xs tabular-nums">
                                {s.slitCoilWeight} MT
                              </TableCell>
                              <TableCell className="text-xs">{formatDate(s.slittingDate)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </DetailSection>
                )}

                {auditLogs.length > 0 && (
                  <DetailSection title="Audit trail" icon={History}>
                    <ul className="space-y-2">
                      {auditLogs.map((log) => (
                        <li
                          key={log.id}
                          className="rounded-lg border bg-muted/20 px-3 py-2 text-xs"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {log.action}
                            </Badge>
                            <span className="text-muted-foreground">{formatDate(log.createdAt)}</span>
                          </div>
                          <p className="mt-1 text-muted-foreground">
                            {log.user.fullName} · {log.user.role.name}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </DetailSection>
                )}

                {writeAccess && (
                  <DetailSection title="Upload documents" icon={Upload}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <DocumentUploadZone
                        label="MTC (PDF)"
                        onUpload={(f) => handleUpload(f, "MTC")}
                      />
                      <DocumentUploadZone
                        label="Invoice (PDF)"
                        onUpload={(f) => handleUpload(f, "INVOICE")}
                      />
                    </div>
                  </DetailSection>
                )}

                <div className="flex flex-wrap gap-2 border-t pt-4">
                  {writeAccess && selectedCoil.status !== "ARCHIVED" && (
                    <Button variant="outline" className="cursor-pointer" onClick={() => openEdit(selectedCoil)}>
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {fullAccess && selectedCoil.status !== "ARCHIVED" && selectedUsage?.canArchive && (
                    <Button
                      variant="outline"
                      className="cursor-pointer border-amber-200 text-amber-800 hover:bg-amber-50"
                      onClick={() => openConfirm("archive", selectedCoil)}
                    >
                      <Archive className="mr-2 h-4 w-4" />
                      Archive
                    </Button>
                  )}
                  {fullAccess && selectedUsage?.canDelete && (
                    <Button
                      variant="destructive"
                      className="cursor-pointer"
                      onClick={() => openConfirm("delete", selectedCoil)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border-0 shadow-xl sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="font-mono">Edit {editingCoil?.coilNumber}</DialogTitle>
            <DialogDescription>Update business fields. Locked fields cannot be changed.</DialogDescription>
          </DialogHeader>
          {editForm && (
            <form onSubmit={handleEdit} className="grid gap-4 sm:grid-cols-2">
              {formError && (
                <p className="sm:col-span-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {formError}
                </p>
              )}
              {editUsage && !editUsage.canEditCriticalFields && (
                <LockedFieldsPanel form={editForm} />
              )}
              <CoilFormFields
                form={editForm}
                setForm={(f) => setEditForm(f as CoilEditFormData)}
                mode="edit"
                criticalLocked={editUsage ? !editUsage.canEditCriticalFields : false}
                hideCriticalFields={editUsage ? !editUsage.canEditCriticalFields : false}
              />
              <div className="sm:col-span-2 flex justify-end gap-2 border-t pt-4">
                <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting} className="cursor-pointer">
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!docToRemove} onOpenChange={(open) => !open && setDocToRemove(null)}>
        <DialogContent className="border-0 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove document?</DialogTitle>
            <DialogDescription>
              Remove{" "}
              <span className="font-medium">{docToRemove?.originalName}</span> (
              {docToRemove?.documentType}) from this coil? The file will be deleted from storage and
              removed from the documents index. This action is logged in the audit trail.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDocToRemove(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              className="cursor-pointer"
              disabled={actionSubmitting}
              onClick={executeRemoveDocument}
            >
              {actionSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Removing…
                </>
              ) : (
                "Remove document"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!confirmAction} onOpenChange={(open) => !open && setConfirmAction(null)}>
        <DialogContent className="border-0 shadow-xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction?.type === "delete" ? "Delete coil?" : "Archive coil?"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction?.type === "delete" ? (
                <>
                  This coil has no linked records. Are you sure you want to delete{" "}
                  <span className="font-mono font-medium">{confirmAction.coil.coilNumber}</span>?
                  This action cannot be undone.
                </>
              ) : confirmAction?.usage.canArchive ? (
                <>
                  This coil is already part of traceability. It cannot be deleted. You can archive{" "}
                  <span className="font-mono font-medium">{confirmAction.coil.coilNumber}</span>{" "}
                  instead — it will be hidden from active lists but remain in traceability reports.
                </>
              ) : (
                <>This coil cannot be archived.</>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant={confirmAction?.type === "delete" ? "destructive" : "default"}
              className="cursor-pointer"
              disabled={
                actionSubmitting ||
                (confirmAction?.type === "delete" && !confirmAction.usage.canDelete) ||
                (confirmAction?.type === "archive" && !confirmAction.usage.canArchive)
              }
              onClick={executeConfirmAction}
            >
              {actionSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Processing…
                </>
              ) : confirmAction?.type === "delete" ? (
                "Delete coil"
              ) : (
                "Archive coil"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
