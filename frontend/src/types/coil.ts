export type CoilStatus = "ACTIVE" | "ARCHIVED";

export interface CoilDocument {
  id: string;
  documentType: "MTC" | "INVOICE" | "OTHER";
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface Coil {
  coilNumber: string;
  grade: string;
  coating: string;
  size: string;
  weight: string;
  supplier: string;
  mtcNumber: string | null;
  invoiceNumber: string | null;
  amnsDispatchDate: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  receiptDateSlitter: string | null;
  receivingConditionRemarks: string | null;
  status?: CoilStatus;
  archivedAt?: string | null;
  documents?: CoilDocument[];
  slittingRecords?: import("./slitting").SlittingRecord[];
  _count?: { documents: number; slittingRecords?: number };
  usage?: CoilUsage;
  createdAt: string;
  updatedAt: string;
}

export interface CoilUsage {
  coilNumber: string;
  status: CoilStatus;
  slittingRecords: number;
  sunrackReceipts: number;
  productionBatches: number;
  dispatches: number;
  siteInstallations: number;
  complaints: number;
  documents: number;
  hasTraceabilityLinks: boolean;
  canEditCriticalFields: boolean;
  canDelete: boolean;
  canArchive: boolean;
}

export interface CoilFormData {
  coilNumber: string;
  grade: string;
  coating: string;
  size: string;
  weight: string;
  supplier: string;
  mtcNumber: string;
  invoiceNumber: string;
  amnsDispatchDate: string;
  vehicleNumber: string;
  transporterName: string;
  receiptDateSlitter: string;
  receivingConditionRemarks: string;
}

export type CoilEditFormData = Omit<CoilFormData, "coilNumber">;
