import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  LayoutDashboard,
  AlertTriangle,
  ShieldCheck,
  Truck,
  Package,
  Bell,
  ClipboardList,
  Factory,
  CheckCheck,
  Activity,
  ExternalLink,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { dashboardApi } from "@/lib/api";
import type {
  DashboardOverview,
  SystemNotification,
  AuditLogEntry,
} from "@/types/dashboard";
import {
  NOTIFICATION_TYPE_LABELS,
  COMPLAINT_STATUS_LABELS,
} from "@/types/dashboard";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClass(status: string) {
  if (status === "OPEN") return "bg-amber-100 text-amber-800";
  if (status === "UNDER_INVESTIGATION") return "bg-blue-100 text-blue-800";
  return "bg-emerald-100 text-emerald-800";
}

export function DashboardPage() {
  const { token } = useAuth();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [notifications, setNotifications] = useState<SystemNotification[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [overviewRes, notifRes, auditRes] = await Promise.all([
        dashboardApi.overview(token),
        dashboardApi.notifications(token),
        dashboardApi.auditLogs(token, { limit: 15 }),
      ]);
      setOverview(overviewRes.overview);
      setNotifications(notifRes.notifications);
      setAuditLogs(auditRes.logs);
    } catch {
      setOverview(null);
      setNotifications([]);
      setAuditLogs([]);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function markRead(id: string) {
    if (!token) return;
    await dashboardApi.markNotificationRead(token, id);
    await loadAll();
  }

  async function markAllRead() {
    if (!token) return;
    await dashboardApi.markAllNotificationsRead(token);
    await loadAll();
  }

  const kpis = overview?.kpis;
  const maxRootCause = Math.max(
    ...(overview?.rootCauseBreakdown.map((r) => r.count) ?? [1]),
    1
  );

  return (
    <div className="p-6 lg:p-8">
      <PageHeader
        title="Management Dashboard"
        description="Plant-wide overview — complaints, QC backlog, dispatch activity, root-cause analytics, notifications, and audit trail."
        actions={
          kpis && kpis.unreadNotifications > 0 ? (
            <Button variant="outline" className="cursor-pointer" onClick={markAllRead}>
              <CheckCheck className="mr-2 h-4 w-4" />
              Mark all read ({kpis.unreadNotifications})
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <p className="py-20 text-center text-muted-foreground">Loading dashboard…</p>
      ) : !overview ? (
        <p className="py-20 text-center text-destructive">Failed to load dashboard data.</p>
      ) : (
        <>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: "Open complaints",
                value: kpis!.openComplaints + kpis!.underInvestigation,
                sub: `${kpis!.openComplaints} open · ${kpis!.underInvestigation} investigating`,
                icon: AlertTriangle,
                color: "bg-red-600",
                link: "/complaints",
              },
              {
                label: "Pending QC",
                value: kpis!.batchesPendingQc,
                sub: "Batches awaiting inspection",
                icon: ShieldCheck,
                color: "bg-cyan-600",
                link: "/qc-inspection",
              },
              {
                label: "FG available",
                value: kpis!.fgAvailableUnits,
                sub: `${kpis!.fgBatchCount} QC-passed batches`,
                icon: Package,
                color: "bg-violet-600",
                link: "/finished-goods",
              },
              {
                label: "Recent dispatches",
                value: kpis!.recentDispatches,
                sub: `${kpis!.pendingSiteDispatches} pending site install`,
                icon: Truck,
                color: "bg-blue-600",
                link: "/dispatch",
              },
            ].map((s) => (
              <Link key={s.label} to={s.link} className="cursor-pointer">
                <Card className="border-0 shadow-sm transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className={cn("rounded-xl p-3", s.color)}>
                      <s.icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-2xl font-semibold tabular-nums">{s.value}</p>
                      <p className="text-sm font-medium">{s.label}</p>
                      <p className="text-xs text-muted-foreground">{s.sub}</p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>

          <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total coils", value: kpis!.totalCoils, icon: Factory },
              { label: "Production batches", value: kpis!.productionBatches, icon: ClipboardList },
              { label: "Total dispatches", value: kpis!.totalDispatches, icon: Truck },
              { label: "Site installations", value: kpis!.totalInstallations, icon: LayoutDashboard },
            ].map((s) => (
              <Card key={s.label} className="border-0 shadow-sm">
                <CardContent className="flex items-center gap-3 p-4">
                  <s.icon className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-lg font-semibold tabular-nums">{s.value}</p>
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bell className="h-4 w-4" />
                  Notifications
                  {kpis!.unreadNotifications > 0 && (
                    <Badge className="bg-red-600">{kpis!.unreadNotifications} new</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {notifications.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No notifications yet
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {notifications.slice(0, 8).map((n) => (
                      <li
                        key={n.id}
                        className={cn(
                          "rounded-lg border p-3 text-sm",
                          !n.isRead && "border-blue-200 bg-blue-50/50"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <Badge variant="outline" className="mb-1 text-xs">
                              {NOTIFICATION_TYPE_LABELS[n.type]}
                            </Badge>
                            <p className="font-medium">{n.title}</p>
                            <p className="text-muted-foreground">{n.message}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatDateTime(n.createdAt)}
                            </p>
                          </div>
                          {!n.isRead && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="cursor-pointer shrink-0 text-xs"
                              onClick={() => markRead(n.id)}
                            >
                              Mark read
                            </Button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Complaint root-cause breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                {overview.rootCauseBreakdown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No complaint root-cause data yet
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {overview.rootCauseBreakdown.map((item) => (
                      <li key={item.stage}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span>{item.label}</span>
                          <span className="font-semibold tabular-nums">{item.count}</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[#0F172A]"
                            style={{ width: `${(item.count / maxRootCause) * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Open complaints</CardTitle>
                <Link
                  to="/complaints"
                  className="flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
                >
                  View all <ExternalLink className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.openComplaints.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          No open complaints
                        </TableCell>
                      </TableRow>
                    ) : (
                      overview.openComplaints.map((c) => (
                        <TableRow key={c.complaintId}>
                          <TableCell className="font-mono text-xs">{c.complaintId}</TableCell>
                          <TableCell className="text-sm">{c.projectName}</TableCell>
                          <TableCell>
                            <Badge className={statusBadgeClass(c.resolutionStatus)}>
                              {COMPLAINT_STATUS_LABELS[c.resolutionStatus] ?? c.resolutionStatus}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between pb-3">
                <CardTitle className="text-base">Batches pending QC</CardTitle>
                <Link
                  to="/qc-inspection"
                  className="flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
                >
                  Inspect <ExternalLink className="h-3 w-3" />
                </Link>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.pendingQcBatches.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                          All batches inspected
                        </TableCell>
                      </TableRow>
                    ) : (
                      overview.pendingQcBatches.map((b) => (
                        <TableRow key={b.batchNumber}>
                          <TableCell className="font-mono text-xs">{b.batchNumber}</TableCell>
                          <TableCell className="text-sm">{b.productType}</TableCell>
                          <TableCell>{b.quantityProduced}</TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card className="mb-8 border-0 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base">Recent dispatches</CardTitle>
              <Link
                to="/dispatch"
                className="flex cursor-pointer items-center gap-1 text-xs text-accent hover:underline"
              >
                View all <ExternalLink className="h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dispatch note</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Project</TableHead>
                    <TableHead>Qty</TableHead>
                    <TableHead>Site</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overview.recentDispatches.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No dispatches recorded
                      </TableCell>
                    </TableRow>
                  ) : (
                    overview.recentDispatches.map((d) => (
                      <TableRow key={d.dispatchNoteNumber}>
                        <TableCell className="font-mono text-xs">{d.dispatchNoteNumber}</TableCell>
                        <TableCell>{formatDate(d.dispatchDate)}</TableCell>
                        <TableCell>{d.projectName}</TableCell>
                        <TableCell>{d.totalQuantity}</TableCell>
                        <TableCell>
                          <Badge variant={d.siteInstalled ? "default" : "secondary"}>
                            {d.siteInstalled ? "Installed" : "Pending"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                Audit trail
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                        No audit entries yet
                      </TableCell>
                    </TableRow>
                  ) : (
                    auditLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs">{formatDateTime(log.createdAt)}</TableCell>
                        <TableCell>
                          <p className="text-sm font-medium">{log.user.fullName}</p>
                          <p className="text-xs text-muted-foreground">{log.user.role.name}</p>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{log.action}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {log.entityType ?? "—"}
                          {log.entityId ? ` · ${log.entityId}` : ""}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
