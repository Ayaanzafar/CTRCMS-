-- name: ListRoles :many
SELECT
    r.id,
    r.code,
    r.name,
    r.description,
    COUNT(u.id)::bigint AS user_count
FROM "Role" r
LEFT JOIN "User" u ON u."roleId" = r.id
GROUP BY r.id, r.code, r.name, r.description
ORDER BY r.name ASC;

-- name: GetRoleByCode :one
SELECT id, code, name, description
FROM "Role"
WHERE code = sqlc.arg(code);

-- name: ListAllRolePermissions :many
SELECT "roleId", module, access
FROM "RoleModulePermission"
ORDER BY "roleId", module;

-- name: ListPermissionsByRoleCode :many
SELECT p.module, p.access
FROM "RoleModulePermission" p
INNER JOIN "Role" r ON r.id = p."roleId"
WHERE r.code = sqlc.arg(code)
ORDER BY p.module;

-- name: UpsertRoleModulePermission :exec
INSERT INTO "RoleModulePermission" (id, "roleId", module, access)
VALUES (sqlc.arg(id), sqlc.arg(role_id), sqlc.arg(module), sqlc.arg(access))
ON CONFLICT ("roleId", module)
DO UPDATE SET access = EXCLUDED.access;
