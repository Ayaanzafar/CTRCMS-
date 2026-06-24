export type InspectionResult = "PENDING" | "PASS" | "CONDITIONAL" | "FAIL";

export interface SunrackReceiptPhoto {
  id: string;
  receiptId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface SunrackReceipt {
  id: string;
  slitCoilId: string;
  receiptDateSunrack: string;
  storageLocationBin: string;
  inspectionResult: InspectionResult;
  inspectionRemarks: string | null;
  confirmedDispatchNote: string | null;
  photos?: SunrackReceiptPhoto[];
  _count?: { photos: number };
  slitCoil?: {
    slitCoilId: string;
    parentCoilNumber: string;
    slitWidthSize: string;
    slitCoilWeight: string;
    slittingDate: string;
    dispatchNote: string | null;
    vehicleNumber: string | null;
    transporterName: string | null;
    parentCoil?: { coilNumber: string; grade: string; coating: string };
  };
  createdAt: string;
  updatedAt: string;
}

export interface SunrackReceiptForm {
  slitCoilId: string;
  receiptDateSunrack: string;
  storageLocationBin: string;
  inspectionResult: InspectionResult;
  inspectionRemarks: string;
  confirmedDispatchNote: string;
}

export interface SunrackReceiptStats {
  totalReceipts: number;
  pendingSlitCoils: number;
  passedInspections: number;
  failedInspections: number;
}

export interface PendingSlitCoil {
  slitCoilId: string;
  parentCoilNumber: string;
  slitWidthSize: string;
  slitCoilWeight: string;
  slittingDate: string;
  dispatchNote: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  parentCoil?: { coilNumber: string; grade: string; coating: string };
}
