package middleware

import (
	"net/http"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/auth"
	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/db"
)

const UserContextKey = "user"

type AuthUser struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	FullName string `json:"fullName"`
	RoleCode string `json:"roleCode"`
	RoleName string `json:"roleName"`
}

func Authenticate(cfg *config.Config, queries *db.Queries) echo.MiddlewareFunc {
	return func(next echo.HandlerFunc) echo.HandlerFunc {
		return func(c echo.Context) error {
			header := c.Request().Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Authentication required"})
			}

			token := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
			claims, err := auth.VerifyToken(token, cfg.JWTSecret)
			if err != nil {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or expired token"})
			}

			user, err := queries.GetUserByID(c.Request().Context(), claims.Sub)
			if err != nil || !user.IsActive {
				return c.JSON(http.StatusUnauthorized, map[string]string{"error": "Invalid or inactive user"})
			}

			c.Set(UserContextKey, AuthUser{
				ID:       user.ID,
				Email:    user.Email,
				FullName: user.FullName,
				RoleCode: user.RoleCode,
				RoleName: user.RoleName,
			})
			return next(c)
		}
	}
}

func GetUser(c echo.Context) (AuthUser, bool) {
	u, ok := c.Get(UserContextKey).(AuthUser)
	return u, ok
}
