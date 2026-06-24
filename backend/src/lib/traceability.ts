import { prisma } from "./prisma.js";

export async function resolveBackwardFromBatches(batchNumbers: string[]) {
  const normalized = [...new Set(batchNumbers.map((b) => b.toUpperCase()))];

  const batches = await prisma.productionBatch.findMany({
    where: { batchNumber: { in: normalized } },
    include: {
      slitCoilConsumptions: {
        include: {
          slitCoil: {
            select: {
              slitCoilId: true,
              parentCoilNumber: true,
              slitWidthSize: true,
              parentCoil: {
                select: {
                  coilNumber: true,
                  grade: true,
                  coating: true,
                  size: true,
                  mtcNumber: true,
                  invoiceNumber: true,
                  supplier: true,
                },
              },
            },
          },
        },
      },
      dispatchLines: {
        include: {
          dispatch: {
            select: {
              dispatchNoteNumber: true,
              projectName: true,
              clientName: true,
              siteLocation: true,
              siteInstallation: {
                select: {
                  installationDate: true,
                  installerEpcPartner: true,
                },
              },
            },
          },
        },
      },
      qcInspections: {
        orderBy: { inspectionDate: "desc" },
        take: 1,
        select: { qcResult: true, inspectionDate: true },
      },
    },
  });

  const foundNumbers = new Set(batches.map((b) => b.batchNumber));
  const missing = normalized.filter((b) => !foundNumbers.has(b));

  const coilMap = new Map<
    string,
    {
      coilNumber: string;
      grade: string;
      coating: string;
      size: string;
      mtcNumber: string | null;
      invoiceNumber: string | null;
      supplier: string;
      slitCoilIds: string[];
    }
  >();

  const slitCoilIds = new Set<string>();

  for (const batch of batches) {
    for (const line of batch.slitCoilConsumptions) {
      slitCoilIds.add(line.slitCoilId);
      const coilNumber = line.slitCoil.parentCoilNumber;
      const existing = coilMap.get(coilNumber);
      if (existing) {
        if (!existing.slitCoilIds.includes(line.slitCoilId)) {
          existing.slitCoilIds.push(line.slitCoilId);
        }
      } else {
        coilMap.set(coilNumber, {
          coilNumber: line.slitCoil.parentCoil.coilNumber,
          grade: line.slitCoil.parentCoil.grade,
          coating: line.slitCoil.parentCoil.coating,
          size: line.slitCoil.parentCoil.size,
          mtcNumber: line.slitCoil.parentCoil.mtcNumber,
          invoiceNumber: line.slitCoil.parentCoil.invoiceNumber,
          supplier: line.slitCoil.parentCoil.supplier,
          slitCoilIds: [line.slitCoilId],
        });
      }
    }
  }

  return {
    linkedCoilNumbers: [...coilMap.keys()],
    linkedSlitCoilIds: [...slitCoilIds],
    coils: [...coilMap.values()],
    batches: batches.map((b) => ({
      batchNumber: b.batchNumber,
      productType: b.productType,
      productionOrderNumber: b.productionOrderNumber,
      quantityProduced: Number(b.quantityProduced),
      latestQcResult: b.qcInspections[0]?.qcResult ?? null,
      slitCoils: b.slitCoilConsumptions.map((c) => ({
        slitCoilId: c.slitCoilId,
        parentCoilNumber: c.slitCoil.parentCoilNumber,
        slitWidthSize: c.slitCoil.slitWidthSize,
        quantityConsumed: Number(c.quantityConsumed),
      })),
      dispatches: b.dispatchLines.map((d) => ({
        dispatchNoteNumber: d.dispatch.dispatchNoteNumber,
        projectName: d.dispatch.projectName,
        quantityDispatched: Number(d.quantityDispatched),
        siteInstallation: d.dispatch.siteInstallation,
      })),
    })),
    missingBatches: missing,
  };
}
