-- name: GetCoilByNumber :one
SELECT *
FROM "Coil"
WHERE "coilNumber" = sqlc.arg(coil_number);

-- name: CoilExists :one
SELECT EXISTS(SELECT 1 FROM "Coil" WHERE "coilNumber" = sqlc.arg(coil_number))::bool AS exists;

-- name: CreateCoil :one
INSERT INTO "Coil" (
    "coilNumber",
    grade,
    coating,
    size,
    weight,
    supplier,
    "mtcNumber",
    "invoiceNumber",
    "amnsDispatchDate",
    "vehicleNumber",
    "transporterName",
    "receiptDateSlitter",
    "receivingConditionRemarks",
    status,
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(coil_number),
    sqlc.arg(grade),
    sqlc.arg(coating),
    sqlc.arg(size),
    sqlc.arg(weight),
    COALESCE(sqlc.narg(supplier), 'AMNS (Hazira Plant)'),
    sqlc.narg(mtc_number),
    sqlc.narg(invoice_number),
    sqlc.narg(amns_dispatch_date),
    sqlc.narg(vehicle_number),
    sqlc.narg(transporter_name),
    sqlc.narg(receipt_date_slitter),
    sqlc.narg(receiving_condition_remarks),
    'ACTIVE',
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateCoil :one
UPDATE "Coil"
SET
    grade = COALESCE(sqlc.narg(grade), grade),
    coating = COALESCE(sqlc.narg(coating), coating),
    size = COALESCE(sqlc.narg(size), size),
    weight = COALESCE(sqlc.narg(weight), weight),
    supplier = COALESCE(sqlc.narg(supplier), supplier),
    "mtcNumber" = COALESCE(sqlc.narg(mtc_number), "mtcNumber"),
    "invoiceNumber" = COALESCE(sqlc.narg(invoice_number), "invoiceNumber"),
    "amnsDispatchDate" = COALESCE(sqlc.narg(amns_dispatch_date), "amnsDispatchDate"),
    "vehicleNumber" = COALESCE(sqlc.narg(vehicle_number), "vehicleNumber"),
    "transporterName" = COALESCE(sqlc.narg(transporter_name), "transporterName"),
    "receiptDateSlitter" = COALESCE(sqlc.narg(receipt_date_slitter), "receiptDateSlitter"),
    "receivingConditionRemarks" = COALESCE(sqlc.narg(receiving_condition_remarks), "receivingConditionRemarks"),
    "updatedAt" = NOW()
WHERE "coilNumber" = sqlc.arg(coil_number)
RETURNING *;

-- name: ArchiveCoil :one
UPDATE "Coil"
SET
    status = 'ARCHIVED',
    "archivedAt" = NOW(),
    "archivedById" = sqlc.narg(archived_by_id),
    "updatedAt" = NOW()
WHERE "coilNumber" = sqlc.arg(coil_number)
RETURNING *;

-- name: DeleteCoil :exec
DELETE FROM "Coil" WHERE "coilNumber" = sqlc.arg(coil_number);

-- name: CountAllCoils :one
SELECT COUNT(*)::bigint AS count FROM "Coil";

-- name: CountActiveCoils :one
SELECT COUNT(*)::bigint AS count FROM "Coil" WHERE status = 'ACTIVE';

-- name: CountArchivedCoils :one
SELECT COUNT(*)::bigint AS count FROM "Coil" WHERE status = 'ARCHIVED';

-- name: CountActiveCoilsInTrace :one
SELECT COUNT(DISTINCT c."coilNumber")::bigint AS count
FROM "Coil" c
INNER JOIN "SlittingRecord" sr ON sr."parentCoilNumber" = c."coilNumber"
WHERE c.status = 'ACTIVE';

-- name: CountActiveCoilsWithDocs :one
SELECT COUNT(DISTINCT c."coilNumber")::bigint AS count
FROM "Coil" c
INNER JOIN "CoilDocument" d ON d."coilNumber" = c."coilNumber"
WHERE c.status = 'ACTIVE';

-- name: CountAllCoilsInTrace :one
SELECT COUNT(DISTINCT c."coilNumber")::bigint AS count
FROM "Coil" c
INNER JOIN "SlittingRecord" sr ON sr."parentCoilNumber" = c."coilNumber";

-- name: CountAllCoilsWithDocs :one
SELECT COUNT(DISTINCT c."coilNumber")::bigint AS count
FROM "Coil" c
INNER JOIN "CoilDocument" d ON d."coilNumber" = c."coilNumber";

-- name: CountSlittingByCoil :one
SELECT COUNT(*)::bigint AS count
FROM "SlittingRecord"
WHERE "parentCoilNumber" = sqlc.arg(coil_number);

-- name: CountDocumentsByCoil :one
SELECT COUNT(*)::bigint AS count
FROM "CoilDocument"
WHERE "coilNumber" = sqlc.arg(coil_number);

-- name: ListCoilDocuments :many
SELECT *
FROM "CoilDocument"
WHERE "coilNumber" = sqlc.arg(coil_number)
ORDER BY "createdAt" DESC;

-- name: ListSlittingByCoil :many
SELECT *
FROM "SlittingRecord"
WHERE "parentCoilNumber" = sqlc.arg(coil_number)
ORDER BY "slittingDate" DESC;

-- name: GetCoilDocumentByID :one
SELECT *
FROM "CoilDocument"
WHERE id = sqlc.arg(id);

-- name: CreateCoilDocument :one
INSERT INTO "CoilDocument" (
    id,
    "coilNumber",
    "documentType",
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
    sqlc.arg(coil_number),
    sqlc.arg(document_type),
    sqlc.arg(filename),
    sqlc.arg(original_name),
    sqlc.arg(mimetype),
    sqlc.arg(size),
    sqlc.arg(storage_path),
    sqlc.narg(uploaded_by_id),
    NOW()
)
RETURNING *;

-- name: DeleteCoilDocument :exec
DELETE FROM "CoilDocument" WHERE id = sqlc.arg(id);

-- name: ListCoilDocumentIDs :many
SELECT id
FROM "CoilDocument"
WHERE "coilNumber" = sqlc.arg(coil_number);

-- name: ListCoilAuditLogs :many
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
WHERE (
    (al."entityType" = 'Coil' AND al."entityId" = sqlc.arg(coil_number))
    OR (
        al."entityType" = 'CoilDocument'
        AND al."entityId" = ANY(sqlc.arg(document_ids)::text[])
    )
)
ORDER BY al."createdAt" DESC
LIMIT sqlc.arg(row_limit);

-- name: GetCoilUsageGraphRows :many
SELECT
    sr."slitCoilId",
    srr.id AS sunrack_receipt_id,
    bcm."batchNumber",
    dbl."dispatchNoteNumber",
    si.id AS installation_id,
    cbl."complaintId"
FROM "SlittingRecord" sr
LEFT JOIN "SunrackReceipt" srr ON srr."slitCoilId" = sr."slitCoilId"
LEFT JOIN "BatchSlitCoilMap" bcm ON bcm."slitCoilId" = sr."slitCoilId"
LEFT JOIN "DispatchBatchLine" dbl ON dbl."batchNumber" = bcm."batchNumber"
LEFT JOIN "SiteInstallation" si ON si."dispatchNoteNumber" = dbl."dispatchNoteNumber"
LEFT JOIN "ComplaintBatchLine" cbl ON cbl."batchNumber" = bcm."batchNumber"
WHERE sr."parentCoilNumber" = sqlc.arg(coil_number);
