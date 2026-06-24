import { prisma } from "./prisma.js";

export async function getDispatchTotalQuantity(dispatchNoteNumber: string): Promise<number> {
  const result = await prisma.dispatchBatchLine.aggregate({
    where: { dispatchNoteNumber: dispatchNoteNumber.toUpperCase() },
    _sum: { quantityDispatched: true },
  });
  return Number(result._sum.quantityDispatched ?? 0);
}

export async function validateSiteInstallation(
  dispatchNoteNumber: string,
  quantityInstalled: number
): Promise<{ ok: true; totalDispatched: number } | { ok: false; error: string }> {
  const note = dispatchNoteNumber.toUpperCase();

  const dispatch = await prisma.siteDispatch.findUnique({
    where: { dispatchNoteNumber: note },
    include: { siteInstallation: true },
  });

  if (!dispatch) {
    return { ok: false, error: `Dispatch note ${note} not found` };
  }

  if (dispatch.siteInstallation) {
    return { ok: false, error: `Dispatch note ${note} already has a site installation record` };
  }

  const totalDispatched = await getDispatchTotalQuantity(note);

  if (totalDispatched <= 0) {
    return { ok: false, error: `Dispatch note ${note} has no quantity to install` };
  }

  if (quantityInstalled <= 0) {
    return { ok: false, error: "Quantity installed must be positive" };
  }

  if (quantityInstalled > totalDispatched + 0.0001) {
    return {
      ok: false,
      error: `Quantity installed (${quantityInstalled}) cannot exceed dispatched total (${totalDispatched.toFixed(3)})`,
    };
  }

  return { ok: true, totalDispatched };
}

export async function validateSiteInstallationUpdate(
  installationId: string,
  dispatchNoteNumber: string,
  quantityInstalled: number
): Promise<{ ok: true; totalDispatched: number } | { ok: false; error: string }> {
  const note = dispatchNoteNumber.toUpperCase();
  const totalDispatched = await getDispatchTotalQuantity(note);

  if (totalDispatched <= 0) {
    return { ok: false, error: `Dispatch note ${note} has no quantity to install` };
  }

  if (quantityInstalled <= 0) {
    return { ok: false, error: "Quantity installed must be positive" };
  }

  if (quantityInstalled > totalDispatched + 0.0001) {
    return {
      ok: false,
      error: `Quantity installed (${quantityInstalled}) cannot exceed dispatched total (${totalDispatched.toFixed(3)})`,
    };
  }

  const existing = await prisma.siteInstallation.findUnique({ where: { id: installationId } });
  if (!existing) {
    return { ok: false, error: "Site installation not found" };
  }

  return { ok: true, totalDispatched };
}
