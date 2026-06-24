import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  Factory,
  Layers,
  Package,
  Cog,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { productionApi, ApiError } from "@/lib/api";
import type {
  ProductionBatch,
  ProductionBatchForm,
  AvailableSlitCoil,
} from "@/types/production";
import { PRODUCT_TYPES } from "@/types/production";
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
import { Card, CardContent } from "@/components/ui/card";
import { QcBadge } from "@/components/QcBadge";
import { cn } from "@/lib/utils";

const EMPTY_FORM: ProductionBatchForm = {
  batchNumber: "",
  productionOrderNumber: "",
  productType: "Walkway Tray",
  quantityProduced: "",
  productionDate: new Date().toISOString().slice(0, 10),
  operatorShift: "Shift A",
  slitCoilId: "",
  quantityConsumed: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function ProductionPage() {
  const { token, canWrite } = useAuth();
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [available, setAvailable] = useState<AvailableSlitCoil[]>([]);
  const [stats, setStats] = useState<{ totalBatches: number; slitCoilsWithReceipt: number } | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProductionBatchForm>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<ProductionBatch | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("production");

  const selectedSlit = available.find((a) => a.slitCoilId === form.slitCoilId);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, batchesRes, availableRes] = await Promise.all([
        productionApi.stats(token),
        productionApi.list(token, {
          search: search || undefined,
          productType: productFilter || undefined,
        }),
        productionApi.availableSlitCoils(token),
      ]);
      setStats(statsRes.stats);
      setBatches(batchesRes.batches);
      setAvailable(availableRes.available);
    } catch {
      setStats(null);
      setBatches([]);
      setAvailable([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, productFilter]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  useEffect(() => {
    if (!token || !dialogOpen) return;
    productionApi.previewBatchNumber(token).then((res) => {
      setForm((f) => ({ ...f, batchNumber: res.batchNumber }));
    });
  }, [token, dialogOpen]);

  async function openDetail(batchNumber: string) {
    if (!token) return;
    const res = await productionApi.get(token, batchNumber);
    setSelected(res.batch);
    setDetailOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await productionApi.create(token, {
        batchNumber: form.batchNumber || undefined,
        productionOrderNumber: form.productionOrderNumber,
        productType: form.productType,
        quantityProduced: Number(form.quantityProduced),
        productionDate: form.productionDate,
        operatorShift: form.operatorShift,
        slitCoilConsumptions: [
          {
            slitCoilId: form.slitCoilId,
            quantityConsumed: Number(form.quantityConsumed),
          },
        ],
      });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      await loadAll();
      await openDetail(res.batch.batchNumber);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to create batch");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Production Tracking"
        description="Issue received slit coils to production batches. One slit coil can be split across multiple batches with partial MT consumption."
        actions={
          writeAccess && (
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button className="cursor-pointer">
                  <Plus className="mr-2 h-4 w-4" />
                  New Production Batch
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Factory className="h-5 w-5 text-accent" />
                    Create Production Batch
                  </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="grid gap-4">
                  {formError && (
                    <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {formError}
                    </p>
                  )}
                  <div>
                    <Label>Batch Number</Label>
                    <Input value={form.batchNumber} readOnly className="font-mono bg-muted/50" />
                  </div>
                  <div>
                    <Label htmlFor="po">Production Order *</Label>
                    <Input
                      id="po"
                      value={form.productionOrderNumber}
                      onChange={(e) => setForm({ ...form, productionOrderNumber: e.target.value })}
                      placeholder="PO-2026-0142"
                      required
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label>Product Type *</Label>
                      <Select
                        value={form.productType}
                        onValueChange={(v) => setForm({ ...form, productType: v })}
                      >
                        <SelectTrigger className="cursor-pointer">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRODUCT_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor="qty">Qty Produced *</Label>
                      <Input
                        id="qty"
                        type="number"
                        step="1"
                        min="1"
                        value={form.quantityProduced}
                        onChange={(e) => setForm({ ...form, quantityProduced: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="prodDate">Production Date *</Label>
                      <Input
                        id="prodDate"
                        type="date"
                        value={form.productionDate}
                        onChange={(e) => setForm({ ...form, productionDate: e.target.value })}
                        required
                      />
                    </div>
                    <div>
                      <Label htmlFor="shift">Operator / Shift *</Label>
                      <Input
                        id="shift"
                        value={form.operatorShift}
                        onChange={(e) => setForm({ ...form, operatorShift: e.target.value })}
                        required
                      />
                    </div>
                  </div>
                  <div className="rounded-lg border bg-muted/20 p-4">
                    <p className="mb-3 text-sm font-medium">Issue Slit Coil</p>
                    <div className="grid gap-3">
                      <div>
                        <Label>Slit Coil *</Label>
                        <Select
                          value={form.slitCoilId}
                          onValueChange={(v) => setForm({ ...form, slitCoilId: v, quantityConsumed: "" })}
                          required
                        >
                          <SelectTrigger className="font-mono cursor-pointer">
                            <SelectValue placeholder="Select received slit coil" />
                          </SelectTrigger>
                          <SelectContent>
                            {available.map((s) => (
                              <SelectItem key={s.slitCoilId} value={s.slitCoilId} className="font-mono">
                                {s.slitCoilId} — {s.remainingQuantity.toFixed(3)} MT left
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="consumed">MT Consumed from Slit Coil *</Label>
                        <Input
                          id="consumed"
                          type="number"
                          step="0.001"
                          min="0.001"
                          max={selectedSlit?.remainingQuantity}
                          value={form.quantityConsumed}
                          onChange={(e) => setForm({ ...form, quantityConsumed: e.target.value })}
                          placeholder={selectedSlit ? `Max ${selectedSlit.remainingQuantity.toFixed(3)}` : ""}
                          required
                        />
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting || !form.slitCoilId}>
                      {submitting ? "Creating…" : "Create Batch"}
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
            { label: "Production batches", value: stats.totalBatches, icon: Layers, color: "bg-[#0369A1]" },
            { label: "Slit coils received", value: stats.slitCoilsWithReceipt, icon: Package, color: "bg-[#0F172A]" },
            { label: "Available to issue", value: available.length, icon: Cog, color: "bg-emerald-600" },
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

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Batch, order, slit coil…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={productFilter || "ALL"} onValueChange={(v) => setProductFilter(v === "ALL" ? "" : v)}>
            <SelectTrigger className="w-full sm:w-48 cursor-pointer">
              <SelectValue placeholder="Product type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All products</SelectItem>
              {PRODUCT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch Number</TableHead>
                <TableHead>Prod. Order</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Qty Produced</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Slit Coils</TableHead>
                <TableHead>QC</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    Loading batches…
                  </TableCell>
                </TableRow>
              ) : batches.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    No production batches yet. {writeAccess ? "Create your first batch." : ""}
                  </TableCell>
                </TableRow>
              ) : (
                batches.map((batch) => (
                  <TableRow
                    key={batch.batchNumber}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(batch.batchNumber)}
                  >
                    <TableCell className="font-mono font-medium">{batch.batchNumber}</TableCell>
                    <TableCell>{batch.productionOrderNumber}</TableCell>
                    <TableCell>{batch.productType}</TableCell>
                    <TableCell>{batch.quantityProduced}</TableCell>
                    <TableCell>{formatDate(batch.productionDate)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {batch._count?.slitCoilConsumptions ?? batch.slitCoilConsumptions?.length ?? 0}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {batch.qcInspections?.[0] ? (
                        <QcBadge result={batch.qcInspections[0].qcResult} />
                      ) : (
                        <Badge variant="outline" className="text-amber-700">Pending QC</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(batch.batchNumber);
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
                  <Factory className="h-4 w-4 text-accent" />
                  {selected.batchNumber}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Production Order</dt>
                    <dd className="font-medium">{selected.productionOrderNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Product Type</dt>
                    <dd>{selected.productType}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Qty Produced</dt>
                    <dd className="font-medium">{selected.quantityProduced}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Production Date</dt>
                    <dd>{formatDate(selected.productionDate)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Operator / Shift</dt>
                    <dd>{selected.operatorShift}</dd>
                  </div>
                </dl>

                <div>
                  <h3 className="mb-3 text-sm font-medium">Slit Coils Consumed</h3>
                  {selected.slitCoilConsumptions && selected.slitCoilConsumptions.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Slit Coil ID</TableHead>
                            <TableHead className="text-xs">MT Used</TableHead>
                            <TableHead className="text-xs">Parent</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.slitCoilConsumptions.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-xs">{c.slitCoilId}</TableCell>
                              <TableCell className="text-xs">{c.quantityConsumed} MT</TableCell>
                              <TableCell className="font-mono text-xs">
                                {c.slitCoil?.parentCoilNumber ?? "—"}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No slit coils linked.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
