-- name: CountRecentSiteDispatches :one
SELECT COUNT(*)::bigint AS count
FROM "SiteDispatch"
WHERE "dispatchDate" >= sqlc.arg(since_date);

-- name: CountPendingSiteDispatches :one
SELECT COUNT(*)::bigint AS count
FROM "SiteDispatch" sd
WHERE NOT EXISTS (
    SELECT 1 FROM "SiteInstallation" si WHERE si."dispatchNoteNumber" = sd."dispatchNoteNumber"
);

-- name: CountUnreadNotifications :one
SELECT COUNT(*)::bigint AS count
FROM "SystemNotification"
WHERE "isRead" = false;

-- name: CountComplaintsWithUndeterminedStage :one
SELECT COUNT(*)::bigint AS count
FROM "Complaint"
WHERE "responsibleStage" IS NULL;

-- name: GroupComplaintsByResponsibleStage :many
SELECT "responsibleStage"::text AS responsible_stage, COUNT(*)::bigint AS count
FROM "Complaint"
WHERE "responsibleStage" IS NOT NULL
GROUP BY "responsibleStage";

-- name: ListProductionBatchesForFgCalc :many
SELECT "batchNumber", "productType", "quantityProduced"
FROM "ProductionBatch";

-- name: ListRecentDispatchesForDashboard :many
SELECT
    sd."dispatchNoteNumber",
    sd."dispatchDate",
    sd."projectName",
    sd."clientName",
    sd."siteLocation",
    (
        SELECT COUNT(*)::bigint
        FROM "DispatchBatchLine" dbl
        WHERE dbl."dispatchNoteNumber" = sd."dispatchNoteNumber"
    ) AS batch_count,
    (
        SELECT COALESCE(SUM("quantityDispatched"), 0)::numeric
        FROM "DispatchBatchLine" dbl
        WHERE dbl."dispatchNoteNumber" = sd."dispatchNoteNumber"
    ) AS total_quantity,
    EXISTS (
        SELECT 1 FROM "SiteInstallation" si
        WHERE si."dispatchNoteNumber" = sd."dispatchNoteNumber"
    ) AS site_installed
FROM "SiteDispatch" sd
ORDER BY sd."dispatchDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: ListPendingQcBatchesForDashboard :many
SELECT
    pb."batchNumber",
    pb."productionOrderNumber",
    pb."productType",
    pb."quantityProduced",
    pb."productionDate"
FROM "ProductionBatch" pb
WHERE NOT EXISTS (
    SELECT 1 FROM "QCInspection" qc WHERE qc."batchNumber" = pb."batchNumber"
)
ORDER BY pb."productionDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: ListOpenComplaintsForDashboard :many
SELECT
    "complaintId",
    "complaintDate",
    "projectName",
    "resolutionStatus"::text AS resolution_status,
    "responsibleStage"::text AS responsible_stage
FROM "Complaint"
WHERE "resolutionStatus" IN ('OPEN', 'UNDER_INVESTIGATION')
ORDER BY "complaintDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: CountAuditLogsFiltered :one
SELECT COUNT(*)::bigint AS count
FROM "AuditLog" al
WHERE (sqlc.narg(entity_type)::text IS NULL OR al."entityType" = sqlc.narg(entity_type))
  AND (sqlc.narg(action_filter)::text IS NULL OR al.action = sqlc.narg(action_filter));

-- name: ListAuditLogsWithUser :many
SELECT
    al.id,
    al.action,
    al."entityType",
    al."entityId",
    al."oldValues",
    al."newValues",
    al."createdAt",
    u."fullName",
    u.email,
    r.name AS role_name
FROM "AuditLog" al
INNER JOIN "User" u ON u.id = al."userId"
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE (sqlc.narg(entity_type)::text IS NULL OR al."entityType" = sqlc.narg(entity_type))
  AND (sqlc.narg(action_filter)::text IS NULL OR al.action = sqlc.narg(action_filter))
ORDER BY al."createdAt" DESC
LIMIT sqlc.arg(result_limit)
OFFSET sqlc.arg(result_offset);

-- name: ListSystemNotifications :many
SELECT *
FROM "SystemNotification"
WHERE (sqlc.arg(unread_only)::bool = false OR "isRead" = false)
ORDER BY "createdAt" DESC
LIMIT sqlc.arg(result_limit);

-- name: MarkNotificationsReadByIDs :exec
UPDATE "SystemNotification"
SET "isRead" = true
WHERE id = ANY(sqlc.arg(notification_ids)::text[]);

-- name: MarkAllNotificationsRead :exec
UPDATE "SystemNotification"
SET "isRead" = true
WHERE "isRead" = false;

-- name: MarkNotificationReadByID :exec
UPDATE "SystemNotification"
SET "isRead" = true
WHERE id = sqlc.arg(notification_id);
