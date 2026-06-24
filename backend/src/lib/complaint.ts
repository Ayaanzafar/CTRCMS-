import { prisma } from "./prisma.js";
import { resolveBackwardFromBatches } from "./traceability.js";

export async function generateNextComplaintId(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `COMP-${year}-`;
  const existing = await prisma.complaint.findMany({
    where: { complaintId: { startsWith: prefix } },
    select: { complaintId: true },
    orderBy: { complaintId: "desc" },
    take: 1,
  });

  let next = 1;
  if (existing[0]) {
    const seq = parseInt(existing[0].complaintId.slice(prefix.length), 10);
    if (!Number.isNaN(seq)) next = seq + 1;
  }

  return `${prefix}${String(next).padStart(4, "0")}`;
}

export async function validateComplaintBatchLines(
  batchNumbers: string[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (batchNumbers.length === 0) {
    return { ok: false, error: "At least one affected batch is required" };
  }

  const normalized = batchNumbers.map((b) => b.toUpperCase());
  const unique = new Set(normalized);
  if (unique.size !== normalized.length) {
    return { ok: false, error: "Duplicate batch numbers in complaint" };
  }

  for (const batchNumber of normalized) {
    const batch = await prisma.productionBatch.findUnique({ where: { batchNumber } });
    if (!batch) {
      return { ok: false, error: `Production batch ${batchNumber} not found` };
    }
  }

  return { ok: true };
}

export async function getComplaintTraceability(batchNumbers: string[]) {
  return resolveBackwardFromBatches(batchNumbers);
}

export async function listEligibleComplaintBatches() {
  const lines = await prisma.dispatchBatchLine.findMany({
    include: {
      batch: {
        select: {
          batchNumber: true,
          productType: true,
          productionOrderNumber: true,
          quantityProduced: true,
        },
      },
      dispatch: {
        select: {
          dispatchNoteNumber: true,
          projectName: true,
          clientName: true,
          siteLocation: true,
          siteInstallation: { select: { id: true, installationDate: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const byBatch = new Map<
    string,
    {
      batchNumber: string;
      productType: string;
      productionOrderNumber: string;
      quantityProduced: number;
      dispatches: Array<{
        dispatchNoteNumber: string;
        projectName: string;
        clientName: string;
        siteLocation: string;
        quantityDispatched: number;
        hasSiteInstallation: boolean;
      }>;
    }
  >();

  for (const line of lines) {
    const key = line.batchNumber;
    const entry = byBatch.get(key) ?? {
      batchNumber: line.batch.batchNumber,
      productType: line.batch.productType,
      productionOrderNumber: line.batch.productionOrderNumber,
      quantityProduced: Number(line.batch.quantityProduced),
      dispatches: [],
    };

    entry.dispatches.push({
      dispatchNoteNumber: line.dispatch.dispatchNoteNumber,
      projectName: line.dispatch.projectName,
      clientName: line.dispatch.clientName,
      siteLocation: line.dispatch.siteLocation,
      quantityDispatched: Number(line.quantityDispatched),
      hasSiteInstallation: !!line.dispatch.siteInstallation,
    });

    byBatch.set(key, entry);
  }

  return [...byBatch.values()];
}
