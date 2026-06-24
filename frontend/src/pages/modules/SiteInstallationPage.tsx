import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Search,
  Eye,
  HardHat,
  Clock,
  CheckCircle2,
  Camera,
  Truck,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { siteInstallationApi, ApiError } from "@/lib/api";
import type {
  SiteInstallation,
  SiteInstallationForm,
  SiteInstallationStats,
  PendingSiteDispatch,
} from "@/types/site-installation";
import { PageHeader } from "@/components/PageHeader";
import { AuthPhoto, MultiPhotoUpload } from "@/components/InspectionPhotoGallery";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const EMPTY_FORM: SiteInstallationForm = {
  dispatchNoteNumber: "",
  siteReceiptDate: new Date().toISOString().slice(0, 10),
  installationDate: new Date().toISOString().slice(0, 10),
  installerEpcPartner: "",
  quantityInstalled: "",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function SitePhoto({ photoId, token, alt }: { photoId: string; token: string; alt: string }) {
  return (
    <AuthPhoto
      photoId={photoId}
      token={token}
      alt={alt}
      className="aspect-video w-full rounded-lg"
      url={siteInstallationApi.photoUrl(photoId)}
    />
  );
}

export function SiteInstallationPage() {
  const { token, user, canWrite } = useAuth();
  const [stats, setStats] = useState<SiteInstallationStats | null>(null);
  const [pending, setPending] = useState<PendingSiteDispatch[]>([]);
  const [installations, setInstallations] = useState<SiteInstallation[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pending" | "history">("pending");
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<SiteInstallationForm>(EMPTY_FORM);
  const [selectedPending, setSelectedPending] = useState<PendingSiteDispatch | null>(null);
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [selected, setSelected] = useState<SiteInstallation | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const writeAccess = canWrite("site-installation");

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, pendingRes, installationsRes] = await Promise.all([
        siteInstallationApi.stats(token),
        siteInstallationApi.pendingDispatches(token),
        siteInstallationApi.list(token, { search: search || undefined }),
      ]);
      setStats(statsRes.stats);
      setPending(pendingRes.pending);
      setInstallations(installationsRes.installations);
    } catch {
      setStats(null);
      setPending([]);
      setInstallations([]);
    } finally {
      setLoading(false);
    }
  }, [token, search]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  function openCreateDialog(dispatch: PendingSiteDispatch) {
    setSelectedPending(dispatch);
    setForm({
      dispatchNoteNumber: dispatch.dispatchNoteNumber,
      siteReceiptDate: new Date().toISOString().slice(0, 10),
      installationDate: new Date().toISOString().slice(0, 10),
      installerEpcPartner: user?.fullName ?? "",
      quantityInstalled: String(dispatch.totalQuantityDispatched),
    });
    setPendingPhotos([]);
    setFormError("");
    setDialogOpen(true);
  }

  async function openDetail(id: string) {
    if (!token) return;
    const res = await siteInstallationApi.get(token, id);
    setSelected(res.installation);
    setDetailOpen(true);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setFormError("");
    setSubmitting(true);
    try {
      const res = await siteInstallationApi.create(token, {
        dispatchNoteNumber: form.dispatchNoteNumber,
        siteReceiptDate: form.siteReceiptDate,
        installationDate: form.installationDate,
        installerEpcPartner: form.installerEpcPartner,
        quantityInstalled: Number(form.quantityInstalled),
      });

      if (pendingPhotos.length > 0) {
        await siteInstallationApi.uploadPhotos(token, res.installation.id, pendingPhotos);
      }

      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setPendingPhotos([]);
      setTab("history");
      await loadAll();
      await openDetail(res.installation.id);
    } catch (err) {
      setFormError(err instanceof ApiError ? String(err.message) : "Failed to save installation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUploadPhotos(files: File[]) {
    if (!token || !selected) return;
    await siteInstallationApi.uploadPhotos(token, selected.id, files);
    const res = await siteInstallationApi.get(token, selected.id);
    setSelected(res.installation);
    await loadAll();
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Site Installation"
        description="Confirm site receipt and installation at EPC/client locations. One record per dispatch note with photo evidence."
      />

      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Pending dispatches", value: stats.pendingDispatches, icon: Clock, color: "bg-amber-600" },
            { label: "Installations recorded", value: stats.totalInstallations, icon: CheckCircle2, color: "bg-emerald-600" },
            { label: "Units installed", value: stats.totalQuantityInstalled, icon: HardHat, color: "bg-[#0369A1]" },
            { label: "Installation photos", value: stats.totalPhotos, icon: Camera, color: "bg-[#0F172A]" },
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
        <div className="flex gap-2">
          <Button
            variant={tab === "pending" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setTab("pending")}
          >
            Pending Dispatches
            {stats && stats.pendingDispatches > 0 && (
              <Badge variant="secondary" className="ml-2">
                {stats.pendingDispatches}
              </Badge>
            )}
          </Button>
          <Button
            variant={tab === "history" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setTab("history")}
          >
            Installation History
          </Button>
        </div>
        {tab === "history" && (
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Dispatch, project, installer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
      </div>

      {tab === "pending" ? (
        <Card className="border-0 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispatch Note</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Project / Client</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Qty Dispatched</TableHead>
                <TableHead className="w-40" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : pending.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-16 text-center">
                    <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-emerald-500/60" />
                    <p className="font-medium">All dispatches confirmed at site</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      New dispatches appear here until site receipt is recorded.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                pending.map((d) => (
                  <TableRow key={d.dispatchNoteNumber}>
                    <TableCell className="font-mono text-sm">{d.dispatchNoteNumber}</TableCell>
                    <TableCell>{formatDate(d.dispatchDate)}</TableCell>
                    <TableCell>
                      <p className="font-medium">{d.projectName}</p>
                      <p className="text-xs text-muted-foreground">{d.clientName}</p>
                    </TableCell>
                    <TableCell className="max-w-[160px] truncate">{d.siteLocation}</TableCell>
                    <TableCell className="tabular-nums">{d.totalQuantityDispatched}</TableCell>
                    <TableCell>
                      {writeAccess && (
                        <Button
                          size="sm"
                          className="cursor-pointer"
                          onClick={() => openCreateDialog(d)}
                        >
                          <Plus className="mr-1 h-3 w-3" />
                          Record Installation
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="border-0 shadow-sm">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dispatch Note</TableHead>
                <TableHead>Installation Date</TableHead>
                <TableHead>Installer / EPC</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Qty Installed</TableHead>
                <TableHead>Photos</TableHead>
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
              ) : installations.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-16 text-center">
                    <HardHat className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                    <p className="font-medium">No installation records yet</p>
                  </TableCell>
                </TableRow>
              ) : (
                installations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">{row.dispatchNoteNumber}</TableCell>
                    <TableCell>{formatDate(row.installationDate)}</TableCell>
                    <TableCell>{row.installerEpcPartner}</TableCell>
                    <TableCell>{row.dispatch.projectName}</TableCell>
                    <TableCell className="tabular-nums">{row.quantityInstalled}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.photoCount}</Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                        onClick={() => openDetail(row.id)}
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HardHat className="h-5 w-5 text-accent" />
              Record Site Installation
            </DialogTitle>
          </DialogHeader>
          {selectedPending && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <p className="font-mono font-medium">{selectedPending.dispatchNoteNumber}</p>
              <p className="text-muted-foreground">
                {selectedPending.projectName} — {selectedPending.siteLocation}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Truck className="h-3 w-3" />
                {selectedPending.totalQuantityDispatched} units dispatched
              </p>
            </div>
          )}
          <form onSubmit={handleCreate} className="grid gap-4">
            {formError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Site Receipt Date</Label>
                <Input
                  type="date"
                  value={form.siteReceiptDate}
                  onChange={(e) => setForm((f) => ({ ...f, siteReceiptDate: e.target.value }))}
                  required
                />
              </div>
              <div>
                <Label>Installation Date</Label>
                <Input
                  type="date"
                  value={form.installationDate}
                  onChange={(e) => setForm((f) => ({ ...f, installationDate: e.target.value }))}
                  required
                />
              </div>
            </div>
            <div>
              <Label>Installer / EPC Partner</Label>
              <Input
                value={form.installerEpcPartner}
                onChange={(e) => setForm((f) => ({ ...f, installerEpcPartner: e.target.value }))}
                placeholder="e.g. Suntrop Solar"
                required
              />
            </div>
            <div>
              <Label>Quantity Installed</Label>
              <Input
                type="number"
                min="0.001"
                step="0.001"
                max={selectedPending?.totalQuantityDispatched}
                value={form.quantityInstalled}
                onChange={(e) => setForm((f) => ({ ...f, quantityInstalled: e.target.value }))}
                required
              />
            </div>
            <div>
              <Label className="mb-2 block">Installation Photos</Label>
              <input
                type="file"
                accept="image/*"
                multiple
                className="block w-full text-sm"
                onChange={(e) => setPendingPhotos(Array.from(e.target.files ?? []))}
              />
              {pendingPhotos.length > 0 && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {pendingPhotos.length} photo(s) selected
                </p>
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
              <Button type="submit" className="cursor-pointer" disabled={submitting}>
                {submitting ? "Saving…" : "Confirm Installation"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 font-mono text-base">
              <HardHat className="h-5 w-5 text-accent" />
              {selected?.dispatchNoteNumber}
            </SheetTitle>
          </SheetHeader>
          {selected && token && (
            <div className="mt-6 space-y-6">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt className="text-muted-foreground">Site Receipt</dt>
                <dd>{formatDate(selected.siteReceiptDate)}</dd>
                <dt className="text-muted-foreground">Installation Date</dt>
                <dd>{formatDate(selected.installationDate)}</dd>
                <dt className="text-muted-foreground">Installer</dt>
                <dd>{selected.installerEpcPartner}</dd>
                <dt className="text-muted-foreground">Qty Installed</dt>
                <dd className="font-semibold tabular-nums">{selected.quantityInstalled}</dd>
                <dt className="text-muted-foreground">Project</dt>
                <dd>{selected.dispatch.projectName}</dd>
                <dt className="text-muted-foreground">Client</dt>
                <dd>{selected.dispatch.clientName}</dd>
                <dt className="text-muted-foreground">Site</dt>
                <dd>{selected.dispatch.siteLocation}</dd>
              </dl>

              {writeAccess && (
                <MultiPhotoUpload
                  label="Add installation photos"
                  onUpload={handleUploadPhotos}
                />
              )}

              {selected.photos.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {selected.photos.map((photo) => (
                    <SitePhoto
                      key={photo.id}
                      photoId={photo.id}
                      token={token}
                      alt={photo.originalName}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
