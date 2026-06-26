-- name: GetQcInspectionByID :one
SELECT *
FROM "QCInspection"
WHERE id = sqlc.arg(id);

-- name: GetLatestQcInspectionByBatch :one
SELECT *
FROM "QCInspection"
WHERE "batchNumber" = sqlc.arg(batch_number)
ORDER BY "inspectionDate" DESC
LIMIT 1;

-- name: CreateQcInspection :one
INSERT INTO "QCInspection" (
    id,
    "batchNumber",
    "qcResult",
    "inspectorName",
    "inspectionDate",
    "qcRemarks",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(batch_number),
    sqlc.arg(qc_result),
    sqlc.arg(inspector_name),
    sqlc.arg(inspection_date),
    sqlc.narg(qc_remarks),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateQcInspection :one
UPDATE "QCInspection"
SET
    "qcResult" = COALESCE(sqlc.narg(qc_result), "qcResult"),
    "inspectorName" = COALESCE(sqlc.narg(inspector_name), "inspectorName"),
    "inspectionDate" = COALESCE(sqlc.narg(inspection_date), "inspectionDate"),
    "qcRemarks" = COALESCE(sqlc.narg(qc_remarks), "qcRemarks"),
    "updatedAt" = NOW()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CountQcInspections :one
SELECT COUNT(*)::bigint AS count FROM "QCInspection";

-- name: CountQcInspectionsByResult :one
SELECT COUNT(*)::bigint AS count
FROM "QCInspection"
WHERE "qcResult" = sqlc.arg(qc_result);

-- name: CountBatchesWithNoQc :one
SELECT COUNT(*)::bigint AS count
FROM "ProductionBatch" pb
WHERE NOT EXISTS (
    SELECT 1 FROM "QCInspection" qi WHERE qi."batchNumber" = pb."batchNumber"
);

-- name: CreateQcInspectionPhoto :one
INSERT INTO "QCInspectionPhoto" (
    id,
    "inspectionId",
    filename,
    "originalName",
    mimetype,
    size,
    "storagePath",
    "uploadedById",
    "createdAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(inspection_id),
    sqlc.arg(filename),
    sqlc.arg(original_name),
    sqlc.arg(mimetype),
    sqlc.arg(size),
    sqlc.arg(storage_path),
    sqlc.narg(uploaded_by_id),
    NOW()
)
RETURNING *;

-- name: GetQcInspectionPhotoByID :one
SELECT *
FROM "QCInspectionPhoto"
WHERE id = sqlc.arg(id);

-- name: ListQcInspectionPhotosByInspectionID :many
SELECT *
FROM "QCInspectionPhoto"
WHERE "inspectionId" = sqlc.arg(inspection_id)
ORDER BY "createdAt" ASC;

-- name: ListQcInspectionsByBatch :many
SELECT *
FROM "QCInspection"
WHERE "batchNumber" = sqlc.arg(batch_number)
ORDER BY "inspectionDate" DESC;
