export interface DashboardKpis {
  totalCoils: number;
  productionBatches: number;
  batchesPendingQc: number;
  fgAvailableUnits: number;
  fgBatchCount: number;
  totalDispatches: number;
  recentDispatches: number;
  pendingSiteDispatches: number;
  totalInstallations: number;
  totalComplaints: number;
  openComplaints: number;
  underInvestigation: number;
  closedComplaints: number;
  unreadNotifications: number;
}

export interface RootCauseItem {
  stage: string;
  label: string;
  count: number;
}

export interface DashboardDispatchRow {
  dispatchNoteNumber: string;
  dispatchDate: string;
  projectName: string;
  clientName: string;
  siteLocation: string;
  batchCount: number;
  totalQuantity: number;
  siteInstalled: boolean;
}

export interface DashboardPendingQc {
  batchNumber: string;
  productionOrderNumber: string;
  productType: string;
  quantityProduced: number;
  productionDate: string;
}

export interface DashboardOpenComplaint {
  complaintId: string;
  complaintDate: string;
  projectName: string;
  resolutionStatus: string;
  responsibleStage: string | null;
}

export interface DashboardOverview {
  kpis: DashboardKpis;
  rootCauseBreakdown: RootCauseItem[];
  recentDispatches: DashboardDispatchRow[];
  pendingQcBatches: DashboardPendingQc[];
  openComplaints: DashboardOpenComplaint[];
}

export interface SystemNotification {
  id: string;
  type: "COMPLAINT_CREATED" | "QC_FAILED";
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  oldValues: unknown;
  newValues: unknown;
  createdAt: string;
  user: {
    fullName: string;
    email: string;
    role: { name: string };
  };
}

export const NOTIFICATION_TYPE_LABELS: Record<SystemNotification["type"], string> = {
  COMPLAINT_CREATED: "New Complaint",
  QC_FAILED: "QC Failed",
};

export const COMPLAINT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  UNDER_INVESTIGATION: "Under Investigation",
  CLOSED: "Closed",
};
