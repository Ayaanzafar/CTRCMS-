package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/sunrack/ctrcms-go/internal/db"
)

var coilSortColumns = map[string]string{
	"createdAt":          `"createdAt"`,
	"coilNumber":         `"coilNumber"`,
	"amnsDispatchDate":   `"amnsDispatchDate"`,
	"receiptDateSlitter": `"receiptDateSlitter"`,
	"grade":              "grade",
}

type CoilListParams struct {
	Search          string
	Grade           string
	Supplier        string
	From            string
	To              string
	IncludeArchived bool
	ActiveOnly      bool
	QuickFilter     string
	SortBy          string
	SortOrder       string
	Limit           *int
	Offset          int
}

type CoilListRow struct {
	CoilNumber                string
	Grade                     string
	Coating                   string
	Size                      string
	Weight                    string
	Supplier                  string
	MtcNumber                 pgtype.Text
	InvoiceNumber             pgtype.Text
	AmnsDispatchDate          pgtype.Timestamp
	VehicleNumber             pgtype.Text
	TransporterName           pgtype.Text
	ReceiptDateSlitter        pgtype.Timestamp
	ReceivingConditionRemarks pgtype.Text
	Status                    db.CoilStatus
	ArchivedAt                pgtype.Timestamp
	ArchivedById              pgtype.Text
	CreatedAt                 pgtype.Timestamp
	UpdatedAt                 pgtype.Timestamp
	DocCount                  int64
	SlitCount                 int64
}

func ListCoils(ctx context.Context, pool *pgxpool.Pool, p CoilListParams) ([]CoilListRow, int64, error) {
	var args []interface{}
	where := []string{"1=1"}
	argN := 1

	if !p.IncludeArchived || p.ActiveOnly {
		where = append(where, `c.status = 'ACTIVE'`)
	}

	if p.Search != "" {
		where = append(where, fmt.Sprintf(`(
			c."coilNumber" ILIKE $%d OR
			c."mtcNumber" ILIKE $%d OR
			c."invoiceNumber" ILIKE $%d
		)`, argN, argN, argN))
		args = append(args, "%"+p.Search+"%")
		argN++
	}
	if p.Grade != "" {
		where = append(where, fmt.Sprintf(`c.grade ILIKE $%d`, argN))
		args = append(args, "%"+p.Grade+"%")
		argN++
	}
	if p.Supplier != "" {
		where = append(where, fmt.Sprintf(`c.supplier ILIKE $%d`, argN))
		args = append(args, "%"+p.Supplier+"%")
		argN++
	}
	if p.From != "" {
		where = append(where, fmt.Sprintf(`c."amnsDispatchDate" >= $%d::timestamp`, argN))
		args = append(args, p.From)
		argN++
	}
	if p.To != "" {
		where = append(where, fmt.Sprintf(`c."amnsDispatchDate" <= $%d::timestamp`, argN))
		args = append(args, p.To)
		argN++
	}
	switch p.QuickFilter {
	case "hasDocs":
		where = append(where, `EXISTS (SELECT 1 FROM "CoilDocument" d WHERE d."coilNumber" = c."coilNumber")`)
	case "inTrace":
		where = append(where, `EXISTS (SELECT 1 FROM "SlittingRecord" sr WHERE sr."parentCoilNumber" = c."coilNumber")`)
	case "missingMtc":
		where = append(where, `NOT EXISTS (SELECT 1 FROM "CoilDocument" d WHERE d."coilNumber" = c."coilNumber" AND d."documentType" = 'MTC')`)
	}

	whereSQL := strings.Join(where, " AND ")

	countSQL := `SELECT COUNT(*)::bigint FROM "Coil" c WHERE ` + whereSQL
	var total int64
	if err := pool.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	sortCol := coilSortColumns["createdAt"]
	if col, ok := coilSortColumns[p.SortBy]; ok {
		sortCol = col
	}
	sortOrder := "DESC"
	if strings.EqualFold(p.SortOrder, "asc") {
		sortOrder = "ASC"
	}

	listSQL := fmt.Sprintf(`
		SELECT
			c."coilNumber", c.grade, c.coating, c.size, c.weight::text, c.supplier,
			c."mtcNumber", c."invoiceNumber", c."amnsDispatchDate", c."vehicleNumber",
			c."transporterName", c."receiptDateSlitter", c."receivingConditionRemarks",
			c.status, c."archivedAt", c."archivedById", c."createdAt", c."updatedAt",
			(SELECT COUNT(*)::bigint FROM "CoilDocument" d WHERE d."coilNumber" = c."coilNumber") AS doc_count,
			(SELECT COUNT(*)::bigint FROM "SlittingRecord" sr WHERE sr."parentCoilNumber" = c."coilNumber") AS slit_count
		FROM "Coil" c
		WHERE %s
		ORDER BY %s %s
	`, whereSQL, sortCol, sortOrder)

	listArgs := append([]interface{}{}, args...)
	if p.Limit != nil {
		listSQL += fmt.Sprintf(` LIMIT $%d`, argN)
		listArgs = append(listArgs, *p.Limit)
		argN++
		if p.Offset > 0 {
			listSQL += fmt.Sprintf(` OFFSET $%d`, argN)
			listArgs = append(listArgs, p.Offset)
		}
	}

	rows, err := pool.Query(ctx, listSQL, listArgs...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []CoilListRow
	for rows.Next() {
		var row CoilListRow
		if err := rows.Scan(
			&row.CoilNumber, &row.Grade, &row.Coating, &row.Size, &row.Weight, &row.Supplier,
			&row.MtcNumber, &row.InvoiceNumber, &row.AmnsDispatchDate, &row.VehicleNumber,
			&row.TransporterName, &row.ReceiptDateSlitter, &row.ReceivingConditionRemarks,
			&row.Status, &row.ArchivedAt, &row.ArchivedById, &row.CreatedAt, &row.UpdatedAt,
			&row.DocCount, &row.SlitCount,
		); err != nil {
			return nil, 0, err
		}
		items = append(items, row)
	}
	if items == nil {
		items = []CoilListRow{}
	}
	return items, total, rows.Err()
}

func GetCoilStats(ctx context.Context, queries *db.Queries, includeArchived bool) (map[string]int64, error) {
	archived, err := queries.CountArchivedCoils(ctx)
	if err != nil {
		return nil, err
	}

	var total, active, inTrace, withDocs int64
	if includeArchived {
		total, err = queries.CountAllCoils(ctx)
		if err != nil {
			return nil, err
		}
		active, err = queries.CountActiveCoils(ctx)
		if err != nil {
			return nil, err
		}
		inTrace, err = queries.CountAllCoilsInTrace(ctx)
		if err != nil {
			return nil, err
		}
		withDocs, err = queries.CountAllCoilsWithDocs(ctx)
		if err != nil {
			return nil, err
		}
	} else {
		active, err = queries.CountActiveCoils(ctx)
		if err != nil {
			return nil, err
		}
		total = active
		inTrace, err = queries.CountActiveCoilsInTrace(ctx)
		if err != nil {
			return nil, err
		}
		withDocs, err = queries.CountActiveCoilsWithDocs(ctx)
		if err != nil {
			return nil, err
		}
	}

	return map[string]int64{
		"total":    total,
		"active":   active,
		"archived": archived,
		"inTrace":  inTrace,
		"withDocs": withDocs,
	}, nil
}

// NumericToString formats pgtype.Numeric as decimal string.
func NumericToString(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	f, err := n.Float64Value()
	if err != nil || !f.Valid {
		return n.Int.String()
	}
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.3f", f.Float64), "0"), ".")
}

// ScanCoilWeight helper for coil row weight field.
func ParseNumericString(s string) (pgtype.Numeric, error) {
	var n pgtype.Numeric
	err := n.Scan(s)
	return n, err
}

// Ensure pgx import used
var _ = pgx.ErrNoRows
