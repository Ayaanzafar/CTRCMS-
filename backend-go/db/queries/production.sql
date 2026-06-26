-- name: GetProductionBatchByNumber :one
SELECT *
FROM "ProductionBatch"
WHERE "batchNumber" = sqlc.arg(batch_number);

-- name: ProductionBatchExists :one
SELECT EXISTS(
    SELECT 1 FROM "ProductionBatch" WHERE "batchNumber" = sqlc.arg(batch_number)
)::bool AS exists;

-- name: CreateProductionBatch :one
INSERT INTO "ProductionBatch" (
    "batchNumber",
    "productionOrderNumber",
    "productType",
    "quantityProduced",
    "productionDate",
    "operatorShift",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(batch_number),
    sqlc.arg(production_order_number),
    sqlc.arg(product_type),
    sqlc.arg(quantity_produced),
    sqlc.arg(production_date),
    sqlc.arg(operator_shift),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateProductionBatch :one
UPDATE "ProductionBatch"
SET
    "productionOrderNumber" = COALESCE(sqlc.narg(production_order_number), "productionOrderNumber"),
    "productType" = COALESCE(sqlc.narg(product_type), "productType"),
    "quantityProduced" = COALESCE(sqlc.narg(quantity_produced), "quantityProduced"),
    "productionDate" = COALESCE(sqlc.narg(production_date), "productionDate"),
    "operatorShift" = COALESCE(sqlc.narg(operator_shift), "operatorShift"),
    "updatedAt" = NOW()
WHERE "batchNumber" = sqlc.arg(batch_number)
RETURNING *;

-- name: CountProductionBatches :one
SELECT COUNT(*)::bigint AS count FROM "ProductionBatch";

-- name: CountSlitCoilsWithNonFailReceipt :one
SELECT COUNT(*)::bigint AS count
FROM "SlittingRecord" sr
INNER JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
WHERE srr."inspectionResult" != 'FAIL';

-- name: GetLatestBatchNumberWithPrefix :one
SELECT "batchNumber"
FROM "ProductionBatch"
WHERE "batchNumber" LIKE sqlc.arg(prefix) || '%'
ORDER BY "batchNumber" DESC
LIMIT 1;

-- name: GetSlitCoilProductionContext :one
SELECT
    sr."slitCoilId",
    sr."slitCoilWeight",
    srr.id AS receipt_id,
    srr."inspectionResult"
FROM "SlittingRecord" sr
LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
WHERE sr."slitCoilId" = sqlc.arg(slit_coil_id);

-- name: SumConsumedBySlitCoil :one
SELECT COALESCE(SUM("quantityConsumed"), 0)::numeric AS total
FROM "BatchSlitCoilMap"
WHERE "slitCoilId" = sqlc.arg(slit_coil_id)
  AND (
    sqlc.narg(exclude_batch)::text IS NULL
    OR sqlc.narg(exclude_batch)::text = ''
    OR "batchNumber" != sqlc.narg(exclude_batch)
  );

-- name: CreateBatchSlitCoilMap :one
INSERT INTO "BatchSlitCoilMap" (
    id,
    "batchNumber",
    "slitCoilId",
    "quantityConsumed",
    "createdAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(batch_number),
    sqlc.arg(slit_coil_id),
    sqlc.arg(quantity_consumed),
    NOW()
)
RETURNING *;

-- name: GetBatchSlitCoilMapByBatchAndSlit :one
SELECT *
FROM "BatchSlitCoilMap"
WHERE "batchNumber" = sqlc.arg(batch_number)
  AND "slitCoilId" = sqlc.arg(slit_coil_id);

-- name: AddBatchSlitCoilConsumption :one
UPDATE "BatchSlitCoilMap"
SET "quantityConsumed" = "quantityConsumed" + sqlc.arg(add_quantity)
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: ListBatchSlitCoilMapsForBatch :many
SELECT *
FROM "BatchSlitCoilMap"
WHERE "batchNumber" = sqlc.arg(batch_number)
ORDER BY "createdAt" ASC;

-- name: ListSlitCoilProductionConsumptions :many
SELECT
    m.id,
    m."batchNumber",
    m."slitCoilId",
    m."quantityConsumed",
    m."createdAt",
    b."productType",
    b."quantityProduced",
    b."productionDate",
    b."productionOrderNumber"
FROM "BatchSlitCoilMap" m
INNER JOIN "ProductionBatch" b ON b."batchNumber" = m."batchNumber"
WHERE m."slitCoilId" = sqlc.arg(slit_coil_id)
ORDER BY m."createdAt" ASC;
