-- name: CreateAuditLogWithValues :one
INSERT INTO "AuditLog" (
    id,
    "userId",
    action,
    "entityType",
    "entityId",
    "oldValues",
    "newValues"
)
VALUES (
    sqlc.arg(id),
    sqlc.arg(user_id),
    sqlc.arg(action),
    sqlc.arg(entity_type),
    sqlc.arg(entity_id),
    sqlc.arg(old_values),
    sqlc.arg(new_values)
)
RETURNING id;
