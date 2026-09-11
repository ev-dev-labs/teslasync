package stormguard

import (
	"fmt"
	"time"
)

// Risk levels, ordered. Stored in stormguard_events.level.
const (
	LevelNone    = "none"
	LevelWatch   = "watch"
	LevelWarning = "warning"
)

// Assessment thresholds. Gust bands follow NWS damage guidance loosely
// (58 mph ≈ 26 m/s destroys; 40 mph ≈ 18 m/s downs branches); WMO codes
// 95/96/99 are thunderstorm, 80-82 violent showers, 71-77 heavy snow.
const (
	warnHorizon   = 24 * time.Hour
	watchHorizon  = 48 * time.Hour
	warnGustMS    = 25.0
	watchGustMS   = 17.0
	maxAssessRows = 72
)

// Assessment is the pure verdict over a forecast window.
type Assessment struct {
	Level      string     `json:"level"`
	Reason     string     `json:"reason"`
	StartsAt   *time.Time `json:"starts_at,omitempty"`
	PeakGustMS float64    `json:"peak_gust_ms"`
}

// Assess grades the forecast from now. Pure: no I/O, deterministic.
// Only the first 72 hourly rows (3 days) are examined; the verdict
// horizons are 24h (warning) and 48h (watch).
func Assess(f *Forecast, now time.Time) Assessment {
	a := Assessment{Level: LevelNone, Reason: "no severe weather in the next 48 hours"}
	if f == nil {
		return a
	}
	n := len(f.Times)
	if len(f.Weather) < n {
		n = len(f.Weather)
	}
	if len(f.WindGustMS) < n {
		n = len(f.WindGustMS)
	}
	if n > maxAssessRows {
		n = maxAssessRows
	}
	for i := 0; i < n; i++ {
		dt := f.Times[i].Sub(now)
		if dt < 0 || dt > watchHorizon {
			continue
		}
		if gust := f.WindGustMS[i]; gust > a.PeakGustMS {
			a.PeakGustMS = gust
		}
	}
	for i := 0; i < n; i++ {
		dt := f.Times[i].Sub(now)
		if dt < 0 {
			continue
		}
		code := f.Weather[i]
		switch {
		case dt <= warnHorizon && (isThunder(code) || f.WindGustMS[i] >= warnGustMS):
			out := severe(LevelWarning, f, i, code)
			out.PeakGustMS = a.PeakGustMS
			return out
		case dt <= watchHorizon && (isThunder(code) || f.WindGustMS[i] >= watchGustMS || isHeavyPrecip(code)):
			if a.Level == LevelNone {
				out := severe(LevelWatch, f, i, code)
				out.PeakGustMS = a.PeakGustMS
				a = out
			}
		}
	}
	return a
}

func severe(level string, f *Forecast, i, code int) Assessment {
	start := f.Times[i]
	a := Assessment{Level: level, StartsAt: &start, PeakGustMS: f.WindGustMS[i]}
	switch {
	case isThunder(code):
		a.Reason = fmt.Sprintf("thunderstorm (WMO %d) forecast at %s", code, start.Format("Mon 15:04"))
	case f.WindGustMS[i] >= warnGustMS:
		a.Reason = fmt.Sprintf("damaging gusts %.0f m/s forecast at %s", f.WindGustMS[i], start.Format("Mon 15:04"))
	case f.WindGustMS[i] >= watchGustMS:
		a.Reason = fmt.Sprintf("strong gusts %.0f m/s forecast at %s", f.WindGustMS[i], start.Format("Mon 15:04"))
	default:
		a.Reason = fmt.Sprintf("heavy precipitation (WMO %d) forecast at %s", code, start.Format("Mon 15:04"))
	}
	return a
}

func isThunder(code int) bool { return code == 95 || code == 96 || code == 99 }

func isHeavyPrecip(code int) bool {
	switch code {
	case 80, 81, 82, 71, 73, 75, 77:
		return true
	}
	return false
}
