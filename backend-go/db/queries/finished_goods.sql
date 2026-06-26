-- name: SumBatchDispatchedQuantity :one
SELECT COALESCE(SUM("quantityDispatched"), 0)::numeric AS total
FROM "DispatchBatchLine"
WHERE "batchNumber" = sqlc.arg(batch_number);
