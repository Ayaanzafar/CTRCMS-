-- name: Ping :one
SELECT 1::int AS val;

-- name: CountUsers :one
SELECT COUNT(*)::bigint AS count FROM "User";

-- name: CountRoles :one
SELECT COUNT(*)::bigint AS count FROM "Role";

-- name: GetUserByEmail :one
SELECT
    u.id,
    u.email,
    u."passwordHash",
    u."fullName",
    u."isActive",
    u."roleId",
    r.code AS role_code,
    r.name AS role_name
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE LOWER(u.email) = LOWER(sqlc.arg(email));

-- name: GetUserByID :one
SELECT
    u.id,
    u.email,
    u."passwordHash",
    u."fullName",
    u."isActive",
    u."roleId",
    r.code AS role_code,
    r.name AS role_name
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE u.id = sqlc.arg(id);

-- name: ListPermissionsByRoleID :many
SELECT module, access
FROM "RoleModulePermission"
WHERE "roleId" = sqlc.arg(role_id);

-- name: GetModulePermissionByRoleCode :one
SELECT p.access
FROM "RoleModulePermission" p
INNER JOIN "Role" r ON r.id = p."roleId"
WHERE r.code = sqlc.arg(role_code) AND p.module = sqlc.arg(module);

-- name: CreateAuditLog :one
INSERT INTO "AuditLog" (id, "userId", action, "entityType", "entityId")
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(action), sqlc.arg(entity_type), sqlc.arg(entity_id))
RETURNING id, "userId", action, "entityType", "entityId", "createdAt";
