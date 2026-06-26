package service

import (
	"context"
	"encoding/json"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/sunrack/ctrcms-go/internal/db"
)

var rootCauseLabels = map[string]string{
	"AMNS":               "Supplied material (AMNS)",
	"SLITTER":            "Slitter processing",
	"SUNRACK_PRODUCTION": "Sunrack production / forming flash",
	"TRANSPORT":          "Transport / logistics",
	"SITE_HANDLING":      "Site handling damage",
}

type DashboardOverview struct {
	KPIs                map[string]interface{}   `json:"kpis"`
	RootCauseBreakdown  []map[string]interface{} `json:"rootCauseBreakdown"`
	RecentDispatches    []map[string]interface{} `json:"recentDispatches"`
	PendingQcBatches    []map[string]interface{} `json:"pendingQcBatches"`
	OpenComplaints      []map[string]interface{} `json:"openComplaints"`
}

type AuditLogsResult struct {
	Logs   []map[string]interface{} `json:"logs"`
	Total  int64                    `json:"total"`
	Limit  int32                    `json:"limit"`
	Offset int32                    `json:"offset"`
}

type NotificationsResult struct {
	Notifications []db.SystemNotification `json:"notifications"`
	UnreadCount   int64                   `json:"unreadCount"`
}

func GetDashboardOverview(ctx context.Context, queries *db.Queries) (DashboardOverview, error) {
	thirtyDaysAgo := time.Now().UTC().AddDate(0, 0, -30)
	sinceDate := pgtype.Timestamp{Time: thirtyDaysAgo, Valid: true}

	totalCoils, err := queries.CountAllCoils(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	totalComplaints, err := queries.CountComplaints(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	openComplaints, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusOPEN)
	if err != nil {
		return DashboardOverview{}, err
	}
	underInvestigation, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusUNDERINVESTIGATION)
	if err != nil {
		return DashboardOverview{}, err
	}
	closedComplaints, err := queries.CountComplaintsByStatus(ctx, db.ResolutionStatusCLOSED)
	if err != nil {
		return DashboardOverview{}, err
	}
	batchesPendingQc, err := queries.CountBatchesWithNoQc(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	totalDispatches, err := queries.CountSiteDispatches(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	recentDispatchCount, err := queries.CountRecentSiteDispatches(ctx, sinceDate)
	if err != nil {
		return DashboardOverview{}, err
	}
	pendingSiteDispatches, err := queries.CountPendingSiteDispatches(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	totalInstallations, err := queries.CountSiteInstallations(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	unreadNotifications, err := queries.CountUnreadNotifications(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	undeterminedComplaints, err := queries.CountComplaintsWithUndeterminedStage(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	productionBatchCount, err := queries.CountProductionBatches(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}

	stageGroups, err := queries.GroupComplaintsByResponsibleStage(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}
	recentDispatches, err := queries.ListRecentDispatchesForDashboard(ctx, 6)
	if err != nil {
		return DashboardOverview{}, err
	}
	pendingQcBatches, err := queries.ListPendingQcBatchesForDashboard(ctx, 8)
	if err != nil {
		return DashboardOverview{}, err
	}
	openComplaintRows, err := queries.ListOpenComplaintsForDashboard(ctx, 8)
	if err != nil {
		return DashboardOverview{}, err
	}

	allBatches, err := queries.ListProductionBatchesForFgCalc(ctx)
	if err != nil {
		return DashboardOverview{}, err
	}

	var fgAvailableUnits float64
	var fgBatchCount int64
	for _, batch := range allBatches {
		latest, err := queries.GetLatestQcInspectionByBatch(ctx, batch.BatchNumber)
		if err != nil {
			continue
		}
		if latest.QcResult != db.QcResultPASS {
			continue
		}
		fgBatchCount++
		produced, err := numericFromPg(batch.QuantityProduced)
		if err != nil {
			continue
		}
		dispatched, err := GetBatchDispatchedQuantity(ctx, queries, batch.BatchNumber)
		if err != nil {
			continue
		}
		fgAvailableUnits += ComputeAvailableQuantity(produced, dispatched)
	}

	rootCauseBreakdown := make([]map[string]interface{}, 0, len(stageGroups)+1)
	type stageCount struct {
		stage string
		count int64
	}
	stageList := make([]stageCount, 0, len(stageGroups))
	for _, g := range stageGroups {
		stageList = append(stageList, stageCount{stage: g.ResponsibleStage, count: g.Count})
	}
	for i := 0; i < len(stageList); i++ {
		for j := i + 1; j < len(stageList); j++ {
			if stageList[j].count > stageList[i].count {
				stageList[i], stageList[j] = stageList[j], stageList[i]
			}
		}
	}
	for _, g := range stageList {
		label := rootCauseLabels[g.stage]
		if label == "" {
			label = g.stage
		}
		rootCauseBreakdown = append(rootCauseBreakdown, map[string]interface{}{
			"stage": g.stage,
			"label": label,
			"count": g.count,
		})
	}
	if undeterminedComplaints > 0 {
		rootCauseBreakdown = append(rootCauseBreakdown, map[string]interface{}{
			"stage": "UNDETERMINED",
			"label": "Not yet determined",
			"count": undeterminedComplaints,
		})
	}

	recentDispatchJSON := make([]map[string]interface{}, 0, len(recentDispatches))
	for _, d := range recentDispatches {
		totalQty, _ := numericFromPg(d.TotalQuantity)
		recentDispatchJSON = append(recentDispatchJSON, map[string]interface{}{
			"dispatchNoteNumber": d.DispatchNoteNumber,
			"dispatchDate":       timestampJSON(d.DispatchDate),
			"projectName":        d.ProjectName,
			"clientName":         d.ClientName,
			"siteLocation":       d.SiteLocation,
			"batchCount":         d.BatchCount,
			"totalQuantity":      totalQty,
			"siteInstalled":      d.SiteInstalled,
		})
	}

	pendingQcJSON := make([]map[string]interface{}, 0, len(pendingQcBatches))
	for _, b := range pendingQcBatches {
		qty, _ := numericFromPg(b.QuantityProduced)
		pendingQcJSON = append(pendingQcJSON, map[string]interface{}{
			"batchNumber":           b.BatchNumber,
			"productionOrderNumber": b.ProductionOrderNumber,
			"productType":           b.ProductType,
			"quantityProduced":      qty,
			"productionDate":        timestampJSON(b.ProductionDate),
		})
	}

	openComplaintsJSON := make([]map[string]interface{}, 0, len(openComplaintRows))
	for _, c := range openComplaintRows {
		var responsible interface{}
		if c.ResponsibleStage != "" {
			responsible = c.ResponsibleStage
		}
		openComplaintsJSON = append(openComplaintsJSON, map[string]interface{}{
			"complaintId":      c.ComplaintId,
			"complaintDate":    timestampJSON(c.ComplaintDate),
			"projectName":      c.ProjectName,
			"resolutionStatus": c.ResolutionStatus,
			"responsibleStage": responsible,
		})
	}

	return DashboardOverview{
		KPIs: map[string]interface{}{
			"totalCoils":            totalCoils,
			"productionBatches":     productionBatchCount,
			"batchesPendingQc":      batchesPendingQc,
			"fgAvailableUnits":      math.Round(fgAvailableUnits*1000) / 1000,
			"fgBatchCount":          fgBatchCount,
			"totalDispatches":       totalDispatches,
			"recentDispatches":      recentDispatchCount,
			"pendingSiteDispatches": pendingSiteDispatches,
			"totalInstallations":    totalInstallations,
			"totalComplaints":       totalComplaints,
			"openComplaints":        openComplaints,
			"underInvestigation":    underInvestigation,
			"closedComplaints":      closedComplaints,
			"unreadNotifications":   unreadNotifications,
		},
		RootCauseBreakdown: rootCauseBreakdown,
		RecentDispatches:   recentDispatchJSON,
		PendingQcBatches:   pendingQcJSON,
		OpenComplaints:     openComplaintsJSON,
	}, nil
}

func ListAuditLogs(ctx context.Context, queries *db.Queries, limit, offset int32, entityType, action string) (AuditLogsResult, error) {
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}

	var entityTypeParam, actionParam pgtype.Text
	if entityType != "" {
		entityTypeParam = pgtype.Text{String: entityType, Valid: true}
	}
	if action != "" {
		actionParam = pgtype.Text{String: action, Valid: true}
	}

	total, err := queries.CountAuditLogsFiltered(ctx, db.CountAuditLogsFilteredParams{
		EntityType:   entityTypeParam,
		ActionFilter: actionParam,
	})
	if err != nil {
		return AuditLogsResult{}, err
	}

	rows, err := queries.ListAuditLogsWithUser(ctx, db.ListAuditLogsWithUserParams{
		EntityType:   entityTypeParam,
		ActionFilter: actionParam,
		ResultLimit:  limit,
		ResultOffset: offset,
	})
	if err != nil {
		return AuditLogsResult{}, err
	}

	logs := make([]map[string]interface{}, 0, len(rows))
	for _, row := range rows {
		logs = append(logs, map[string]interface{}{
			"id":         row.ID,
			"action":     row.Action,
			"entityType": textOrNil(row.EntityType),
			"entityId":   textOrNil(row.EntityId),
			"oldValues":  jsonRawOrNil(row.OldValues),
			"newValues":  jsonRawOrNil(row.NewValues),
			"createdAt":  timestampJSON(row.CreatedAt),
			"user": map[string]interface{}{
				"fullName": row.FullName,
				"email":    row.Email,
				"role": map[string]interface{}{
					"name": row.RoleName,
				},
			},
		})
	}

	return AuditLogsResult{
		Logs:   logs,
		Total:  total,
		Limit:  limit,
		Offset: offset,
	}, nil
}

func ListNotifications(ctx context.Context, queries *db.Queries, unreadOnly bool, limit int32) (NotificationsResult, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 50 {
		limit = 50
	}

	notifications, err := queries.ListSystemNotifications(ctx, db.ListSystemNotificationsParams{
		UnreadOnly:  unreadOnly,
		ResultLimit: limit,
	})
	if err != nil {
		return NotificationsResult{}, err
	}
	unreadCount, err := queries.CountUnreadNotifications(ctx)
	if err != nil {
		return NotificationsResult{}, err
	}
	if notifications == nil {
		notifications = []db.SystemNotification{}
	}
	return NotificationsResult{
		Notifications: notifications,
		UnreadCount:   unreadCount,
	}, nil
}

func MarkNotificationsRead(ctx context.Context, queries *db.Queries, ids []string) (int64, error) {
	if len(ids) > 0 {
		if err := queries.MarkNotificationsReadByIDs(ctx, ids); err != nil {
			return 0, err
		}
	} else {
		if err := queries.MarkAllNotificationsRead(ctx); err != nil {
			return 0, err
		}
	}
	return queries.CountUnreadNotifications(ctx)
}

func MarkNotificationRead(ctx context.Context, queries *db.Queries, id string) (int64, error) {
	if err := queries.MarkNotificationReadByID(ctx, id); err != nil {
		return 0, err
	}
	return queries.CountUnreadNotifications(ctx)
}

func timestampJSON(ts pgtype.Timestamp) interface{} {
	if !ts.Valid {
		return nil
	}
	return ts.Time.UTC().Format(time.RFC3339Nano)
}

func jsonRawOrNil(data []byte) interface{} {
	if len(data) == 0 {
		return nil
	}
	var v interface{}
	if err := json.Unmarshal(data, &v); err != nil {
		return nil
	}
	return v
}
