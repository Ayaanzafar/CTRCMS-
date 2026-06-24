export interface SiteInstallationPhoto {
  id: string;
  installationId: string;
  filename: string;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
}

export interface PendingSiteDispatch {
  dispatchNoteNumber: string;
  dispatchDate: string;
  projectName: string;
  clientName: string;
  siteLocation: string;
  vehicleNumber: string | null;
  transporterName: string | null;
  totalQuantityDispatched: number;
  batchLines: Array<{
    batchNumber: string;
    quantityDispatched: number;
    productType: string;
  }>;
}

export interface SiteInstallation {
  id: string;
  dispatchNoteNumber: string;
  siteReceiptDate: string;
  installationDate: string;
  installerEpcPartner: string;
  quantityInstalled: number;
  totalDispatched: number;
  photoCount: number;
  photos: SiteInstallationPhoto[];
  dispatch: {
    dispatchNoteNumber: string;
    dispatchDate: string;
    projectName: string;
    clientName: string;
    siteLocation: string;
    vehicleNumber: string | null;
    transporterName: string | null;
    totalQuantityDispatched: number;
    batchLines: Array<{
      batchNumber: string;
      quantityDispatched: number;
      productType: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
}

export interface SiteInstallationStats {
  totalInstallations: number;
  pendingDispatches: number;
  totalQuantityInstalled: number;
  totalPhotos: number;
}

export interface SiteInstallationForm {
  dispatchNoteNumber: string;
  siteReceiptDate: string;
  installationDate: string;
  installerEpcPartner: string;
  quantityInstalled: string;
}
