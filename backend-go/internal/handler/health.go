package handler

import (
	"net/http"
	"time"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/db"
)

type RootHandler struct{}

func (h *RootHandler) Index(c echo.Context) error {
	return c.JSON(http.StatusOK, map[string]interface{}{
		"name":        "CTRCMS API",
		"version":     "0.1.0",
		"phase":       "complete",
		"description": "Coil Traceability & Rust Complaint Management System",
		"runtime":     "go",
	})
}

type HealthHandler struct {
	Queries   *db.Queries
	UploadDir string
}

func (h *HealthHandler) Check(c echo.Context) error {
	if _, err := h.Queries.Ping(c.Request().Context()); err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]interface{}{
			"status":   "error",
			"database": "disconnected",
			"message":  err.Error(),
		})
	}

	if _, err := config.EnsureUploadDirectories(h.UploadDir); err != nil {
		return c.JSON(http.StatusServiceUnavailable, map[string]interface{}{
			"status":  "error",
			"storage": "unavailable",
			"message": err.Error(),
		})
	}

	users, _ := h.Queries.CountUsers(c.Request().Context())
	roles, _ := h.Queries.CountRoles(c.Request().Context())

	return c.JSON(http.StatusOK, map[string]interface{}{
		"status":    "ok",
		"database":  "connected",
		"storage":   "ready",
		"tables":    map[string]int64{"users": users, "roles": roles},
		"timestamp": time.Now().UTC().Format(time.RFC3339),
	})
}
