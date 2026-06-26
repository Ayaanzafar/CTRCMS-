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
	dispTestParent   = "DISP-TEST-PARENT-001"
	dispTestSlit     = "DISP-TEST-SLIT-001"
	dispBatchPass    = "BATCH-DISP-TEST-PASS"
	dispBatchPass2   = "BATCH-DISP-TEST-PASS2"
	dispBatchFail    = "BATCH-DISP-TEST-FAIL"
)

func setupDispatchTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	cleanupDispatchTestData(t, pool)

	_, err := pool.Exec(ctx, `
		INSERT INTO "Coil" ("coilNumber", grade, coating, size, weight, supplier, status, "createdAt", "updatedAt")
		VALUES ($1, 'AMNS550S', 'ZM150', '1250 x 0.5 mm', 5, 'AMNS (Hazira Plant)', 'ACTIVE', NOW(), NOW())
	`, dispTestParent)
	if err != nil {
		t.Fatalf("seed parent: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SlittingRecord" ("slitCoilId", "parentCoilNumber", "slitWidthSize", "slittingDate", "slitCoilWeight", "slitterLocation", "dispatchNote", "createdAt", "updatedAt")
		VALUES ($1, $2, '1040 x 0.5 mm', '2026-01-15', 4.0, 'Shiv Sagar Slitter', 'DN-DISP-SEED', NOW(), NOW())
	`, dispTestSlit, dispTestParent)
	if err != nil {
		t.Fatalf("seed slit: %v", err)
	}

	_, err = pool.Exec(ctx, `
		INSERT INTO "SunrackReceipt" (id, "slitCoilId", "receiptDateSunrack", "storageLocationBin", "inspectionResult", "createdAt", "updatedAt")
		VALUES ($1, $2, '2026-02-01', 'WH-B', 'PASS', NOW(), NOW())
	`, "receipt-"+dispTestSlit, dispTestSlit)
	if err != nil {
		t.Fatalf("seed receipt: %v", err)
	}

	for _, spec := range []struct {
		batch  string
		po     string
		qty    float64
		result string
	}{
		{dispBatchPass, "PO-DISP-1", 100, "PASS"},
		{dispBatchPass2, "PO-DISP-2", 80, "PASS"},
		{dispBatchFail, "PO-DISP-FAIL", 60, "FAIL"},
	} {
		_, err = pool.Exec(ctx, `
			INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
			VALUES ($1, $2, 'Walkway Tray', $3, '2026-02-20', 'Shift A', NOW(), NOW())
		`, spec.batch, spec.po, spec.qty)
		if err != nil {
			t.Fatalf("seed batch %s: %v", spec.batch, err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
			VALUES ($1, $2, $3, 0.01, NOW())
		`, "disp-map-"+spec.batch, spec.batch, dispTestSlit)
		if err != nil {
			t.Fatalf("seed consumption %s: %v", spec.batch, err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "createdAt", "updatedAt")
			VALUES ($1, $2, $3::"QcResult", 'QC Inspector', '2026-02-21', NOW(), NOW())
		`, "disp-qc-"+spec.batch, spec.batch, spec.result)
		if err != nil {
			t.Fatalf("seed qc %s: %v", spec.batch, err)
		}
	}
}

func cleanupDispatchTestData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	batches := []string{dispBatchPass, dispBatchPass2, dispBatchFail}

	_, _ = pool.Exec(ctx, `
		DELETE FROM "DispatchBatchLine"
		WHERE "batchNumber" = ANY($1)
		   OR "dispatchNoteNumber" LIKE 'DN-DISP-TEST%'
	`, batches)
	_, _ = pool.Exec(ctx, `
		DELETE FROM "SiteDispatch"
		WHERE "dispatchNoteNumber" LIKE 'DN-DISP-TEST%'
		   OR "dispatchNoteNumber" IN (
			 SELECT "dispatchNoteNumber" FROM "DispatchBatchLine" WHERE "batchNumber" = ANY($1)
		   )
	`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = ANY($1) OR "slitCoilId" = $2`, batches, dispTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceiptPhoto" WHERE "receiptId" IN (SELECT id FROM "SunrackReceipt" WHERE "slitCoilId" = $1)`, dispTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SunrackReceipt" WHERE "slitCoilId" = $1`, dispTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "SlittingRecord" WHERE "slitCoilId" = $1`, dispTestSlit)
	_, _ = pool.Exec(ctx, `DELETE FROM "Coil" WHERE "coilNumber" = $1`, dispTestParent)
}

func TestDispatchAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupDispatchTestData(t, pool)
	defer cleanupDispatchTestData(t, pool)

	token := adminToken(t, srv)
	var notePartial string
	var noteMulti string

	t.Run("returns dispatch stats", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch/stats", nil)
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
		if _, ok := body.Stats["totalDispatches"]; !ok {
			t.Fatalf("missing totalDispatches: %+v", body.Stats)
		}
		if _, ok := body.Stats["totalUnitsDispatched"]; !ok {
			t.Fatalf("missing totalUnitsDispatched: %+v", body.Stats)
		}
	})

	t.Run("previews next dispatch note number", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch/preview-dispatch-note", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("preview: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			DispatchNoteNumber string `json:"dispatchNoteNumber"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if !strings.HasPrefix(body.DispatchNoteNumber, "DN-SR-") {
			t.Fatalf("unexpected note format: %s", body.DispatchNoteNumber)
		}
	})

	t.Run("rejects dispatch for QC-failed batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":"DN-DISP-TEST-FAIL",
			"dispatchDate":"2026-03-01",
			"projectName":"Test Project",
			"clientName":"Test Client",
			"siteLocation":"Pune",
			"batchLines":[{"batchNumber":%q,"quantityDispatched":10}]
		}`, dispBatchFail))
		req := httptest.NewRequest(http.MethodPost, "/api/dispatch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(strings.ToLower(rec.Body.String()), "qc pass") {
			t.Fatalf("expected QC Pass error, got %s", rec.Body.String())
		}
	})

	t.Run("creates partial dispatch for one batch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":"DN-DISP-TEST-001",
			"dispatchDate":"2026-03-01",
			"vehicleNumber":"MH12XY9999",
			"transporterName":"Sunrack Logistics",
			"projectName":"Solar Park Alpha",
			"clientName":"Suntrop Solar",
			"siteLocation":"Nashik, Maharashtra",
			"batchLines":[{"batchNumber":%q,"quantityDispatched":40}]
		}`, dispBatchPass))
		req := httptest.NewRequest(http.MethodPost, "/api/dispatch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create partial: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Dispatch struct {
				DispatchNoteNumber      string `json:"dispatchNoteNumber"`
				TotalQuantityDispatched float64 `json:"totalQuantityDispatched"`
				BatchLines              []interface{} `json:"batchLines"`
			} `json:"dispatch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Dispatch.BatchLines) != 1 || res.Dispatch.TotalQuantityDispatched != 40 {
			t.Fatalf("unexpected dispatch: %+v", res.Dispatch)
		}
		notePartial = res.Dispatch.DispatchNoteNumber
	})

	t.Run("rejects over-quantity dispatch", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":"DN-DISP-TEST-OVER",
			"dispatchDate":"2026-03-02",
			"projectName":"Solar Park Alpha",
			"clientName":"Suntrop Solar",
			"siteLocation":"Nashik",
			"batchLines":[{"batchNumber":%q,"quantityDispatched":70}]
		}`, dispBatchPass))
		req := httptest.NewRequest(http.MethodPost, "/api/dispatch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("expected 400, got %d %s", rec.Code, rec.Body.String())
		}
		if !strings.Contains(strings.ToLower(rec.Body.String()), "only has") {
			t.Fatalf("expected over-quantity error, got %s", rec.Body.String())
		}
	})

	t.Run("creates multi-batch dispatch note", func(t *testing.T) {
		body := bytes.NewBufferString(fmt.Sprintf(`{
			"dispatchNoteNumber":"DN-DISP-TEST-002",
			"dispatchDate":"2026-03-03",
			"projectName":"Solar Park Beta",
			"clientName":"EPC Partner",
			"siteLocation":"Aurangabad",
			"batchLines":[
				{"batchNumber":%q,"quantityDispatched":50},
				{"batchNumber":%q,"quantityDispatched":30}
			]
		}`, dispBatchPass, dispBatchPass2))
		req := httptest.NewRequest(http.MethodPost, "/api/dispatch", body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusCreated {
			t.Fatalf("create multi: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Dispatch struct {
				DispatchNoteNumber      string  `json:"dispatchNoteNumber"`
				TotalQuantityDispatched float64 `json:"totalQuantityDispatched"`
				BatchLines              []interface{} `json:"batchLines"`
			} `json:"dispatch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if len(res.Dispatch.BatchLines) != 2 || res.Dispatch.TotalQuantityDispatched != 80 {
			t.Fatalf("unexpected multi dispatch: %+v", res.Dispatch)
		}
		noteMulti = res.Dispatch.DispatchNoteNumber
		_ = noteMulti
	})

	t.Run("lists dispatches with search", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch?search=Solar+Park", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Dispatches []interface{} `json:"dispatches"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if len(body.Dispatches) < 2 {
			t.Fatalf("expected at least 2 dispatches, got %d", len(body.Dispatches))
		}
	})

	t.Run("gets dispatch detail by note number", func(t *testing.T) {
		if notePartial == "" {
			t.Fatal("missing partial dispatch note")
		}
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch/"+notePartial, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Dispatch struct {
				ProjectName string `json:"projectName"`
				BatchLines  []struct {
					BatchNumber string `json:"batchNumber"`
				} `json:"batchLines"`
			} `json:"dispatch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Dispatch.ProjectName != "Solar Park Alpha" {
			t.Fatalf("unexpected project: %s", body.Dispatch.ProjectName)
		}
		if len(body.Dispatch.BatchLines) == 0 || body.Dispatch.BatchLines[0].BatchNumber != dispBatchPass {
			t.Fatalf("unexpected batch lines: %+v", body.Dispatch.BatchLines)
		}
	})

	t.Run("finished goods reflects dispatched quantities", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods/"+dispBatchPass, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("finished goods: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Item struct {
				QuantityProduced   float64 `json:"quantityProduced"`
				QuantityDispatched float64 `json:"quantityDispatched"`
				QuantityAvailable  float64 `json:"quantityAvailable"`
			} `json:"item"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Item.QuantityProduced != 100 || body.Item.QuantityDispatched != 90 || body.Item.QuantityAvailable != 10 {
			t.Fatalf("unexpected quantities: %+v", body.Item)
		}
	})

	t.Run("updates dispatch header", func(t *testing.T) {
		if notePartial == "" {
			t.Fatal("missing partial dispatch note")
		}
		body := bytes.NewBufferString(`{
			"vehicleNumber":"MH04UPDATED",
			"transporterName":"Updated Transporter"
		}`)
		req := httptest.NewRequest(http.MethodPut, "/api/dispatch/"+notePartial, body)
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("update: %d %s", rec.Code, rec.Body.String())
		}
		var res struct {
			Dispatch struct {
				VehicleNumber string `json:"vehicleNumber"`
			} `json:"dispatch"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &res)
		if res.Dispatch.VehicleNumber != "MH04UPDATED" {
			t.Fatalf("expected updated vehicle, got %s", res.Dispatch.VehicleNumber)
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/dispatch/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}
