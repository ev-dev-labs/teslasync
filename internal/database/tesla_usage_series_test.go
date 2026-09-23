package database

import (
	"math"
	"testing"
	"time"
)

func TestTeslaUsageBucketUTCWeekAndDayBoundaries(t *testing.T) {
	monday := time.Date(2026, 8, 31, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		ts     time.Time
		bucket string
		want   time.Time
	}{
		{monday.Add(-time.Nanosecond), "week", monday.AddDate(0, 0, -7)},
		{monday, "week", monday},
		{monday.Add(7 * 24 * time.Hour), "week", monday.AddDate(0, 0, 7)},
		{monday.Add(-time.Nanosecond), "day", monday.AddDate(0, 0, -1)},
		{monday.In(time.FixedZone("PDT", -7*3600)), "day", monday},
	} {
		if got := TeslaUsageBucketStart(tc.ts, tc.bucket); !got.Equal(tc.want) {
			t.Errorf("%s bucket(%s) = %s, want %s", tc.bucket, tc.ts, got, tc.want)
		}
	}
}

func TestTeslaUsageSeriesPreservesOldObservedBucketsAndFourPrices(t *testing.T) {
	start := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	a := newTeslaUsageSeriesAccumulator("week")
	a.addSignals(start.Add(time.Hour), 150000)
	for i := 0; i < 1000; i++ {
		a.addRequest(start.Add(2*time.Hour), "tesla-api", "POST", "/api/1/vehicles/1/command/door_lock", 200)
	}
	for i := 0; i < 500; i++ {
		a.addRequest(start.Add(3*time.Hour), "tesla-api", "GET", "/api/1/vehicles/1/vehicle_data", 200)
	}
	for i := 0; i < 50; i++ {
		a.addRequest(start.Add(4*time.Hour), "tesla-api", "POST", "/api/1/vehicles/1/wake_up", 200)
	}
	a.addRequest(start.Add(5*time.Hour), "tesla-api", "GET", "/api/v1/system/health", 200)
	a.addRequest(start.Add(5*time.Hour), "tesla-api", "GET", "/api/1/vehicles", 200)
	a.addSignals(start.Add(14*24*time.Hour), 150000) // no fabricated intervening week
	result := a.build(start, end, 366, 0)
	if len(result.Points) != 2 {
		t.Fatalf("points = %+v; want only two observed weekly buckets", result.Points)
	}
	p := result.Points[0]
	if p.Signals != 150000 || p.Commands != 1000 || p.DataRequests != 500 || p.Wakes != 50 || math.Abs(p.EstimatedUSD-4) > 1e-12 {
		t.Errorf("first historical bucket = %+v; want four $1 categories", p)
	}
	if result.Total.EstimatedUSD != 5 || result.Total.Signals != 300000 {
		t.Errorf("range totals = %+v; want $5 for all old buckets", result.Total)
	}
	paged := a.build(start, end, 1, 1)
	if len(paged.Points) != 1 || !paged.Points[0].BucketStart.Equal(start.Add(14*24*time.Hour)) ||
		paged.Total.EstimatedUSD != 5 {
		t.Errorf("pagination collapsed historical totals or bucket: %+v", paged)
	}
	if got := newTeslaUsageSeriesAccumulator("day").build(start, end, 366, 0); len(got.Points) != 0 {
		t.Errorf("absent history was fabricated: %+v", got.Points)
	}
}
