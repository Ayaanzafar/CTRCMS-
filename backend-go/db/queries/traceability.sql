-- name: SearchTraceabilityComplaints :many
SELECT "complaintId", "projectName", "resolutionStatus"::text AS resolution_status, "complaintDate"
FROM "Complaint"
WHERE "complaintId" ILIKE '%' || sqlc.arg(search_term) || '%'
   OR "projectName" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "complaintDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilityDispatches :many
SELECT "dispatchNoteNumber", "projectName", "dispatchDate"
FROM "SiteDispatch"
WHERE "dispatchNoteNumber" ILIKE '%' || sqlc.arg(search_term) || '%'
   OR "projectName" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "dispatchDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilityBatches :many
SELECT "batchNumber", "productType", "productionDate"
FROM "ProductionBatch"
WHERE "batchNumber" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "productionDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilitySlits :many
SELECT "slitCoilId", "parentCoilNumber", "slittingDate"
FROM "SlittingRecord"
WHERE "slitCoilId" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "slittingDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilityCoils :many
SELECT "coilNumber", grade, coating, "createdAt"
FROM "Coil"
WHERE "coilNumber" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "createdAt" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilityDispatchesByProject :many
SELECT "dispatchNoteNumber", "projectName", "dispatchDate"
FROM "SiteDispatch"
WHERE "projectName" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "dispatchDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: SearchTraceabilityComplaintsByProject :many
SELECT "complaintId", "projectName", "resolutionStatus"::text AS resolution_status
FROM "Complaint"
WHERE "projectName" ILIKE '%' || sqlc.arg(search_term) || '%'
ORDER BY "complaintDate" DESC
LIMIT sqlc.arg(result_limit);

-- name: ListParentCoilsForBatch :many
SELECT DISTINCT sr."parentCoilNumber"
FROM "BatchSlitCoilMap" bcm
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
WHERE bcm."batchNumber" = sqlc.arg(batch_number);

-- name: ListParentCoilsForDispatch :many
SELECT DISTINCT sr."parentCoilNumber"
FROM "DispatchBatchLine" dbl
INNER JOIN "BatchSlitCoilMap" bcm ON bcm."batchNumber" = dbl."batchNumber"
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
WHERE dbl."dispatchNoteNumber" = sqlc.arg(dispatch_note_number);

-- name: ListParentCoilsForComplaint :many
SELECT DISTINCT sr."parentCoilNumber"
FROM "ComplaintBatchLine" cbl
INNER JOIN "BatchSlitCoilMap" bcm ON bcm."batchNumber" = cbl."batchNumber"
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
WHERE cbl."complaintId" = sqlc.arg(complaint_id);

-- name: ListParentCoilsForProjectFromDispatch :many
SELECT DISTINCT sr."parentCoilNumber"
FROM "SiteDispatch" sd
INNER JOIN "DispatchBatchLine" dbl ON dbl."dispatchNoteNumber" = sd."dispatchNoteNumber"
INNER JOIN "BatchSlitCoilMap" bcm ON bcm."batchNumber" = dbl."batchNumber"
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
WHERE sd."projectName" ILIKE sqlc.arg(project_name);

-- name: ListParentCoilsForProjectFromComplaint :many
SELECT DISTINCT sr."parentCoilNumber"
FROM "Complaint" c
INNER JOIN "ComplaintBatchLine" cbl ON cbl."complaintId" = c."complaintId"
INNER JOIN "BatchSlitCoilMap" bcm ON bcm."batchNumber" = cbl."batchNumber"
INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
WHERE c."projectName" ILIKE sqlc.arg(project_name);

-- name: ListDispatchBatchLinesByBatchForTraceability :many
SELECT
    dbl."dispatchNoteNumber",
    dbl."quantityDispatched",
    sd."dispatchDate",
    sd."projectName",
    sd."clientName",
    sd."siteLocation",
    sd."vehicleNumber",
    sd."transporterName"
FROM "DispatchBatchLine" dbl
INNER JOIN "SiteDispatch" sd ON sd."dispatchNoteNumber" = dbl."dispatchNoteNumber"
WHERE dbl."batchNumber" = sqlc.arg(batch_number)
ORDER BY dbl."createdAt" ASC;

-- name: ListComplaintsForBatchTraceability :many
SELECT
    c."complaintId",
    c."complaintDate",
    c."projectName",
    c."clientName",
    c."siteLocation",
    c."complaintDescription",
    c."rootCauseRemarks",
    c."resolutionStatus"::text AS resolution_status,
    c."resolutionDate",
    c."responsibleStage"::text AS responsible_stage
FROM "ComplaintBatchLine" cbl
INNER JOIN "Complaint" c ON c."complaintId" = cbl."complaintId"
WHERE cbl."batchNumber" = sqlc.arg(batch_number);
