package service

import (
	"context"
	"fmt"
	"strconv"
	"strings"

	"github.com/sunrack/ctrcms-go/internal/db"
)

func GenerateNextSlitCoilIDs(ctx context.Context, queries *db.Queries, parentCoilNumber string, count int) ([]string, error) {
	if count < 1 {
		return []string{}, nil
	}
	parent := strings.ToUpper(parentCoilNumber)
	existing, err := queries.ListSlitCoilIdsForParent(ctx, parent)
	if err != nil {
		return nil, err
	}

	maxSeq := 0
	prefix := parent + "-SC"
	for _, id := range existing {
		if strings.HasPrefix(id, prefix) {
			seq, err := strconv.Atoi(id[len(prefix):])
			if err == nil && seq > maxSeq {
				maxSeq = seq
			}
		}
	}

	ids := make([]string, 0, count)
	for i := 1; i <= count; i++ {
		ids = append(ids, fmt.Sprintf("%s%03d", prefix, maxSeq+i))
	}
	return ids, nil
}
