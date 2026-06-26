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
	compComplaintID  = "COMP-TEST-001"
	compDispatchNote = "DN-COMP-TEST-001"
	compBatch        = "BATCH-COMP-TEST"
	compParentCoil   = "COMP-TEST-PARENT"
	compTestSlit     = "COMP-TEST-SLIT"
)

func setupComplaintTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupComplaintTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, compParentCoil)
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 4.0, 'Shiv Sagar Slitter', 'DN-COMP-SEED', NOW(), NOW())
	`, compTestSlit, compParentCoil)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-02-01', 'WH-A', 'PASS', NOW(), NOW())
	`, "receipt-"+compTestSlit, compTestSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
		VALUES ($1, 'PO-COMP-TEST', 'Walkway Tray', 100, '2026-02-20', 'Shift A', NOW(), NOW())
	`, compBatch)
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
		VALUES ($1, $2, $3, 0.5, NOW())
	`, "comp-map-"+compBatch, compBatch, compTestSlit)
	if err != nil {
		t.Fatalf("seed consumption: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "createdAt", "updatedAt")
		VALUES ($1, $2, 'PASS', 'QC Inspector', '2026-02-21', NOW(), NOW())
	`, "comp-qc-"+compBatch, compBatch)
	if err != nil {
		t.Fatalf("seed qc: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SiteDispatch" ("dispatchNoteNumber", "dispatchDate", "projectName", "clientName", "siteLocation", "createdAt", "updatedAt")
		VALUES ($1, '2026-03-01', 'Complaint Test Project', 'Test Client', 'Pune', NOW(), NOW())
	`, compDispatchNote)
	if err != nil {
		t.Fatalf("seed dispatch: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "DispatchBatchLine" (id, "dispatchNoteNumber", "batchNumber", "quantityDispatched", "createdAt")
		VALUES ($1, $2, $3, 50, NOW())
	`, "comp-dbl-"+compDispatchNote, compDispatchNote, compBatch)
	if err != nil {
		t.Fatalf("seed dispatch line: %v", err)
	}
}

func cleanupComplaintTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	_, _ = pool.Exec(ctx, `
		DELETE FROM "SystemNotification"
		WHERE "entityType" = 'Complaint' AND "entityId" = $1
	`, compComplaintID)
	_, _ = pool.Exec(ctx, `
		DELETE FROM "ComplaintPhoto"
		WHERE "complaintId" = $1
	`, compComplaintID)
	_, _ = pool.Exec(ctx, `DELETE FROM "ComplaintBatchLine" WHERE "complaintId" = $1`, compComplaintID)
	_, _ = pool.Exec(ctx, `DELETE FROM "Complaint" WHERE "complaintId" = $1`, compComplaintID)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteInstallation" WHERE "dispatchNoteNumber" = $1`, compDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "DispatchBatchLine" WHERE "dispatchNoteNumber" = $1`, compDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "SiteDispatch" WHERE "dispatchNoteNumber" = $1`, compDispatchNote)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = $1`, compBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1 OR "slitCoilId" = $2`, compBatch, compTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, compBatch)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1)`, compTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, compTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, compTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, compParentCoil)
}

func TestComplaintAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupComplaintTestData(t, pool)
	defer cleanupComplaintTestData(t, pool)

	token := adminToken(t, srv)

	t.Run("returns complaint stats", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/complaints/stats", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats map[string]interface{} `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if _, ok := body.Stats["totalComplaints"]; !ok {
			t.Fatalf("missing totalComplaints: %+v", body.Stats)
		}
	})

	t.Run("lists eligible dispatched batches", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/complaints/eligible-batches", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("eligible: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Batches []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"batches"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, b := range body.Batches {
			if b.BatchNumber == compBatch {
				found = true
			}
		}
		if !found {
			t.Fatalf("expected %s in eligible batches", compBatch)
		}
	})

	t.Run("auto-resolves originating coil numbers", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{"batchNumbers":[%q]}`, compBatch))
		req := httptest.NewRequest(http.MethodPost, "/api/complaints/resolve-trace", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("resolve-trace: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Traceability struct {
				LinkedCoilNumbers []string `json:"linkedCoilNumbers"`
				LinkedSlitCoilIds []string `json:"linkedSlitCoilIds"`
				Coils []struct {
					CoilNumber string `json:"coilNumber"`
				} `json:"coils"`
			} `json:"traceability"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if !contains(res.Traceability.LinkedCoilNumbers, compParentCoil) {
			t.Fatalf("expected parent coil %s, got %v", compParentCoil, res.Traceability.LinkedCoilNumbers)
		}
		if !contains(res.Traceability.LinkedSlitCoilIds, compTestSlit) {
			t.Fatalf("expected slit %s, got %v", compTestSlit, res.Traceability.LinkedSlitCoilIds)
		}
		if len(res.Traceability.Coils) == 0 || res.Traceability.Coils[0].CoilNumber != compParentCoil {
			t.Fatalf("unexpected coils: %+v", res.Traceability.Coils)
		}
	})

	t.Run("creates complaint linked to batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"complaintId":%q,
			"complaintDate":"2026-03-10",
			"projectName":"Complaint Test Project",
			"clientName":"Test Client",
			"siteLocation":"Pune",
			"complaintDescription":"Rust spots observed on walkway tray surface near bolt holes",
			"responsibleStage":"SITE_HANDLING",
			"batchNumbers":[%q]
		}`, compComplaintID, compBatch))
		req := httptest.NewRequest(http.MethodPost, "/api/complaints", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Complaint struct {
				ComplaintId       string   `json:"complaintId"`
				LinkedCoilNumbers []string `json:"linkedCoilNumbers"`
				ResolutionStatus  string   `json:"resolutionStatus"`
			} `json:"complaint"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Complaint.ComplaintId != compComplaintID {
			t.Fatalf("unexpected id: %s", res.Complaint.ComplaintId)
		}
		if !contains(res.Complaint.LinkedCoilNumbers, compParentCoil) {
			t.Fatalf("expected linked coil %s", compParentCoil)
		}
		if res.Complaint.ResolutionStatus != "OPEN" {
			t.Fatalf("expected OPEN, got %s", res.Complaint.ResolutionStatus)
		}
	})

	t.Run("uploads rust photo to complaint", func(t *testing.T) {
		body, contentType := multipartPhotoBody(t, "photos", "rust-spot.png", minPNG)
		req := httptest.NewRequest(http.MethodPost, "/api/complaints/"+compComplaintID+"/photos", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, contentType)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("upload: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Photos []interface{} `json:"photos"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Photos) < 1 {
			t.Fatal("expected at least one photo")
		}
	})

	t.Run("updates complaint investigation status and closes", func(t *testing.T) {
		investigateBody := bytes.NewBufferString(`{
			"resolutionStatus":"UNDER_INVESTIGATION",
			"rootCauseRemarks":"Handling damage during site unloading — shoe marks visible",
			"responsibleStage":"SITE_HANDLING"
		}`)
		investigateReq := httptest.NewRequest(http.MethodPut, "/api/complaints/"+compComplaintID, investigateBody)
		investigateReq.Header.Set("Authorization", "Bearer "+token)
		investigateReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		investigateRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(investigateRec, investigateReq)
		if investigateRec.Code != http.StatusOK {
			t.Fatalf("investigate: %d %s", investigateRec.Code, investigateRec.Body.String())
		}
		var investigateRes struct {
			Complaint struct {
				ResolutionStatus string `json:"resolutionStatus"`
			} `json:"complaint"`
		}
		_ = json.Unmarshal(investigateRec.Body.Bytes(), &investigateRes)
		if investigateRes.Complaint.ResolutionStatus != "UNDER_INVESTIGATION" {
			t.Fatalf("expected UNDER_INVESTIGATION, got %s", investigateRes.Complaint.ResolutionStatus)
		}

		closeBody := bytes.NewBufferString(`{
			"resolutionStatus":"CLOSED",
			"resolutionDate":"2026-03-15",
			"rootCauseRemarks":"Confirmed site handling damage, not supplied material defect"
		}`)
		closeReq := httptest.NewRequest(http.MethodPut, "/api/complaints/"+compComplaintID, closeBody)
		closeReq.Header.Set("Authorization", "Bearer "+token)
		closeReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		closeRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(closeRec, closeReq)
		if closeRec.Code != http.StatusOK {
			t.Fatalf("close: %d %s", closeRec.Code, closeRec.Body.String())
		}
		var closeRes struct {
			Complaint struct {
				ResolutionStatus string      `json:"resolutionStatus"`
				ResolutionDate   interface{} `json:"resolutionDate"`
			} `json:"complaint"`
		}
		_ = json.Unmarshal(closeRec.Body.Bytes(), &closeRes)
		if closeRes.Complaint.ResolutionStatus != "CLOSED" {
			t.Fatalf("expected CLOSED, got %s", closeRes.Complaint.ResolutionStatus)
		}
		if closeRes.Complaint.ResolutionDate == nil {
			t.Fatal("expected resolution date on close")
		}
	})

	t.Run("gets complaint detail with traceability", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/complaints/"+compComplaintID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Complaint struct {
				Traceability struct {
					LinkedCoilNumbers []string `json:"linkedCoilNumbers"`
				} `json:"traceability"`
				PhotoCount int64 `json:"photoCount"`
			} `json:"complaint"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if !contains(body.Complaint.Traceability.LinkedCoilNumbers, compParentCoil) {
			t.Fatalf("expected traceability coil %s", compParentCoil)
		}
		if body.Complaint.PhotoCount < 1 {
			t.Fatalf("expected photo count >= 1, got %d", body.Complaint.PhotoCount)
		}
	})

	t.Run("lists complaints with search", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/complaints?search=rust", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Complaints []struct {
				ComplaintId string `json:"complaintId"`
			} `json:"complaints"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		found := false
		for _, c := range body.Complaints {
			if c.ComplaintId == compComplaintID {
				found = true
			}
		}
		if !found {
			t.Fatal("expected complaint in search results")
		}
	})

	t.Run("rejects duplicate complaint create", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"complaintId":%q,
			"complaintDate":"2026-03-11",
			"projectName":"Duplicate",
			"clientName":"Test",
			"siteLocation":"Pune",
			"complaintDescription":"duplicate test",
			"batchNumbers":[%q]
		}`, compComplaintID, compBatch))
		req := httptest.NewRequest(http.MethodPost, "/api/complaints", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusConflict {
			t.Fatalf("expected 409, got %d", rec.Code)
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/complaints/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
