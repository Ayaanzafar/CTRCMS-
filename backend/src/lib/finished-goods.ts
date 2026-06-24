import { getBatchDispatchedQuantity as sumBatchDispatched } from "./dispatch.js";

export async function getBatchDispatchedQuantity(batchNumber: string): Promise<number> {
  return sumBatchDispatched(batchNumber);
}

export function computeAvailableQuantity(quantityProduced: number, quantityDispatched: number): number {
  return Math.max(0, quantityProduced - quantityDispatched);
}
