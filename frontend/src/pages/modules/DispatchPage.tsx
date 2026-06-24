import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  Truck,
  Package,
  MapPin,
  Layers,
  Trash2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dispatchApi, finishedGoodsApi, ApiError } from "@/lib/api";
import type { SiteDispatch, DispatchForm, DispatchStats } from "@/types/dispatch";
import type { FinishedGoodsItem } from "@/types/finished-goods";
import { PageHeader } from "@/components/PageHeader";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EMPTY_LINE = { batchNumber: "", quantityDispatched: "" };

const EMPTY_FORM: DispatchForm = {
  dispatchNoteNumber: "",
  dispatchDate: new Date().toISOString().slice(0, 10),
  vehicleNumber: "",
  transporterName: "",
  projectName: "",
  clientName: "",
  siteLocation: "",
  batchLines: [{ ...EMPTY_LINE }],
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function DispatchPage() {
  const { token, canWrite } = useAuth();
  const [stats, setStats] = useState<DispatchStats | null>(null);
  const [dispatches, setDispatches] = useState<SiteDispatch[]>([]);
  const [inventory, setInventory] = useState<FinishedGoodsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DispatchForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<SiteDispatch | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("dispatch");

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, dispatchesRes, inventoryRes] = await Promise.all([
        dispatchApi.stats(token),
        dispatchApi.list(token, { search: search || undefined }),
        finishedGoodsApi.list(token, { availableOnly: true }),
      ]);
      setStats(statsRes.stats);
      setDispatches(dispatchesRes.dispatches);
      setInventory(inventoryRes.inventory);
    } catch {
      setStats(null);
      setDispatches([]);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  useEffect(() => {
    if (!token || !dialogOpen) return;
    dispatchApi.previewDispatchNote(token).then((res) => {
      setForm((f) => ({ ...f, dispatchNoteNumber: res.dispatchNoteNumber }));
    });
  }, [token, dialogOpen]);

  async function openDetail(dispatchNoteNumber: string) {
    if (!token) return;
    const res = await dispatchApi.get(token, dispatchNoteNumber);
    setSelected(res.dispatch);
    setDetailOpen(true);
  }

  function getAvailableQty(batchNumber: string) {
    const item = inventory.find((i) => i.batchNumber === batchNumber);
    return item?.quantityAvailable ?? 0;
  }

  function addBatchLine() {
    setForm((f) => ({ ...f, batchLines: [...f.batchLines, { ...EMPTY_LINE }] }));
  }

  function removeBatchLine(index: number) {
    setForm((f) => ({
      ...f,
      batchLines: f.batchLines.filter((_, i) => i !== index),
    }));
  }

  function updateBatchLine(index: number, field: "batchNumber" | "quantityDispatched", value: string) {
    setForm((f) => {
      const lines = [...f.batchLines];
      lines[index] = { ...lines[index], [field]: value };
      if (field === "batchNumber" && value) {
        const avail = getAvailableQty(value);
        if (avail > 0 && !lines[index].quantityDispatched) {
          lines[index].quantityDispatched = String(avail);
        }
      }
      return { ...f, batchLines: lines };
    });
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const batchLines = form.batchLines
        .filter((l) => l.batchNumber && l.quantityDispatched)
        .map((l) => ({
          batchNumber: l.batchNumber,
          quantityDispatched: Number(l.quantityDispatched),
        }));

      if (batchLines.length === 0) {
        setFormError("Add at least one batch with quantity");
        return;
      }

      const res = await dispatchApi.create(token, {
        dispatchNoteNumber: form.dispatchNoteNumber || undefined,
        dispatchDate: form.dispatchDate,
        vehicleNumber: form.vehicleNumber || null,
        transporterName: form.transporterName || null,
        projectName: form.projectName,
        clientName: form.clientName,
        siteLocation: form.siteLocation,
        batchLines,
      });
      setDialogOpen(false);
      setForm({ ...EMPTY_FORM, batchLines: [{ ...EMPTY_LINE }] });
      await loadAll();
      await openDetail(res.dispatch.dispatchNoteNumber);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to create dispatch");
    } finally {
      setSubmitting(false);
    }
  }

  const availableBatches = inventory.filter((i) => i.quantityAvailable > 0);

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Dispatch"
        description="Ship QC-passed finished goods to client project sites. One dispatch note can include multiple batches with partial quantities."
        actions={
          writeAccess && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  New Dispatch Note
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Truck className="h-5 w-5 text-accent" />
                    Create Dispatch Note
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
                      <Label>Dispatch Note Number</Label>
                      <Input
                        value={form.dispatchNoteNumber}
                        readOnly
                        className="bg-muted/50 font-mono"
                      />
                    </div>
                    <div>
                      <Label>Dispatch Date</Label>
                      <Input
                        type="date"
                        value={form.dispatchDate}
                        onChange={(e) => setForm((f) => ({ ...f, dispatchDate: e.target.value }))}
                        required
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Project Name</Label>
                      <Input
                        value={form.projectName}
                        onChange={(e) => setForm((f) => ({ ...f, projectName: e.target.value }))}
                        placeholder="Solar Park Phase 2"
                        required
                      />
                    </div>
                    <div>
                      <Label>Client Name</Label>
                      <Input
                        value={form.clientName}
                        onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                        placeholder="EPC / Client company"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <Label>Site Location</Label>
                    <Input
                      value={form.siteLocation}
                      onChange={(e) => setForm((f) => ({ ...f, siteLocation: e.target.value }))}
                      placeholder="City, State"
                      required
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Vehicle Number</Label>
                      <Input
                        value={form.vehicleNumber}
                        onChange={(e) => setForm((f) => ({ ...f, vehicleNumber: e.target.value }))}
                        placeholder="MH12AB1234"
                      />
                    </div>
                    <div>
                      <Label>Transporter Name</Label>
                      <Input
                        value={form.transporterName}
                        onChange={(e) => setForm((f) => ({ ...f, transporterName: e.target.value }))}
                        placeholder="Logistics partner"
                      />
                    </div>
                  </div>

                  <div className="rounded-lg border p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <Label className="text-base">Batch Lines</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="cursor-pointer"
                        onClick={addBatchLine}
                        disabled={availableBatches.length === 0}
                      >
                        <Plus className="mr-1 h-3 w-3" />
                        Add batch
                      </Button>
                    </div>

                    {availableBatches.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        No QC-passed inventory with available quantity. Create production batches and
                        complete QC first.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {form.batchLines.map((line, index) => (
                          <div key={index} className="grid gap-2 sm:grid-cols-[1fr_120px_40px] sm:items-end">
                            <div>
                              {index === 0 && (
                                <Label className="text-xs text-muted-foreground">Batch</Label>
                              )}
                              <select
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                                value={line.batchNumber}
                                onChange={(e) =>
                                  updateBatchLine(index, "batchNumber", e.target.value)
                                }
                                required={index === 0}
                              >
                                <option value="">Select batch…</option>
                                {availableBatches.map((b) => (
                                  <option key={b.batchNumber} value={b.batchNumber}>
                                    {b.batchNumber} — {b.productType} ({b.quantityAvailable}{" "}
                                    avail.)
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              {index === 0 && (
                                <Label className="text-xs text-muted-foreground">Qty</Label>
                              )}
                              <Input
                                type="number"
                                min="0.001"
                                step="0.001"
                                max={
                                  line.batchNumber
                                    ? getAvailableQty(line.batchNumber)
                                    : undefined
                                }
                                value={line.quantityDispatched}
                                onChange={(e) =>
                                  updateBatchLine(index, "quantityDispatched", e.target.value)
                                }
                                placeholder="Qty"
                                required={!!line.batchNumber}
                              />
                            </div>
                            {form.batchLines.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="cursor-pointer text-destructive"
                                onClick={() => removeBatchLine(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
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
                    <Button
                      type="submit"
                      className="cursor-pointer"
                      disabled={submitting || availableBatches.length === 0}
                    >
                      {submitting ? "Creating…" : "Create Dispatch"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          )
        }
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total dispatches", value: stats.totalDispatches, icon: Truck, color: "bg-[#0F172A]" },
            { label: "Units shipped", value: stats.totalUnitsDispatched, icon: Package, color: "bg-emerald-600" },
            { label: "Active projects", value: stats.activeProjects, icon: MapPin, color: "bg-[#0369A1]" },
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          {availableBatches.length} batch(es) with available inventory for dispatch
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Note, project, client, batch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <Card className="border-0 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dispatch Note</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Project / Client</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Batches</TableHead>
              <TableHead>Qty Shipped</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="py-12 text-center text-muted-foreground">
                  Loading dispatches…
                </TableCell>
              </TableRow>
            ) : dispatches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-16 text-center">
                  <Truck className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium">No dispatch records yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create a dispatch note for QC-passed batches from Finished Goods inventory.
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              dispatches.map((d) => (
                <TableRow key={d.dispatchNoteNumber}>
                  <TableCell className="font-mono text-sm">{d.dispatchNoteNumber}</TableCell>
                  <TableCell>{formatDate(d.dispatchDate)}</TableCell>
                  <TableCell>
                    <p className="font-medium">{d.projectName}</p>
                    <p className="text-xs text-muted-foreground">{d.clientName}</p>
                  </TableCell>
                  <TableCell className="max-w-[160px] truncate">{d.siteLocation}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{d.batchCount}</Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">{d.totalQuantityDispatched}</TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="cursor-pointer"
                      onClick={() => openDetail(d.dispatchNoteNumber)}
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
              <Truck className="h-5 w-5 text-accent" />
              {selected?.dispatchNoteNumber}
            </SheetTitle>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">Dispatch Date</dt>
                <dd>{formatDate(selected.dispatchDate)}</dd>
                <dt className="text-muted-foreground">Project</dt>
                <dd>{selected.projectName}</dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd>{selected.clientName}</dd>
                <dt className="text-muted-foreground">Site</dt>
                <dd>{selected.siteLocation}</dd>
                <dt className="text-muted-foreground">Vehicle</dt>
                <dd>{selected.vehicleNumber || "—"}</dd>
                <dt className="text-muted-foreground">Transporter</dt>
                <dd>{selected.transporterName || "—"}</dd>
                <dt className="text-muted-foreground">Total Shipped</dt>
                <dd className="font-semibold tabular-nums">{selected.totalQuantityDispatched}</dd>
              </dl>

              <div>
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Layers className="h-4 w-4" />
                  Batch Lines
                </h3>
                <div className="space-y-2">
                  {selected.batchLines.map((line) => (
                    <div
                      key={line.id}
                      className="rounded-lg border bg-muted/30 p-3 text-sm"
                    >
                      <p className="font-mono font-medium">{line.batchNumber}</p>
                      {line.batch && (
                        <p className="text-xs text-muted-foreground">{line.batch.productType}</p>
                      )}
                      <p className="mt-1 tabular-nums">
                        Dispatched: <strong>{line.quantityDispatched}</strong>
                        {line.batch && (
                          <span className="text-muted-foreground">
                            {" "}
                            / {line.batch.quantityAvailable} still available
                          </span>
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
