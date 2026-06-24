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

export interface ListDocumentsParams {
  search?: string;
  category?: DocumentCategory | "ALL";
  kind?: DocumentKind | "ALL";
  limit?: number;
  offset?: number;
}

export interface ListDocumentsResult {
  documents: DocumentItem[];
  total: number;
  limit: number;
  offset: number;
}

function isImage(mimetype: string) {
  return mimetype.startsWith("image/");
}

function isPdf(mimetype: string) {
  return mimetype === "application/pdf";
}

function matchesSearch(item: DocumentItem, search: string) {
  const q = search.toLowerCase();
  const haystack = [
    item.originalName,
    item.context.coilNumber,
    item.context.slitCoilId,
    item.context.batchNumber,
    item.context.dispatchNoteNumber,
    item.context.complaintId,
    item.context.projectName,
    item.context.documentType,
    item.sourceLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(q);
}

export async function aggregateAllDocuments(): Promise<DocumentItem[]> {
  const { prisma } = await import("./prisma.js");

  const [
    coilDocs,
    receiptPhotos,
    qcPhotos,
    installPhotos,
    complaintPhotos,
  ] = await Promise.all([
    prisma.coilDocument.findMany({
      include: { coil: { select: { coilNumber: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.sunrackReceiptPhoto.findMany({
      include: {
        receipt: {
          select: {
            slitCoilId: true,
            slitCoil: { select: { parentCoilNumber: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.qCInspectionPhoto.findMany({
      include: {
        inspection: { select: { batchNumber: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.siteInstallationPhoto.findMany({
      include: {
        installation: {
          select: {
            dispatchNoteNumber: true,
            dispatch: { select: { projectName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.complaintPhoto.findMany({
      include: {
        complaint: { select: { complaintId: true, projectName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const items: DocumentItem[] = [];

  for (const doc of coilDocs) {
    const category: DocumentCategory =
      doc.documentType === "INVOICE" ? "invoices" : "mtc";
    items.push({
      id: doc.id,
      category,
      kind: "document",
      originalName: doc.originalName,
      mimetype: doc.mimetype,
      size: doc.size,
      createdAt: doc.createdAt.toISOString(),
      downloadUrl: `/api/coils/documents/${doc.id}/file`,
      context: {
        coilNumber: doc.coilNumber,
        documentType: doc.documentType,
      },
      sourceModule: "coil-master",
      sourcePath: "/coil-master",
      sourceLabel: `Coil ${doc.coilNumber}`,
    });
  }

  for (const photo of receiptPhotos) {
    items.push({
      id: photo.id,
      category: "inspection-photos",
      kind: "photo",
      originalName: photo.originalName,
      mimetype: photo.mimetype,
      size: photo.size,
      createdAt: photo.createdAt.toISOString(),
      downloadUrl: `/api/sunrack-receipts/photos/${photo.id}/file`,
      context: {
        slitCoilId: photo.receipt.slitCoilId,
        coilNumber: photo.receipt.slitCoil.parentCoilNumber,
      },
      sourceModule: "sunrack-receipt",
      sourcePath: "/sunrack-receipt",
      sourceLabel: `Receipt ${photo.receipt.slitCoilId}`,
    });
  }

  for (const photo of qcPhotos) {
    items.push({
      id: photo.id,
      category: "qc-reports",
      kind: isPdf(photo.mimetype) ? "document" : "photo",
      originalName: photo.originalName,
      mimetype: photo.mimetype,
      size: photo.size,
      createdAt: photo.createdAt.toISOString(),
      downloadUrl: `/api/qc/photos/${photo.id}/file`,
      context: {
        batchNumber: photo.inspection.batchNumber,
      },
      sourceModule: "qc-inspection",
      sourcePath: "/qc-inspection",
      sourceLabel: `QC ${photo.inspection.batchNumber}`,
    });
  }

  for (const photo of installPhotos) {
    items.push({
      id: photo.id,
      category: "installation-photos",
      kind: "photo",
      originalName: photo.originalName,
      mimetype: photo.mimetype,
      size: photo.size,
      createdAt: photo.createdAt.toISOString(),
      downloadUrl: `/api/site-installation/photos/${photo.id}/file`,
      context: {
        dispatchNoteNumber: photo.installation.dispatchNoteNumber,
        projectName: photo.installation.dispatch.projectName,
      },
      sourceModule: "site-installation",
      sourcePath: "/site-installation",
      sourceLabel: `Site ${photo.installation.dispatchNoteNumber}`,
    });
  }

  for (const photo of complaintPhotos) {
    items.push({
      id: photo.id,
      category: "complaint-photos",
      kind: "photo",
      originalName: photo.originalName,
      mimetype: photo.mimetype,
      size: photo.size,
      createdAt: photo.createdAt.toISOString(),
      downloadUrl: `/api/complaints/photos/${photo.id}/file`,
      context: {
        complaintId: photo.complaint.complaintId,
        projectName: photo.complaint.projectName,
      },
      sourceModule: "complaint",
      sourcePath: "/complaints",
      sourceLabel: `Complaint ${photo.complaint.complaintId}`,
    });
  }

  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function getDocumentStats(): Promise<DocumentStats> {
  const all = await aggregateAllDocuments();

  const byCategory: Record<DocumentCategory, number> = {
    mtc: 0,
    invoices: 0,
    "inspection-photos": 0,
    "qc-reports": 0,
    "installation-photos": 0,
    "complaint-photos": 0,
  };

  let documents = 0;
  let photos = 0;

  for (const item of all) {
    byCategory[item.category]++;
    if (item.kind === "document") documents++;
    else photos++;
  }

  return {
    total: all.length,
    byCategory,
    documents,
    photos,
  };
}

export async function listDocuments(params: ListDocumentsParams): Promise<ListDocumentsResult> {
  const limit = Math.min(params.limit ?? 50, 100);
  const offset = params.offset ?? 0;

  let items = await aggregateAllDocuments();

  if (params.category && params.category !== "ALL") {
    items = items.filter((i) => i.category === params.category);
  }

  if (params.kind && params.kind !== "ALL") {
    items = items.filter((i) => i.kind === params.kind);
  }

  if (params.search?.trim()) {
    items = items.filter((i) => matchesSearch(i, params.search!.trim()));
  }

  const total = items.length;
  const documents = items.slice(offset, offset + limit);

  return { documents, total, limit, offset };
}

export async function listDocumentsForReference(referenceQuery: string): Promise<DocumentItem[]> {
  const result = await listDocuments({ search: referenceQuery, limit: 100, offset: 0 });
  return result.documents;
}
