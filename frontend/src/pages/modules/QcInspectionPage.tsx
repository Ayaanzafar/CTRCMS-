import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  ShieldCheck,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { qcApi, ApiError } from "@/lib/api";
import type { QcInspection, QcInspectionForm, QcStats, PendingQcBatch, QcResult } from "@/types/qc";
import { PageHeader } from "@/components/PageHeader";
import { QcBadge } from "@/components/QcBadge";
import { AuthPhoto, MultiPhotoUpload } from "@/components/InspectionPhotoGallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EMPTY_FORM: QcInspectionForm = {
  batchNumber: "",
  qcResult: "PASS",
  inspectorName: "",
  inspectionDate: new Date().toISOString().slice(0, 10),
  qcRemarks: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function QcPhoto({ photoId, token, alt }: { photoId: string; token: string; alt: string }) {
  return <AuthPhoto photoId={photoId} token={token} alt={alt} className="aspect-video w-full" url={qcApi.photoUrl(photoId)} />;
}

export function QcInspectionPage() {
  const { token, user, canWrite } = useAuth();
  const [stats, setStats] = useState<QcStats | null>(null);
  const [inspections, setInspections] = useState<QcInspection[]>([]);
  const [pending, setPending] = useState<PendingQcBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<QcInspectionForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<QcInspection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("qc-inspection");

  useEffect(() => {
    if (user?.fullName && !form.inspectorName) {
      setForm((f) => ({ ...f, inspectorName: user.fullName }));
    }
  }, [user, form.inspectorName]);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, pendingRes, inspectionsRes] = await Promise.all([
        qcApi.stats(token),
        qcApi.pendingBatches(token),
        qcApi.list(token, {
          search: search || undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
        }),
      ]);
      setStats(statsRes.stats);
      setPending(pendingRes.pending);
      setInspections(inspectionsRes.inspections);
    } catch {
      setStats(null);
      setPending([]);
      setInspections([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  function openInspectDialog(batch: PendingQcBatch) {
    setForm({
      ...EMPTY_FORM,
      batchNumber: batch.batchNumber,
      inspectorName: user?.fullName ?? "",
      qcResult: batch.latestQc?.qcResult === "REWORK" ? "PASS" : "PASS",
    });
    setFormError("");
    setDialogOpen(true);
  }

  async function openDetail(id: string) {
    if (!token) return;
    const res = await qcApi.get(token, id);
    setSelected(res.inspection);
    setDetailOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await qcApi.create(token, {
        batchNumber: form.batchNumber,
        qcResult: form.qcResult,
        inspectorName: form.inspectorName,
        inspectionDate: form.inspectionDate,
        qcRemarks: form.qcRemarks || null,
      });
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, inspectorName: user?.fullName ?? "" });
      await loadAll();
      setTab("history");
      await openDetail(res.inspection.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to save inspection");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoUpload(files: File[]) {
    if (!token || !selected) return;
    await qcApi.uploadPhotos(token, selected.id, files);
    const res = await qcApi.get(token, selected.id);
    setSelected(res.inspection);
    await loadAll();
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="QC Inspection"
        description="Quality sign-off on production batches. Only Pass batches are eligible for dispatch."
        actions={
          writeAccess && pending.length > 0 && (
            <Button className="cursor-pointer" onClick={() => openInspectDialog(pending[0]!)}>
              <Plus className="mr-2 h-4 w-4" />
              Inspect Next Batch
            </Button>
          )
        }
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {[
            { label: "Pending QC", value: stats.batchesPendingQc, icon: Clock, color: "bg-amber-500" },
            { label: "Total inspections", value: stats.totalInspections, icon: ShieldCheck, color: "bg-[#0369A1]" },
            { label: "Passed", value: stats.passed, icon: CheckCircle2, color: "bg-emerald-600" },
            { label: "Failed", value: stats.failed, icon: XCircle, color: "bg-red-500" },
            { label: "Rework", value: stats.rework, icon: RotateCcw, color: "bg-orange-500" },
          ].map((s) => (
            <Card key={s.label} className="border-0 shadow-sm">
              <CardContent className="flex items-center gap-3 p-4">
                <div className={cn("rounded-lg p-2.5", s.color)}>
                  <s.icon className="h-5 w-5 text-white" />
                </div>
                <div>
                  <p className="text-xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border bg-muted/30 p-1">
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === "pending" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
            onClick={() => setTab("pending")}
          >
            Pending QC
            {pending.length > 0 && <Badge variant="secondary" className="ml-2">{pending.length}</Badge>}
          </button>
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === "history" ? "bg-background shadow-sm" : "text-muted-foreground"
            )}
            onClick={() => setTab("history")}
          >
            Inspection History
          </button>
        </div>
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Batch, inspector, order…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {tab === "pending" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <Card className="col-span-full p-12 text-center text-muted-foreground">Loading…</Card>
          ) : pending.length === 0 ? (
            <Card className="col-span-full p-12 text-center">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500/60" />
              <p className="mt-4 font-medium">All batches inspected</p>
            </Card>
          ) : (
            pending.map((b) => (
              <Card key={b.batchNumber} className="overflow-hidden hover:shadow-md transition-shadow">
                <CardContent className="p-0">
                  <div className="bg-gradient-to-r from-[#0F172A] to-[#1e3a5f] px-5 py-4 text-white">
                    <p className="font-mono font-semibold">{b.batchNumber}</p>
                    <p className="text-sm text-white/70">{b.productType} · {b.quantityProduced} units</p>
                  </div>
                  <div className="space-y-2 p-5 text-sm">
                    <div className="flex justify-between"><span className="text-muted-foreground">Order</span><span>{b.productionOrderNumber}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Produced</span><span>{formatDate(b.productionDate)}</span></div>
                    {b.latestQc?.qcResult === "REWORK" && (
                      <QcBadge result="REWORK" />
                    )}
                    {writeAccess && (
                      <Button className="mt-2 w-full cursor-pointer" onClick={() => openInspectDialog(b)}>
                        <ShieldCheck className="mr-2 h-4 w-4" />
                        Record QC
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      ) : (
        <Card>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 cursor-pointer"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All results</SelectItem>
                <SelectItem value="PASS">Pass</SelectItem>
                <SelectItem value="FAIL">Fail</SelectItem>
                <SelectItem value="REWORK">Rework</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Batch</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Inspector</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">Loading…</TableCell></TableRow>
                ) : inspections.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="py-12 text-center text-muted-foreground">No inspections yet.</TableCell></TableRow>
                ) : (
                  inspections.map((i) => (
                    <TableRow key={i.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(i.id)}>
                      <TableCell className="font-mono font-medium">{i.batchNumber}</TableCell>
                      <TableCell>{i.batch?.productType ?? "—"}</TableCell>
                      <TableCell>{i.inspectorName}</TableCell>
                      <TableCell>{formatDate(i.inspectionDate)}</TableCell>
                      <TableCell><QcBadge result={i.qcResult} /></TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="cursor-pointer" onClick={(e) => { e.stopPropagation(); openDetail(i.id); }}>
                          <Eye className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-accent" />
              QC Inspection
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="grid gap-4">
            {formError && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{formError}</p>}
            <div>
              <Label>Batch Number</Label>
              <Input value={form.batchNumber} readOnly className="font-mono bg-muted/50" />
            </div>
            <div>
              <Label>QC Result *</Label>
              <Select value={form.qcResult} onValueChange={(v) => setForm({ ...form, qcResult: v as QcResult })}>
                <SelectTrigger className="cursor-pointer"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PASS">Pass — release for dispatch</SelectItem>
                  <SelectItem value="FAIL">Fail — block from dispatch</SelectItem>
                  <SelectItem value="REWORK">Rework — re-inspect after correction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="inspector">Inspector Name *</Label>
              <Input id="inspector" value={form.inspectorName} onChange={(e) => setForm({ ...form, inspectorName: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="inspDate">Inspection Date *</Label>
              <Input id="inspDate" type="date" value={form.inspectionDate} onChange={(e) => setForm({ ...form, inspectionDate: e.target.value })} required />
            </div>
            <div>
              <Label htmlFor="remarks">QC Remarks</Label>
              <Textarea id="remarks" value={form.qcRemarks} onChange={(e) => setForm({ ...form, qcRemarks: e.target.value })} rows={3} placeholder="Coating, dimensions, weld quality…" />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save Inspection"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && token && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 font-mono">
                  <ShieldCheck className="h-4 w-4 text-accent" />
                  {selected.batchNumber}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <QcBadge result={selected.qcResult} />
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-muted-foreground">Inspector</dt><dd>{selected.inspectorName}</dd></div>
                  <div><dt className="text-muted-foreground">Date</dt><dd>{formatDate(selected.inspectionDate)}</dd></div>
                  {selected.batch && (
                    <>
                      <div><dt className="text-muted-foreground">Product</dt><dd>{selected.batch.productType}</dd></div>
                      <div><dt className="text-muted-foreground">Qty Produced</dt><dd>{selected.batch.quantityProduced}</dd></div>
                    </>
                  )}
                  {selected.qcRemarks && (
                    <div className="col-span-2"><dt className="text-muted-foreground">Remarks</dt><dd className="rounded-md bg-muted/50 p-3">{selected.qcRemarks}</dd></div>
                  )}
                </dl>
                {selected.photos && selected.photos.length > 0 && (
                  <div className="grid grid-cols-2 gap-3">
                    {selected.photos.map((p) => (
                      <div key={p.id} className="overflow-hidden rounded-lg border">
                        <QcPhoto photoId={p.id} token={token} alt={p.originalName} />
                      </div>
                    ))}
                  </div>
                )}
                {writeAccess && (
                  <MultiPhotoUpload label="Upload QC photos" onUpload={handlePhotoUpload} />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
