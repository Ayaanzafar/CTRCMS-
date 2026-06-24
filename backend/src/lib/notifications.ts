import type { NotificationType } from "@prisma/client";
import { prisma } from "./prisma.js";
import { env } from "../config/env.js";

interface NotifyInput {
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
}

export async function createSystemNotification(input: NotifyInput) {
  const notification = await prisma.systemNotification.create({
    data: {
      type: input.type,
      title: input.title,
      message: input.message,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });

  dispatchExternalNotification(input);
  return notification;
}

function dispatchExternalNotification(input: NotifyInput) {
  const payload = `[CTRCMS ${input.type}] ${input.title}: ${input.message}`;

  if (env.NOTIFY_EMAIL_ENABLED && env.NOTIFY_EMAIL_TO) {
    console.info(`[NOTIFY:EMAIL → ${env.NOTIFY_EMAIL_TO}] ${payload}`);
  }

  if (env.NOTIFY_SMS_ENABLED) {
    console.info(`[NOTIFY:SMS] ${payload}`);
  }

  if (!env.NOTIFY_EMAIL_ENABLED && !env.NOTIFY_SMS_ENABLED) {
    console.info(`[NOTIFY:IN_APP] ${payload}`);
  }
}

export async function notifyComplaintCreated(params: {
  complaintId: string;
  projectName: string;
  clientName: string;
}) {
  return createSystemNotification({
    type: "COMPLAINT_CREATED",
    title: `New complaint ${params.complaintId}`,
    message: `${params.projectName} · ${params.clientName} — review and assign investigation`,
    entityType: "Complaint",
    entityId: params.complaintId,
  });
}

export async function notifyQcFailed(params: {
  batchNumber: string;
  productType: string;
  inspectorName: string;
  qcRemarks?: string | null;
}) {
  return createSystemNotification({
    type: "QC_FAILED",
    title: `QC failed — ${params.batchNumber}`,
    message: `${params.productType} · Inspector ${params.inspectorName}${params.qcRemarks ? ` — ${params.qcRemarks}` : ""}`,
    entityType: "ProductionBatch",
    entityId: params.batchNumber,
  });
}
