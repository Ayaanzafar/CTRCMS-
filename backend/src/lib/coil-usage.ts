import type { CoilStatus } from "@prisma/client";
import { prisma } from "./prisma.js";

export const CRITICAL_COIL_FIELDS = [
  "grade",
  "coating",
  "size",
  "weight",
  "mtcNumber",
] as const;

export interface CoilUsageInfo {
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

export async function getCoilUsage(coilNumber: string): Promise<CoilUsageInfo | null> {
  const coil = await prisma.coil.findUnique({
    where: { coilNumber },
    include: {
      _count: { select: { slittingRecords: true, documents: true } },
      slittingRecords: {
        select: {
          sunrackReceipt: { select: { id: true } },
          batchConsumptions: {
            select: {
              batchNumber: true,
              batch: {
                select: {
                  dispatchLines: {
                    select: {
                      dispatchNoteNumber: true,
                      dispatch: {
                        select: { siteInstallation: { select: { id: true } } },
                      },
                    },
                  },
                  complaintLines: { select: { complaintId: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!coil) return null;

  let sunrackReceipts = 0;
  const batchSet = new Set<string>();
  const dispatchSet = new Set<string>();
  const installationSet = new Set<string>();
  const complaintSet = new Set<string>();

  for (const slit of coil.slittingRecords) {
    if (slit.sunrackReceipt) sunrackReceipts++;

    for (const consumption of slit.batchConsumptions) {
      batchSet.add(consumption.batchNumber);

      for (const line of consumption.batch.dispatchLines) {
        dispatchSet.add(line.dispatchNoteNumber);
        if (line.dispatch.siteInstallation) {
          installationSet.add(line.dispatch.siteInstallation.id);
        }
      }

      for (const complaintLine of consumption.batch.complaintLines) {
        complaintSet.add(complaintLine.complaintId);
      }
    }
  }

  const slittingRecords = coil._count.slittingRecords;
  const hasTraceabilityLinks = slittingRecords > 0;

  return {
    coilNumber: coil.coilNumber,
    status: coil.status,
    slittingRecords,
    sunrackReceipts,
    productionBatches: batchSet.size,
    dispatches: dispatchSet.size,
    siteInstallations: installationSet.size,
    complaints: complaintSet.size,
    documents: coil._count.documents,
    hasTraceabilityLinks,
    canEditCriticalFields: !hasTraceabilityLinks,
    canDelete: coil.status === "ACTIVE" && !hasTraceabilityLinks,
    canArchive: coil.status === "ACTIVE" && hasTraceabilityLinks,
  };
}
