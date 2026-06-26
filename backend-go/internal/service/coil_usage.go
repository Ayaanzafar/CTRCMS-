package service

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"

	"github.com/sunrack/ctrcms-go/internal/db"
)

var CriticalCoilFields = []string{"grade", "coating", "size", "weight", "mtcNumber"}

type CoilUsage struct {
	CoilNumber            string `json:"coilNumber"`
	Status                string `json:"status"`
	SlittingRecords       int64  `json:"slittingRecords"`
	SunrackReceipts       int64  `json:"sunrackReceipts"`
	ProductionBatches     int64  `json:"productionBatches"`
	Dispatches            int64  `json:"dispatches"`
	SiteInstallations     int64  `json:"siteInstallations"`
	Complaints            int64  `json:"complaints"`
	Documents             int64  `json:"documents"`
	HasTraceabilityLinks  bool   `json:"hasTraceabilityLinks"`
	CanEditCriticalFields bool   `json:"canEditCriticalFields"`
	CanDelete             bool   `json:"canDelete"`
	CanArchive            bool   `json:"canArchive"`
}

func GetCoilUsage(ctx context.Context, queries *db.Queries, coilNumber string) (*CoilUsage, error) {
	coil, err := queries.GetCoilByNumber(ctx, coilNumber)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}

	slitCount, err := queries.CountSlittingByCoil(ctx, coilNumber)
	if err != nil {
		return nil, err
	}
	docCount, err := queries.CountDocumentsByCoil(ctx, coilNumber)
	if err != nil {
		return nil, err
	}

	rows, err := queries.GetCoilUsageGraphRows(ctx, coilNumber)
	if err != nil {
		return nil, err
	}

	var sunrackSlits = make(map[string]struct{})
	batchSet := make(map[string]struct{})
	dispatchSet := make(map[string]struct{})
	installSet := make(map[string]struct{})
	complaintSet := make(map[string]struct{})

	for _, row := range rows {
		if row.SunrackReceiptID.Valid {
			sunrackSlits[row.SlitCoilId] = struct{}{}
		}
		if row.BatchNumber.Valid {
			batchSet[row.BatchNumber.String] = struct{}{}
		}
		if row.DispatchNoteNumber.Valid {
			dispatchSet[row.DispatchNoteNumber.String] = struct{}{}
		}
		if row.InstallationID.Valid {
			installSet[row.InstallationID.String] = struct{}{}
		}
		if row.ComplaintId.Valid {
			complaintSet[row.ComplaintId.String] = struct{}{}
		}
	}

	hasTrace := slitCount > 0

	return &CoilUsage{
		CoilNumber:            coil.CoilNumber,
		Status:                string(coil.Status),
		SlittingRecords:       slitCount,
		SunrackReceipts:       int64(len(sunrackSlits)),
		ProductionBatches:     int64(len(batchSet)),
		Dispatches:            int64(len(dispatchSet)),
		SiteInstallations:     int64(len(installSet)),
		Complaints:            int64(len(complaintSet)),
		Documents:             docCount,
		HasTraceabilityLinks:  hasTrace,
		CanEditCriticalFields: !hasTrace,
		CanDelete:             coil.Status == db.CoilStatusACTIVE && !hasTrace,
		CanArchive:            coil.Status == db.CoilStatusACTIVE && hasTrace,
	}, nil
}
