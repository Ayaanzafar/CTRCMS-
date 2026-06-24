import { prisma } from "./prisma.js";

export type TraceabilityReferenceType =
  | "COIL_NUMBER"
  | "SLIT_COIL_ID"
  | "BATCH_NUMBER"
  | "DISPATCH_NOTE"
  | "PROJECT_NAME"
  | "COMPLAINT_ID";

export type TimelineStage =
  | "COIL_MASTER"
  | "SLITTING"
  | "SUNRACK_RECEIPT"
  | "PRODUCTION"
  | "QC"
  | "DISPATCH"
  | "SITE_INSTALLATION"
  | "COMPLAINT"
  | "DOCUMENT";

export interface TimelineAttachment {
  id: string;
  kind: "document" | "photo";
  label: string;
  mimetype: string;
  url: string;
}

export interface TimelineEvent {
  id: string;
  stage: TimelineStage;
  occurredAt: string | null;
  title: string;
  entityType: string;
  entityId: string;
  fields: Record<string, string | number | null>;
  links: {
    coilNumber?: string;
    slitCoilId?: string;
    batchNumber?: string;
    dispatchNoteNumber?: string;
    complaintId?: string;
  };
  attachments: TimelineAttachment[];
}

export interface TraceabilitySearchHit {
  referenceType: TraceabilityReferenceType;
  referenceId: string;
  label: string;
  subtitle: string;
}

export interface TraceabilityTimeline {
  query: string;
  referenceType: TraceabilityReferenceType;
  referenceId: string;
  rootCoilNumbers: string[];
  events: TimelineEvent[];
  summary: {
    slitCoilCount: number;
    batchCount: number;
    dispatchCount: number;
    complaintCount: number;
    documentCount: number;
  };
}

function isoDate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

function dec(value: { toString(): string } | number): number {
  return Number(value);
}

export async function searchTraceabilityReferences(
  query: string,
  limit = 10
): Promise<TraceabilitySearchHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const hits: TraceabilitySearchHit[] = [];
  const seen = new Set<string>();
  const add = (hit: TraceabilitySearchHit) => {
    const key = `${hit.referenceType}:${hit.referenceId}`;
    if (seen.has(key) || hits.length >= limit) return;
    seen.add(key);
    hits.push(hit);
  };

  const [
    complaints,
    dispatches,
    batches,
    slits,
    coils,
    projectsDispatch,
    projectsComplaint,
  ] = await Promise.all([
    prisma.complaint.findMany({
      where: {
        OR: [
          { complaintId: { contains: q, mode: "insensitive" } },
          { projectName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { complaintDate: "desc" },
    }),
    prisma.siteDispatch.findMany({
      where: {
        OR: [
          { dispatchNoteNumber: { contains: q, mode: "insensitive" } },
          { projectName: { contains: q, mode: "insensitive" } },
        ],
      },
      take: limit,
      orderBy: { dispatchDate: "desc" },
    }),
    prisma.productionBatch.findMany({
      where: { batchNumber: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { productionDate: "desc" },
    }),
    prisma.slittingRecord.findMany({
      where: { slitCoilId: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { slittingDate: "desc" },
    }),
    prisma.coil.findMany({
      where: { coilNumber: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { createdAt: "desc" },
    }),
    prisma.siteDispatch.findMany({
      where: { projectName: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { dispatchDate: "desc" },
    }),
    prisma.complaint.findMany({
      where: { projectName: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { complaintDate: "desc" },
    }),
  ]);

  for (const c of complaints) {
    add({
      referenceType: "COMPLAINT_ID",
      referenceId: c.complaintId,
      label: c.complaintId,
      subtitle: `${c.projectName} · ${c.resolutionStatus}`,
    });
  }

  for (const d of dispatches) {
    add({
      referenceType: "DISPATCH_NOTE",
      referenceId: d.dispatchNoteNumber,
      label: d.dispatchNoteNumber,
      subtitle: `${d.projectName} · ${isoDate(d.dispatchDate)}`,
    });
  }

  for (const b of batches) {
    add({
      referenceType: "BATCH_NUMBER",
      referenceId: b.batchNumber,
      label: b.batchNumber,
      subtitle: `${b.productType} · ${isoDate(b.productionDate)}`,
    });
  }

  for (const s of slits) {
    add({
      referenceType: "SLIT_COIL_ID",
      referenceId: s.slitCoilId,
      label: s.slitCoilId,
      subtitle: `Parent ${s.parentCoilNumber}`,
    });
  }

  for (const c of coils) {
    add({
      referenceType: "COIL_NUMBER",
      referenceId: c.coilNumber,
      label: c.coilNumber,
      subtitle: `${c.grade} · ${c.coating}`,
    });
  }

  for (const d of projectsDispatch) {
    add({
      referenceType: "PROJECT_NAME",
      referenceId: d.projectName,
      label: d.projectName,
      subtitle: `Dispatch ${d.dispatchNoteNumber}`,
    });
  }

  for (const c of projectsComplaint) {
    add({
      referenceType: "PROJECT_NAME",
      referenceId: c.projectName,
      label: c.projectName,
      subtitle: `Complaint ${c.complaintId}`,
    });
  }

  return hits;
}

export async function resolveReference(
  query: string
): Promise<{ referenceType: TraceabilityReferenceType; referenceId: string } | null> {
  const q = query.trim();
  if (!q) return null;

  const hits = await searchTraceabilityReferences(q, 20);
  if (hits.length === 0) return null;

  const exact = hits.find(
    (h) => h.referenceId.toLowerCase() === q.toLowerCase() || h.label.toLowerCase() === q.toLowerCase()
  );
  if (exact) {
    return { referenceType: exact.referenceType, referenceId: exact.referenceId };
  }

  const first = hits[0];
  return { referenceType: first.referenceType, referenceId: first.referenceId };
}

async function rootCoilsFromReference(
  referenceType: TraceabilityReferenceType,
  referenceId: string
): Promise<string[]> {
  const coilSet = new Set<string>();

  if (referenceType === "COIL_NUMBER") {
    const coil = await prisma.coil.findUnique({ where: { coilNumber: referenceId } });
    if (coil) coilSet.add(coil.coilNumber);
    return [...coilSet];
  }

  if (referenceType === "SLIT_COIL_ID") {
    const slit = await prisma.slittingRecord.findUnique({
      where: { slitCoilId: referenceId },
      select: { parentCoilNumber: true },
    });
    if (slit) coilSet.add(slit.parentCoilNumber);
    return [...coilSet];
  }

  if (referenceType === "BATCH_NUMBER") {
    const batch = await prisma.productionBatch.findUnique({
      where: { batchNumber: referenceId },
      include: {
        slitCoilConsumptions: { select: { slitCoil: { select: { parentCoilNumber: true } } } },
      },
    });
    for (const line of batch?.slitCoilConsumptions ?? []) {
      coilSet.add(line.slitCoil.parentCoilNumber);
    }
    return [...coilSet];
  }

  if (referenceType === "DISPATCH_NOTE") {
    const dispatch = await prisma.siteDispatch.findUnique({
      where: { dispatchNoteNumber: referenceId },
      include: {
        batchLines: {
          include: {
            batch: {
              include: {
                slitCoilConsumptions: {
                  select: { slitCoil: { select: { parentCoilNumber: true } } },
                },
              },
            },
          },
        },
      },
    });
    for (const line of dispatch?.batchLines ?? []) {
      for (const c of line.batch.slitCoilConsumptions) {
        coilSet.add(c.slitCoil.parentCoilNumber);
      }
    }
    return [...coilSet];
  }

  if (referenceType === "COMPLAINT_ID") {
    const complaint = await prisma.complaint.findUnique({
      where: { complaintId: referenceId },
      include: {
        batchLines: {
          include: {
            batch: {
              include: {
                slitCoilConsumptions: {
                  select: { slitCoil: { select: { parentCoilNumber: true } } },
                },
              },
            },
          },
        },
      },
    });
    for (const line of complaint?.batchLines ?? []) {
      for (const c of line.batch.slitCoilConsumptions) {
        coilSet.add(c.slitCoil.parentCoilNumber);
      }
    }
    return [...coilSet];
  }

  if (referenceType === "PROJECT_NAME") {
    const [dispatches, complaints] = await Promise.all([
      prisma.siteDispatch.findMany({
        where: { projectName: { equals: referenceId, mode: "insensitive" } },
        include: {
          batchLines: {
            include: {
              batch: {
                include: {
                  slitCoilConsumptions: {
                    select: { slitCoil: { select: { parentCoilNumber: true } } },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.complaint.findMany({
        where: { projectName: { equals: referenceId, mode: "insensitive" } },
        include: {
          batchLines: {
            include: {
              batch: {
                include: {
                  slitCoilConsumptions: {
                    select: { slitCoil: { select: { parentCoilNumber: true } } },
                  },
                },
              },
            },
          },
        },
      }),
    ]);

    for (const d of dispatches) {
      for (const line of d.batchLines) {
        for (const c of line.batch.slitCoilConsumptions) {
          coilSet.add(c.slitCoil.parentCoilNumber);
        }
      }
    }
    for (const c of complaints) {
      for (const line of c.batchLines) {
        for (const b of line.batch.slitCoilConsumptions) {
          coilSet.add(b.slitCoil.parentCoilNumber);
        }
      }
    }
    return [...coilSet];
  }

  return [];
}

function sortEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (!a.occurredAt && !b.occurredAt) return a.title.localeCompare(b.title);
    if (!a.occurredAt) return 1;
    if (!b.occurredAt) return -1;
    return a.occurredAt.localeCompare(b.occurredAt);
  });
}

export async function buildTimeline(query: string): Promise<TraceabilityTimeline | null> {
  const resolved = await resolveReference(query);
  if (!resolved) return null;

  const rootCoilNumbers = await rootCoilsFromReference(resolved.referenceType, resolved.referenceId);
  if (rootCoilNumbers.length === 0) return null;

  const coils = await prisma.coil.findMany({
    where: { coilNumber: { in: rootCoilNumbers } },
    include: {
      documents: true,
      slittingRecords: {
        orderBy: { slittingDate: "asc" },
        include: {
          sunrackReceipt: { include: { photos: true } },
          batchConsumptions: {
            include: {
              batch: {
                include: {
                  qcInspections: { orderBy: { inspectionDate: "asc" }, include: { photos: true } },
                  dispatchLines: {
                    include: {
                      dispatch: {
                        include: {
                          siteInstallation: { include: { photos: true } },
                        },
                      },
                    },
                  },
                  complaintLines: {
                    include: {
                      complaint: { include: { photos: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const events: TimelineEvent[] = [];
  const slitCoilIds = new Set<string>();
  const batchNumbers = new Set<string>();
  const dispatchNotes = new Set<string>();
  const complaintIds = new Set<string>();
  let documentCount = 0;

  for (const coil of coils) {
    const coilAttachments: TimelineAttachment[] = coil.documents.map((doc) => ({
      id: doc.id,
      kind: "document" as const,
      label: `${doc.documentType}: ${doc.originalName}`,
      mimetype: doc.mimetype,
      url: `/api/coils/documents/${doc.id}/file`,
    }));
    documentCount += coilAttachments.length;

    events.push({
      id: `coil:${coil.coilNumber}`,
      stage: "COIL_MASTER",
      occurredAt: isoDate(coil.amnsDispatchDate ?? coil.receiptDateSlitter ?? coil.createdAt),
      title: `Coil Master — ${coil.coilNumber}`,
      entityType: "Coil",
      entityId: coil.coilNumber,
      fields: {
        grade: coil.grade,
        coating: coil.coating,
        size: coil.size,
        weight: dec(coil.weight),
        supplier: coil.supplier,
        mtcNumber: coil.mtcNumber,
        status: coil.status,
        invoiceNumber: coil.invoiceNumber,
        amnsDispatchDate: isoDate(coil.amnsDispatchDate),
        vehicleNumber: coil.vehicleNumber,
        transporterName: coil.transporterName,
        receiptDateSlitter: isoDate(coil.receiptDateSlitter),
        receivingConditionRemarks: coil.receivingConditionRemarks,
      },
      links: { coilNumber: coil.coilNumber },
      attachments: coilAttachments,
    });

    for (const doc of coil.documents) {
      events.push({
        id: `doc:${doc.id}`,
        stage: "DOCUMENT",
        occurredAt: isoDate(doc.createdAt),
        title: `Document — ${doc.documentType}`,
        entityType: "CoilDocument",
        entityId: doc.id,
        fields: {
          coilNumber: coil.coilNumber,
          documentType: doc.documentType,
          originalName: doc.originalName,
        },
        links: { coilNumber: coil.coilNumber },
        attachments: [
          {
            id: doc.id,
            kind: "document",
            label: doc.originalName,
            mimetype: doc.mimetype,
            url: `/api/coils/documents/${doc.id}/file`,
          },
        ],
      });
    }

    for (const slit of coil.slittingRecords) {
      slitCoilIds.add(slit.slitCoilId);

      events.push({
        id: `slit:${slit.slitCoilId}`,
        stage: "SLITTING",
        occurredAt: isoDate(slit.slittingDate),
        title: `Slitting — ${slit.slitCoilId}`,
        entityType: "SlittingRecord",
        entityId: slit.slitCoilId,
        fields: {
          parentCoilNumber: slit.parentCoilNumber,
          slitWidthSize: slit.slitWidthSize,
          slitCoilWeight: dec(slit.slitCoilWeight),
          slitterLocation: slit.slitterLocation,
          dispatchNote: slit.dispatchNote,
          vehicleNumber: slit.vehicleNumber,
          transporterName: slit.transporterName,
        },
        links: { coilNumber: coil.coilNumber, slitCoilId: slit.slitCoilId },
        attachments: [],
      });

      if (slit.sunrackReceipt) {
        const receipt = slit.sunrackReceipt;
        const photoAttachments = receipt.photos.map((p) => ({
          id: p.id,
          kind: "photo" as const,
          label: p.originalName,
          mimetype: p.mimetype,
          url: `/api/sunrack-receipts/photos/${p.id}/file`,
        }));
        documentCount += photoAttachments.length;

        events.push({
          id: `receipt:${receipt.id}`,
          stage: "SUNRACK_RECEIPT",
          occurredAt: isoDate(receipt.receiptDateSunrack),
          title: `Sunrack Receipt — ${slit.slitCoilId}`,
          entityType: "SunrackReceipt",
          entityId: receipt.id,
          fields: {
            slitCoilId: slit.slitCoilId,
            storageLocationBin: receipt.storageLocationBin,
            inspectionResult: receipt.inspectionResult,
            inspectionRemarks: receipt.inspectionRemarks,
            confirmedDispatchNote: receipt.confirmedDispatchNote,
          },
          links: { coilNumber: coil.coilNumber, slitCoilId: slit.slitCoilId },
          attachments: photoAttachments,
        });
      }

      for (const consumption of slit.batchConsumptions) {
        const batch = consumption.batch;
        batchNumbers.add(batch.batchNumber);

        events.push({
          id: `batch:${batch.batchNumber}`,
          stage: "PRODUCTION",
          occurredAt: isoDate(batch.productionDate),
          title: `Production — ${batch.batchNumber}`,
          entityType: "ProductionBatch",
          entityId: batch.batchNumber,
          fields: {
            productionOrderNumber: batch.productionOrderNumber,
            productType: batch.productType,
            quantityProduced: dec(batch.quantityProduced),
            operatorShift: batch.operatorShift,
            slitCoilId: slit.slitCoilId,
            quantityConsumed: dec(consumption.quantityConsumed),
          },
          links: {
            coilNumber: coil.coilNumber,
            slitCoilId: slit.slitCoilId,
            batchNumber: batch.batchNumber,
          },
          attachments: [],
        });

        for (const qc of batch.qcInspections) {
          const qcPhotos = qc.photos.map((p) => ({
            id: p.id,
            kind: "photo" as const,
            label: p.originalName,
            mimetype: p.mimetype,
            url: `/api/qc/photos/${p.id}/file`,
          }));
          documentCount += qcPhotos.length;

          events.push({
            id: `qc:${qc.id}`,
            stage: "QC",
            occurredAt: isoDate(qc.inspectionDate),
            title: `QC Inspection — ${batch.batchNumber}`,
            entityType: "QCInspection",
            entityId: qc.id,
            fields: {
              batchNumber: batch.batchNumber,
              qcResult: qc.qcResult,
              inspectorName: qc.inspectorName,
              qcRemarks: qc.qcRemarks,
            },
            links: { batchNumber: batch.batchNumber, slitCoilId: slit.slitCoilId },
            attachments: qcPhotos,
          });
        }

        for (const dispatchLine of batch.dispatchLines) {
          const dispatch = dispatchLine.dispatch;
          dispatchNotes.add(dispatch.dispatchNoteNumber);

          events.push({
            id: `dispatch:${dispatch.dispatchNoteNumber}:${batch.batchNumber}`,
            stage: "DISPATCH",
            occurredAt: isoDate(dispatch.dispatchDate),
            title: `Dispatch — ${dispatch.dispatchNoteNumber}`,
            entityType: "SiteDispatch",
            entityId: dispatch.dispatchNoteNumber,
            fields: {
              batchNumber: batch.batchNumber,
              quantityDispatched: dec(dispatchLine.quantityDispatched),
              projectName: dispatch.projectName,
              clientName: dispatch.clientName,
              siteLocation: dispatch.siteLocation,
              vehicleNumber: dispatch.vehicleNumber,
              transporterName: dispatch.transporterName,
            },
            links: {
              batchNumber: batch.batchNumber,
              dispatchNoteNumber: dispatch.dispatchNoteNumber,
            },
            attachments: [],
          });

          if (dispatch.siteInstallation) {
            const install = dispatch.siteInstallation;
            const installPhotos = install.photos.map((p) => ({
              id: p.id,
              kind: "photo" as const,
              label: p.originalName,
              mimetype: p.mimetype,
              url: `/api/site-installation/photos/${p.id}/file`,
            }));
            documentCount += installPhotos.length;

            events.push({
              id: `install:${install.id}`,
              stage: "SITE_INSTALLATION",
              occurredAt: isoDate(install.installationDate),
              title: `Site Installation — ${dispatch.dispatchNoteNumber}`,
              entityType: "SiteInstallation",
              entityId: install.id,
              fields: {
                dispatchNoteNumber: dispatch.dispatchNoteNumber,
                siteReceiptDate: isoDate(install.siteReceiptDate),
                installationDate: isoDate(install.installationDate),
                installerEpcPartner: install.installerEpcPartner,
                quantityInstalled: dec(install.quantityInstalled),
              },
              links: { dispatchNoteNumber: dispatch.dispatchNoteNumber, batchNumber: batch.batchNumber },
              attachments: installPhotos,
            });
          }
        }

        for (const complaintLine of batch.complaintLines) {
          const complaint = complaintLine.complaint;
          complaintIds.add(complaint.complaintId);

          const complaintPhotos = complaint.photos.map((p) => ({
            id: p.id,
            kind: "photo" as const,
            label: p.originalName,
            mimetype: p.mimetype,
            url: `/api/complaints/photos/${p.id}/file`,
          }));
          documentCount += complaintPhotos.length;

          events.push({
            id: `complaint:${complaint.complaintId}`,
            stage: "COMPLAINT",
            occurredAt: isoDate(complaint.complaintDate),
            title: `Complaint — ${complaint.complaintId}`,
            entityType: "Complaint",
            entityId: complaint.complaintId,
            fields: {
              batchNumber: batch.batchNumber,
              projectName: complaint.projectName,
              clientName: complaint.clientName,
              siteLocation: complaint.siteLocation,
              complaintDescription: complaint.complaintDescription,
              rootCauseRemarks: complaint.rootCauseRemarks,
              resolutionStatus: complaint.resolutionStatus,
              resolutionDate: isoDate(complaint.resolutionDate),
              responsibleStage: complaint.responsibleStage,
            },
            links: {
              complaintId: complaint.complaintId,
              batchNumber: batch.batchNumber,
            },
            attachments: complaintPhotos,
          });
        }
      }
    }
  }

  return {
    query: query.trim(),
    referenceType: resolved.referenceType,
    referenceId: resolved.referenceId,
    rootCoilNumbers,
    events: sortEvents(events),
    summary: {
      slitCoilCount: slitCoilIds.size,
      batchCount: batchNumbers.size,
      dispatchCount: dispatchNotes.size,
      complaintCount: complaintIds.size,
      documentCount,
    },
  };
}
