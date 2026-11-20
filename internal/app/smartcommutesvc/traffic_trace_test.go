package smartcommutesvc

import (
	"slices"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestPrepareTrafficTraceKeepsObservedBendsAndBoundsDisclosure(t *testing.T) {
	start := instant(t, "2026-04-07T14:00:00Z")
	origin := domain.Point{Latitude: 47.15, Longitude: -122.2}
	turn := domain.Point{Latitude: 47.16, Longitude: -122.2}
	destination := domain.Point{Latitude: 47.16, Longitude: -122.18}
	routine := domain.Routine{Origin: origin, Destination: destination}
	sampled := func(seconds int, p domain.Point) signal.TimelineRow {
		at := start.Add(time.Duration(seconds) * time.Second)
		return signal.TimelineRow{Timestamp: at,
			Fields:     map[string]signal.SignalValue{"latitude": p.Latitude, "longitude": p.Longitude},
			ObservedAt: map[string]time.Time{"latitude": at, "longitude": at},
		}
	}
	outOfWindow := sampled(-1, domain.Point{Latitude: 10, Longitude: 20})
	seed := sampled(10, domain.Point{Latitude: 20, Longitude: 30})
	delete(seed.ObservedAt, "longitude")
	rows := []signal.TimelineRow{
		outOfWindow, sampled(0, origin), seed, sampled(20, domain.Point{Latitude: 47.155, Longitude: -122.2}),
		sampled(40, turn), sampled(60, domain.Point{Latitude: 47.16, Longitude: -122.19}), sampled(90, destination),
		sampled(100, domain.Point{Latitude: 10, Longitude: 20}),
	}
	got, ok := prepareTrafficTrace(rows, start, start.Add(90*time.Second), routine)
	if !ok || !slices.Equal(got, []domain.Point{origin, turn, {Latitude: 47.16, Longitude: -122.19}, destination}) {
		t.Fatalf("approved trace did not preserve the observed bend: %v, %t", got, ok)
	}
	if _, ok := prepareTrafficTrace([]signal.TimelineRow{sampled(0, origin), sampled(40, turn), seed},
		start, start.Add(90*time.Second), routine); ok {
		t.Fatal("an incomplete route without a destination observation was offered")
	}
	routine.Destination.Longitude -= 0.02
	if _, ok := prepareTrafficTrace(rows, start, start.Add(90*time.Second), routine); ok {
		t.Fatal("the selected drive does not terminate near the confirmed routine")
	}
}
