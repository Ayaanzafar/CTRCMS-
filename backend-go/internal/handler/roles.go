package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
)

type RolesHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

type updatePermissionsRequest struct {
	Permissions map[string]string `json:"permissions"`
}

func (h *RolesHandler) ListModules(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"modules": constants.ModuleDefinitions,
	})
}

func (h *RolesHandler) List(c echo.Context) error {
	ctx := c.Request().Context()
	roles, err := h.Queries.ListRoles(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list roles"})
	}

	perms, err := h.Queries.ListAllRolePermissions(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load permissions"})
	}

	permsByRole := make(map[string][]map[string]string)
	for _, p := range perms {
		permsByRole[p.RoleId] = append(permsByRole[p.RoleId], map[string]string{
			"module": p.Module,
			"access": string(p.Access),
		})
	}

	out := make([]map[string]interface{}, 0, len(roles))
	for _, r := range roles {
		desc := ""
		if r.Description.Valid {
			desc = r.Description.String
		}
		rolePerms := permsByRole[r.ID]
		if rolePerms == nil {
			rolePerms = []map[string]string{}
		}
		out = append(out, map[string]interface{}{
			"id":          r.ID,
			"code":        r.Code,
			"name":        r.Name,
			"description": desc,
			"_count":      map[string]int64{"users": r.UserCount},
			"permissions": rolePerms,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"roles":       out,
		"definitions": constants.RoleDefinitions,
	})
}

func (h *RolesHandler) GetPermissions(c echo.Context) error {
	code := c.Param("code")
	ctx := c.Request().Context()

	role, err := h.Queries.GetRoleByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Role not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load role"})
	}

	rows, err := h.Queries.ListPermissionsByRoleCode(ctx, code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load permissions"})
	}

	permissions := make(map[string]string, len(rows))
	for _, row := range rows {
		permissions[row.Module] = string(row.Access)
	}

	desc := ""
	if role.Description.Valid {
		desc = role.Description.String
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"role": map[string]interface{}{
			"id":          role.ID,
			"code":        role.Code,
			"name":        role.Name,
			"description": desc,
			"permissions": permissions,
		},
		"modulesByPhase": groupModulesByPhase(),
	})
}

func (h *RolesHandler) UpdatePermissions(c echo.Context) error {
	code := c.Param("code")
	var req updatePermissionsRequest
	if err := c.Bind(&req); err != nil || req.Permissions == nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid permissions payload"})
	}
	return h.updatePermissionsWithMap(c, code, req.Permissions)
}

func (h *RolesHandler) ResetPermissions(c echo.Context) error {
	code := c.Param("code")
	if code == string(constants.RoleAdmin) {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Admin role permissions are fixed at FULL"})
	}

	defaults, ok := constants.DefaultRolePermissions[constants.RoleCode(code)]
	if !ok {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "Role not found"})
	}

	perms := make(map[string]string, len(defaults))
	for mod, access := range defaults {
		perms[string(mod)] = string(access)
	}

	return h.updatePermissionsWithMap(c, code, perms)
}

func (h *RolesHandler) updatePermissionsWithMap(c echo.Context, code string, incoming map[string]string) error {
	if code == string(constants.RoleAdmin) {
		return c.JSON(http.StatusBadRequest, map[string]string{
			"error": "Admin role always has FULL access on all modules and cannot be modified",
		})
	}

	validModules := make(map[string]struct{}, len(constants.AllModules))
	for _, m := range constants.AllModules {
		validModules[string(m)] = struct{}{}
	}
	for key, val := range incoming {
		if _, ok := validModules[key]; !ok {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Unknown module: " + key})
		}
		if !isValidAccess(val) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid access level: " + val})
		}
	}

	ctx := c.Request().Context()
	role, err := h.Queries.GetRoleByCode(ctx, code)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "Role not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load role"})
	}

	oldRows, _ := h.Queries.ListPermissionsByRoleCode(ctx, code)
	oldPermissions := make(map[string]string, len(oldRows))
	for _, row := range oldRows {
		oldPermissions[row.Module] = string(row.Access)
	}

	tx, err := h.Pool.Begin(ctx)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to start transaction"})
	}
	defer tx.Rollback(ctx)

	qtx := h.Queries.WithTx(tx)
	for _, moduleCode := range constants.AllModules {
		access := incoming[string(moduleCode)]
		if access == "" {
			access = string(constants.AccessNone)
		}
		if err := qtx.UpsertRoleModulePermission(ctx, db.UpsertRoleModulePermissionParams{
			ID:     uuid.New().String(),
			RoleID: role.ID,
			Module: string(moduleCode),
			Access: db.ModuleAccess(access),
		}); err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update permissions"})
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to commit permissions"})
	}

	updatedRows, err := h.Queries.ListPermissionsByRoleCode(ctx, code)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load updated permissions"})
	}
	permissions := make(map[string]string, len(updatedRows))
	for _, row := range updatedRows {
		permissions[row.Module] = string(row.Access)
	}

	if authUser, ok := middleware.GetUser(c); ok {
		oldJSON, _ := json.Marshal(oldPermissions)
		newJSON, _ := json.Marshal(incoming)
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     authUser.ID,
			Action:     "UPDATE",
			EntityType: textPtr("RolePermissions"),
			EntityID:   textPtr(role.Code),
			OldValues:  oldJSON,
			NewValues:  newJSON,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"role": map[string]interface{}{
			"code":        role.Code,
			"name":        role.Name,
			"permissions": permissions,
		},
	})
}

func groupModulesByPhase() []map[string]interface{} {
	groups := make(map[int][]constants.ModuleDefinition)
	for _, mod := range constants.ModuleDefinitions {
		groups[mod.Phase] = append(groups[mod.Phase], mod)
	}
	phases := make([]int, 0, len(groups))
	for phase := range groups {
		phases = append(phases, phase)
	}
	sort.Ints(phases)

	out := make([]map[string]interface{}, 0, len(phases))
	for _, phase := range phases {
		out = append(out, map[string]interface{}{
			"phase":   phase,
			"modules": groups[phase],
		})
	}
	return out
}

func isValidAccess(level string) bool {
	switch constants.ModuleAccess(level) {
	case constants.AccessNone, constants.AccessRead, constants.AccessWrite, constants.AccessFull:
		return true
	default:
		return false
	}
}
