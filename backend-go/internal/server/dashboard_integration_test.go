package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

const (
	dashBatch     = "BATCH-DASH-QC-FAIL"
	dashSlit      = "DASH-COIL-S01"
	dashCoil      = "DASH-COIL-001"
	dashComplaint = "COMP-DASH-TEST-001"
	dashDispatch  = "DN-DASH-TEST-001"
)

func setupDashboardTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupDashboardTestData(t, pool)

	_, _ = pool.Exec(ctx, `DELETE FROM "SystemNotification"`)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, dashCoil)
	if err != nil {
		t.Fatalf("seed coil: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-10', 4, NOW(), NOW())
	`, dashSlit, dashCoil)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-01-15', 'WH-DASH', 'PASS', NOW(), NOW())
	`, "receipt-"+dashSlit, dashSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
		VALUES ($1, 'PO-DASH-001', 'Walkway Tray', 50, '2026-01-20', 'Shift A', NOW(), NOW())
	`, dashBatch)
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
		VALUES ($1, $2, $3, 0.5, NOW())
	`, "dash-map-"+dashBatch, dashBatch, dashSlit)
	if err != nil {
		t.Fatalf("seed consumption: %v", err)
	}

	_, _ = pool.Exec(ctx, `
		INSERT INTO "SiteDispatch" ("dispatchNoteNumber", "dispatchDate", "projectName", "clientName", "siteLocation", "createdAt", "updatedAt")
		VALUES ($1, '2026-02-01', 'Dashboard Test Project', 'Dash Client', 'Pune', NOW(), NOW())
		ON CONFLICT DO NOTHING
	`, dashDispatch)
}

func cleanupDashboardTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	_, _ = pool.Exec(ctx, `DELETE FROM "SystemNotification"`)
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintPhoto" WHERE "complaintId" = $1`, dashComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintBatchLine" WHERE "complaintId" = $1`, dashComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "Complaint" WHERE "complaintId" = $1`, dashComplaint)
	_, _ = pool.Exec(ctx, `DELETE FROM "DispatchBatchLine" WHERE "dispatchNoteNumber" = $1`, dashDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteDispatch" WHERE "dispatchNoteNumber" = $1`, dashDispatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = $1`, dashBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1`, dashBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, dashBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, dashSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, dashSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, dashCoil)
}

func TestDashboardAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupDashboardTestData(t, pool)
	defer cleanupDashboardTestData(t, pool)

	adminToken := adminToken(t, srv)
	managementToken := loginToken(t, srv, "management@sunrack.local", "Management@123")
	qcToken := loginToken(t, srv, "qc@sunrack.local", "QC@12345")
	siteToken := loginToken(t, srv, "site@sunrack.local", "Site@12345")

	t.Run("returns dashboard overview for management", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
		req.Header.Set("Authorization", "Bearer "+managementToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("overview: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Overview struct {
				Kpis struct {
					TotalCoils       int64 `json:"totalCoils"`
					BatchesPendingQc int64 `json:"batchesPendingQc"`
					OpenComplaints     int64 `json:"openComplaints"`
					TotalDispatches    int64 `json:"totalDispatches"`
				} `json:"kpis"`
				RootCauseBreakdown []interface{} `json:"rootCauseBreakdown"`
				RecentDispatches   []interface{} `json:"recentDispatches"`
				PendingQcBatches   []interface{} `json:"pendingQcBatches"`
				OpenComplaints     []interface{} `json:"openComplaints"`
			} `json:"overview"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Overview.Kpis.TotalCoils < 1 {
			t.Fatal("expected totalCoils")
		}
		if body.Overview.RootCauseBreakdown == nil {
			t.Fatal("expected rootCauseBreakdown array")
		}
	})

	t.Run("returns audit logs with user details", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dashboard/audit-logs?limit=5", nil)
		req.Header.Set("Authorization", "Bearer "+adminToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("audit logs: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Total int64 `json:"total"`
			Logs  []struct {
				Action string `json:"action"`
				User   struct {
					FullName string `json:"fullName"`
				} `json:"user"`
			} `json:"logs"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Total < 0 {
			t.Fatal("expected total >= 0")
		}
		if len(body.Logs) > 0 && body.Logs[0].User.FullName == "" {
			t.Fatal("expected user fullName on audit log")
		}
	})

	t.Run("creates notification on QC failure", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"qcResult":"FAIL",
			"inspectorName":"Dashboard QC Test",
			"inspectionDate":"2026-01-21",
			"qcRemarks":"Coating defect for dashboard test"
		}`, dashBatch))
		createReq := httptest.NewRequest(http.MethodPost, "/api/qc", body)
		createReq.Header.Set("Authorization", "Bearer "+qcToken)
		createReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		createRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(createRec, createReq)
		if createRec.Code != http.StatusCreated {
			t.Fatalf("qc create: %d %s", createRec.Code, createRec.Body.String())
		}

		notifReq := httptest.NewRequest(http.MethodGet, "/api/dashboard/notifications?unreadOnly=true", nil)
		notifReq.Header.Set("Authorization", "Bearer "+managementToken)
		notifRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(notifRec, notifReq)
		if notifRec.Code != http.StatusOK {
			t.Fatalf("notifications: %d %s", notifRec.Code, notifRec.Body.String())
		}
		var notifBody struct {
			Notifications []struct {
				Type     string `json:"type"`
				EntityId string `json:"entityId"`
			} `json:"notifications"`
		}
		_ = json.Unmarshal(notifRec.Body.Bytes(), &notifBody)
		found := false
		for _, n := range notifBody.Notifications {
			if n.Type == "QC_FAILED" && n.EntityId == dashBatch {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected QC_FAILED notification for %s", dashBatch)
		}
	})

	t.Run("creates notification on complaint creation", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"complaintId":%q,
			"complaintDate":"2026-03-01",
			"projectName":"Dashboard Test Project",
			"clientName":"Dash Client",
			"siteLocation":"Pune",
			"complaintDescription":"Dashboard notification test complaint",
			"batchNumbers":[%q]
		}`, dashComplaint, dashBatch))
		createReq := httptest.NewRequest(http.MethodPost, "/api/complaints", body)
		createReq.Header.Set("Authorization", "Bearer "+siteToken)
		createReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		createRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(createRec, createReq)
		if createRec.Code != http.StatusCreated {
			t.Fatalf("complaint create: %d %s", createRec.Code, createRec.Body.String())
		}

		notifReq := httptest.NewRequest(http.MethodGet, "/api/dashboard/notifications", nil)
		notifReq.Header.Set("Authorization", "Bearer "+managementToken)
		notifRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(notifRec, notifReq)
		var notifBody struct {
			Notifications []struct {
				Type     string `json:"type"`
				EntityId string `json:"entityId"`
			} `json:"notifications"`
		}
		_ = json.Unmarshal(notifRec.Body.Bytes(), &notifBody)
		found := false
		for _, n := range notifBody.Notifications {
			if n.Type == "COMPLAINT_CREATED" && n.EntityId == dashComplaint {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected COMPLAINT_CREATED notification for %s", dashComplaint)
		}
	})

	t.Run("marks notifications as read", func(t *testing.T) {
		listReq := httptest.NewRequest(http.MethodGet, "/api/dashboard/notifications?unreadOnly=true", nil)
		listReq.Header.Set("Authorization", "Bearer "+managementToken)
		listRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(listRec, listReq)
		var listBody struct {
			Notifications []struct {
				ID string `json:"id"`
			} `json:"notifications"`
		}
		_ = json.Unmarshal(listRec.Body.Bytes(), &listBody)
		if len(listBody.Notifications) == 0 {
			t.Fatal("expected at least one unread notification")
		}
		id := listBody.Notifications[0].ID

		markReq := httptest.NewRequest(http.MethodPatch, "/api/dashboard/notifications/"+id+"/read", nil)
		markReq.Header.Set("Authorization", "Bearer "+managementToken)
		markRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(markRec, markReq)
		if markRec.Code != http.StatusOK {
			t.Fatalf("mark one: %d %s", markRec.Code, markRec.Body.String())
		}
	})

	t.Run("marks all notifications read", func(t *testing.T) {
		markReq := httptest.NewRequest(http.MethodPatch, "/api/dashboard/notifications/read", bytes.NewBufferString(`{}`))
		markReq.Header.Set("Authorization", "Bearer "+managementToken)
		markReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		markRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(markRec, markReq)
		if markRec.Code != http.StatusOK {
			t.Fatalf("mark all: %d %s", markRec.Code, markRec.Body.String())
		}
		var body struct {
			UnreadCount int64 `json:"unreadCount"`
		}
		_ = json.Unmarshal(markRec.Body.Bytes(), &body)
		if body.UnreadCount != 0 {
			t.Fatalf("expected unreadCount 0, got %d", body.UnreadCount)
		}
	})

	t.Run("denies dashboard access to roles without permission", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
		req.Header.Set("Authorization", "Bearer "+qcToken)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("expected 403, got %d", rec.Code)
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dashboard/overview", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
