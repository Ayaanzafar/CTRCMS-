package middleware

import (
	"net/http"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/db"
)

func RequireModuleAccess(queries *db.Queries, module constants.ModuleCode, minimum constants.ModuleAccess) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			user, ok := GetUser(c)
			if !ok {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			}

			perm, err := queries.GetModulePermissionByRoleCode(c.Request().Context(), db.GetModulePermissionByRoleCodeParams{
				RoleCode: user.RoleCode,
				Module:   string(module),
			})
			access := constants.AccessNone
			if err == nil {
				access = constants.ModuleAccess(perm)
			}

			if constants.AccessRank(access) < constants.AccessRank(minimum) {
				return c.JSON(http.StatusForbidden, map[string]interface{}{
					"error":    "Insufficient permissions for module: " + string(module),
					"required": minimum,
					"actual":   access,
				})
			}
			return next(c)
		}
	}
}

func RequireFullAccess(queries *db.Queries, module constants.ModuleCode) echo.MiddlewareFunc {
	return RequireModuleAccess(queries, module, constants.AccessFull)
}
