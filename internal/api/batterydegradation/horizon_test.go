package batterydegradation

import (
	"testing"
	"time"
)

func horizonSnapshots() []batterySnapshotData {
	base := time.Date(2024, 1, 15, 12, 0, 0, 0, time.UTC)
	out := make([]batterySnapshotData, 0, 13)
	for i := 0; i < 13; i++ {
		out = append(out, batterySnapshotData{
			HealthScore: 96 - float64(i)*0.2, // ~-2.4%/yr
			CreatedAt:   base.AddDate(0, i, 0),
		})
	}
	return out
}

func TestPredictDegradationHorizonOutlook(t *testing.T) {
	h := &Handler{now: func() time.Time { return time.Date(2025, 2, 1, 12, 0, 0, 0, time.UTC) }}
	res := h.predictDegradation(horizonSnapshots())
	if !res.Horizon.HasEnoughData {
		t.Fatal("expected HasEnoughData")
	}
	if len(res.Horizon.Points) != 3 {
		t.Fatalf("points = %d, want 3", len(res.Horizon.Points))
	}
	if res.Horizon.DataMonths < 11 || res.Horizon.DataMonths > 13 {
		t.Fatalf("data months = %d, want ~12", res.Horizon.DataMonths)
	}
	prev := 101.0
	for _, p := range res.Horizon.Points {
		if p.HealthPct >= prev {
			t.Fatalf("horizon not declining: %+v", res.Horizon.Points)
		}
		prev = p.HealthPct
		if p.ConfidenceLow > p.HealthPct || p.ConfidenceHigh < p.HealthPct {
			t.Fatalf("broken interval: %+v", p)
		}
	}
	if len(res.Projections) != 61 {
		t.Fatalf("projections = %d, want 61 (60 months)", len(res.Projections))
	}
}

func TestPredictDegradationHorizonEmpty(t *testing.T) {
	h := &Handler{now: time.Now}
	res := h.predictDegradation(nil)
	if res.Horizon.HasEnoughData || res.Horizon.Points == nil {
		t.Fatalf("empty input must yield empty outlook: %+v", res.Horizon)
	}
}
