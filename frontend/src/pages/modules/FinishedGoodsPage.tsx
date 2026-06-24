import { useCallback, useEffect, useState } from "react";
import { Search, Eye, ClipboardList, Package, Truck, Layers } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { finishedGoodsApi } from "@/lib/api";
import type { FinishedGoodsItem, FinishedGoodsStats } from "@/types/finished-goods";
import { PRODUCT_TYPES } from "@/types/production";
import { PageHeader } from "@/components/PageHeader";
import { QcBadge } from "@/components/QcBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function FinishedGoodsPage() {
  const { token } = useAuth();
  const [inventory, setInventory] = useState<FinishedGoodsItem[]>([]);
  const [stats, setStats] = useState<FinishedGoodsStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [availableOnly, setAvailableOnly] = useState(true);
  const [selected, setSelected] = useState<FinishedGoodsItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, inventoryRes] = await Promise.all([
        finishedGoodsApi.stats(token),
        finishedGoodsApi.list(token, {
          search: search || undefined,
          productType: productFilter || undefined,
          availableOnly,
        }),
      ]);
      setStats(statsRes.stats);
      setInventory(inventoryRes.inventory);
    } catch {
      setStats(null);
      setInventory([]);
    } finally {
      setLoading(false);
    }
  }, [token, search, productFilter, availableOnly]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  async function openDetail(batchNumber: string) {
    if (!token) return;
    const res = await finishedGoodsApi.get(token, batchNumber);
    setSelected(res.item);
    setDetailOpen(true);
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Finished Goods"
        description="QC-passed production batches ready for warehouse inventory and dispatch. Only batches with latest QC result Pass appear here."
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "QC-passed batches", value: stats.qcPassedBatches, icon: Layers, color: "bg-[#0369A1]" },
            { label: "Units available", value: stats.totalUnitsAvailable, icon: Package, color: "bg-emerald-600" },
            { label: "Units dispatched", value: stats.totalUnitsDispatched, icon: Truck, color: "bg-[#0F172A]" },
            { label: "Total produced (pass)", value: stats.totalUnitsProduced, icon: ClipboardList, color: "bg-slate-600" },
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

      {stats && Object.keys(stats.byProductType).length > 0 && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-medium">Inventory by Product Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {Object.entries(stats.byProductType).map(([type, data]) => (
                <button
                  key={type}
                  type="button"
                  className={cn(
                    "cursor-pointer rounded-lg border px-4 py-2 text-left transition-colors hover:border-accent",
                    productFilter === type && "border-accent bg-accent/5"
                  )}
                  onClick={() => setProductFilter(productFilter === type ? "" : type)}
                >
                  <p className="font-medium">{type}</p>
                  <p className="text-xs text-muted-foreground">
                    {data.batches} batch(es) · {data.available} units available
                  </p>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Batch, order, product type…"
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
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={availableOnly}
              onChange={(e) => setAvailableOnly(e.target.checked)}
              className="cursor-pointer"
            />
            Available only
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Batch Number</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Produced</TableHead>
                <TableHead>Dispatched</TableHead>
                <TableHead>Available</TableHead>
                <TableHead>QC</TableHead>
                <TableHead>Slit Coils</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                    Loading inventory…
                  </TableCell>
                </TableRow>
              ) : inventory.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-12 text-center">
                    <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
                    <p className="mt-3 font-medium">No finished goods in inventory</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Batches need QC Pass before they appear here. Check Production and QC Inspection modules.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                inventory.map((item) => (
                  <TableRow
                    key={item.batchNumber}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => openDetail(item.batchNumber)}
                  >
                    <TableCell className="font-mono font-medium">{item.batchNumber}</TableCell>
                    <TableCell>{item.productType}</TableCell>
                    <TableCell>{item.quantityProduced}</TableCell>
                    <TableCell>{item.quantityDispatched}</TableCell>
                    <TableCell>
                      <Badge variant={item.quantityAvailable > 0 ? "default" : "secondary"}>
                        {item.quantityAvailable}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <QcBadge result="PASS" />
                    </TableCell>
                    <TableCell>{item.slitCoilCount}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(item.batchNumber);
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
                  <ClipboardList className="h-4 w-4 text-accent" />
                  {selected.batchNumber}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-6">
                <div className="flex items-center gap-2">
                  <QcBadge result="PASS" />
                  <Badge variant="outline">{selected.productType}</Badge>
                </div>

                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">Production Order</dt>
                    <dd>{selected.productionOrderNumber}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Production Date</dt>
                    <dd>{formatDate(selected.productionDate)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Qty Produced</dt>
                    <dd className="font-semibold">{selected.quantityProduced}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Qty Available</dt>
                    <dd className="font-semibold text-emerald-700">{selected.quantityAvailable}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Qty Dispatched</dt>
                    <dd>{selected.quantityDispatched}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Operator / Shift</dt>
                    <dd>{selected.operatorShift}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">QC Inspector</dt>
                    <dd>
                      {selected.qcInspection.inspectorName} —{" "}
                      {formatDate(selected.qcInspection.inspectionDate)}
                    </dd>
                  </div>
                </dl>

                {selected.slitCoilConsumptions && selected.slitCoilConsumptions.length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-medium">Source Slit Coils</h3>
                    <div className="overflow-hidden rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Slit Coil</TableHead>
                            <TableHead className="text-xs">Parent</TableHead>
                            <TableHead className="text-xs">MT Used</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {selected.slitCoilConsumptions.map((c) => (
                            <TableRow key={c.id}>
                              <TableCell className="font-mono text-xs">{c.slitCoilId}</TableCell>
                              <TableCell className="font-mono text-xs">
                                {c.slitCoil?.parentCoilNumber ?? "—"}
                              </TableCell>
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
