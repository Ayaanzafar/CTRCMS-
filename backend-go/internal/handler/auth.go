package handler

import (
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	"github.com/sunrack/ctrcms-go/internal/auth"
	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
)

type AuthHandler struct {
	Cfg     *config.Config
	Queries *db.Queries
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (h *AuthHandler) Login(c echo.Context) error {
	var req loginRequest
	if err := c.Bind(&req); err != nil || req.Email == "" || req.Password == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email or password format"})
	}

	user, err := h.Queries.GetUserByEmail(c.Request().Context(), strings.TrimSpace(req.Email))
	if err != nil || !user.IsActive {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid credentials"})
	}

	perms, err := h.Queries.ListPermissionsByRoleID(c.Request().Context(), user.RoleId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load permissions"})
	}

	permissions := permissionsMap(perms)
	accessibleModules := accessibleModulesFromPermissions(permissions)

	token, err := auth.SignToken(user.ID, user.RoleCode, h.Cfg.JWTSecret, h.Cfg.JWTExpiresIn)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to issue token"})
	}

	_, _ = h.Queries.CreateAuditLog(c.Request().Context(), db.CreateAuditLogParams{
		ID:         uuid.New().String(),
		UserID:     user.ID,
		Action:     "LOGIN",
		EntityType: pgtype.Text{String: "User", Valid: true},
		EntityID:   pgtype.Text{String: user.ID, Valid: true},
	})

	return c.JSON(http.StatusOK, map[string]interface{}{
		"token": token,
		"user": map[string]interface{}{
			"id":                user.ID,
			"email":             user.Email,
			"fullName":          user.FullName,
			"role":              map[string]string{"code": user.RoleCode, "name": user.RoleName},
			"permissions":       permissions,
			"accessibleModules": accessibleModules,
		},
	})
}

func (h *AuthHandler) Me(c echo.Context) error {
	authUser, ok := middleware.GetUser(c)
	if !ok {
		return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
	}

	user, err := h.Queries.GetUserByID(c.Request().Context(), authUser.ID)
	if err != nil {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
	}

	perms, err := h.Queries.ListPermissionsByRoleID(c.Request().Context(), user.RoleId)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load permissions"})
	}

	permissions := permissionsMap(perms)
	accessibleModules := accessibleModulesFromPermissions(permissions)

	return c.JSON(http.StatusOK, map[string]interface{}{
		"id":                user.ID,
		"email":             user.Email,
		"fullName":          user.FullName,
		"role":              map[string]string{"code": user.RoleCode, "name": user.RoleName},
		"permissions":       permissions,
		"accessibleModules": accessibleModules,
	})
}

func (h *AuthHandler) Logout(c echo.Context) error {
	authUser, ok := middleware.GetUser(c)
	if ok {
		_, _ = h.Queries.CreateAuditLog(c.Request().Context(), db.CreateAuditLogParams{
			ID:         uuid.New().String(),
			UserID:     authUser.ID,
			Action:     "LOGOUT",
			EntityType: pgtype.Text{String: "User", Valid: true},
			EntityID:   pgtype.Text{String: authUser.ID, Valid: true},
		})
	}
	return c.JSON(http.StatusOK, map[string]string{"message": "Logged out successfully"})
}

func permissionsMap(rows []db.ListPermissionsByRoleIDRow) map[string]string {
	out := make(map[string]string, len(rows))
	for _, r := range rows {
		out[r.Module] = string(r.Access)
	}
	return out
}

func accessibleModulesFromPermissions(permissions map[string]string) []constants.ModuleDefinition {
	var mods []constants.ModuleDefinition
	for _, def := range constants.ModuleDefinitions {
		access, ok := permissions[string(def.Code)]
		if ok && access != string(constants.AccessNone) {
			mods = append(mods, def)
		}
	}
	if mods == nil {
		mods = []constants.ModuleDefinition{}
	}
	return mods
}
