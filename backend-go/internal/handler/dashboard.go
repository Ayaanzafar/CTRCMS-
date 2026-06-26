package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/service"
)

type DashboardHandler struct {
	Queries *db.Queries
}

func (h *DashboardHandler) Overview(c echo.Context) error {
	overview, err := service.GetDashboardOverview(c.Request().Context(), h.Queries)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load dashboard overview"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"overview": overview})
}

func (h *DashboardHandler) AuditLogs(c echo.Context) error {
	limit := int32(50)
	offset := int32(0)
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = int32(n)
		}
	}
	if v := c.QueryParam("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			offset = int32(n)
		}
	}
	entityType := strings.TrimSpace(c.QueryParam("entityType"))
	action := strings.TrimSpace(c.QueryParam("action"))

	result, err := service.ListAuditLogs(c.Request().Context(), h.Queries, limit, offset, entityType, action)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load audit logs"})
	}
	return c.JSON(http.StatusOK, result)
}

func (h *DashboardHandler) Notifications(c echo.Context) error {
	unreadOnly := c.QueryParam("unreadOnly") == "true"
	limit := int32(20)
	if v := c.QueryParam("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			limit = int32(n)
		}
	}

	result, err := service.ListNotifications(c.Request().Context(), h.Queries, unreadOnly, limit)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load notifications"})
	}
	return c.JSON(http.StatusOK, result)
}

type markNotificationsReadRequest struct {
	IDs []string `json:"ids"`
}

func (h *DashboardHandler) MarkNotificationsRead(c echo.Context) error {
	var req markNotificationsReadRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	unreadCount, err := service.MarkNotificationsRead(c.Request().Context(), h.Queries, req.IDs)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mark notifications read"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"unreadCount": unreadCount})
}

func (h *DashboardHandler) MarkNotificationRead(c echo.Context) error {
	id := c.Param("id")
	unreadCount, err := service.MarkNotificationRead(c.Request().Context(), h.Queries, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to mark notification read"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"unreadCount": unreadCount})
}
