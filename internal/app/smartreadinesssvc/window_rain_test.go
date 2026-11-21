package smartreadinesssvc

import (
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/enums"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestWindowRainNeedsFreshOpenWindowAndOutdoorPark(t *testing.T) {
	now := time.Date(2026, 11, 20, 7, 45, 0, 0, time.UTC)
	setup := func() (map[string]*signal.Value, domain.RainForecast) {
		return map[string]*signal.Value{
			"Gear":     {Raw: enums.GearPark, Timestamp: now},
			"FdWindow": {Raw: "Closed", Timestamp: now},
			"RpWindow": {Raw: "PartiallyOpen", Timestamp: now.Add(-time.Minute)},
		}, domain.RainForecast{ReceivedAt: now.Add(-time.Minute), Hours: []domain.RainForecastHour{
			{EndsAt: now.Truncate(time.Hour).Add(2 * time.Hour), PrecipChancePct: 80, RainAndShowersM: 0.0007},
		}}
	}
	values, forecast := setup()
	until := now.Add(3 * time.Hour)
	risk := windowRainRisk(values, true, forecast, now, until)
	if risk == nil || risk.Window.Position != domain.WindowRearPassenger ||
		!risk.RiskStartAt.Equal(time.Date(2026, 11, 20, 8, 0, 0, 0, time.UTC)) || !risk.ExpiresAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("want actionable rain risk for the last observed open window: %+v", risk)
	}
	if risk := windowRainRisk(values, false, forecast, now, until); risk != nil {
		t.Fatalf("garage or unconfirmed park must stay quiet: %+v", risk)
	}
	if risk := windowRainRisk(values, true, forecast, now, now.Add(10*time.Minute)); risk != nil {
		t.Fatalf("rain after the declared park must stay quiet: %+v", risk)
	}
	for _, tc := range []struct {
		name   string
		change func(map[string]*signal.Value, *domain.RainForecast)
	}{
		{"closed", func(v map[string]*signal.Value, _ *domain.RainForecast) { v["RpWindow"].Raw = "Closed" }},
		{"unknown", func(v map[string]*signal.Value, _ *domain.RainForecast) { delete(v, "RpWindow") }},
		{"stale", func(v map[string]*signal.Value, _ *domain.RainForecast) {
			v["RpWindow"].Timestamp = now.Add(-3 * time.Minute)
		}},
		{"synthetic", func(v map[string]*signal.Value, _ *domain.RainForecast) { v["RpWindow"].TimestampSynthetic = true }},
		{"departed", func(v map[string]*signal.Value, _ *domain.RainForecast) { v["Gear"].Raw = "D" }},
		{"weather stale", func(_ map[string]*signal.Value, f *domain.RainForecast) {
			f.ReceivedAt = now.Add(-16 * time.Minute)
		}},
		{"no rainfall", func(_ map[string]*signal.Value, f *domain.RainForecast) { f.Hours[0].RainAndShowersM = 0 }},
		{"not likely", func(_ map[string]*signal.Value, f *domain.RainForecast) { f.Hours[0].PrecipChancePct = 40 }},
		{"forecast out of range", func(_ map[string]*signal.Value, f *domain.RainForecast) {
			f.Hours[0].EndsAt = now.Truncate(time.Hour).Add(4 * time.Hour)
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			values, forecast := setup()
			tc.change(values, &forecast)
			if risk := windowRainRisk(values, true, forecast, now, until); risk != nil {
				t.Fatalf("must stay quiet: %+v", risk)
			}
		})
	}
}
