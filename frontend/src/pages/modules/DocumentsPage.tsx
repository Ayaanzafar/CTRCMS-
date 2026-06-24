import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  FileText,
  Camera,
  ExternalLink,
  Paperclip,
  Info,
  Download,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { documentsApi } from "@/lib/api";
import type { DocumentItem, DocumentStats } from "@/types/documents";
import { CATEGORY_LABELS, SOURCE_MODULE_LABELS } from "@/types/documents";
import { PageHeader } from "@/components/PageHeader";
import { AuthPhoto } from "@/components/InspectionPhotoGallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function contextSummary(ctx: DocumentItem["context"]) {
  return (
    ctx.coilNumber ??
    ctx.batchNumber ??
    ctx.complaintId ??
    ctx.dispatchNoteNumber ??
    ctx.slitCoilId ??
    ctx.projectName ??
    "—"
  );
}

async function openFile(url: string, token: string, mimetype: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  if (mimetype === "application/pdf") {
    window.open(objectUrl, "_blank");
  } else {
    window.open(objectUrl, "_blank");
  }
}

export function DocumentsPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const initialQ = searchParams.get("q") ?? "";

  const [stats, setStats] = useState<DocumentStats | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(initialQ);
  const [category, setCategory] = useState("ALL");
  const [kind, setKind] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<DocumentItem | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [traceFilter, setTraceFilter] = useState(initialQ);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [statsRes, listRes] = await Promise.all([
        documentsApi.stats(token),
        documentsApi.list(token, {
          search: search || undefined,
          category: category !== "ALL" ? category : undefined,
          kind: kind !== "ALL" ? kind : undefined,
          limit: 100,
        }),
      ]);
      setStats(statsRes.stats);
      setDocuments(listRes.documents);
      setTotal(listRes.total);
    } catch {
      setStats(null);
      setDocuments([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [token, search, category, kind]);

  useEffect(() => {
    const t = setTimeout(loadAll, 300);
    return () => clearTimeout(t);
  }, [loadAll]);

  useEffect(() => {
    if (initialQ) {
      setSearch(initialQ);
      setTraceFilter(initialQ);
    }
  }, [initialQ]);

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Documents & Photos"
        description="Central index of MTCs, invoices, QC reports, inspection photos, installation photos, and complaint evidence — uploaded from each workflow module."
      />

      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-900">
        <div className="flex gap-2">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            <strong>Upload in the source module</strong> — attach MTC/invoice in Coil Master, QC photos in QC
            Inspection, rust photos in Complaints, etc. This page is your searchable hub and download center.
          </p>
        </div>
      </div>

      {traceFilter && (
        <div className="mb-4 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm">
          <Paperclip className="h-4 w-4" />
          <span>
            Traceability filter: <span className="font-mono font-medium">{traceFilter}</span>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer ml-auto"
            onClick={() => {
              setTraceFilter("");
              setSearch("");
            }}
          >
            Clear
          </Button>
        </div>
      )}

      {stats && (
        <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          <Card className="border-0 shadow-sm xl:col-span-1">
            <CardContent className="p-4">
              <p className="text-2xl font-semibold tabular-nums">{stats.total}</p>
              <p className="text-xs text-muted-foreground">Total files</p>
              <p className="text-xs text-muted-foreground">
                {stats.documents} docs · {stats.photos} photos
              </p>
            </CardContent>
          </Card>
          {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((key) => (
            <Card
              key={key}
              className="cursor-pointer border-0 shadow-sm transition-shadow hover:shadow-md"
              onClick={() => setCategory(key)}
            >
              <CardContent className="p-4">
                <p className="text-lg font-semibold tabular-nums">{stats.byCategory[key]}</p>
                <p className="text-xs text-muted-foreground">{CATEGORY_LABELS[key]}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search filename, coil, batch, complaint, dispatch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All categories</SelectItem>
            {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((k) => (
              <SelectItem key={k} value={k}>
                {CATEGORY_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="w-full sm:w-36">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All types</SelectItem>
            <SelectItem value="document">Documents</SelectItem>
            <SelectItem value="photo">Photos</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="border-0 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Context</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="w-24" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="py-12 text-center text-muted-foreground">
                  Loading…
                </TableCell>
              </TableRow>
            ) : documents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-16 text-center">
                  <Paperclip className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                  <p className="font-medium">No documents found</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Upload files from Coil Master, QC, Site Installation, or Complaints modules
                  </p>
                </TableCell>
              </TableRow>
            ) : (
              documents.map((doc) => (
                <TableRow key={`${doc.category}-${doc.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {doc.kind === "photo" ? (
                        <Camera className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <FileText className="h-4 w-4 text-accent" />
                      )}
                      <span className="max-w-[200px] truncate text-sm">{doc.originalName}</span>
                    </div>
                    <p className="text-xs text-muted-foreground">{formatSize(doc.size)}</p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary">{CATEGORY_LABELS[doc.category]}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{contextSummary(doc.context)}</TableCell>
                  <TableCell className="text-sm">
                    {SOURCE_MODULE_LABELS[doc.sourceModule] ?? doc.sourceModule}
                  </TableCell>
                  <TableCell>{formatDate(doc.createdAt)}</TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="cursor-pointer"
                        title="Preview"
                        onClick={() => {
                          setSelected(doc);
                          setDetailOpen(true);
                        }}
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="cursor-pointer" asChild>
                        <Link to={doc.sourcePath} title="Go to source module">
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {!loading && total > documents.length && (
        <p className="mt-3 text-center text-xs text-muted-foreground">
          Showing {documents.length} of {total} files
        </p>
      )}

      <Sheet open={detailOpen} onOpenChange={setDetailOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle className="text-base">{selected?.originalName}</SheetTitle>
          </SheetHeader>
          {selected && token && (
            <div className="mt-6 space-y-4">
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{CATEGORY_LABELS[selected.category]}</dd>
                <dt className="text-muted-foreground">Type</dt>
                <dd className="capitalize">{selected.kind}</dd>
                <dt className="text-muted-foreground">Size</dt>
                <dd>{formatSize(selected.size)}</dd>
                <dt className="text-muted-foreground">Uploaded</dt>
                <dd>{formatDate(selected.createdAt)}</dd>
                <dt className="text-muted-foreground">Source</dt>
                <dd>{SOURCE_MODULE_LABELS[selected.sourceModule]}</dd>
              </dl>

              {selected.context.coilNumber && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Coil: </span>
                  <span className="font-mono">{selected.context.coilNumber}</span>
                </p>
              )}
              {selected.context.batchNumber && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Batch: </span>
                  <span className="font-mono">{selected.context.batchNumber}</span>
                </p>
              )}
              {selected.context.complaintId && (
                <p className="text-sm">
                  <span className="text-muted-foreground">Complaint: </span>
                  <span className="font-mono">{selected.context.complaintId}</span>
                </p>
              )}

              {selected.kind === "photo" && (
                <AuthPhoto
                  photoId={selected.id}
                  token={token}
                  alt={selected.originalName}
                  className="aspect-video w-full rounded-lg border"
                  url={selected.downloadUrl}
                />
              )}

              <div className="flex flex-col gap-2">
                <Button
                  className="cursor-pointer w-full"
                  onClick={() => openFile(selected.downloadUrl, token, selected.mimetype)}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Open / Download
                </Button>
                <Button variant="outline" className="cursor-pointer w-full" asChild>
                  <Link to={selected.sourcePath}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Go to {SOURCE_MODULE_LABELS[selected.sourceModule]}
                  </Link>
                </Button>
                <Button variant="outline" className="cursor-pointer w-full" asChild>
                  <Link to={`/traceability?q=${encodeURIComponent(contextSummary(selected.context))}`}>
                    <Search className="mr-2 h-4 w-4" />
                    View traceability
                  </Link>
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
