export interface BatchSlitCoilConsumption {
  id: string;
  batchNumber: string;
  slitCoilId: string;
  quantityConsumed: string;
  createdAt: string;
  slitCoil?: {
    slitCoilId: string;
    parentCoilNumber: string;
    slitWidthSize: string;
    slitCoilWeight: string;
  };
  batch?: {
    batchNumber: string;
    productType: string;
    quantityProduced: string;
    productionDate: string;
    productionOrderNumber: string;
  };
}

export interface ProductionBatch {
  batchNumber: string;
  productionOrderNumber: string;
  productType: string;
  quantityProduced: string;
  productionDate: string;
  operatorShift: string;
  slitCoilConsumptions?: BatchSlitCoilConsumption[];
  qcInspections?: Array<{
    id: string;
    qcResult: import("./qc").QcResult;
    inspectionDate: string;
    inspectorName: string;
    photos?: import("./qc").QcInspectionPhoto[];
  }>;
  _count?: { slitCoilConsumptions: number };
  createdAt: string;
  updatedAt: string;
}

export interface ProductionBatchForm {
  batchNumber: string;
  productionOrderNumber: string;
  productType: string;
  quantityProduced: string;
  productionDate: string;
  operatorShift: string;
  slitCoilId: string;
  quantityConsumed: string;
}

export interface AvailableSlitCoil {
  slitCoilId: string;
  parentCoilNumber: string;
  slitWidthSize: string;
  slitCoilWeight: string;
  remainingQuantity: number;
  parentCoil?: { coilNumber: string; grade: string; coating: string };
  sunrackReceipt?: { storageLocationBin: string; inspectionResult: string };
}

export const PRODUCT_TYPES = [
  "Walkway Tray",
  "Support Frame",
  "Purlin",
  "Module Mounting Structure",
  "Other",
] as const;
