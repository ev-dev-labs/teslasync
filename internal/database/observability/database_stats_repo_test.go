package observability

import (
	"context"
	"errors"
	"strconv"
	"testing"
)

func TestDatabaseStatsBoundedQueries(t *testing.T) {
	for _, count := range []int{0, 202} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			rows := rowsFrom()
			for range count {
				rows.scans = append(rows.scans, scanRow("public", "signal_log", int64(824389), int64(1024), int64(2), nil))
			}
			db := (&fakeDBTX{}).pushRow(rowWith(int64(499889843))).pushQuery(rows, nil)
			stats, err := (&DatabaseStatsRepo{exec: db}).Stats(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if stats.DatabaseSize != 499889843 || !stats.RowCountsEstimated || stats.Tables == nil || stats.TableCount != count {
				t.Fatalf("unexpected statistics: %+v", stats)
			}
			if len(db.rowCalls) != 1 || len(db.queryCalls) != 1 {
				t.Fatalf("expected two queries regardless of table count, got %d + %d", len(db.rowCalls), len(db.queryCalls))
			}
			if !rows.closed {
				t.Fatal("table rows were not closed")
			}
		})
	}
}

func TestDatabaseStatsFailuresDoNotReturnZeroSuccess(t *testing.T) {
	failure := errors.New("database unavailable")
	tests := []struct {
		name string
		db   *fakeDBTX
	}{
		{"size", (&fakeDBTX{}).pushRow(rowErr(failure))},
		{"tables", (&fakeDBTX{}).pushRow(rowWith(int64(4096))).pushQuery(nil, failure)},
		{"scan", (&fakeDBTX{}).pushRow(rowWith(int64(4096))).pushQuery(rowsFrom(func(...any) error { return failure }), nil)},
		{"iteration", (&fakeDBTX{}).pushRow(rowWith(int64(4096))).pushQuery(rowsErr(failure), nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			stats, err := (&DatabaseStatsRepo{exec: tt.db}).Stats(context.Background())
			if !errors.Is(err, failure) || stats != nil {
				t.Fatalf("got (%+v, %v), want no statistics and original error", stats, err)
			}
		})
	}
}
