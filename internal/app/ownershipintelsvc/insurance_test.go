package ownershipintelsvc

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
	port "github.com/ev-dev-labs/teslasync/internal/port/ownershipintel"
)

type insuranceTestSource struct {
	port.SourceRepository
	drives   []port.DriveRecord
	from, to time.Time
}

func (s *insuranceTestSource) ListDrives(_ context.Context, _ int64, from, to time.Time) ([]port.DriveRecord, error) {
	s.from, s.to = from, to
	return s.drives, nil
}

type insuranceTestDurable struct{ port.DurableRepository }

func (insuranceTestDurable) GetPolicy(context.Context, string, int64) (*port.PolicyRecord, error) {
	return nil, nil
}

func TestInsuranceSelectedClockPreservesSourceAndWindow(t *testing.T) {
	start := time.Date(2026, 3, 9, 6, 30, 0, 0, time.UTC)
	end := start.Add(10 * time.Minute)
	distance, duration := 1000.0, int64(600)
	source := &insuranceTestSource{drives: []port.DriveRecord{
		{ID: 1, StartedAt: start, EndedAt: &end, DistanceM: &distance, DurationS: &duration},
	}}
	original := append([]port.DriveRecord(nil), source.drives...)
	now := time.Date(2026, 3, 12, 0, 0, 0, 0, time.UTC)
	service := New(source, insuranceTestDurable{}).WithClock(func() time.Time { return now })
	var utcHash string
	for _, zone := range []string{"", "UTC", "America/Los_Angeles"} {
		profile, err := service.InsuranceRiskProfile(context.Background(), "test", 7, 90, zone)
		if err != nil {
			t.Fatal(err)
		}
		wantNight := 0.0
		if zone == "America/Los_Angeles" {
			wantNight = distance
		}
		if profile.NightDistanceM != wantNight || profile.ExposureDistanceM != distance ||
			profile.ExposureDurationS != duration || profile.DriveCount != 1 {
			t.Fatalf("%s changed source accounting: %+v", zone, profile)
		}
		if !source.from.Equal(now.AddDate(0, 0, -90)) || !source.to.Equal(now) {
			t.Fatalf("%s changed UTC eligibility bounds", zone)
		}
		if zone == "" {
			if profile.Timezone != "UTC" {
				t.Fatalf("legacy zone = %q, want UTC", profile.Timezone)
			}
			utcHash = profile.EvidencePacketHash
		} else if (profile.EvidencePacketHash == utcHash) != (zone == "UTC") {
			t.Fatalf("%s checksum did not reflect deterministic clock semantics", zone)
		}
	}
	if !reflect.DeepEqual(source.drives, original) {
		t.Fatal("selected clock rewrote source records")
	}
	for _, zone := range []string{"Local", "invalid/timezone"} {
		if _, err := service.InsuranceRiskProfile(context.Background(), "test", 7, 90, zone); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("%s error = %v, want invalid input", zone, err)
		}
	}
}

func TestInsuranceTrendUsesSelectedCalendarWeek(t *testing.T) {
	start := time.Date(2026, 3, 7, 12, 0, 0, 0, time.UTC)
	distance, duration := 1000.0, int64(600)
	drives := []port.DriveRecord{{StartedAt: start, DistanceM: &distance, DurationS: &duration}}
	for _, tt := range []struct{ zone, bucket string }{
		{"UTC", "2026-03-01T00:00:00Z"},
		{"Pacific/Auckland", "2026-03-07T11:00:00Z"},
	} {
		location, err := time.LoadLocation(tt.zone)
		if err != nil {
			t.Fatal(err)
		}
		points := riskTrend(drives, domain.Window{}, location)
		if len(points) != 1 || points[0].BucketStart.Format(time.RFC3339) != tt.bucket ||
			points[0].DistanceM != distance || points[0].DriveCount != 1 {
			t.Fatalf("%s calendar bucket = %+v", tt.zone, points)
		}
	}
}

func TestInsuranceNightBandUsesSelectedClock(t *testing.T) {
	for _, tt := range []struct {
		zone, instant string
		want          bool
	}{
		{"UTC", "2026-03-09T06:30:00Z", false},
		{"America/Los_Angeles", "2026-03-09T06:30:00Z", true},
		{"America/Los_Angeles", "2026-03-09T04:59:59Z", false},
		{"America/Los_Angeles", "2026-03-09T05:00:00Z", true},
		{"America/Los_Angeles", "2026-03-09T11:59:59Z", true},
		{"America/Los_Angeles", "2026-03-09T12:00:00Z", false},
		{"Pacific/Auckland", "2026-03-09T10:30:00Z", true},
	} {
		t.Run(tt.zone+"/"+tt.instant, func(t *testing.T) {
			location, err := time.LoadLocation(tt.zone)
			if err != nil {
				t.Fatal(err)
			}
			instant, err := time.Parse(time.RFC3339, tt.instant)
			if err != nil {
				t.Fatal(err)
			}
			if got := isNight(instant.In(location)); got != tt.want {
				t.Fatalf("overnight = %v, want %v for %v", got, tt.want, instant.In(location))
			}
		})
	}
}
