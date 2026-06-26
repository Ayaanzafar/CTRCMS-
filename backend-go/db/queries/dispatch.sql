-- name: GetSiteDispatchByNoteNumber :one
SELECT *
FROM "SiteDispatch"
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number);

-- name: SiteDispatchExists :one
SELECT EXISTS(
    SELECT 1 FROM "SiteDispatch" WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number)
) AS exists;

-- name: CreateSiteDispatch :one
INSERT INTO "SiteDispatch" (
    "dispatchNoteNumber",
    "dispatchDate",
    "vehicleNumber",
    "transporterName",
    "projectName",
    "clientName",
    "siteLocation",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(dispatch_note_number),
    sqlc.arg(dispatch_date),
    sqlc.narg(vehicle_number),
    sqlc.narg(transporter_name),
    sqlc.arg(project_name),
    sqlc.arg(client_name),
    sqlc.arg(site_location),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateSiteDispatch :one
UPDATE "SiteDispatch"
SET
    "dispatchDate" = COALESCE(sqlc.narg(dispatch_date), "dispatchDate"),
    "vehicleNumber" = COALESCE(sqlc.narg(vehicle_number), "vehicleNumber"),
    "transporterName" = COALESCE(sqlc.narg(transporter_name), "transporterName"),
    "projectName" = COALESCE(sqlc.narg(project_name), "projectName"),
    "clientName" = COALESCE(sqlc.narg(client_name), "clientName"),
    "siteLocation" = COALESCE(sqlc.narg(site_location), "siteLocation"),
    "updatedAt" = NOW()
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number)
RETURNING *;

-- name: CountSiteDispatches :one
SELECT COUNT(*)::bigint AS count FROM "SiteDispatch";

-- name: SumAllDispatchedQuantity :one
SELECT COALESCE(SUM("quantityDispatched"), 0)::numeric AS total
FROM "DispatchBatchLine";

-- name: CountDistinctDispatchProjects :one
SELECT COUNT(DISTINCT "projectName")::bigint AS count FROM "SiteDispatch";

-- name: GetLatestDispatchNoteByPrefix :one
SELECT "dispatchNoteNumber"
FROM "SiteDispatch"
WHERE "dispatchNoteNumber" LIKE sqlc.arg(prefix) || '%'
ORDER BY "dispatchNoteNumber" DESC
LIMIT 1;

-- name: CreateDispatchBatchLine :one
INSERT INTO "DispatchBatchLine" (
    id,
    "dispatchNoteNumber",
    "batchNumber",
    "quantityDispatched",
    "createdAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(dispatch_note_number),
    sqlc.arg(batch_number),
    sqlc.arg(quantity_dispatched),
    NOW()
)
RETURNING *;

-- name: DeleteDispatchBatchLinesByNote :exec
DELETE FROM "DispatchBatchLine"
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number);

-- name: ListDispatchBatchLinesByNote :many
SELECT *
FROM "DispatchBatchLine"
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number)
ORDER BY "createdAt" ASC;

-- name: SumBatchDispatchedQuantityExcludingNote :one
SELECT COALESCE(SUM("quantityDispatched"), 0)::numeric AS total
FROM "DispatchBatchLine"
WHERE "batchNumber" = sqlc.arg(batch_number)
  AND "dispatchNoteNumber" <> sqlc.arg(exclude_dispatch_note_number);

-- name: SumDispatchNoteQuantity :one
SELECT COALESCE(SUM("quantityDispatched"), 0)::numeric AS total
FROM "DispatchBatchLine"
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number);

-- name: GetSiteInstallationSummaryByDispatchNote :one
SELECT
    si.id,
    si."dispatchNoteNumber",
    si."siteReceiptDate",
    si."installationDate",
    si."installerEpcPartner",
    si."quantityInstalled",
    si."createdAt",
    si."updatedAt",
    (
        SELECT COUNT(*)::bigint
        FROM "SiteInstallationPhoto" sip
        WHERE sip."installationId" = si.id
    ) AS photo_count
FROM "SiteInstallation" si
WHERE si."dispatchNoteNumber" = sqlc.arg(dispatch_note_number);
