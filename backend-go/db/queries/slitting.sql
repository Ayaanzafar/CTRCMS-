-- name: GetSlittingBySlitCoilId :one
SELECT *
FROM "SlittingRecord"
WHERE "slitCoilId" = sqlc.arg(slit_coil_id);

-- name: SlittingExists :one
SELECT EXISTS(
    SELECT 1 FROM "SlittingRecord" WHERE "slitCoilId" = sqlc.arg(slit_coil_id)
)::bool AS exists;

-- name: ListSlitCoilIdsForParent :many
SELECT "slitCoilId"
FROM "SlittingRecord"
WHERE "parentCoilNumber" = sqlc.arg(parent_coil_number)
ORDER BY "slitCoilId" DESC;

-- name: CreateSlittingRecord :one
INSERT INTO "SlittingRecord" (
    "slitCoilId",
    "parentCoilNumber",
    "slitWidthSize",
    "slittingDate",
    "slitCoilWeight",
    "slitterLocation",
    "dispatchNote",
    "vehicleNumber",
    "transporterName",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(slit_coil_id),
    sqlc.arg(parent_coil_number),
    sqlc.arg(slit_width_size),
    sqlc.arg(slitting_date),
    sqlc.arg(slit_coil_weight),
    COALESCE(sqlc.narg(slitter_location), 'Shiv Sagar Slitter'),
    sqlc.narg(dispatch_note),
    sqlc.narg(vehicle_number),
    sqlc.narg(transporter_name),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateSlittingRecord :one
UPDATE "SlittingRecord"
SET
    "slitWidthSize" = COALESCE(sqlc.narg(slit_width_size), "slitWidthSize"),
    "slittingDate" = COALESCE(sqlc.narg(slitting_date), "slittingDate"),
    "slitCoilWeight" = COALESCE(sqlc.narg(slit_coil_weight), "slitCoilWeight"),
    "slitterLocation" = COALESCE(sqlc.narg(slitter_location), "slitterLocation"),
    "dispatchNote" = COALESCE(sqlc.narg(dispatch_note), "dispatchNote"),
    "vehicleNumber" = COALESCE(sqlc.narg(vehicle_number), "vehicleNumber"),
    "transporterName" = COALESCE(sqlc.narg(transporter_name), "transporterName"),
    "updatedAt" = NOW()
WHERE "slitCoilId" = sqlc.arg(slit_coil_id)
RETURNING *;

-- name: GetParentCoilStatus :one
SELECT status
FROM "Coil"
WHERE "coilNumber" = sqlc.arg(coil_number);
