export type TraceabilityReferenceType =
  | "COIL_NUMBER"
  | "SLIT_COIL_ID"
  | "BATCH_NUMBER"
  | "DISPATCH_NOTE"
  | "PROJECT_NAME"
  | "COMPLAINT_ID";

export type TimelineStage =
  | "COIL_MASTER"
  | "SLITTING"
  | "SUNRACK_RECEIPT"
  | "PRODUCTION"
  | "QC"
  | "DISPATCH"
  | "SITE_INSTALLATION"
  | "COMPLAINT"
  | "DOCUMENT";

export interface TimelineAttachment {
  id: string;
  kind: "document" | "photo";
  label: string;
  mimetype: string;
  url: string;
}

export interface TimelineEvent {
  id: string;
  stage: TimelineStage;
  occurredAt: string | null;
  title: string;
  entityType: string;
  entityId: string;
  fields: Record<string, string | number | null>;
  links: {
    coilNumber?: string;
    slitCoilId?: string;
    batchNumber?: string;
    dispatchNoteNumber?: string;
    complaintId?: string;
  };
  attachments: TimelineAttachment[];
}

export interface TraceabilitySearchHit {
  referenceType: TraceabilityReferenceType;
  referenceId: string;
  label: string;
  subtitle: string;
}

export interface TraceabilityTimeline {
  query: string;
  referenceType: TraceabilityReferenceType;
  referenceId: string;
  rootCoilNumbers: string[];
  events: TimelineEvent[];
  summary: {
    slitCoilCount: number;
    batchCount: number;
    dispatchCount: number;
    complaintCount: number;
    documentCount: number;
  };
}

export const STAGE_LABELS: Record<TimelineStage, string> = {
  COIL_MASTER: "Coil Master",
  SLITTING: "Slitting",
  SUNRACK_RECEIPT: "Sunrack Receipt",
  PRODUCTION: "Production",
  QC: "QC Inspection",
  DISPATCH: "Dispatch",
  SITE_INSTALLATION: "Site Installation",
  COMPLAINT: "Complaint",
  DOCUMENT: "Document",
};

export const REFERENCE_TYPE_LABELS: Record<TraceabilityReferenceType, string> = {
  COIL_NUMBER: "Coil Number",
  SLIT_COIL_ID: "Slit Coil ID",
  BATCH_NUMBER: "Batch Number",
  DISPATCH_NOTE: "Dispatch Note",
  PROJECT_NAME: "Project Name",
  COMPLAINT_ID: "Complaint ID",
};

export const STAGE_COLORS: Record<TimelineStage, string> = {
  COIL_MASTER: "bg-[#0F172A] text-white",
  SLITTING: "bg-slate-600 text-white",
  SUNRACK_RECEIPT: "bg-indigo-600 text-white",
  PRODUCTION: "bg-violet-600 text-white",
  QC: "bg-cyan-600 text-white",
  DISPATCH: "bg-blue-600 text-white",
  SITE_INSTALLATION: "bg-teal-600 text-white",
  COMPLAINT: "bg-red-600 text-white",
  DOCUMENT: "bg-amber-600 text-white",
};
