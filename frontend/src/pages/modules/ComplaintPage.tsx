import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  AlertTriangle,
  Link2,
  Camera,
  FileWarning,
  CheckCircle2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { complaintApi, ApiError } from "@/lib/api";
import type {
  Complaint,
  ComplaintForm,
  ComplaintStats,
  ComplaintTraceability,
  EligibleComplaintBatch,
  ResolutionStatus,
  ResponsibleStage,
} from "@/types/complaint";
import {
  RESOLUTION_STATUS_LABELS,
  RESPONSIBLE_STAGE_LABELS,
} from "@/types/complaint";
import { PageHeader } from "@/components/PageHeader";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EMPTY_FORM: ComplaintForm = {
  complaintId: "",
  complaintDate: new Date().toISOString().slice(0, 10),
  projectName: "",
  clientName: "",
  siteLocation: "",
  complaintDescription: "",
  rootCauseRemarks: "",
  responsibleStage: "",
  batchNumbers: [],
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusBadgeClass(status: ResolutionStatus) {
  if (status === "OPEN") return "bg-amber-100 text-amber-800";
  if (status === "UNDER_INVESTIGATION") return "bg-blue-100 text-blue-800";
  return "bg-emerald-100 text-emerald-800";
}

function ComplaintPhoto({ photoId, token, alt }: { photoId: string; token: string; alt: string }) {
  return (
    <AuthPhoto
      photoId={photoId}
      token={token}
      alt={alt}
      className="aspect-video w-full rounded-lg"
      url={complaintApi.photoUrl(photoId)}
    />
  );
}

function TraceabilityPanel({ trace }: { trace: ComplaintTraceability }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-4 text-sm">
      <h4 className="mb-3 flex items-center gap-2 font-semibold">
        <Link2 className="h-4 w-4 text-accent" />
        Auto-resolved traceability
      </h4>
      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Linked coil numbers</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {trace.linkedCoilNumbers.map((c) => (
              <Badge key={c} variant="secondary" className="font-mono">
                {c}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium uppercase text-muted-foreground">Slit coil IDs</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {trace.linkedSlitCoilIds.map((s) => (
              <Badge key={s} variant="outline" className="font-mono text-xs">
                {s}
              </Badge>
            ))}
          </div>
        </div>
        {trace.coils.map((coil) => (
          <div key={coil.coilNumber} className="rounded border bg-background p-2 text-xs">
            <p className="font-mono font-medium">{coil.coilNumber}</p>
            <p className="text-muted-foreground">
              {coil.grade} · {coil.coating} · MTC {coil.mtcNumber ?? "—"}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ComplaintPage() {
  const { token, canWrite } = useAuth();
  const [stats, setStats] = useState<ComplaintStats | null>(null);
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [eligible, setEligible] = useState<EligibleComplaintBatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ComplaintForm>(EMPTY_FORM);
  const [tracePreview, setTracePreview] = useState<ComplaintTraceability | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Complaint | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<ResolutionStatus>("OPEN");
  const [updateRootCause, setUpdateRootCause] = useState("");
  const [updateStage, setUpdateStage] = useState<ResponsibleStage | "">("");
  const writeAccess = canWrite("complaint");

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, listRes, eligibleRes] = await Promise.all([
        complaintApi.stats(token),
        complaintApi.list(token, {
          search: search || undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
        }),
        complaintApi.eligibleBatches(token),
      ]);
      setStats(statsRes.stats);
      setComplaints(listRes.complaints);
      setEligible(eligibleRes.batches);
    } catch {
      setStats(null);
      setComplaints([]);
      setEligible([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  useEffect(() => {
    if (!token || !dialogOpen) return;
    complaintApi.previewComplaintId(token).then((res) => {
      setForm((f) => ({ ...f, complaintId: res.complaintId }));
    });
  }, [token, dialogOpen]);

  useEffect(() => {
    if (!token || form.batchNumbers.length === 0) {
      setTracePreview(null);
      return;
    }
    complaintApi.resolveTrace(token, form.batchNumbers).then((res) => {
      setTracePreview(res.traceability);
    }).catch(() => setTracePreview(null));
  }, [token, form.batchNumbers]);

  function toggleBatch(batchNumber: string, dispatch?: EligibleComplaintBatch["dispatches"][0]) {
    setForm((f) => {
      const has = f.batchNumbers.includes(batchNumber);
      const batchNumbers = has
        ? f.batchNumbers.filter((b) => b !== batchNumber)
        : [...f.batchNumbers, batchNumber];

      const next = { ...f, batchNumbers };
      if (!has && dispatch) {
        next.projectName = dispatch.projectName;
        next.clientName = dispatch.clientName;
        next.siteLocation = dispatch.siteLocation;
      }
      return next;
    });
  }

  async function openDetail(complaintId: string) {
    if (!token) return;
    const res = await complaintApi.get(token, complaintId);
    setSelected(res.complaint);
    setUpdateStatus(res.complaint.resolutionStatus);
    setUpdateRootCause(res.complaint.rootCauseRemarks ?? "");
    setUpdateStage(res.complaint.responsibleStage ?? "");
    setDetailOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      if (form.batchNumbers.length === 0) {
        setFormError("Select at least one affected batch");
        return;
      }

      const res = await complaintApi.create(token, {
        complaintId: form.complaintId || undefined,
        complaintDate: form.complaintDate,
        projectName: form.projectName,
        clientName: form.clientName,
        siteLocation: form.siteLocation,
        complaintDescription: form.complaintDescription,
        rootCauseRemarks: form.rootCauseRemarks || null,
        responsibleStage: form.responsibleStage || null,
        batchNumbers: form.batchNumbers,
      });

      if (pendingPhotos.length > 0) {
        await complaintApi.uploadPhotos(token, res.complaint.complaintId, pendingPhotos);
      }

      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setPendingPhotos([]);
      setTracePreview(null);
      await loadAll();
      await openDetail(res.complaint.complaintId);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to create complaint");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateInvestigation() {
    if (!token || !selected) return;
    try {
      const res = await complaintApi.update(token, selected.complaintId, {
        resolutionStatus: updateStatus,
        rootCauseRemarks: updateRootCause || null,
        responsibleStage: updateStage || null,
        ...(updateStatus === "CLOSED"
          ? { resolutionDate: new Date().toISOString().slice(0, 10) }
          : {}),
      });
      setSelected(res.complaint);
      await loadAll();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Update failed");
    }
  }

  async function handleUploadPhotos(files: File[]) {
    if (!token || !selected) return;
    await complaintApi.uploadPhotos(token, selected.complaintId, files);
    const res = await complaintApi.get(token, selected.complaintId);
    setSelected(res.complaint);
    await loadAll();
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Complaint Management"
        description="Log rust and quality complaints with automatic backward traceability to originating coil numbers."
        actions={
          writeAccess && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  Raise Complaint
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-destructive" />
                    Raise Complaint
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="grid gap-4">
                  {formError && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {formError}
                    </p>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Complaint ID</Label>
                      <Input value={form.complaintId} readOnly className="bg-muted/50 font-mono" />
                    </div>
                    <div>
                      <Label>Complaint Date</Label>
                      <Input
                        type="date"
                        value={form.complaintDate}
                        onChange={(e) => setForm((f) => ({ ...f, complaintDate: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Affected Batch(es)</Label>
                    <div className="mt-2 max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">
                      {eligible.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          No dispatched batches available. Complete dispatch first.
                        </p>
                      ) : (
                        eligible.map((b) => (
                          <label
                            key={b.batchNumber}
                            className="flex cursor-pointer items-start gap-2 rounded p-2 hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              checked={form.batchNumbers.includes(b.batchNumber)}
                              onChange={() =>
                                toggleBatch(b.batchNumber, b.dispatches[0])
                              }
                              className="mt-1"
                            />
                            <span className="text-sm">
                              <span className="font-mono font-medium">{b.batchNumber}</span>
                              <span className="text-muted-foreground"> — {b.productType}</span>
                              {b.dispatches[0] && (
                                <span className="block text-xs text-muted-foreground">
                                  {b.dispatches[0].projectName} · {b.dispatches[0].siteLocation}
                                </span>
                              )}
                            </span>
                          </label>
                        ))
                      )}
                    </div>
                  </div>

                  {tracePreview && <TraceabilityPanel trace={tracePreview} />}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Project Name</Label>
                      <Input
                        value={form.projectName}
                        onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
                        required
                      />
                    </div>
                    <div>
                      <Label>Client Name</Label>
                      <Input
                        value={form.clientName}
                        onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Site Location</Label>
                    <Input
                      value={form.siteLocation}
                      onChange={(e) => setForm((f) => ({ ...f, siteLocation: e.target.value }))}
                      required
                    />
                  </div>

                  <div>
                    <Label>Complaint Description</Label>
                    <Textarea
                      value={form.complaintDescription}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, complaintDescription: e.target.value }))
                      }
                      rows={3}
                      required
                    />
                  </div>

                  <div>
                    <Label>Responsible Stage (initial)</Label>
                    <Select
                      value={form.responsibleStage || "none"}
                      onValueChange={(v) =>
                        setForm((f) => ({
                          ...f,
                          responsibleStage: v === "none" ? "" : (v as ResponsibleStage),
                        }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select stage…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Not determined yet</SelectItem>
                        {(Object.keys(RESPONSIBLE_STAGE_LABELS) as ResponsibleStage[]).map((k) => (
                          <SelectItem key={k} value={k}>
                            {RESPONSIBLE_STAGE_LABELS[k]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="mb-2 block">Rust / Defect Photos</Label>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="block w-full text-sm"
                      onChange={(e) => setPendingPhotos(Array.from(e.target.files ?? []))}
                    />
                  </div>

                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="cursor-pointer"
                      onClick={() => setDialogOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" className="cursor-pointer" disabled={submitting}>
                      {submitting ? "Submitting…" : "Submit Complaint"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Total complaints", value: stats.totalComplaints, icon: FileWarning, color: "bg-[#0F172A]" },
            { label: "Open", value: stats.open, icon: AlertTriangle, color: "bg-amber-600" },
            { label: "Under investigation", value: stats.underInvestigation, icon: Search, color: "bg-[#0369A1]" },
            { label: "Closed", value: stats.closed, icon: CheckCircle2, color: "bg-emerald-600" },
          ].map((s) => (
            <Card key={s.label} className="border-0 shadow-sm">
              <CardContent className="flex items-center gap-4 p-5">
                <div className={cn("rounded-xl p-3", s.color)}>
                  <s.icon className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="UNDER_INVESTIGATION">Under Investigation</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="ID, project, batch, coil…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Complaint ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Batches</TableHead>
              <TableHead>Linked Coils</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : complaints.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium">No complaints logged</p>
                </TableCell>
              </TableRow>
            ) : (
              complaints.map((c) => (
                <TableRow key={c.complaintId}>
                  <TableCell className="font-mono text-sm">{c.complaintId}</TableCell>
                  <TableCell>{formatDate(c.complaintDate)}</TableCell>
                  <TableCell>{c.projectName}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{c.batchNumbers.length}</Badge>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">
                      {c.linkedCoilNumbers.slice(0, 2).join(", ")}
                      {c.linkedCoilNumbers.length > 2 ? "…" : ""}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge className={statusBadgeClass(c.resolutionStatus)}>
                      {RESOLUTION_STATUS_LABELS[c.resolutionStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="cursor-pointer"
                      onClick={() => openDetail(c.complaintId)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 font-mono text-base">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {selected?.complaintId}
            </SheetTitle>
          </SheetHeader>
          {selected && token && (
            <div className="mt-6 space-y-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">Date</dt>
                <dd>{formatDate(selected.complaintDate)}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge className={statusBadgeClass(selected.resolutionStatus)}>
                    {RESOLUTION_STATUS_LABELS[selected.resolutionStatus]}
                  </Badge>
                </dd>
                <dt className="text-muted-foreground">Project</dt>
                <dd>{selected.projectName}</dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd>{selected.clientName}</dd>
                <dt className="text-muted-foreground col-span-2">Description</dt>
                <dd className="col-span-2">{selected.complaintDescription}</dd>
              </dl>

              <TraceabilityPanel trace={selected.traceability} />

              {writeAccess && (
                <div className="rounded-lg border p-4 space-y-3">
                  <h4 className="text-sm font-semibold">Investigation & Resolution</h4>
                  <Select
                    value={updateStatus}
                    onValueChange={(v) => setUpdateStatus(v as ResolutionStatus)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(RESOLUTION_STATUS_LABELS) as ResolutionStatus[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {RESOLUTION_STATUS_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={updateStage || "none"}
                    onValueChange={(v) =>
                      setUpdateStage(v === "none" ? "" : (v as ResponsibleStage))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Responsible stage" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not determined</SelectItem>
                      {(Object.keys(RESPONSIBLE_STAGE_LABELS) as ResponsibleStage[]).map((k) => (
                        <SelectItem key={k} value={k}>
                          {RESPONSIBLE_STAGE_LABELS[k]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Root cause remarks…"
                    value={updateRootCause}
                    onChange={(e) => setUpdateRootCause(e.target.value)}
                    rows={3}
                  />
                  <Button className="cursor-pointer w-full" onClick={handleUpdateInvestigation}>
                    Save Investigation Update
                  </Button>
                </div>
              )}

              {writeAccess && (
                <MultiPhotoUpload label="Add rust photos" onUpload={handleUploadPhotos} />
              )}

              {selected.photos.length > 0 && (
                <div>
                  <h4 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                    <Camera className="h-4 w-4" />
                    Rust Photos ({selected.photoCount})
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selected.photos.map((photo) => (
                      <ComplaintPhoto
                        key={photo.id}
                        photoId={photo.id}
                        token={token}
                        alt={photo.originalName}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
