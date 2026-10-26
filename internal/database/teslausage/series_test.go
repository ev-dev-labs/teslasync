package teslausage

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

func TestTeslaUsageSelectedCalendarBucketsConserveBothSources(t *testing.T) {
	first := time.Date(2025, 1, 5, 23, 30, 0, 0, time.UTC)
	second := first.Add(time.Hour)
	for _, tc := range []struct {
		zone, bucket string
		keys         []string
	}{
		{"UTC", "day", []string{"2025-01-05T00:00:00Z", "2025-01-06T00:00:00Z"}},
		{"UTC", "week", []string{"2024-12-30T00:00:00Z", "2025-01-06T00:00:00Z"}},
		{"America/Los_Angeles", "day", []string{"2025-01-05T08:00:00Z"}},
		{"America/Los_Angeles", "week", []string{"2024-12-30T08:00:00Z"}},
		{"Asia/Tokyo", "day", []string{"2025-01-05T15:00:00Z"}},
		{"Asia/Tokyo", "week", []string{"2025-01-05T15:00:00Z"}},
	} {
		t.Run(tc.zone+"/"+tc.bucket, func(t *testing.T) {
			loc, err := time.LoadLocation(tc.zone)
			if err != nil {
				t.Fatal(err)
			}
			acc := newTeslaUsageSeriesAccumulator(tc.bucket, loc)
			acc.addSignals(first, 150000)
			acc.addRequest(first, "tesla-api", "POST", "/api/1/vehicles/7/command/door_lock", 200)
			acc.addRequest(second, "tesla-api", "GET", "/api/1/vehicles/7/vehicle_data", 200)
			acc.addRequest(second, "tesla-api", "POST", "/api/1/vehicles/7/wake_up", 200)
			result := acc.build(first, second.Add(time.Minute), 366, 0)
			if len(result.Points) != len(tc.keys) {
				t.Fatalf("buckets = %+v, want %v", result.Points, tc.keys)
			}
			for i, key := range tc.keys {
				if got := result.Points[i].BucketStart.Format(time.RFC3339); got != key {
					t.Errorf("bucket %d = %s, want %s", i, got, key)
				}
			}
			total := result.Total
			if total.Signals != 150000 || total.Commands != 1 || total.DataRequests != 1 || total.Wakes != 1 ||
				math.Abs(total.EstimatedUSD-1.023) > 1e-12 || !total.Start.Equal(first) || !total.End.Equal(second.Add(time.Minute)) {
				t.Errorf("calendar changed source counts, price, or interval: %+v", total)
			}
			paged := acc.build(first, second.Add(time.Minute), 1, 0)
			if len(paged.Points) != 1 || paged.Total != total {
				t.Errorf("pagination changed full-range totals: %+v", paged)
			}
		})
	}
}

func TestTeslaUsageCalendarDSTAndMidnightTransitions(t *testing.T) {
	for _, tc := range []struct {
		zone, at, want string
	}{
		{"America/Los_Angeles", "2024-03-10T12:00:00Z", "2024-03-10T08:00:00Z"},
		{"America/Los_Angeles", "2024-03-11T12:00:00Z", "2024-03-11T07:00:00Z"},
		{"America/Los_Angeles", "2024-11-03T12:00:00Z", "2024-11-03T07:00:00Z"},
		{"America/Los_Angeles", "2024-11-04T12:00:00Z", "2024-11-04T08:00:00Z"},
		{"America/Sao_Paulo", "2018-11-04T12:00:00Z", "2018-11-04T03:00:00Z"},
		{"America/Havana", "2024-11-03T12:00:00Z", "2024-11-03T04:00:00Z"},
	} {
		loc, err := time.LoadLocation(tc.zone)
		if err != nil {
			t.Fatal(err)
		}
		at, err := time.Parse(time.RFC3339, tc.at)
		if err != nil {
			t.Fatal(err)
		}
		if got := TeslaUsageBucketStart(at, "day", loc).Format(time.RFC3339); got != tc.want {
			t.Errorf("%s bucket(%s) = %s, want %s", tc.zone, tc.at, got, tc.want)
		}
	}
}
