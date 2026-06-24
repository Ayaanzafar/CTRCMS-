export interface FinishedGoodsItem {
  batchNumber: string;
  productionOrderNumber: string;
  productType: string;
  quantityProduced: number;
  quantityDispatched: number;
  quantityAvailable: number;
  productionDate: string;
  operatorShift: string;
  qcInspection: {
    id: string;
    qcResult: string;
    inspectionDate: string;
    inspectorName: string;
  };
  slitCoilCount: number;
  slitCoilConsumptions?: Array<{
    id: string;
    slitCoilId: string;
    quantityConsumed: string;
    slitCoil?: { slitCoilId: string; parentCoilNumber: string; slitWidthSize: string };
  }>;
}

export interface FinishedGoodsStats {
  qcPassedBatches: number;
  totalUnitsProduced: number;
  totalUnitsDispatched: number;
  totalUnitsAvailable: number;
  byProductType: Record<string, { batches: number; available: number }>;
}
