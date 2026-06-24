import { prisma } from "./prisma.js";
import { computeAvailableQuantity, getBatchDispatchedQuantity } from "./finished-goods.js";
import { getLatestQcResult } from "./qc.js";

const ROOT_CAUSE_LABELS: Record<string, string> = {
  AMNS: "Supplied material (AMNS)",
  SLITTER: "Slitter processing",
  SUNRACK_PRODUCTION: "Sunrack production / forming flash",
  TRANSPORT: "Transport / logistics",
  SITE_HANDLING: "Site handling damage",
};

export async function getDashboardOverview() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    totalCoils,
    totalComplaints,
    openComplaints,
    underInvestigation,
    closedComplaints,
    batchesPendingQc,
    totalDispatches,
    recentDispatchCount,
    pendingSiteDispatches,
    totalInstallations,
    unreadNotifications,
    complaintStageGroups,
    undeterminedComplaints,
    recentDispatches,
    pendingQcBatches,
    openComplaintRows,
    productionBatchCount,
  ] = await Promise.all([
    prisma.coil.count(),
    prisma.complaint.count(),
    prisma.complaint.count({ where: { resolutionStatus: "OPEN" } }),
    prisma.complaint.count({ where: { resolutionStatus: "UNDER_INVESTIGATION" } }),
    prisma.complaint.count({ where: { resolutionStatus: "CLOSED" } }),
    prisma.productionBatch.count({ where: { qcInspections: { none: {} } } }),
    prisma.siteDispatch.count(),
    prisma.siteDispatch.count({ where: { dispatchDate: { gte: thirtyDaysAgo } } }),
    prisma.siteDispatch.count({ where: { siteInstallation: null } }),
    prisma.siteInstallation.count(),
    prisma.systemNotification.count({ where: { isRead: false } }),
    prisma.complaint.groupBy({
      by: ["responsibleStage"],
      where: { responsibleStage: { not: null } },
      _count: { _all: true },
    }),
    prisma.complaint.count({ where: { responsibleStage: null } }),
    prisma.siteDispatch.findMany({
      take: 6,
      orderBy: { dispatchDate: "desc" },
      include: {
        batchLines: { select: { batchNumber: true, quantityDispatched: true } },
        siteInstallation: { select: { id: true } },
      },
    }),
    prisma.productionBatch.findMany({
      where: { qcInspections: { none: {} } },
      take: 8,
      orderBy: { productionDate: "desc" },
      select: {
        batchNumber: true,
        productType: true,
        quantityProduced: true,
        productionDate: true,
        productionOrderNumber: true,
      },
    }),
    prisma.complaint.findMany({
      where: { resolutionStatus: { in: ["OPEN", "UNDER_INVESTIGATION"] } },
      take: 8,
      orderBy: { complaintDate: "desc" },
      select: {
        complaintId: true,
        complaintDate: true,
        projectName: true,
        resolutionStatus: true,
        responsibleStage: true,
      },
    }),
    prisma.productionBatch.count(),
  ]);

  const allBatches = await prisma.productionBatch.findMany({
    select: { batchNumber: true, productType: true, quantityProduced: true },
  });

  let fgAvailableUnits = 0;
  let fgBatchCount = 0;

  for (const batch of allBatches) {
    const latest = await getLatestQcResult(batch.batchNumber);
    if (latest?.qcResult !== "PASS") continue;

    fgBatchCount++;
    const dispatched = await getBatchDispatchedQuantity(batch.batchNumber);
    fgAvailableUnits += computeAvailableQuantity(Number(batch.quantityProduced), dispatched);
  }

  const rootCauseBreakdown = complaintStageGroups
    .filter((g) => g.responsibleStage)
    .map((g) => ({
      stage: g.responsibleStage!,
      label: ROOT_CAUSE_LABELS[g.responsibleStage!] ?? g.responsibleStage!,
      count: g._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  if (undeterminedComplaints > 0) {
    rootCauseBreakdown.push({
      stage: "UNDETERMINED",
      label: "Not yet determined",
      count: undeterminedComplaints,
    });
  }

  return {
    kpis: {
      totalCoils,
      productionBatches: productionBatchCount,
      batchesPendingQc,
      fgAvailableUnits: Math.round(fgAvailableUnits * 1000) / 1000,
      fgBatchCount,
      totalDispatches,
      recentDispatches: recentDispatchCount,
      pendingSiteDispatches,
      totalInstallations,
      totalComplaints,
      openComplaints,
      underInvestigation,
      closedComplaints,
      unreadNotifications,
    },
    rootCauseBreakdown,
    recentDispatches: recentDispatches.map((d) => ({
      dispatchNoteNumber: d.dispatchNoteNumber,
      dispatchDate: d.dispatchDate,
      projectName: d.projectName,
      clientName: d.clientName,
      siteLocation: d.siteLocation,
      batchCount: d.batchLines.length,
      totalQuantity: d.batchLines.reduce((s, l) => s + Number(l.quantityDispatched), 0),
      siteInstalled: !!d.siteInstallation,
    })),
    pendingQcBatches: pendingQcBatches.map((b) => ({
      batchNumber: b.batchNumber,
      productionOrderNumber: b.productionOrderNumber,
      productType: b.productType,
      quantityProduced: Number(b.quantityProduced),
      productionDate: b.productionDate,
    })),
    openComplaints: openComplaintRows.map((c) => ({
      complaintId: c.complaintId,
      complaintDate: c.complaintDate,
      projectName: c.projectName,
      resolutionStatus: c.resolutionStatus,
      responsibleStage: c.responsibleStage,
    })),
  };
}

export async function listAuditLogs(params: {
  limit?: number;
  offset?: number;
  entityType?: string;
  action?: string;
}) {
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = params.offset ?? 0;

  const where: {
    entityType?: string;
    action?: string;
  } = {};

  if (params.entityType) where.entityType = params.entityType;
  if (params.action) where.action = params.action;

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { fullName: true, email: true, role: { select: { name: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs: logs.map((log) => ({
      id: log.id,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      oldValues: log.oldValues,
      newValues: log.newValues,
      createdAt: log.createdAt,
      user: log.user,
    })),
    total,
    limit,
    offset,
  };
}

export async function listNotifications(params: { unreadOnly?: boolean; limit?: number }) {
  const limit = Math.min(params.limit ?? 20, 50);

  const notifications = await prisma.systemNotification.findMany({
    where: params.unreadOnly ? { isRead: false } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const unreadCount = await prisma.systemNotification.count({ where: { isRead: false } });

  return { notifications, unreadCount };
}
