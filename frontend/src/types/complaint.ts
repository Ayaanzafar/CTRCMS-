export type ResolutionStatus = "OPEN" | "UNDER_INVESTIGATION" | "CLOSED";

export type ResponsibleStage =
  | "AMNS"
  | "SLITTER"
  | "SUNRACK_PRODUCTION"
  | "TRANSPORT"
  | "SITE_HANDLING";

export interface ComplaintPhoto {
  id: string;
  complaintId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface ComplaintBatchLine {
  batchNumber: string;
  productType: string;
  productionOrderNumber: string;
  quantityProduced: number;
}

export interface TraceabilityCoil {
  coilNumber: string;
  grade: string;
  coating: string;
  size: string;
  mtcNumber: string | null;
  invoiceNumber: string | null;
  supplier: string;
  slitCoilIds: string[];
}

export interface ComplaintTraceability {
  linkedCoilNumbers: string[];
  linkedSlitCoilIds: string[];
  coils: TraceabilityCoil[];
  batches: Array<{
    batchNumber: string;
    productType: string;
    productionOrderNumber: string;
    quantityProduced: number;
    latestQcResult: string | null;
    slitCoils: Array<{
      slitCoilId: string;
      parentCoilNumber: string;
      slitWidthSize: string;
      quantityConsumed: number;
    }>;
    dispatches: Array<{
      dispatchNoteNumber: string;
      projectName: string;
      quantityDispatched: number;
      siteInstallation: { installationDate: string; installerEpcPartner: string } | null;
    }>;
  }>;
  missingBatches: string[];
}

export interface EligibleComplaintBatch {
  batchNumber: string;
  productType: string;
  productionOrderNumber: string;
  quantityProduced: number;
  dispatches: Array<{
    dispatchNoteNumber: string;
    projectName: string;
    clientName: string;
    siteLocation: string;
    quantityDispatched: number;
    hasSiteInstallation: boolean;
  }>;
}

export interface Complaint {
  complaintId: string;
  complaintDate: string;
  projectName: string;
  clientName: string;
  siteLocation: string;
  complaintDescription: string;
  rootCauseRemarks: string | null;
  resolutionStatus: ResolutionStatus;
  resolutionDate: string | null;
  responsibleStage: ResponsibleStage | null;
  batchNumbers: string[];
  batchLines: ComplaintBatchLine[];
  linkedCoilNumbers: string[];
  linkedSlitCoilIds: string[];
  traceability: ComplaintTraceability;
  photoCount: number;
  photos: ComplaintPhoto[];
  createdAt: string;
  updatedAt: string;
}

export interface ComplaintStats {
  totalComplaints: number;
  open: number;
  underInvestigation: number;
  closed: number;
  totalPhotos: number;
}

export interface ComplaintForm {
  complaintId: string;
  complaintDate: string;
  projectName: string;
  clientName: string;
  siteLocation: string;
  complaintDescription: string;
  rootCauseRemarks: string;
  responsibleStage: ResponsibleStage | "";
  batchNumbers: string[];
}

export const RESOLUTION_STATUS_LABELS: Record<ResolutionStatus, string> = {
  OPEN: "Open",
  UNDER_INVESTIGATION: "Under Investigation",
  CLOSED: "Closed",
};

export const RESPONSIBLE_STAGE_LABELS: Record<ResponsibleStage, string> = {
  AMNS: "AMNS (Supplier)",
  SLITTER: "Slitter / Processing",
  SUNRACK_PRODUCTION: "Sunrack Production",
  TRANSPORT: "Transport",
  SITE_HANDLING: "Site Handling",
};
