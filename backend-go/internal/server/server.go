package server

import (
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"github.com/labstack/echo/v4/middleware"

	"github.com/sunrack/ctrcms-go/internal/config"
	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/handler"
	mw "github.com/sunrack/ctrcms-go/internal/middleware"
)

type Server struct {
	Echo *echo.Echo
}

func New(cfg *config.Config, pool *pgxpool.Pool, queries *db.Queries) *Server {
	e := echo.New()
	e.HideBanner = true
	e.HidePort = true

	e.Use(middleware.Recover())
	e.Use(middleware.Logger())
	e.Use(middleware.CORSWithConfig(middleware.CORSConfig{
		AllowOrigins: []string{cfg.CORSOrigin},
		AllowHeaders: []string{echo.HeaderOrigin, echo.HeaderContentType, echo.HeaderAccept, echo.HeaderAuthorization},
	}))

	root := &handler.RootHandler{}
	health := &handler.HealthHandler{Queries: queries, UploadDir: cfg.UploadDir}
	authHandler := &handler.AuthHandler{Cfg: cfg, Queries: queries}
	usersHandler := &handler.UsersHandler{Queries: queries, Pool: pool}
	rolesHandler := &handler.RolesHandler{Queries: queries, Pool: pool}
	coilsHandler := &handler.CoilsHandler{
		Queries:          queries,
		Pool:             pool,
		UploadDir:        cfg.UploadDir,
		MaxFileSizeBytes: cfg.MaxFileSizeBytes,
		AllowedMimeTypes: cfg.AllowedMimeTypes,
	}
	authenticate := mw.Authenticate(cfg, queries)

	e.GET("/", root.Index)
	e.GET("/api/health", health.Check)

	authGroup := e.Group("/api/auth")
	authGroup.POST("/login", authHandler.Login)
	authGroup.GET("/me", authHandler.Me, authenticate)
	authGroup.POST("/logout", authHandler.Logout, authenticate)

	usersGroup := e.Group("/api/users", authenticate)
	usersGroup.GET("", usersHandler.List, mw.RequireModuleAccess(queries, constants.ModuleUsersRoles, constants.AccessRead))
	usersGroup.GET("/:id", usersHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleUsersRoles, constants.AccessRead))
	usersGroup.POST("", usersHandler.Create, mw.RequireFullAccess(queries, constants.ModuleUsersRoles))
	usersGroup.PUT("/:id", usersHandler.Update, mw.RequireFullAccess(queries, constants.ModuleUsersRoles))
	usersGroup.PATCH("/:id/deactivate", usersHandler.Deactivate, mw.RequireFullAccess(queries, constants.ModuleUsersRoles))

	rolesGroup := e.Group("/api/roles", authenticate)
	rolesGroup.GET("/modules", rolesHandler.ListModules, mw.RequireModuleAccess(queries, constants.ModuleUsersRoles, constants.AccessRead))
	rolesGroup.GET("", rolesHandler.List, mw.RequireModuleAccess(queries, constants.ModuleUsersRoles, constants.AccessRead))
	rolesGroup.GET("/:code/permissions", rolesHandler.GetPermissions, mw.RequireModuleAccess(queries, constants.ModuleUsersRoles, constants.AccessRead))
	rolesGroup.PUT("/:code/permissions", rolesHandler.UpdatePermissions, mw.RequireFullAccess(queries, constants.ModuleUsersRoles))
	rolesGroup.POST("/:code/permissions/reset", rolesHandler.ResetPermissions, mw.RequireFullAccess(queries, constants.ModuleUsersRoles))

	coilsGroup := e.Group("/api/coils", authenticate)
	coilsGroup.GET("/documents/:documentId/file", coilsHandler.ServeDocument, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.DELETE("/documents/:documentId", coilsHandler.DeleteDocument, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessWrite))
	coilsGroup.GET("", coilsHandler.List, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.GET("/stats", coilsHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.GET("/:coilNumber/audit-logs", coilsHandler.AuditLogs, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.GET("/:coilNumber/usage", coilsHandler.Usage, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.GET("/:coilNumber", coilsHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessRead))
	coilsGroup.POST("", coilsHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessWrite))
	coilsGroup.PUT("/:coilNumber", coilsHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessWrite))
	coilsGroup.PATCH("/:coilNumber/archive", coilsHandler.Archive, mw.RequireFullAccess(queries, constants.ModuleCoilMaster))
	coilsGroup.DELETE("/:coilNumber", coilsHandler.Delete, mw.RequireFullAccess(queries, constants.ModuleCoilMaster))
	coilsGroup.POST("/:coilNumber/documents", coilsHandler.AttachDocument, mw.RequireModuleAccess(queries, constants.ModuleCoilMaster, constants.AccessWrite))

	slittingHandler := &handler.SlittingHandler{Queries: queries, Pool: pool}
	slittingGroup := e.Group("/api/slitting", authenticate)
	slittingGroup.GET("", slittingHandler.List, mw.RequireModuleAccess(queries, constants.ModuleSlitting, constants.AccessRead))
	slittingGroup.GET("/preview-ids", slittingHandler.PreviewIDs, mw.RequireModuleAccess(queries, constants.ModuleSlitting, constants.AccessWrite))
	slittingGroup.POST("/batch", slittingHandler.CreateBatch, mw.RequireModuleAccess(queries, constants.ModuleSlitting, constants.AccessWrite))
	slittingGroup.GET("/:slitCoilId", slittingHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleSlitting, constants.AccessRead))
	slittingGroup.PUT("/:slitCoilId", slittingHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleSlitting, constants.AccessWrite))

	sunrackHandler := &handler.SunrackReceiptHandler{
		Queries:          queries,
		Pool:             pool,
		UploadDir:        cfg.UploadDir,
		MaxFileSizeBytes: cfg.MaxFileSizeBytes,
		AllowedMimeTypes: cfg.AllowedMimeTypes,
	}
	sunrackGroup := e.Group("/api/sunrack-receipts", authenticate)
	sunrackGroup.GET("/stats", sunrackHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.GET("/pending", sunrackHandler.Pending, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.GET("/by-slit/:slitCoilId", sunrackHandler.GetBySlitCoil, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.GET("/photos/:photoId/file", sunrackHandler.ServePhoto, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.GET("", sunrackHandler.List, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.POST("", sunrackHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessWrite))
	sunrackGroup.GET("/:id", sunrackHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessRead))
	sunrackGroup.PUT("/:id", sunrackHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessWrite))
	sunrackGroup.POST("/:id/photos", sunrackHandler.AttachPhotos, mw.RequireModuleAccess(queries, constants.ModuleSunrackReceipt, constants.AccessWrite))

	productionHandler := &handler.ProductionHandler{Queries: queries, Pool: pool}
	productionGroup := e.Group("/api/production", authenticate)
	productionGroup.GET("/stats", productionHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessRead))
	productionGroup.GET("/available-slit-coils", productionHandler.AvailableSlitCoils, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessRead))
	productionGroup.GET("/preview-batch-number", productionHandler.PreviewBatchNumber, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessWrite))
	productionGroup.GET("/slit-coil/:slitCoilId/usage", productionHandler.SlitCoilUsage, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessRead))
	productionGroup.GET("", productionHandler.List, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessRead))
	productionGroup.POST("", productionHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessWrite))
	productionGroup.GET("/:batchNumber", productionHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessRead))
	productionGroup.POST("/:batchNumber/issue", productionHandler.Issue, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessWrite))
	productionGroup.PUT("/:batchNumber", productionHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleProduction, constants.AccessWrite))

	qcHandler := &handler.QcHandler{
		Queries:          queries,
		Pool:             pool,
		UploadDir:        cfg.UploadDir,
		MaxFileSizeBytes: cfg.MaxFileSizeBytes,
		AllowedMimeTypes: cfg.AllowedMimeTypes,
	}
	qcGroup := e.Group("/api/qc", authenticate)
	qcGroup.GET("/stats", qcHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.GET("/pending-batches", qcHandler.PendingBatches, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.GET("/dispatch-eligible-batches", qcHandler.DispatchEligibleBatches, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessRead))
	qcGroup.GET("/photos/:photoId/file", qcHandler.ServePhoto, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.GET("/batch/:batchNumber", qcHandler.GetByBatch, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.GET("", qcHandler.List, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.GET("/:id", qcHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessRead))
	qcGroup.POST("", qcHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessWrite))
	qcGroup.PUT("/:id", qcHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessWrite))
	qcGroup.POST("/:id/photos", qcHandler.AttachPhotos, mw.RequireModuleAccess(queries, constants.ModuleQCInspection, constants.AccessWrite))

	finishedGoodsHandler := &handler.FinishedGoodsHandler{Queries: queries, Pool: pool}
	finishedGoodsGroup := e.Group("/api/finished-goods", authenticate)
	finishedGoodsGroup.GET("/stats", finishedGoodsHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleFinishedGoods, constants.AccessRead))
	finishedGoodsGroup.GET("", finishedGoodsHandler.List, mw.RequireModuleAccess(queries, constants.ModuleFinishedGoods, constants.AccessRead))
	finishedGoodsGroup.GET("/:batchNumber", finishedGoodsHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleFinishedGoods, constants.AccessRead))

	dispatchHandler := &handler.DispatchHandler{Queries: queries, Pool: pool}
	dispatchGroup := e.Group("/api/dispatch", authenticate)
	dispatchGroup.GET("/stats", dispatchHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessRead))
	dispatchGroup.GET("/preview-dispatch-note", dispatchHandler.PreviewDispatchNote, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessWrite))
	dispatchGroup.GET("", dispatchHandler.List, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessRead))
	dispatchGroup.GET("/:dispatchNoteNumber", dispatchHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessRead))
	dispatchGroup.POST("", dispatchHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessWrite))
	dispatchGroup.PUT("/:dispatchNoteNumber", dispatchHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleDispatch, constants.AccessWrite))

	siteInstallationHandler := &handler.SiteInstallationHandler{
		Queries:          queries,
		Pool:             pool,
		UploadDir:        cfg.UploadDir,
		MaxFileSizeBytes: cfg.MaxFileSizeBytes,
		AllowedMimeTypes: cfg.AllowedMimeTypes,
	}
	siteGroup := e.Group("/api/site-installation", authenticate)
	siteGroup.GET("/stats", siteInstallationHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.GET("/pending-dispatches", siteInstallationHandler.PendingDispatches, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.GET("/photos/:photoId/file", siteInstallationHandler.ServePhoto, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.GET("/by-dispatch/:dispatchNoteNumber", siteInstallationHandler.GetByDispatch, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.GET("", siteInstallationHandler.List, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.GET("/:id", siteInstallationHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessRead))
	siteGroup.POST("", siteInstallationHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessWrite))
	siteGroup.PUT("/:id", siteInstallationHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessWrite))
	siteGroup.POST("/:id/photos", siteInstallationHandler.AttachPhotos, mw.RequireModuleAccess(queries, constants.ModuleSiteInstallation, constants.AccessWrite))

	complaintHandler := &handler.ComplaintHandler{
		Queries:          queries,
		Pool:             pool,
		UploadDir:        cfg.UploadDir,
		MaxFileSizeBytes: cfg.MaxFileSizeBytes,
		AllowedMimeTypes: cfg.AllowedMimeTypes,
	}
	complaintGroup := e.Group("/api/complaints", authenticate)
	complaintGroup.GET("/stats", complaintHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.GET("/eligible-batches", complaintHandler.EligibleBatches, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.POST("/resolve-trace", complaintHandler.ResolveTrace, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.GET("/preview-complaint-id", complaintHandler.PreviewComplaintID, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessWrite))
	complaintGroup.GET("/photos/:photoId/file", complaintHandler.ServePhoto, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.GET("", complaintHandler.List, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.GET("/:complaintId", complaintHandler.Get, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessRead))
	complaintGroup.POST("", complaintHandler.Create, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessWrite))
	complaintGroup.PUT("/:complaintId", complaintHandler.Update, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessWrite))
	complaintGroup.POST("/:complaintId/photos", complaintHandler.AttachPhotos, mw.RequireModuleAccess(queries, constants.ModuleComplaint, constants.AccessWrite))

	traceabilityHandler := &handler.TraceabilityHandler{Queries: queries}
	traceabilityGroup := e.Group("/api/traceability", authenticate)
	traceabilityGroup.GET("/search", traceabilityHandler.Search, mw.RequireModuleAccess(queries, constants.ModuleTraceability, constants.AccessRead))
	traceabilityGroup.GET("/timeline", traceabilityHandler.Timeline, mw.RequireModuleAccess(queries, constants.ModuleTraceability, constants.AccessRead))
	traceabilityGroup.GET("/export/pdf", traceabilityHandler.ExportPDF, mw.RequireModuleAccess(queries, constants.ModuleTraceability, constants.AccessRead))

	dashboardHandler := &handler.DashboardHandler{Queries: queries}
	dashboardGroup := e.Group("/api/dashboard", authenticate)
	dashboardGroup.GET("/overview", dashboardHandler.Overview, mw.RequireModuleAccess(queries, constants.ModuleDashboard, constants.AccessRead))
	dashboardGroup.GET("/audit-logs", dashboardHandler.AuditLogs, mw.RequireModuleAccess(queries, constants.ModuleDashboard, constants.AccessRead))
	dashboardGroup.GET("/notifications", dashboardHandler.Notifications, mw.RequireModuleAccess(queries, constants.ModuleDashboard, constants.AccessRead))
	dashboardGroup.PATCH("/notifications/read", dashboardHandler.MarkNotificationsRead, mw.RequireModuleAccess(queries, constants.ModuleDashboard, constants.AccessRead))
	dashboardGroup.PATCH("/notifications/:id/read", dashboardHandler.MarkNotificationRead, mw.RequireModuleAccess(queries, constants.ModuleDashboard, constants.AccessRead))

	documentsHandler := &handler.DocumentsHandler{Queries: queries}
	documentsGroup := e.Group("/api/documents", authenticate)
	documentsGroup.GET("/stats", documentsHandler.Stats, mw.RequireModuleAccess(queries, constants.ModuleDocuments, constants.AccessRead))
	documentsGroup.GET("/by-reference", documentsHandler.ByReference, mw.RequireModuleAccess(queries, constants.ModuleDocuments, constants.AccessRead))
	documentsGroup.GET("", documentsHandler.List, mw.RequireModuleAccess(queries, constants.ModuleDocuments, constants.AccessRead))

	e.HTTPErrorHandler = func(err error, c echo.Context) {
		if c.Response().Committed {
			return
		}
		if he, ok := err.(*echo.HTTPError); ok {
			_ = c.JSON(he.Code, map[string]string{"error": formatHTTPError(he)})
			return
		}
		_ = c.JSON(http.StatusInternalServerError, map[string]string{"error": "Internal server error"})
	}

	return &Server{Echo: e}
}

func formatHTTPError(he *echo.HTTPError) string {
	if msg, ok := he.Message.(string); ok {
		return msg
	}
	return http.StatusText(he.Code)
}
