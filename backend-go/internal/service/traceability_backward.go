package service

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type TraceabilityCoil struct {
	CoilNumber    string   `json:"coilNumber"`
	Grade         string   `json:"grade"`
	Coating       string   `json:"coating"`
	Size          string   `json:"size"`
	MtcNumber     *string  `json:"mtcNumber"`
	InvoiceNumber *string  `json:"invoiceNumber"`
	Supplier      string   `json:"supplier"`
	SlitCoilIds   []string `json:"slitCoilIds"`
}

type TraceabilitySlitCoil struct {
	SlitCoilId       string  `json:"slitCoilId"`
	ParentCoilNumber string  `json:"parentCoilNumber"`
	SlitWidthSize    string  `json:"slitWidthSize"`
	QuantityConsumed float64 `json:"quantityConsumed"`
}

type TraceabilitySiteInstallation struct {
	InstallationDate    string `json:"installationDate"`
	InstallerEpcPartner string `json:"installerEpcPartner"`
}

type TraceabilityDispatch struct {
	DispatchNoteNumber string                        `json:"dispatchNoteNumber"`
	ProjectName        string                        `json:"projectName"`
	QuantityDispatched float64                       `json:"quantityDispatched"`
	SiteInstallation   *TraceabilitySiteInstallation `json:"siteInstallation"`
}

type TraceabilityBatch struct {
	BatchNumber           string                 `json:"batchNumber"`
	ProductType           string                 `json:"productType"`
	ProductionOrderNumber string                 `json:"productionOrderNumber"`
	QuantityProduced      float64                `json:"quantityProduced"`
	LatestQcResult        interface{}            `json:"latestQcResult"`
	SlitCoils             []TraceabilitySlitCoil `json:"slitCoils"`
	Dispatches            []TraceabilityDispatch `json:"dispatches"`
}

type BackwardTraceability struct {
	LinkedCoilNumbers   []string            `json:"linkedCoilNumbers"`
	LinkedSlitCoilIds   []string            `json:"linkedSlitCoilIds"`
	Coils               []TraceabilityCoil  `json:"coils"`
	Batches             []TraceabilityBatch `json:"batches"`
	MissingBatches      []string            `json:"missingBatches"`
}

func ResolveBackwardFromBatches(ctx context.Context, pool *pgxpool.Pool, batchNumbers []string) (BackwardTraceability, error) {
	seen := make(map[string]struct{})
	normalized := make([]string, 0, len(batchNumbers))
	for _, b := range batchNumbers {
		n := strings.ToUpper(strings.TrimSpace(b))
		if n == "" {
			continue
		}
		if _, ok := seen[n]; ok {
			continue
		}
		seen[n] = struct{}{}
		normalized = append(normalized, n)
	}

	result := BackwardTraceability{
		LinkedCoilNumbers: []string{},
		LinkedSlitCoilIds: []string{},
		Coils:             []TraceabilityCoil{},
		Batches:           []TraceabilityBatch{},
		MissingBatches:    []string{},
	}

	if len(normalized) == 0 {
		return result, nil
	}

	foundSet := make(map[string]struct{})
	coilMap := make(map[string]*TraceabilityCoil)
	slitSet := make(map[string]struct{})

	for _, batchNumber := range normalized {
		batch, err := loadTraceabilityBatch(ctx, pool, batchNumber)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				result.MissingBatches = append(result.MissingBatches, batchNumber)
				continue
			}
			return BackwardTraceability{}, err
		}
		foundSet[batchNumber] = struct{}{}
		result.Batches = append(result.Batches, batch)

		for _, slit := range batch.SlitCoils {
			slitSet[slit.SlitCoilId] = struct{}{}
			coilNumber := slit.ParentCoilNumber
			if existing, ok := coilMap[coilNumber]; ok {
				if !containsString(existing.SlitCoilIds, slit.SlitCoilId) {
					existing.SlitCoilIds = append(existing.SlitCoilIds, slit.SlitCoilId)
				}
			} else {
				coil, err := loadTraceabilityCoil(ctx, pool, coilNumber, slit.SlitCoilId)
				if err != nil {
					continue
				}
				coilMap[coilNumber] = &coil
			}
		}
	}

	for _, b := range normalized {
		if _, ok := foundSet[b]; !ok {
			result.MissingBatches = append(result.MissingBatches, b)
		}
	}

	for coilNumber, coil := range coilMap {
		result.LinkedCoilNumbers = append(result.LinkedCoilNumbers, coilNumber)
		result.Coils = append(result.Coils, *coil)
	}
	for slitID := range slitSet {
		result.LinkedSlitCoilIds = append(result.LinkedSlitCoilIds, slitID)
	}
	if result.LinkedCoilNumbers == nil {
		result.LinkedCoilNumbers = []string{}
	}
	if result.LinkedSlitCoilIds == nil {
		result.LinkedSlitCoilIds = []string{}
	}
	if result.Coils == nil {
		result.Coils = []TraceabilityCoil{}
	}
	if result.Batches == nil {
		result.Batches = []TraceabilityBatch{}
	}
	if result.MissingBatches == nil {
		result.MissingBatches = []string{}
	}
	return result, nil
}

func loadTraceabilityCoil(ctx context.Context, pool *pgxpool.Pool, coilNumber, slitCoilID string) (TraceabilityCoil, error) {
	var grade, coating, size, supplier string
	var mtc, invoice pgtype.Text
	err := pool.QueryRow(ctx, `
		SELECT grade, coating, size, supplier, "mtcNumber", "invoiceNumber"
		FROM "Coil"
		WHERE "coilNumber" = $1
	`, coilNumber).Scan(&grade, &coating, &size, &supplier, &mtc, &invoice)
	if err != nil {
		return TraceabilityCoil{}, err
	}
	coil := TraceabilityCoil{
		CoilNumber:  coilNumber,
		Grade:       grade,
		Coating:     coating,
		Size:        size,
		Supplier:    supplier,
		SlitCoilIds: []string{slitCoilID},
	}
	if mtc.Valid {
		v := mtc.String
		coil.MtcNumber = &v
	}
	if invoice.Valid {
		v := invoice.String
		coil.InvoiceNumber = &v
	}
	return coil, nil
}

func loadTraceabilityBatch(ctx context.Context, pool *pgxpool.Pool, batchNumber string) (TraceabilityBatch, error) {
	var batch TraceabilityBatch
	var qtyProduced pgtype.Numeric
	err := pool.QueryRow(ctx, `
		SELECT "batchNumber", "productType", "productionOrderNumber", "quantityProduced"
		FROM "ProductionBatch"
		WHERE "batchNumber" = $1
	`, batchNumber).Scan(&batch.BatchNumber, &batch.ProductType, &batch.ProductionOrderNumber, &qtyProduced)
	if err != nil {
		return TraceabilityBatch{}, err
	}
	qty, err := numericFromPg(qtyProduced)
	if err != nil {
		return TraceabilityBatch{}, err
	}
	batch.QuantityProduced = qty

	var qcResult pgtype.Text
	_ = pool.QueryRow(ctx, `
		SELECT "qcResult"::text
		FROM "QCInspection"
		WHERE "batchNumber" = $1
		ORDER BY "inspectionDate" DESC
		LIMIT 1
	`, batchNumber).Scan(&qcResult)
	if qcResult.Valid {
		batch.LatestQcResult = qcResult.String
	} else {
		batch.LatestQcResult = nil
	}

	consRows, err := pool.Query(ctx, `
		SELECT bcm."slitCoilId", sr."parentCoilNumber", sr."slitWidthSize", bcm."quantityConsumed"
		FROM "BatchSlitCoilMap" bcm
		INNER JOIN "SlittingRecord" sr ON sr."slitCoilId" = bcm."slitCoilId"
		WHERE bcm."batchNumber" = $1
	`, batchNumber)
	if err != nil {
		return TraceabilityBatch{}, err
	}
	defer consRows.Close()
	for consRows.Next() {
		var slit TraceabilitySlitCoil
		var qtyConsumed pgtype.Numeric
		if err := consRows.Scan(&slit.SlitCoilId, &slit.ParentCoilNumber, &slit.SlitWidthSize, &qtyConsumed); err != nil {
			return TraceabilityBatch{}, err
		}
		consumed, err := numericFromPg(qtyConsumed)
		if err != nil {
			return TraceabilityBatch{}, err
		}
		slit.QuantityConsumed = consumed
		batch.SlitCoils = append(batch.SlitCoils, slit)
	}
	if batch.SlitCoils == nil {
		batch.SlitCoils = []TraceabilitySlitCoil{}
	}

	dispRows, err := pool.Query(ctx, `
		SELECT dbl."quantityDispatched", sd."dispatchNoteNumber", sd."projectName",
			si."installationDate", si."installerEpcPartner"
		FROM "DispatchBatchLine" dbl
		INNER JOIN "SiteDispatch" sd ON sd."dispatchNoteNumber" = dbl."dispatchNoteNumber"
		LEFT JOIN "SiteInstallation" si ON si."dispatchNoteNumber" = sd."dispatchNoteNumber"
		WHERE dbl."batchNumber" = $1
	`, batchNumber)
	if err != nil {
		return TraceabilityBatch{}, err
	}
	defer dispRows.Close()
	for dispRows.Next() {
		var d TraceabilityDispatch
		var qtyDispatched pgtype.Numeric
		var installDate pgtype.Timestamp
		var installer pgtype.Text
		if err := dispRows.Scan(&qtyDispatched, &d.DispatchNoteNumber, &d.ProjectName, &installDate, &installer); err != nil {
			return TraceabilityBatch{}, err
		}
		q, err := numericFromPg(qtyDispatched)
		if err != nil {
			return TraceabilityBatch{}, err
		}
		d.QuantityDispatched = q
		if installDate.Valid && installer.Valid {
			d.SiteInstallation = &TraceabilitySiteInstallation{
				InstallationDate:    formatTimestampISO(installDate),
				InstallerEpcPartner: installer.String,
			}
		}
		batch.Dispatches = append(batch.Dispatches, d)
	}
	if batch.Dispatches == nil {
		batch.Dispatches = []TraceabilityDispatch{}
	}
	return batch, nil
}

func formatTimestampISO(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format("2006-01-02T15:04:05.000Z")
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}
