package geofence

import (
	"context"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/jackc/pgx/v5"
)

func TestListVisitedCandidates_ClustersAndSeparatesChargingEvidence(t *testing.T) {
	now := time.Date(2026, 9, 23, 12, 0, 0, 0, time.UTC)
	known := &systemmodel.Geofence{
		ID: 9, Name: "Home", PolygonWKT: systemmodel.CircleToPolygonWKT(40, -75, 75),
	}
	pool := &fakePool{queryQueue: []queryResult{
		{rows: newFakeRows([][]any{
			{int64(101), 40.0, -75.0, "Home", now},
			{int64(102), 41.0, -76.0, "Office", now},
			{int64(103), 41.0001, -76.0, "", now.Add(-time.Hour)},
			{int64(104), 42.0, -77.0, "Store", now.Add(-2 * time.Hour)},
		})},
		{rows: newFakeRows([][]any{{41.0001, -76.0, now.Add(-3 * time.Hour)}})},
		{rows: newFakeRows([][]any{geofenceRowVals(known)})},
	}}
	got, err := newRepo(pool).ListVisitedCandidates(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0].Name != "Office" || got[0].VisitCount != 2 ||
		got[0].ChargeCount != 1 || got[0].FirstChargeAt == nil ||
		got[1].Name != "Store" || got[1].ChargeCount != 0 {
		t.Fatalf("unexpected visit candidates: %+v", got)
	}
	if !strings.Contains(pool.queryCalls[0].sql, "ended_at IS NOT NULL") ||
		!strings.Contains(pool.queryCalls[1].sql, "ended_at IS NOT NULL") {
		t.Fatal("both visits and charges must be completed")
	}
}

func TestFirstChargingSessionAt_CoversUnattributedSpatialSession(t *testing.T) {
	g := &systemmodel.Geofence{ID: 7, PolygonWKT: systemmodel.CircleToPolygonWKT(40, -75, 75)}
	first := time.Date(2026, 9, 20, 10, 0, 0, 0, time.UTC)
	pool := &fakePool{queryRowQueue: []pgx.Row{
		fakeRow{vals: geofenceRowVals(g)},
		fakeRow{vals: []any{&first}},
	}}
	got, err := newRepo(pool).FirstChargingSessionAt(context.Background(), 7)
	if err != nil || got == nil || !got.Equal(first) {
		t.Fatalf("first=%v err=%v", got, err)
	}
	if !strings.Contains(pool.queryRowCalls[1].sql, "geofence_id IS NULL") ||
		!strings.Contains(pool.queryRowCalls[1].sql, "start_lat BETWEEN") {
		t.Fatalf("spatial fallback missing: %s", pool.queryRowCalls[1].sql)
	}
}
