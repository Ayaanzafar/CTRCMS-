-- name: ListAllCoilDocumentsForHub :many
SELECT
    d.id,
    d."coilNumber",
    d."documentType"::text AS document_type,
    d."originalName",
    d.mimetype,
    d.size,
    d."createdAt"
FROM "CoilDocument" d
ORDER BY d."createdAt" DESC;

-- name: ListAllSunrackReceiptPhotosForHub :many
SELECT
    p.id,
    p."originalName",
    p.mimetype,
    p.size,
    p."createdAt",
    r."slitCoilId",
    sr."parentCoilNumber"
FROM "SunrackReceiptPhoto" p
INNER JOIN "SunrackReceipt" r ON r.id = p."receiptId"
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = r."slitCoilId"
ORDER BY p."createdAt" DESC;

-- name: ListAllQcPhotosForHub :many
SELECT
    p.id,
    p."originalName",
    p.mimetype,
    p.size,
    p."createdAt",
    qc."batchNumber"
FROM "QCInspectionPhoto" p
INNER JOIN "QCInspection" qc ON qc.id = p."inspectionId"
ORDER BY p."createdAt" DESC;

-- name: ListAllSiteInstallationPhotosForHub :many
SELECT
    p.id,
    p."originalName",
    p.mimetype,
    p.size,
    p."createdAt",
    si."dispatchNoteNumber",
    sd."projectName"
FROM "SiteInstallationPhoto" p
INNER JOIN "SiteInstallation" si ON si.id = p."installationId"
INNER JOIN "SiteDispatch" sd ON sd."dispatchNoteNumber" = si."dispatchNoteNumber"
ORDER BY p."createdAt" DESC;

-- name: ListAllComplaintPhotosForHub :many
SELECT
    p.id,
    p."originalName",
    p.mimetype,
    p.size,
    p."createdAt",
    c."complaintId",
    c."projectName"
FROM "ComplaintPhoto" p
INNER JOIN "Complaint" c ON c."complaintId" = p."complaintId"
ORDER BY p."createdAt" DESC;
