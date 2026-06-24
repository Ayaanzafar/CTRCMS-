export type QcResult = "PASS" | "FAIL" | "REWORK";

export interface QcInspectionPhoto {
  id: string;
  inspectionId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface QcInspection {
  id: string;
  batchNumber: string;
  qcResult: QcResult;
  inspectorName: string;
  inspectionDate: string;
  qcRemarks: string | null;
  photos?: QcInspectionPhoto[];
  _count?: { photos: number };
  batch?: {
    batchNumber: string;
    productionOrderNumber: string;
    productType: string;
    quantityProduced: string;
    productionDate: string;
    operatorShift: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface QcInspectionForm {
  batchNumber: string;
  qcResult: QcResult;
  inspectorName: string;
  inspectionDate: string;
  qcRemarks: string;
}

export interface QcStats {
  totalInspections: number;
  passed: number;
  failed: number;
  rework: number;
  batchesPendingQc: number;
}

export interface PendingQcBatch {
  batchNumber: string;
  productionOrderNumber: string;
  productType: string;
  quantityProduced: string;
  productionDate: string;
  latestQc: { qcResult: QcResult; inspectionDate: string; inspectorName: string } | null;
  needsInspection: boolean;
}
