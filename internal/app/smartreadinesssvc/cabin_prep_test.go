package smartreadinesssvc

import (
	"maps"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestCabinPrepUsesComparableObservedTransitionBrackets(t *testing.T) {
	now := time.Date(2026, 11, 20, 7, 45, 0, 0, time.UTC)
	departure := now.Add(15 * time.Minute)
	live := domain.CabinPrepConditions{ObservedAt: now.Add(-time.Minute), CabinC: 10, OutsideC: 7, Parked: true}
	rows := make([]domain.CabinPrepEpisode, 0, 7)
	for i := 1; i <= 4; i++ {
		on := now.AddDate(0, 0, -i)
		end := on.Add(time.Duration(i+8) * time.Minute)
		rows = append(rows, domain.CabinPrepEpisode{
			LastOffAt: on.Add(-time.Minute), FirstOnAt: on,
			LastOutOfBandAt: end.Add(-time.Minute), FirstInBandAt: end,
			InitialCabinC: 9, OutsideC: 6, TargetC: 21,
		})
	}

	foreignSeason := rows[0]
	foreignSeason.OutsideC = 24
	rows = append(rows, foreignSeason)
	forecast, reason := EstimateCabinPrep(rows, live, departure, now, time.UTC, 21)
	if reason != domain.CabinPrepEligible || forecast == nil || forecast.ComparableMornings != 4 ||
		forecast.LeadLowS != 480 || forecast.LeadHighS != 900 {
		t.Fatalf("want 8–15 minutes across 4 comparable mornings: %+v (%s)", forecast, reason)
	}
	for _, tt := range []struct {
		name   string
		change func(*domain.CabinPrepConditions, *[]domain.CabinPrepEpisode)
		want   domain.CabinPrepReason
	}{
		{"already preparing", func(l *domain.CabinPrepConditions, _ *[]domain.CabinPrepEpisode) { l.HVACOn = true }, domain.CabinPrepAlreadyActive},
		{"already comfortable", func(l *domain.CabinPrepConditions, _ *[]domain.CabinPrepEpisode) { l.CabinC = 20 }, domain.CabinPrepComfortable},
		{"stale observation", func(l *domain.CabinPrepConditions, _ *[]domain.CabinPrepEpisode) {
			l.ObservedAt = now.Add(-3 * time.Minute)
		}, domain.CabinPrepUnknownState},
		{"not parked", func(l *domain.CabinPrepConditions, _ *[]domain.CabinPrepEpisode) { l.Parked = false }, domain.CabinPrepUnknownState},
		{"gaps do not prove attainment", func(_ *domain.CabinPrepConditions, r *[]domain.CabinPrepEpisode) {
			for i := 0; i < 2; i++ {
				(*r)[i].FirstInBandAt = (*r)[i].FirstInBandAt.Add(3 * time.Minute)
			}
		}, domain.CabinPrepInsufficient},
		{"repeated same-day samples", func(_ *domain.CabinPrepConditions, r *[]domain.CabinPrepEpisode) {
			*r = append(*r, (*r)[0], (*r)[1])
		}, domain.CabinPrepInsufficient},
	} {
		t.Run(tt.name, func(t *testing.T) {
			current := live
			samples := append([]domain.CabinPrepEpisode(nil), rows...)
			tt.change(&current, &samples)
			estimate, reason := EstimateCabinPrep(samples, current, departure, now, time.UTC, 21)
			if estimate != nil || reason != tt.want {
				t.Fatalf("got %+v (%s), want suppression %s", estimate, reason, tt.want)
			}
		})
	}
}

func TestCabinEpisodeUsesEmissionsNotForwardFilledValues(t *testing.T) {
	start := time.Date(2026, 11, 18, 7, 42, 0, 0, time.UTC)
	departure := start.Add(18 * time.Minute)
	makeTimeline := func(mutation string) []signal.TimelineRow {
		fields := make(map[string]signal.SignalValue)
		observed := make(map[string]time.Time)
		var rows []signal.TimelineRow
		record := func(at time.Time, emissions map[string]signal.SignalValue) {
			for field, v := range emissions {
				fields[field], observed[field] = v, at
			}
			rows = append(rows, signal.TimelineRow{Timestamp: at, Fields: maps.Clone(fields),
				ObservedAt: maps.Clone(observed), SourceTime: maps.Clone(observed)})
		}
		record(start, map[string]signal.SignalValue{
			cabinHVAC: false, cabinGear: "P", cabinInterior: 9.0,
			cabinAmbient: 7.0, cabinDriverTarget: 21.0, cabinOtherTarget: 21.0, cabinOverheat: "Off",
		})
		record(start.Add(time.Minute), map[string]signal.SignalValue{cabinHVAC: true})
		record(start.Add(2*time.Minute), map[string]signal.SignalValue{cabinInterior: 12.0})
		record(start.Add(4*time.Minute), map[string]signal.SignalValue{cabinInterior: 15.0})
		record(start.Add(6*time.Minute), map[string]signal.SignalValue{cabinInterior: 19.0})
		record(start.Add(7*time.Minute), map[string]signal.SignalValue{cabinInterior: 21.0})
		switch mutation {
		case "not emitted":
			delete(rows[5].ObservedAt, cabinInterior)
		case "receipt-only temperature":
			delete(rows[5].SourceTime, cabinInterior)
		case "HVAC was off":
			rows[4].Fields[cabinHVAC] = false
		case "vehicle moved":
			rows[4].Fields[cabinGear] = "D"
		case "retargeted":
			rows[4].Fields[cabinDriverTarget] = 24.0
		case "seed-only initial cabin":
			delete(rows[1].ObservedAt, cabinInterior)
		case "overheat not ruled out":
			rows[1].Fields[cabinOverheat] = "On"
		}
		return rows
	}
	result := cabinEpisodeFromTimeline(makeTimeline(""), departure)
	if result == nil || result.InitialCabinC != 9 || result.TargetC != 21 ||
		result.LastOutOfBandAt.Sub(result.FirstOnAt) != 5*time.Minute ||
		result.FirstInBandAt.Sub(result.LastOffAt) != 7*time.Minute {
		t.Fatalf("unexpected bracket: %+v", result)
	}
	for _, mutation := range []string{"not emitted", "receipt-only temperature", "HVAC was off", "vehicle moved", "retargeted", "seed-only initial cabin", "overheat not ruled out"} {
		t.Run(mutation, func(t *testing.T) {
			if episode := cabinEpisodeFromTimeline(makeTimeline(mutation), departure); episode != nil {
				t.Fatalf("unexpected episode: %+v", episode)
			}
		})
	}
}
