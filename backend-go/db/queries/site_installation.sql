-- name: GetSiteInstallationByID :one
SELECT *
FROM "SiteInstallation"
WHERE id = sqlc.arg(id);

-- name: GetSiteInstallationByDispatchNote :one
SELECT *
FROM "SiteInstallation"
WHERE "dispatchNoteNumber" = sqlc.arg(dispatch_note_number);

-- name: CreateSiteInstallation :one
INSERT INTO "SiteInstallation" (
    id,
    "dispatchNoteNumber",
    "siteReceiptDate",
    "installationDate",
    "installerEpcPartner",
    "quantityInstalled",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(dispatch_note_number),
    sqlc.arg(site_receipt_date),
    sqlc.arg(installation_date),
    sqlc.arg(installer_epc_partner),
    sqlc.arg(quantity_installed),
    NOW(),
    NOW()
)
RETURNING *;

-- name: UpdateSiteInstallation :one
UPDATE "SiteInstallation"
SET
    "siteReceiptDate" = COALESCE(sqlc.narg(site_receipt_date), "siteReceiptDate"),
    "installationDate" = COALESCE(sqlc.narg(installation_date), "installationDate"),
    "installerEpcPartner" = COALESCE(sqlc.narg(installer_epc_partner), "installerEpcPartner"),
    "quantityInstalled" = COALESCE(sqlc.narg(quantity_installed), "quantityInstalled"),
    "updatedAt" = NOW()
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: CountSiteInstallations :one
SELECT COUNT(*)::bigint AS count FROM "SiteInstallation";

-- name: CountPendingDispatches :one
SELECT COUNT(*)::bigint AS count
FROM "SiteDispatch" sd
WHERE NOT EXISTS (
    SELECT 1 FROM "SiteInstallation" si WHERE si."dispatchNoteNumber" = sd."dispatchNoteNumber"
);

-- name: CountSiteInstallationPhotos :one
SELECT COUNT(*)::bigint AS count FROM "SiteInstallationPhoto";

-- name: SumQuantityInstalled :one
SELECT COALESCE(SUM("quantityInstalled"), 0)::numeric AS total
FROM "SiteInstallation";

-- name: CreateSiteInstallationPhoto :one
INSERT INTO "SiteInstallationPhoto" (
    id,
    "installationId",
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
    sqlc.arg(installation_id),
    sqlc.arg(filename),
    sqlc.arg(original_name),
    sqlc.arg(mimetype),
    sqlc.arg(size),
    sqlc.arg(storage_path),
    sqlc.narg(uploaded_by_id),
    NOW()
)
RETURNING *;

-- name: GetSiteInstallationPhotoByID :one
SELECT *
FROM "SiteInstallationPhoto"
WHERE id = sqlc.arg(id);

-- name: ListSiteInstallationPhotosByInstallationID :many
SELECT *
FROM "SiteInstallationPhoto"
WHERE "installationId" = sqlc.arg(installation_id)
ORDER BY "createdAt" ASC;

-- name: CountSiteInstallationPhotosByInstallationID :one
SELECT COUNT(*)::bigint AS count
FROM "SiteInstallationPhoto"
WHERE "installationId" = sqlc.arg(installation_id);
