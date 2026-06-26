-- name: GetSunrackReceiptByID :one
SELECT *
FROM "SunrackReceipt"
WHERE id = sqlc.arg(id);

-- name: GetSunrackReceiptBySlitCoilId :one
SELECT *
FROM "SunrackReceipt"
WHERE "slitCoilId" = sqlc.arg(slit_coil_id);

-- name: SunrackReceiptExistsForSlitCoil :one
SELECT EXISTS(
    SELECT 1 FROM "SunrackReceipt" WHERE "slitCoilId" = sqlc.arg(slit_coil_id)
)::bool AS exists;

-- name: CreateSunrackReceipt :one
INSERT INTO "SunrackReceipt" (
    id,
    "slitCoilId",
    "receiptDateSunrack",
    "storageLocationBin",
    "inspectionResult",
    "inspectionRemarks",
    "confirmedDispatchNote",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(slit_coil_id),
    sqlc.arg(receipt_date_sunrack),
    sqlc.arg(storage_location_bin),
    sqlc.arg(inspection_result),
    sqlc.narg(inspection_remarks),
    sqlc.narg(confirmed_dispatch_note),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateSunrackReceipt :one
UPDATE "SunrackReceipt"
SET
    "receiptDateSunrack" = COALESCE(sqlc.narg(receipt_date_sunrack), "receiptDateSunrack"),
    "storageLocationBin" = COALESCE(sqlc.narg(storage_location_bin), "storageLocationBin"),
    "inspectionResult" = COALESCE(sqlc.narg(inspection_result), "inspectionResult"),
    "inspectionRemarks" = COALESCE(sqlc.narg(inspection_remarks), "inspectionRemarks"),
    "confirmedDispatchNote" = COALESCE(sqlc.narg(confirmed_dispatch_note), "confirmedDispatchNote"),
    "updatedAt" = NOW()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CountSunrackReceiptsTotal :one
SELECT COUNT(*)::bigint AS count FROM "SunrackReceipt";

-- name: CountPendingSlitCoils :one
SELECT COUNT(*)::bigint AS count
FROM "SlittingRecord" sr
LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
WHERE srr.id IS NULL;

-- name: CountSunrackReceiptsByInspection :one
SELECT COUNT(*)::bigint AS count
FROM "SunrackReceipt"
WHERE "inspectionResult" = sqlc.arg(inspection_result);

-- name: CreateSunrackReceiptPhoto :one
INSERT INTO "SunrackReceiptPhoto" (
    id,
    "receiptId",
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
    sqlc.arg(receipt_id),
    sqlc.arg(filename),
    sqlc.arg(original_name),
    sqlc.arg(mimetype),
    sqlc.arg(size),
    sqlc.arg(storage_path),
    sqlc.narg(uploaded_by_id),
    NOW()
)
RETURNING *;

-- name: GetSunrackReceiptPhotoByID :one
SELECT *
FROM "SunrackReceiptPhoto"
WHERE id = sqlc.arg(id);

-- name: ListSunrackReceiptPhotosByReceiptID :many
SELECT *
FROM "SunrackReceiptPhoto"
WHERE "receiptId" = sqlc.arg(receipt_id)
ORDER BY "createdAt" ASC;

-- name: GetSlittingDispatchNote :one
SELECT "dispatchNote"
FROM "SlittingRecord"
WHERE "slitCoilId" = sqlc.arg(slit_coil_id);
