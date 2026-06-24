import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  Warehouse,
  PackageCheck,
  Clock,
  CheckCircle2,
  XCircle,
  Truck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { sunrackReceiptApi, ApiError } from "@/lib/api";
import type {
  SunrackReceipt,
  SunrackReceiptForm,
  SunrackReceiptStats,
  PendingSlitCoil,
  InspectionResult,
} from "@/types/sunrack-receipt";
import { PageHeader } from "@/components/PageHeader";
import { InspectionBadge } from "@/components/InspectionBadge";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EMPTY_FORM: SunrackReceiptForm = {
  slitCoilId: "",
  receiptDateSunrack: new Date().toISOString().slice(0, 10),
  storageLocationBin: "",
  inspectionResult: "PENDING",
  inspectionRemarks: "",
  confirmedDispatchNote: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  accent: string;
}) {
  return (
    <Card className="overflow-hidden border-0 shadow-sm">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={cn("rounded-xl p-3", accent)}>
          <Icon className="h-6 w-6 text-white" />
        </div>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SunrackReceiptPage() {
  const { token, canWrite } = useAuth();
  const [stats, setStats] = useState<SunrackReceiptStats | null>(null);
  const [receipts, setReceipts] = useState<SunrackReceipt[]>([]);
  const [pending, setPending] = useState<PendingSlitCoil[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "received">("pending");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SunrackReceiptForm>(EMPTY_FORM);
  const [selectedPending, setSelectedPending] = useState<PendingSlitCoil | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<SunrackReceipt | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("sunrack-receipt");

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, pendingRes, receiptsRes] = await Promise.all([
        sunrackReceiptApi.stats(token),
        sunrackReceiptApi.pending(token, search || undefined),
        sunrackReceiptApi.list(token, {
          search: search || undefined,
          status: statusFilter !== "ALL" ? statusFilter : undefined,
        }),
      ]);
      setStats(statsRes.stats);
      setPending(pendingRes.pending);
      setReceipts(receiptsRes.receipts);
    } catch {
      setStats(null);
      setPending([]);
      setReceipts([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, statusFilter]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  function openReceiveDialog(pendingCoil: PendingSlitCoil) {
    setSelectedPending(pendingCoil);
    setForm({
      ...EMPTY_FORM,
      slitCoilId: pendingCoil.slitCoilId,
      confirmedDispatchNote: pendingCoil.dispatchNote ?? "",
    });
    setFormError("");
    setDialogOpen(true);
  }

  async function openDetail(id: string) {
    if (!token) return;
    const res = await sunrackReceiptApi.get(token, id);
    setSelected(res.receipt);
    setDetailOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await sunrackReceiptApi.create(token, {
        slitCoilId: form.slitCoilId,
        receiptDateSunrack: form.receiptDateSunrack,
        storageLocationBin: form.storageLocationBin,
        inspectionResult: form.inspectionResult,
        inspectionRemarks: form.inspectionRemarks || null,
        confirmedDispatchNote: form.confirmedDispatchNote || null,
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setSelectedPending(null);
      await loadAll();
      setTab("received");
      await openDetail(res.receipt.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to create receipt");
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePhotoUpload(files: File[]) {
    if (!token || !selected) return;
    await sunrackReceiptApi.uploadPhotos(token, selected.id, files);
    const res = await sunrackReceiptApi.get(token, selected.id);
    setSelected(res.receipt);
    await loadAll();
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Sunrack Receipt & Storage"
        description="Confirm slit coil arrivals from Shiv Sagar Slitter, assign warehouse storage, and record visual/coating inspection with photos."
        actions={
          writeAccess && pending.length > 0 && (
            <Button className="cursor-pointer" onClick={() => openReceiveDialog(pending[0]!)}>
              <Plus className="mr-2 h-4 w-4" />
              Receive Next Coil
            </Button>
          )
        }
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Pending arrivals"
            value={stats.pendingSlitCoils}
            icon={Clock}
            accent="bg-amber-500"
          />
          <StatCard
            label="Total received"
            value={stats.totalReceipts}
            icon={PackageCheck}
            accent="bg-[#0369A1]"
          />
          <StatCard
            label="Passed inspection"
            value={stats.passedInspections}
            icon={CheckCircle2}
            accent="bg-emerald-600"
          />
          <StatCard
            label="Failed inspection"
            value={stats.failedInspections}
            icon={XCircle}
            accent="bg-red-500"
          />
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border bg-muted/30 p-1">
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === "pending" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("pending")}
          >
            Pending Arrivals
            {stats && stats.pendingSlitCoils > 0 && (
              <Badge variant="secondary" className="ml-2">
                {stats.pendingSlitCoils}
              </Badge>
            )}
          </button>
          <button
            type="button"
            className={cn(
              "cursor-pointer rounded-md px-4 py-2 text-sm font-medium transition-colors",
              tab === "received" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setTab("received")}
          >
            Received & Inspected
          </button>
        </div>
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search slit coil, dispatch note, bin…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {tab === "pending" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {loading ? (
            <Card className="col-span-full p-12 text-center text-muted-foreground">
              Loading pending arrivals…
            </Card>
          ) : pending.length === 0 ? (
            <Card className="col-span-full p-12 text-center">
              <Warehouse className="mx-auto h-12 w-12 text-emerald-500/60" />
              <p className="mt-4 font-medium">All slit coils received</p>
              <p className="mt-1 text-sm text-muted-foreground">
                No pending arrivals from the slitter. New dispatches will appear here.
              </p>
            </Card>
          ) : (
            pending.map((item) => (
              <Card
                key={item.slitCoilId}
                className="group overflow-hidden transition-shadow hover:shadow-md"
              >
                <CardContent className="p-0">
                  <div className="border-b bg-gradient-to-r from-[#0F172A] to-[#1e3a5f] px-5 py-4 text-white">
                    <p className="font-mono text-lg font-semibold">{item.slitCoilId}</p>
                    <p className="mt-1 text-sm text-white/70">
                      Parent: {item.parentCoilNumber}
                      {item.parentCoil && ` · ${item.parentCoil.grade}`}
                    </p>
                  </div>
                  <div className="space-y-3 p-5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Size</span>
                      <span className="font-medium">{item.slitWidthSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Weight</span>
                      <span>{item.slitCoilWeight} MT</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Slitting date</span>
                      <span>{formatDate(item.slittingDate)}</span>
                    </div>
                    {item.dispatchNote && (
                      <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
                        <Truck className="h-4 w-4 text-accent" />
                        <span className="font-mono text-xs">{item.dispatchNote}</span>
                      </div>
                    )}
                    {writeAccess && (
                      <Button
                        className="mt-2 w-full cursor-pointer"
                        onClick={() => openReceiveDialog(item)}
                      >
                        <PackageCheck className="mr-2 h-4 w-4" />
                        Confirm Receipt
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
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <Label className="text-sm text-muted-foreground">Inspection:</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40 cursor-pointer">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                <SelectItem value="PASS">Pass</SelectItem>
                <SelectItem value="CONDITIONAL">Conditional</SelectItem>
                <SelectItem value="FAIL">Fail</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Slit Coil ID</TableHead>
                  <TableHead>Receipt Date</TableHead>
                  <TableHead>Storage Bin</TableHead>
                  <TableHead>Inspection</TableHead>
                  <TableHead>Photos</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      Loading receipts…
                    </TableCell>
                  </TableRow>
                ) : receipts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                      No receipts recorded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  receipts.map((r) => (
                    <TableRow
                      key={r.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => openDetail(r.id)}
                    >
                      <TableCell className="font-mono font-medium">{r.slitCoilId}</TableCell>
                      <TableCell>{formatDate(r.receiptDateSunrack)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-mono">
                          {r.storageLocationBin}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <InspectionBadge result={r.inspectionResult} />
                      </TableCell>
                      <TableCell>{r._count?.photos ?? r.photos?.length ?? 0}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            openDetail(r.id);
                          }}
                        >
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
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Warehouse className="h-5 w-5 text-accent" />
              Confirm Sunrack Receipt
            </DialogTitle>
          </DialogHeader>
          {selectedPending && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-mono font-semibold">{selectedPending.slitCoilId}</p>
              <p className="text-muted-foreground">
                {selectedPending.slitWidthSize} · {selectedPending.slitCoilWeight} MT
              </p>
            </div>
          )}
          <form onSubmit={handleCreate} className="grid gap-4">
            {formError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            <div>
              <Label htmlFor="receiptDate">Receipt Date *</Label>
              <Input
                id="receiptDate"
                type="date"
                value={form.receiptDateSunrack}
                onChange={(e) => setForm({ ...form, receiptDateSunrack: e.target.value })}
                required
              />
            </div>
            <div>
              <Label htmlFor="storageBin">Storage Location / Bin *</Label>
              <Input
                id="storageBin"
                value={form.storageLocationBin}
                onChange={(e) => setForm({ ...form, storageLocationBin: e.target.value })}
                placeholder="e.g. WH-A / Rack-12 / Bin-04"
                required
              />
            </div>
            <div>
              <Label htmlFor="dispatchNote">Confirm Dispatch Note</Label>
              <Input
                id="dispatchNote"
                value={form.confirmedDispatchNote}
                onChange={(e) => setForm({ ...form, confirmedDispatchNote: e.target.value })}
                placeholder="Match slitter dispatch note"
                className="font-mono"
              />
            </div>
            <div>
              <Label>Inspection Result</Label>
              <Select
                value={form.inspectionResult}
                onValueChange={(v) =>
                  setForm({ ...form, inspectionResult: v as InspectionResult })
                }
              >
                <SelectTrigger className="cursor-pointer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PENDING">Pending inspection</SelectItem>
                  <SelectItem value="PASS">Pass — good condition</SelectItem>
                  <SelectItem value="CONDITIONAL">Conditional — minor issues</SelectItem>
                  <SelectItem value="FAIL">Fail — reject / quarantine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="remarks">Inspection Remarks</Label>
              <Textarea
                id="remarks"
                value={form.inspectionRemarks}
                onChange={(e) => setForm({ ...form, inspectionRemarks: e.target.value })}
                placeholder="Coating condition, edge quality, rust spots, handling damage…"
                rows={3}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Saving…" : "Confirm Receipt"}
              </Button>
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
                  <Warehouse className="h-4 w-4 text-accent" />
                  {selected.slitCoilId}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="flex items-center gap-3">
                  <InspectionBadge result={selected.inspectionResult} />
                  <span className="text-sm text-muted-foreground">
                    Received {formatDate(selected.receiptDateSunrack)}
                  </span>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Storage Bin</dt>
                    <dd className="font-mono font-medium">{selected.storageLocationBin}</dd>
                  </div>
                  {selected.confirmedDispatchNote && (
                    <div>
                      <dt className="text-muted-foreground">Dispatch Note</dt>
                      <dd className="font-mono">{selected.confirmedDispatchNote}</dd>
                    </div>
                  )}
                  {selected.slitCoil && (
                    <>
                      <div>
                        <dt className="text-muted-foreground">Parent Coil</dt>
                        <dd className="font-mono">{selected.slitCoil.parentCoilNumber}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Slit Size</dt>
                        <dd>{selected.slitCoil.slitWidthSize}</dd>
                      </div>
                    </>
                  )}
                  {selected.inspectionRemarks && (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Remarks</dt>
                      <dd className="rounded-md bg-muted/50 p-3">{selected.inspectionRemarks}</dd>
                    </div>
                  )}
                </dl>

                <div>
                  <h3 className="mb-3 text-sm font-medium">
                    Inspection Photos ({selected.photos?.length ?? 0})
                  </h3>
                  {selected.photos && selected.photos.length > 0 ? (
                    <div className="grid grid-cols-2 gap-3">
                      {selected.photos.map((photo) => (
                        <div key={photo.id} className="overflow-hidden rounded-lg border">
                          <AuthPhoto
                            photoId={photo.id}
                            token={token}
                            alt={photo.originalName}
                            className="aspect-video w-full"
                          />
                          <p className="truncate px-2 py-1 text-xs text-muted-foreground">
                            {photo.originalName}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No inspection photos yet.</p>
                  )}
                </div>

                {writeAccess && (
                  <MultiPhotoUpload
                    label="Upload inspection photos"
                    onUpload={handlePhotoUpload}
                  />
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
