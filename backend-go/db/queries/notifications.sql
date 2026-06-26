-- name: CreateSystemNotification :one
INSERT INTO "SystemNotification" (
    id,
    type,
    title,
    message,
    "entityType",
    "entityId",
    "isRead",
    "createdAt"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(notification_type),
    sqlc.arg(title),
    sqlc.arg(message),
    sqlc.narg(entity_type),
    sqlc.narg(entity_id),
    false,
    NOW()
)
RETURNING id;
