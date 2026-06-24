export interface SlittingRecord {
  slitCoilId: string;
  parentCoilNumber: string;
  slitWidthSize: string;
  slittingDate: string;
  slitCoilWeight: string;
  slitterLocation: string;
  dispatchNote: string | null;
  vehicleNumber: string | null;
  transporterName: string | null;
  createdAt: string;
  updatedAt: string;
  sunrackReceipt?: {
    id: string;
    receiptDateSunrack: string;
    inspectionResult: import("./sunrack-receipt").InspectionResult;
    storageLocationBin: string;
    _count?: { photos: number };
    photos?: import("./sunrack-receipt").SunrackReceiptPhoto[];
  };
  batchConsumptions?: import("./production").BatchSlitCoilConsumption[];
  parentCoil?: {
    coilNumber: string;
    grade: string;
    coating: string;
    size?: string;
    weight?: string;
    supplier?: string;
  };
}

export interface SlitLineForm {
  slitWidthSize: string;
  slitCoilWeight: string;
}

export interface SlittingBatchForm {
  parentCoilNumber: string;
  slittingDate: string;
  slitterLocation: string;
  dispatchNote: string;
  vehicleNumber: string;
  transporterName: string;
  slitCoils: SlitLineForm[];
}
