package stormguard

import (
	"testing"
	"time"
)

func forecastAt(now time.Time, hours []int, codes []int, gusts []float64) *Forecast {
	f := &Forecast{}
	for i, h := range hours {
		f.Times = append(f.Times, now.Add(time.Duration(h)*time.Hour))
		f.Weather = append(f.Weather, codes[i])
		f.WindGustMS = append(f.WindGustMS, gusts[i])
	}
	return f
}

func TestAssessLevels(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	cases := []struct {
		name  string
		hours []int
		codes []int
		gusts []float64
		want  string
	}{
		{"calm is none", []int{1, 12, 30}, []int{1, 2, 3}, []float64{5, 6, 8}, LevelNone},
		{"nil forecast is none", nil, nil, nil, LevelNone},
		{"thunderstorm in 6h is warning", []int{6}, []int{95}, []float64{10}, LevelWarning},
		{"severe thunderstorm in 20h is warning", []int{20}, []int{99}, []float64{12}, LevelWarning},
		{"thunderstorm in 30h is watch", []int{30}, []int{96}, []float64{10}, LevelWatch},
		{"damaging gust in 10h is warning", []int{10}, []int{3}, []float64{28}, LevelWarning},
		{"strong gust in 10h is watch", []int{10}, []int{3}, []float64{19}, LevelWatch},
		{"strong gust in 40h is watch", []int{40}, []int{3}, []float64{20}, LevelWatch},
		{"heavy snow in 12h is watch", []int{12}, []int{75}, []float64{8}, LevelWatch},
		{"storm beyond 48h is none", []int{60}, []int{95}, []float64{40}, LevelNone},
		{"past storm is none", []int{-5}, []int{95}, []float64{40}, LevelNone},
		{"warning beats earlier watch", []int{30, 10}, []int{95, 95}, []float64{10, 10}, LevelWarning},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var f *Forecast
			if tc.hours != nil {
				f = forecastAt(now, tc.hours, tc.codes, tc.gusts)
			}
			got := Assess(f, now)
			if got.Level != tc.want {
				t.Fatalf("level = %q, want %q (reason %q)", got.Level, tc.want, got.Reason)
			}
			if tc.want != LevelNone && got.StartsAt == nil {
				t.Fatal("expected StartsAt for elevated level")
			}
		})
	}
}

func TestAssessPeakGust(t *testing.T) {
	now := time.Date(2026, 4, 1, 12, 0, 0, 0, time.UTC)
	f := forecastAt(now, []int{5, 10, 60}, []int{1, 1, 1}, []float64{9, 22, 99})
	got := Assess(f, now)
	if got.Level != LevelWatch {
		t.Fatalf("level = %q, want watch", got.Level)
	}
	if got.PeakGustMS != 22 {
		t.Fatalf("peak = %v, want 22 (beyond-horizon gust excluded)", got.PeakGustMS)
	}
}
