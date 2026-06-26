package handler

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func formatTimestamp(ts pgtype.Timestamp) string {
	if !ts.Valid {
		return ""
	}
	return ts.Time.UTC().Format(time.RFC3339)
}

func textPtr(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: true}
}

func optionalEmail(email string) pgtype.Text {
	if email == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: email, Valid: true}
}

func optionalText(s string) pgtype.Text {
	if s == "" {
		return pgtype.Text{}
	}
	return pgtype.Text{String: s, Valid: true}
}

func optionalBoolPtr(b *bool) pgtype.Bool {
	if b == nil {
		return pgtype.Bool{}
	}
	return pgtype.Bool{Bool: *b, Valid: true}
}
