import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  Search,
  Link2,
  Download,
  FileText,
  Camera,
  Loader2,
  AlertCircle,
  Package,
  Factory,
  Truck,
  MapPin,
  AlertTriangle,
  Paperclip,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { traceabilityApi, ApiError } from "@/lib/api";
import type {
  TraceabilitySearchHit,
  TraceabilityTimeline,
  TimelineEvent,
  TimelineStage,
} from "@/types/traceability";
import {
  STAGE_LABELS,
  REFERENCE_TYPE_LABELS,
  STAGE_COLORS,
} from "@/types/traceability";
import { PageHeader } from "@/components/PageHeader";
import { AuthPhoto } from "@/components/InspectionPhotoGallery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DEMO_SEARCHES = [
  "DEMO-COIL-001",
  "COMP-DEMO-2026-0001",
  "DN-DEMO-2026-0001",
  "BATCH-DEMO-2026-003",
  "Solar Park Demo Alpha",
];

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatFieldKey(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function stageIcon(stage: TimelineStage) {
  if (stage === "COIL_MASTER") return Package;
  if (stage === "SLITTING" || stage === "PRODUCTION") return Factory;
  if (stage === "DISPATCH") return Truck;
  if (stage === "SITE_INSTALLATION") return MapPin;
  if (stage === "COMPLAINT") return AlertTriangle;
  return FileText;
}

function TimelineAttachmentView({
  attachment,
  token,
}: {
  attachment: TimelineEvent["attachments"][0];
  token: string;
}) {
  if (attachment.kind === "photo") {
    return (
      <div className="overflow-hidden rounded-lg border">
        <AuthPhoto
          photoId={attachment.id}
          token={token}
          alt={attachment.label}
          className="aspect-video w-full max-w-xs"
          url={attachment.url}
        />
        <p className="truncate px-2 py-1 text-xs text-muted-foreground">{attachment.label}</p>
      </div>
    );
  }

  return (
    <a
      href={attachment.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted/50"
      onClick={(e) => {
        e.preventDefault();
        fetch(attachment.url, { headers: { Authorization: `Bearer ${token}` } })
          .then((r) => r.blob())
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            window.open(url, "_blank");
          });
      }}
    >
      <FileText className="h-4 w-4 text-accent" />
      <span className="truncate">{attachment.label}</span>
    </a>
  );
}

function TimelineEventCard({ event, token }: { event: TimelineEvent; token: string }) {
  const Icon = stageIcon(event.stage);
  const fields = Object.entries(event.fields).filter(
    ([, v]) => v !== null && v !== undefined && v !== ""
  );

  return (
    <div className="relative pl-10">
      <div
        className={cn(
          "absolute left-0 top-1 flex h-8 w-8 items-center justify-center rounded-full",
          STAGE_COLORS[event.stage]
        )}
      >
        <Icon className="h-4 w-4" />
      </div>

      <Card className="border shadow-sm">
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold">{event.title}</h3>
              <p className="text-sm text-muted-foreground">
                {STAGE_LABELS[event.stage]} · {formatDate(event.occurredAt)}
              </p>
            </div>
            <Badge variant="outline" className="font-mono text-xs">
              {event.entityId}
            </Badge>
          </div>

          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {fields.map(([key, value]) => (
              <div key={key} className="text-sm">
                <dt className="text-xs font-medium uppercase text-muted-foreground">
                  {formatFieldKey(key)}
                </dt>
                <dd className="break-words">{String(value)}</dd>
              </div>
            ))}
          </dl>

          {event.attachments.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium uppercase text-muted-foreground">
                <Camera className="h-3.5 w-3.5" />
                Attachments ({event.attachments.length})
              </p>
              <div className="flex flex-wrap gap-3">
                {event.attachments.map((a) => (
                  <TimelineAttachmentView key={a.id} attachment={a} token={token} />
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function TraceabilityPage() {
  const { token } = useAuth();
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [suggestions, setSuggestions] = useState<TraceabilitySearchHit[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [timeline, setTimeline] = useState<TraceabilityTimeline | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  const loadTimeline = useCallback(
    async (q: string) => {
      if (!token || !q.trim()) return;
      setLoading(true);
      setError("");
      setActiveQuery(q.trim());
      try {
        const res = await traceabilityApi.timeline(token, q.trim());
        setTimeline(res.timeline);
        setShowSuggestions(false);
      } catch (err) {
        setTimeline(null);
        setError(err instanceof ApiError ? err.message : "Search failed");
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    if (!token || query.trim().length < 2) {
      setSuggestions([]);
      return;
    }

    const t = setTimeout(() => {
      traceabilityApi
        .search(token, query.trim())
        .then((res) => setSuggestions(res.hits))
        .catch(() => setSuggestions([]));
    }, 300);

    return () => clearTimeout(t);
  }, [token, query]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    const q = searchParams.get("q")?.trim();
    if (q && token) {
      setQuery(q);
      void loadTimeline(q);
    }
  }, [searchParams, token, loadTimeline]);

  async function handleExportPdf() {
    if (!token || !activeQuery) return;
    setExporting(true);
    try {
      const blob = await traceabilityApi.exportPdf(token, activeQuery);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `traceability-${activeQuery.replace(/[^a-zA-Z0-9-_]/g, "_")}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Traceability Report"
        description="Search by coil number, slit coil ID, batch, dispatch note, project name, or complaint ID — view the full chronological chain and export a PDF."
        actions={
          timeline && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="cursor-pointer" asChild>
                <Link to={`/documents?q=${encodeURIComponent(activeQuery)}`}>
                  <Paperclip className="mr-2 h-4 w-4" />
                  All Documents ({timeline.summary.documentCount})
                </Link>
              </Button>
              <Button
                variant="outline"
                className="cursor-pointer"
                disabled={exporting}
                onClick={handleExportPdf}
              >
                {exporting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Export PDF
              </Button>
            </div>
          )
        }
      />

      <Card className="mb-8 border-0 shadow-sm">
        <CardContent className="p-5">
          <div ref={searchRef} className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 pl-10 text-base"
              placeholder="Search coil, slit, batch, dispatch note, project, complaint…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadTimeline(query);
              }}
            />

            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full rounded-lg border bg-background shadow-lg">
                {suggestions.map((hit) => (
                  <button
                    key={`${hit.referenceType}:${hit.referenceId}`}
                    type="button"
                    className="flex w-full cursor-pointer flex-col px-4 py-3 text-left hover:bg-muted/50"
                    onClick={() => {
                      setQuery(hit.referenceId);
                      loadTimeline(hit.referenceId);
                    }}
                  >
                    <span className="font-mono text-sm font-medium">{hit.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {REFERENCE_TYPE_LABELS[hit.referenceType]} · {hit.subtitle}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button className="cursor-pointer" onClick={() => loadTimeline(query)} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching…
                </>
              ) : (
                <>
                  <Link2 className="mr-2 h-4 w-4" />
                  Build Timeline
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">Try:</span>
            {DEMO_SEARCHES.map((demo) => (
              <button
                key={demo}
                type="button"
                className="cursor-pointer rounded-full bg-muted px-2.5 py-1 font-mono text-xs hover:bg-muted/80"
                onClick={() => {
                  setQuery(demo);
                  loadTimeline(demo);
                }}
              >
                {demo}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {timeline && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {[
              { label: "Root coil(s)", value: timeline.rootCoilNumbers.join(", ") },
              { label: "Slit coils", value: timeline.summary.slitCoilCount },
              { label: "Batches", value: timeline.summary.batchCount },
              { label: "Dispatches", value: timeline.summary.dispatchCount },
              { label: "Complaints", value: timeline.summary.complaintCount },
            ].map((s) => (
              <Card key={s.label} className="border-0 shadow-sm">
                <CardContent className="p-4">
                  <p className="text-xs font-medium uppercase text-muted-foreground">{s.label}</p>
                  <p className="mt-1 font-mono text-sm font-semibold tabular-nums">{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Badge className="bg-[#0F172A]">
              {REFERENCE_TYPE_LABELS[timeline.referenceType]}
            </Badge>
            <span className="font-mono text-sm">{timeline.referenceId}</span>
            <span className="text-sm text-muted-foreground">
              · {timeline.events.length} timeline events · {timeline.summary.documentCount} attachments
            </span>
            <Link
              to={`/documents?q=${encodeURIComponent(activeQuery)}`}
              className="ml-auto flex cursor-pointer items-center gap-1 text-sm text-accent hover:underline"
            >
              <Paperclip className="h-4 w-4" />
              Open in Documents hub
            </Link>
          </div>

          <div className="relative space-y-6 border-l-2 border-muted pl-6 ml-4">
            {timeline.events.map((event) => (
              <TimelineEventCard key={event.id} event={event} token={token!} />
            ))}
          </div>
        </>
      )}

      {!loading && !timeline && !error && (
        <div className="py-20 text-center text-muted-foreground">
          <Link2 className="mx-auto mb-4 h-12 w-12 opacity-30" />
          <p className="font-medium">Enter a reference ID to build the traceability timeline</p>
          <p className="mt-1 text-sm">
            Coil → Slitting → Receipt → Production → QC → Dispatch → Site → Complaint
          </p>
        </div>
      )}
    </div>
  );
}
