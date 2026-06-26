-- name: GetComplaintByID :one
SELECT *
FROM "Complaint"
WHERE "complaintId" = sqlc.arg(complaint_id);

-- name: ComplaintExists :one
SELECT EXISTS(
    SELECT 1 FROM "Complaint" WHERE "complaintId" = sqlc.arg(complaint_id)
) AS exists;

-- name: CreateComplaint :one
INSERT INTO "Complaint" (
    "complaintId",
    "complaintDate",
    "projectName",
    "clientName",
    "siteLocation",
    "complaintDescription",
    "rootCauseRemarks",
    "resolutionStatus",
    "resolutionDate",
    "responsibleStage",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(complaint_id),
    sqlc.arg(complaint_date),
    sqlc.arg(project_name),
    sqlc.arg(client_name),
    sqlc.arg(site_location),
    sqlc.arg(complaint_description),
    sqlc.narg(root_cause_remarks),
    sqlc.arg(resolution_status),
    sqlc.narg(resolution_date),
    sqlc.narg(responsible_stage),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateComplaint :one
UPDATE "Complaint"
SET
    "complaintDate" = COALESCE(sqlc.narg(complaint_date), "complaintDate"),
    "projectName" = COALESCE(sqlc.narg(project_name), "projectName"),
    "clientName" = COALESCE(sqlc.narg(client_name), "clientName"),
    "siteLocation" = COALESCE(sqlc.narg(site_location), "siteLocation"),
    "complaintDescription" = COALESCE(sqlc.narg(complaint_description), "complaintDescription"),
    "rootCauseRemarks" = COALESCE(sqlc.narg(root_cause_remarks), "rootCauseRemarks"),
    "resolutionStatus" = COALESCE(sqlc.narg(resolution_status), "resolutionStatus"),
    "resolutionDate" = COALESCE(sqlc.narg(resolution_date), "resolutionDate"),
    "responsibleStage" = COALESCE(sqlc.narg(responsible_stage), "responsibleStage"),
    "updatedAt" = NOW()
WHERE "complaintId" = sqlc.arg(complaint_id)
RETURNING *;

-- name: CountComplaints :one
SELECT COUNT(*)::bigint AS count FROM "Complaint";

-- name: CountComplaintsByStatus :one
SELECT COUNT(*)::bigint AS count
FROM "Complaint"
WHERE "resolutionStatus" = sqlc.arg(resolution_status);

-- name: CountComplaintPhotos :one
SELECT COUNT(*)::bigint AS count FROM "ComplaintPhoto";

-- name: GetLatestComplaintIDByPrefix :one
SELECT "complaintId"
FROM "Complaint"
WHERE "complaintId" LIKE sqlc.arg(prefix) || '%'
ORDER BY "complaintId" DESC
LIMIT 1;

-- name: CreateComplaintBatchLine :one
INSERT INTO "ComplaintBatchLine" (id, "complaintId", "batchNumber", "createdAt")
VALUES (sqlc.arg(id), sqlc.arg(complaint_id), sqlc.arg(batch_number), NOW())
RETURNING *;

-- name: DeleteComplaintBatchLinesByComplaint :exec
DELETE FROM "ComplaintBatchLine"
WHERE "complaintId" = sqlc.arg(complaint_id);

-- name: ListComplaintBatchLinesByComplaint :many
SELECT *
FROM "ComplaintBatchLine"
WHERE "complaintId" = sqlc.arg(complaint_id)
ORDER BY "createdAt" ASC;

-- name: CreateComplaintPhoto :one
INSERT INTO "ComplaintPhoto" (
    id,
    "complaintId",
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
    sqlc.arg(complaint_id),
    sqlc.arg(filename),
    sqlc.arg(original_name),
    sqlc.arg(mimetype),
    sqlc.arg(size),
    sqlc.arg(storage_path),
    sqlc.narg(uploaded_by_id),
    NOW()
)
RETURNING *;

-- name: GetComplaintPhotoByID :one
SELECT *
FROM "ComplaintPhoto"
WHERE id = sqlc.arg(id);

-- name: ListComplaintPhotosByComplaintID :many
SELECT *
FROM "ComplaintPhoto"
WHERE "complaintId" = sqlc.arg(complaint_id)
ORDER BY "createdAt" ASC;

-- name: CountComplaintPhotosByComplaintID :one
SELECT COUNT(*)::bigint AS count
FROM "ComplaintPhoto"
WHERE "complaintId" = sqlc.arg(complaint_id);
