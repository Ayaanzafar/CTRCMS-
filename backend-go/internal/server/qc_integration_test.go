package server_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
)

const (
	qcTestParent   = "QC-TEST-PARENT-001"
	qcTestSlit     = "QC-TEST-SLIT-001"
	qcBatchPass    = "BATCH-QC-TEST-PASS"
	qcBatchFail    = "BATCH-QC-TEST-FAIL"
)

func setupQcTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupQcTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, qcTestParent)
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 4.0, 'Shiv Sagar Slitter', 'DN-QC-001', NOW(), NOW())
	`, qcTestSlit, qcTestParent)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-02-01', 'WH-A', 'PASS', NOW(), NOW())
	`, "receipt-"+qcTestSlit, qcTestSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	for _, spec := range []struct {
		batch string
		po    string
	}{
		{qcBatchPass, "PO-" + qcBatchPass},
		{qcBatchFail, "PO-" + qcBatchFail},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
			VALUES ($1, $2, 'Walkway Tray', 50, '2026-02-15', 'Shift A', NOW(), NOW())
		`, spec.batch, spec.po)
		if err != nil {
			t.Fatalf("seed batch %s: %v", spec.batch, err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
			VALUES ($1, $2, $3, 0.5, NOW())
		`, "map-"+spec.batch, spec.batch, qcTestSlit)
		if err != nil {
			t.Fatalf("seed consumption %s: %v", spec.batch, err)
		}
	}
}

func cleanupQcTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	batches := []string{qcBatchPass, qcBatchFail}

	_, _ = pool.Exec(ctx, `
		DELETE FROM "SystemNotification"
		WHERE "entityType" = 'ProductionBatch' AND "entityId" = ANY($1)
	`, batches)
	_, _ = pool.Exec(ctx, `
		DELETE FROM "QCInspectionPhoto"
		WHERE "inspectionId" IN (SELECT id FROM "QCInspection" WHERE "batchNumber" = ANY($1))
	`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = ANY($1) OR "slitCoilId" = $2`, batches, qcTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1)`, qcTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, qcTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, qcTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, qcTestParent)
}

func TestQcInspectionAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupQcTestData(t, pool)
	defer cleanupQcTestData(t, pool)

	token := adminToken(t, srv)
	var passInspectionID string
	var failInspectionID string

	t.Run("returns QC stats", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/qc/stats", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats map[string]int64 `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Stats["batchesPendingQc"] < 0 {
			t.Fatalf("unexpected stats: %+v", body.Stats)
		}
	})

	t.Run("lists pending batches including test batches", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/qc/pending-batches", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("pending: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Pending []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"pending"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		numbers := make([]string, len(body.Pending))
		for i, p := range body.Pending {
			numbers[i] = p.BatchNumber
		}
		if !contains(numbers, qcBatchPass) || !contains(numbers, qcBatchFail) {
			t.Fatalf("expected test batches in pending, got %v", numbers)
		}
	})

	t.Run("creates PASS inspection for one batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"qcResult":"PASS",
			"inspectorName":"QC Inspector",
			"inspectionDate":"2026-02-16",
			"qcRemarks":"All dimensions within tolerance"
		}`, qcBatchPass))
		req := httptest.NewRequest(http.MethodPost, "/api/qc", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create pass: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Inspection struct {
				ID       string `json:"id"`
				QcResult string `json:"qcResult"`
			} `json:"inspection"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Inspection.QcResult != "PASS" {
			t.Fatalf("expected PASS, got %s", res.Inspection.QcResult)
		}
		passInspectionID = res.Inspection.ID
	})

	t.Run("creates FAIL inspection for another batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"batchNumber":%q,
			"qcResult":"FAIL",
			"inspectorName":"QC Inspector",
			"inspectionDate":"2026-02-16",
			"qcRemarks":"Coating defect found"
		}`, qcBatchFail))
		req := httptest.NewRequest(http.MethodPost, "/api/qc", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create fail: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Inspection struct {
				ID       string `json:"id"`
				QcResult string `json:"qcResult"`
			} `json:"inspection"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Inspection.QcResult != "FAIL" {
			t.Fatalf("expected FAIL, got %s", res.Inspection.QcResult)
		}
		failInspectionID = res.Inspection.ID

		var count int
		err := pool.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM "SystemNotification"
			WHERE type = 'QC_FAILED' AND "entityId" = $1
		`, qcBatchFail).Scan(&count)
		if err != nil {
			t.Fatalf("notification check: %v", err)
		}
		if count < 1 {
			t.Fatal("expected QC_FAILED notification for fail batch")
		}
	})

	t.Run("uploads QC photo to inspection", func(t *testing.T) {
		if passInspectionID == "" {
			t.Fatal("missing pass inspection id")
		}
		body, contentType := multipartPhotoBody(t, "photos", "qc-test.png", minPNG)
		req := httptest.NewRequest(http.MethodPost, "/api/qc/"+passInspectionID+"/photos", body)
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

	t.Run("dispatch-eligible list includes PASS batch only", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/qc/dispatch-eligible-batches", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("dispatch-eligible: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Batches []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"batches"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		numbers := make([]string, len(body.Batches))
		for i, b := range body.Batches {
			numbers[i] = b.BatchNumber
		}
		if !contains(numbers, qcBatchPass) {
			t.Fatalf("expected PASS batch in eligible list, got %v", numbers)
		}
		if contains(numbers, qcBatchFail) {
			t.Fatalf("FAIL batch should not be dispatch eligible, got %v", numbers)
		}
	})

	t.Run("batch QC status shows dispatchEligible for pass only", func(t *testing.T) {
		passReq := httptest.NewRequest(http.MethodGet, "/api/qc/batch/"+qcBatchPass, nil)
		passReq.Header.Set("Authorization", "Bearer "+token)
		passRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(passRec, passReq)

		failReq := httptest.NewRequest(http.MethodGet, "/api/qc/batch/"+qcBatchFail, nil)
		failReq.Header.Set("Authorization", "Bearer "+token)
		failRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(failRec, failReq)

		var passBody struct {
			DispatchEligible bool   `json:"dispatchEligible"`
			LatestResult     string `json:"latestResult"`
		}
		var failBody struct {
			DispatchEligible bool   `json:"dispatchEligible"`
			LatestResult     string `json:"latestResult"`
		}
		_ = json.Unmarshal(passRec.Body.Bytes(), &passBody)
		_ = json.Unmarshal(failRec.Body.Bytes(), &failBody)

		if !passBody.DispatchEligible || passBody.LatestResult != "PASS" {
			t.Fatalf("pass batch status: eligible=%v result=%s", passBody.DispatchEligible, passBody.LatestResult)
		}
		if failBody.DispatchEligible || failBody.LatestResult != "FAIL" {
			t.Fatalf("fail batch status: eligible=%v result=%s", failBody.DispatchEligible, failBody.LatestResult)
		}
	})

	t.Run("lists inspections with batch include", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/qc?search="+strings.ToLower(qcBatchPass), nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Inspections []map[string]interface{} `json:"inspections"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if len(body.Inspections) < 1 {
			t.Fatal("expected at least one inspection in list")
		}
		if _, ok := body.Inspections[0]["batch"]; !ok {
			t.Fatal("expected batch include on inspection")
		}
	})

	t.Run("gets inspection by id", func(t *testing.T) {
		if failInspectionID == "" {
			t.Fatal("missing fail inspection id")
		}
		req := httptest.NewRequest(http.MethodGet, "/api/qc/"+failInspectionID, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get by id: %d %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/qc/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}

func contains(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
