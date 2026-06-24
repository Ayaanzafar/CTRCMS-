import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search, Eye, Scissors, Trash2, Warehouse, Factory } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { coilApi, slittingApi, ApiError } from "@/lib/api";
import type { Coil } from "@/types/coil";
import type { SlittingRecord, SlittingBatchForm } from "@/types/slitting";
import { PageHeader } from "@/components/PageHeader";
import { InspectionBadge } from "@/components/InspectionBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogTrigger,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const EMPTY_LINE = { slitWidthSize: "", slitCoilWeight: "" };

const EMPTY_BATCH: SlittingBatchForm = {
  parentCoilNumber: "",
  slittingDate: new Date().toISOString().slice(0, 10),
  slitterLocation: "Shiv Sagar Slitter",
  dispatchNote: "",
  vehicleNumber: "",
  transporterName: "",
  slitCoils: [{ ...EMPTY_LINE }],
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function SlittingPage() {
  const { token, canWrite } = useAuth();
  const [searchParams] = useSearchParams();
  const [records, setRecords] = useState<SlittingRecord[]>([]);
  const [coils, setCoils] = useState<Coil[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [parentFilter, setParentFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SlittingBatchForm>(EMPTY_BATCH);
  const [previewIds, setPreviewIds] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<SlittingRecord | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("slitting");

  const loadRecords = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await slittingApi.list(token, {
        search: search || undefined,
        parentCoil: parentFilter || undefined,
      });
      setRecords(res.records);
    } catch {
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, parentFilter]);

  const loadCoils = useCallback(async () => {
    if (!token) return;
    try {
      const res = await coilApi.list(token);
      setCoils(res.coils);
    } catch {
      setCoils([]);
    }
  }, [token]);

  useEffect(() => {
    const t = setTimeout(loadRecords, 300);
    return () => clearTimeout(t);
  }, [loadRecords]);

  useEffect(() => {
    loadCoils();
  }, [loadCoils]);

  useEffect(() => {
    const parentCoil = searchParams.get("parentCoil")?.trim();
    if (parentCoil) {
      setParentFilter(parentCoil);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!token || !form.parentCoilNumber || form.slitCoils.length === 0) {
      setPreviewIds([]);
      return;
    }
    slittingApi
      .previewIds(token, form.parentCoilNumber, form.slitCoils.length)
      .then((res) => setPreviewIds(res.slitCoilIds))
      .catch(() => setPreviewIds([]));
  }, [token, form.parentCoilNumber, form.slitCoils.length]);

  async function openDetail(slitCoilId: string) {
    if (!token) return;
    const res = await slittingApi.get(token, slitCoilId);
    setSelected(res.record);
    setDetailOpen(true);
  }

  function addSlitLine() {
    setForm((f) => ({ ...f, slitCoils: [...f.slitCoils, { ...EMPTY_LINE }] }));
  }

  function removeSlitLine(index: number) {
    setForm((f) => ({
      ...f,
      slitCoils: f.slitCoils.length > 1 ? f.slitCoils.filter((_, i) => i !== index) : f.slitCoils,
    }));
  }

  function updateSlitLine(index: number, field: keyof typeof EMPTY_LINE, value: string) {
    setForm((f) => ({
      ...f,
      slitCoils: f.slitCoils.map((line, i) => (i === index ? { ...line, [field]: value } : line)),
    }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await slittingApi.createBatch(token, {
        parentCoilNumber: form.parentCoilNumber,
        slittingDate: form.slittingDate,
        slitterLocation: form.slitterLocation,
        dispatchNote: form.dispatchNote || null,
        vehicleNumber: form.vehicleNumber || null,
        transporterName: form.transporterName || null,
        slitCoils: form.slitCoils.map((line) => ({
          slitWidthSize: line.slitWidthSize,
          slitCoilWeight: Number(line.slitCoilWeight),
        })),
      });
      setDialogOpen(false);
      setForm(EMPTY_BATCH);
      await loadRecords();
      if (res.records[0]) await openDetail(res.records[0].slitCoilId);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to create slitting records");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Slitting Tracking"
        description="Record slitting events linking parent coil numbers to slit coil IDs, with yield and dispatch-to-Sunrack details."
        actions={
          writeAccess && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  Record Slitting
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>New Slitting Batch</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="grid gap-4 sm:grid-cols-2">
                  {formError && (
                    <p className="sm:col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {formError}
                    </p>
                  )}
                  <div className="sm:col-span-2">
                    <Label>Parent Coil Number *</Label>
                    <Select
                      value={form.parentCoilNumber}
                      onValueChange={(v) => setForm({ ...form, parentCoilNumber: v })}
                      required
                    >
                      <SelectTrigger className="font-mono">
                        <SelectValue placeholder="Select parent coil" />
                      </SelectTrigger>
                      <SelectContent>
                        {coils.map((c) => (
                          <SelectItem key={c.coilNumber} value={c.coilNumber} className="font-mono">
                            {c.coilNumber} — {c.grade} / {c.coating}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="slittingDate">Slitting Date *</Label>
                    <Input
                      id="slittingDate"
                      type="date"
                      value={form.slittingDate}
                      onChange={(e) => setForm({ ...form, slittingDate: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <Label htmlFor="slitterLocation">Slitter Location</Label>
                    <Input
                      id="slitterLocation"
                      value={form.slitterLocation}
                      onChange={(e) => setForm({ ...form, slitterLocation: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label htmlFor="dispatchNote">Dispatch Note</Label>
                    <Input
                      id="dispatchNote"
                      value={form.dispatchNote}
                      onChange={(e) => setForm({ ...form, dispatchNote: e.target.value })}
                      placeholder="DN-001"
                    />
                  </div>
                  <div>
                    <Label htmlFor="vehicleNumber">Vehicle Number</Label>
                    <Input
                      id="vehicleNumber"
                      value={form.vehicleNumber}
                      onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="transporterName">Transporter</Label>
                    <Input
                      id="transporterName"
                      value={form.transporterName}
                      onChange={(e) => setForm({ ...form, transporterName: e.target.value })}
                    />
                  </div>

                  <div className="sm:col-span-2 space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Slit Coils *</Label>
                      <Button type="button" variant="outline" size="sm" onClick={addSlitLine} className="cursor-pointer">
                        <Plus className="mr-1 h-3 w-3" />
                        Add slit coil
                      </Button>
                    </div>
                    {form.slitCoils.map((line, index) => (
                      <div key={index} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="font-mono text-xs text-muted-foreground">
                            {previewIds[index] ?? `Auto ID #${index + 1}`}
                          </span>
                          {form.slitCoils.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 cursor-pointer"
                              onClick={() => removeSlitLine(index)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <Label>Slit Width / Size *</Label>
                            <Input
                              value={line.slitWidthSize}
                              onChange={(e) => updateSlitLine(index, "slitWidthSize", e.target.value)}
                              placeholder="1040 x 0.5 mm"
                              required
                            />
                          </div>
                          <div>
                            <Label>Slit Coil Weight (MT) *</Label>
                            <Input
                              type="number"
                              step="0.001"
                              value={line.slitCoilWeight}
                              onChange={(e) => updateSlitLine(index, "slitCoilWeight", e.target.value)}
                              required
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="sm:col-span-2 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting || !form.parentCoilNumber}>
                      {submitting ? "Saving…" : `Create ${form.slitCoils.length} slit coil(s)`}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-medium">Search & Filter</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="relative sm:col-span-2">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Slit coil ID, parent coil, dispatch note…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Input
              placeholder="Parent coil filter"
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              className="font-mono"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Slit Coil ID</TableHead>
                <TableHead>Parent Coil</TableHead>
                <TableHead>Width / Size</TableHead>
                <TableHead>Weight (MT)</TableHead>
                <TableHead>Slitting Date</TableHead>
                <TableHead>Dispatch</TableHead>
                <TableHead>Sunrack</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    Loading slitting records…
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    No slitting records found. {writeAccess ? "Record your first slitting batch." : ""}
                  </TableCell>
                </TableRow>
              ) : (
                records.map((record) => (
                  <TableRow
                    key={record.slitCoilId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(record.slitCoilId)}
                  >
                    <TableCell className="font-mono font-medium">{record.slitCoilId}</TableCell>
                    <TableCell className="font-mono text-sm">{record.parentCoilNumber}</TableCell>
                    <TableCell>{record.slitWidthSize}</TableCell>
                    <TableCell>{record.slitCoilWeight}</TableCell>
                    <TableCell>{formatDate(record.slittingDate)}</TableCell>
                    <TableCell>
                      {record.dispatchNote ? (
                        <Badge variant="secondary">{record.dispatchNote}</Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {record.sunrackReceipt ? (
                        <InspectionBadge result={record.sunrackReceipt.inspectionResult} />
                      ) : (
                        <Badge variant="outline" className="text-amber-700">
                          Awaiting
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(record.slitCoilId);
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

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 font-mono">
                  <Scissors className="h-4 w-4 text-accent" />
                  {selected.slitCoilId}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Parent Coil</dt>
                    <dd className="font-mono font-medium">{selected.parentCoilNumber}</dd>
                  </div>
                  {selected.parentCoil && (
                    <>
                      <div>
                        <dt className="text-muted-foreground">Grade</dt>
                        <dd>{selected.parentCoil.grade}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Coating</dt>
                        <dd>{selected.parentCoil.coating}</dd>
                      </div>
                    </>
                  )}
                  <div>
                    <dt className="text-muted-foreground">Slit Width / Size</dt>
                    <dd className="font-medium">{selected.slitWidthSize}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Slit Weight</dt>
                    <dd className="font-medium">{selected.slitCoilWeight} MT</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Slitting Date</dt>
                    <dd>{formatDate(selected.slittingDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Slitter Location</dt>
                    <dd>{selected.slitterLocation}</dd>
                  </div>
                  {selected.dispatchNote && (
                    <div>
                      <dt className="text-muted-foreground">Dispatch Note</dt>
                      <dd>{selected.dispatchNote}</dd>
                    </div>
                  )}
                  {selected.vehicleNumber && (
                    <div>
                      <dt className="text-muted-foreground">Vehicle</dt>
                      <dd>{selected.vehicleNumber}</dd>
                    </div>
                  )}
                  {selected.transporterName && (
                    <div className="col-span-2">
                      <dt className="text-muted-foreground">Transporter</dt>
                      <dd>{selected.transporterName}</dd>
                    </div>
                  )}
                </dl>

                {selected.sunrackReceipt ? (
                  <div className="rounded-xl border bg-gradient-to-br from-emerald-50/80 to-transparent p-4 dark:from-emerald-950/30">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <Warehouse className="h-4 w-4 text-accent" />
                      Sunrack Receipt
                    </h3>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-muted-foreground">Receipt Date</dt>
                        <dd>{formatDate(selected.sunrackReceipt.receiptDateSunrack)}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Storage Bin</dt>
                        <dd className="font-mono">{selected.sunrackReceipt.storageLocationBin}</dd>
                      </div>
                      <div className="col-span-2">
                        <dt className="mb-1 text-muted-foreground">Inspection</dt>
                        <dd>
                          <InspectionBadge result={selected.sunrackReceipt.inspectionResult} />
                        </dd>
                      </div>
                      {(selected.sunrackReceipt._count?.photos ?? selected.sunrackReceipt.photos?.length ?? 0) > 0 && (
                        <div className="col-span-2">
                          <dt className="text-muted-foreground">Inspection Photos</dt>
                          <dd>
                            {selected.sunrackReceipt._count?.photos ?? selected.sunrackReceipt.photos?.length} uploaded
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-amber-300/60 bg-amber-50/50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
                    Awaiting Sunrack warehouse receipt — check Sunrack Receipt module.
                  </div>
                )}

                {selected.batchConsumptions && selected.batchConsumptions.length > 0 && (
                  <div className="rounded-xl border bg-gradient-to-br from-blue-50/80 to-transparent p-4 dark:from-blue-950/30">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
                      <Factory className="h-4 w-4 text-accent" />
                      Production Consumption ({selected.batchConsumptions.length} batch
                      {selected.batchConsumptions.length > 1 ? "es" : ""})
                    </h3>
                    <div className="overflow-hidden rounded-md border bg-background">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Batch</TableHead>
                            <TableHead className="text-xs">Product</TableHead>
                            <TableHead className="text-xs">MT Used</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.batchConsumptions.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-xs">
                                {c.batch?.batchNumber ?? c.batchNumber}
                              </TableCell>
                              <TableCell className="text-xs">{c.batch?.productType ?? "—"}</TableCell>
                              <TableCell className="text-xs">{c.quantityConsumed} MT</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
