export interface DispatchBatchLine {
  id: string;
  batchNumber: string;
  quantityDispatched: number;
  batch?: {
    batchNumber: string;
    productionOrderNumber: string;
    productType: string;
    quantityProduced: number;
    quantityDispatched: number;
    quantityAvailable: number;
    productionDate: string;
  };
}

export interface SiteDispatch {
  dispatchNoteNumber: string;
  dispatchDate: string;
  vehicleNumber: string | null;
  transporterName: string | null;
  projectName: string;
  clientName: string;
  siteLocation: string;
  batchLines: DispatchBatchLine[];
  batchCount: number;
  totalQuantityDispatched: number;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchStats {
  totalDispatches: number;
  totalUnitsDispatched: number;
  activeProjects: number;
}

export interface DispatchBatchLineForm {
  batchNumber: string;
  quantityDispatched: string;
}

export interface DispatchForm {
  dispatchNoteNumber: string;
  dispatchDate: string;
  vehicleNumber: string;
  transporterName: string;
  projectName: string;
  clientName: string;
  siteLocation: string;
  batchLines: DispatchBatchLineForm[];
}
