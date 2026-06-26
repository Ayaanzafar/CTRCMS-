-- name: ListUsers :many
SELECT
    u.id,
    u.email,
    u."fullName",
    u."isActive",
    u."createdAt",
    r.code AS role_code,
    r.name AS role_name
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
ORDER BY u."fullName" ASC;

-- name: GetUserPublicByID :one
SELECT
    u.id,
    u.email,
    u."fullName",
    u."isActive",
    u."createdAt",
    r.code AS role_code,
    r.name AS role_name
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE u.id = sqlc.arg(id);

-- name: GetUserWithRoleByID :one
SELECT
    u.id,
    u.email,
    u."fullName",
    u."isActive",
    u."roleId",
    r.code AS role_code
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE u.id = sqlc.arg(id);

-- name: FindUserIDByEmailExcluding :one
SELECT id
FROM "User"
WHERE LOWER(email) = LOWER(sqlc.arg(email))
  AND id != sqlc.arg(exclude_id);

-- name: CountActiveAdminsExcept :one
SELECT COUNT(*)::bigint AS count
FROM "User" u
INNER JOIN "Role" r ON r.id = u."roleId"
WHERE u."isActive" = true
  AND r.code = 'ADMIN'
  AND u.id != sqlc.arg(exclude_id);

-- name: CreateUser :one
INSERT INTO "User" (
    id,
    email,
    "passwordHash",
    "fullName",
    "roleId",
    "createdAt",
    "updatedAt"
)
VALUES (
    sqlc.arg(id),
    LOWER(sqlc.arg(email)),
    sqlc.arg(password_hash),
    sqlc.arg(full_name),
    sqlc.arg(role_id),
    NOW(),
    NOW()
)
RETURNING id, email, "fullName", "isActive", "createdAt", "roleId";

-- name: UpdateUser :one
UPDATE "User"
SET
    email = COALESCE(sqlc.narg(email), email),
    "fullName" = COALESCE(sqlc.narg(full_name), "fullName"),
    "isActive" = COALESCE(sqlc.narg(is_active), "isActive"),
    "roleId" = COALESCE(sqlc.narg(role_id), "roleId"),
    "passwordHash" = COALESCE(sqlc.narg(password_hash), "passwordHash"),
    "updatedAt" = NOW()
WHERE id = sqlc.arg(id)
RETURNING id, email, "fullName", "isActive", "createdAt", "roleId";
