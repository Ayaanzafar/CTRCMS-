export type DocumentCategory =
  | "mtc"
  | "invoices"
  | "inspection-photos"
  | "qc-reports"
  | "installation-photos"
  | "complaint-photos";

export type DocumentKind = "document" | "photo";

export interface DocumentContext {
  coilNumber?: string;
  slitCoilId?: string;
  batchNumber?: string;
  dispatchNoteNumber?: string;
  complaintId?: string;
  documentType?: string;
  projectName?: string;
}

export interface DocumentItem {
  id: string;
  category: DocumentCategory;
  kind: DocumentKind;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
  downloadUrl: string;
  context: DocumentContext;
  sourceModule: string;
  sourcePath: string;
  sourceLabel: string;
}

export interface DocumentStats {
  total: number;
  byCategory: Record<DocumentCategory, number>;
  documents: number;
  photos: number;
}

export const CATEGORY_LABELS: Record<DocumentCategory, string> = {
  mtc: "MTC",
  invoices: "Invoices",
  "inspection-photos": "Inspection Photos",
  "qc-reports": "QC Reports / Photos",
  "installation-photos": "Installation Photos",
  "complaint-photos": "Complaint Photos",
};

export const SOURCE_MODULE_LABELS: Record<string, string> = {
  "coil-master": "Coil Master",
  "sunrack-receipt": "Sunrack Receipt",
  "qc-inspection": "QC Inspection",
  "site-installation": "Site Installation",
  complaint: "Complaint Management",
};
