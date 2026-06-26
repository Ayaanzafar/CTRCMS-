package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	fgBatchPass = "BATCH-FG-TEST-PASS"
	fgBatchFail = "BATCH-FG-TEST-FAIL"
)

func TestFinishedGoodsAPI(t *testing.T) {
	srv, pool, cleanup := testServer(t)
	defer cleanup()

	setupQcTestData(t, pool)
	defer cleanupQcTestData(t, pool)

	seedFinishedGoodsInspections(t, pool)
	defer cleanupFinishedGoodsInspections(t, pool)

	token := adminToken(t, srv)

	t.Run("returns stats for QC-passed inventory only", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods/stats", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("stats: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Stats struct {
				QcPassedBatches     int64   `json:"qcPassedBatches"`
				TotalUnitsAvailable float64 `json:"totalUnitsAvailable"`
			} `json:"stats"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Stats.QcPassedBatches < 1 {
			t.Fatalf("expected at least 1 QC-passed batch, got %d", body.Stats.QcPassedBatches)
		}
		if body.Stats.TotalUnitsAvailable < 100 {
			t.Fatalf("expected available >= 100, got %v", body.Stats.TotalUnitsAvailable)
		}
	})

	t.Run("lists only QC-passed batches in inventory", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("list: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Inventory []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"inventory"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		numbers := make([]string, len(body.Inventory))
		for i, item := range body.Inventory {
			numbers[i] = item.BatchNumber
		}
		if !contains(numbers, fgBatchPass) {
			t.Fatalf("expected PASS batch in inventory, got %v", numbers)
		}
		if contains(numbers, fgBatchFail) {
			t.Fatalf("FAIL batch should not be in inventory, got %v", numbers)
		}
	})

	t.Run("inventory item shows available quantity equal to produced", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods/"+fgBatchPass, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("get item: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Item struct {
				QuantityProduced   float64 `json:"quantityProduced"`
				QuantityDispatched float64 `json:"quantityDispatched"`
				QuantityAvailable  float64 `json:"quantityAvailable"`
				QcInspection       struct {
					QcResult string `json:"qcResult"`
				} `json:"qcInspection"`
			} `json:"item"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		if body.Item.QuantityProduced != 100 || body.Item.QuantityDispatched != 0 || body.Item.QuantityAvailable != 100 {
			t.Fatalf("unexpected quantities: %+v", body.Item)
		}
		if body.Item.QcInspection.QcResult != "PASS" {
			t.Fatalf("expected PASS qc result, got %s", body.Item.QcInspection.QcResult)
		}
	})

	t.Run("returns 404 for QC-failed batch", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods/"+fgBatchFail, nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("expected 404, got %d", rec.Code)
		}
	})

	t.Run("filters by product type", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods?productType=Walkway", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("filter: %d %s", rec.Code, rec.Body.String())
		}
		var body struct {
			Inventory []struct {
				ProductType string `json:"productType"`
			} `json:"inventory"`
		}
		_ = json.Unmarshal(rec.Body.Bytes(), &body)
		for _, item := range body.Inventory {
			if !strings.Contains(item.ProductType, "Walkway") {
				t.Fatalf("expected Walkway product type filter, got %s", item.ProductType)
			}
		}
	})

	t.Run("matches dispatch-eligible batches from QC module", func(t *testing.T) {
		fgReq := httptest.NewRequest(http.MethodGet, "/api/finished-goods", nil)
		fgReq.Header.Set("Authorization", "Bearer "+token)
		fgRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(fgRec, fgReq)

		eligibleReq := httptest.NewRequest(http.MethodGet, "/api/qc/dispatch-eligible-batches", nil)
		eligibleReq.Header.Set("Authorization", "Bearer "+token)
		eligibleRec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(eligibleRec, eligibleReq)

		var fgBody struct {
			Inventory []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"inventory"`
		}
		var eligibleBody struct {
			Batches []struct {
				BatchNumber string `json:"batchNumber"`
			} `json:"batches"`
		}
		_ = json.Unmarshal(fgRec.Body.Bytes(), &fgBody)
		_ = json.Unmarshal(eligibleRec.Body.Bytes(), &eligibleBody)

		eligibleSet := make(map[string]struct{}, len(eligibleBody.Batches))
		for _, b := range eligibleBody.Batches {
			eligibleSet[b.BatchNumber] = struct{}{}
		}
		for _, item := range fgBody.Inventory {
			if _, ok := eligibleSet[item.BatchNumber]; !ok {
				t.Fatalf("inventory batch %s not in dispatch-eligible list", item.BatchNumber)
			}
		}
	})

	t.Run("denies unauthenticated access", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/finished-goods/stats", nil)
		rec := httptest.NewRecorder()
		srv.Echo.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Fatalf("expected 401, got %d", rec.Code)
		}
	})
}

func seedFinishedGoodsInspections(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()

	cleanupFinishedGoodsInspections(t, pool)

	for _, spec := range []struct {
		batch  string
		result string
		qty    float64
	}{
		{fgBatchPass, "PASS", 100},
		{fgBatchFail, "FAIL", 100},
	} {
		_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = $1`, spec.batch)
		_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = $1`, spec.batch)

		_, err := pool.Exec(ctx, `
			INSERT INTO "ProductionBatch" ("batchNumber", "productionOrderNumber", "productType", "quantityProduced", "productionDate", "operatorShift", "createdAt", "updatedAt")
			VALUES ($1, $2, 'Walkway Tray', $3, '2026-02-20', 'Shift A', NOW(), NOW())
		`, spec.batch, "PO-"+spec.batch, spec.qty)
		if err != nil {
			t.Fatalf("seed batch %s: %v", spec.batch, err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "BatchSlitCoilMap" (id, "batchNumber", "slitCoilId", "quantityConsumed", "createdAt")
			VALUES ($1, $2, $3, 0.01, NOW())
		`, "fg-map-"+spec.batch, spec.batch, qcTestSlit)
		if err != nil {
			t.Fatalf("seed consumption %s: %v", spec.batch, err)
		}
		_, err = pool.Exec(ctx, `
			INSERT INTO "QCInspection" (id, "batchNumber", "qcResult", "inspectorName", "inspectionDate", "createdAt", "updatedAt")
			VALUES ($1, $2, $3::"QcResult", 'QC Inspector', '2026-02-21', NOW(), NOW())
		`, "fg-qc-"+spec.batch, spec.batch, spec.result)
		if err != nil {
			t.Fatalf("seed qc %s: %v", spec.batch, err)
		}
	}
}

func cleanupFinishedGoodsInspections(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	batches := []string{fgBatchPass, fgBatchFail}
	_, _ = pool.Exec(ctx, `DELETE FROM "QCInspection" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "BatchSlitCoilMap" WHERE "batchNumber" = ANY($1)`, batches)
	_, _ = pool.Exec(ctx, `DELETE FROM "ProductionBatch" WHERE "batchNumber" = ANY($1)`, batches)
}
