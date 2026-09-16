package sciencesvc

import (
	"context"
	"fmt"
	"sort"
	"time"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	"github.com/ev-dev-labs/teslasync/internal/physics"
	apiscience "github.com/ev-dev-labs/teslasync/internal/science"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel/trace"
)

type HistoryFetcher func(ctx context.Context, lat, lng float64, start, end time.Time) ([]HistoryHour, error)

type HistoryHour struct {
	At          time.Time
	TempC       float64
	PressureHpa float64
	WindMps     float64
	PrecipMm    float64
}

// maxWeatherDrives caps archive joins per request (documented).
const maxWeatherDrives = 12

// buildWeather joins drives to archive weather at each drive start and
// correlates the twin residual against density and wind. Residuals come
// from physics.Solve (consumed, never reimplemented).
func buildWeather(ctx context.Context, vehicleID int64, from, to time.Time, samples []physics.Sample, drives []*drivemodel.Drive, params physics.Params, fetch HistoryFetcher) apiscience.WeatherReport {
	rep := apiscience.WeatherReport{
		VehicleID: vehicleID, Start: from.UTC(), End: to.UTC(),
		Points:      []apiscience.WeatherPoint{},
		WeatherUnk:  true,
		SignalsUsed: []string{"VehicleSpeed", "PackVoltage", "PackCurrent", "EnergyRemaining", "Odometer", "open_meteo_archive"},
		Missing:     []string{},
		Honesty:     apiscience.WeatherHonesty,
	}
	sorted := append([]physics.Sample(nil), samples...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].At.Before(sorted[j].At) })
	usable := []*drivemodel.Drive{}
	for _, d := range drives {
		if d == nil || d.EndTs == nil {
			continue
		}
		usable = append(usable, d)
	}
	sort.Slice(usable, func(i, j int) bool { return usable[i].StartTs.After(usable[j].StartTs) })
	if len(usable) > maxWeatherDrives {
		rep.Missing = append(rep.Missing, "weather_drive_cap_hit")
		usable = usable[:maxWeatherDrives]
	}
	cache := map[string][]HistoryHour{}
	for _, d := range usable {
		end := d.EndTs.UTC()
		start := d.StartTs.UTC()
		var win []physics.Sample
		for _, s := range sorted {
			if !s.At.Before(start) && !s.At.After(end) {
				win = append(win, s)
			}
		}
		if len(win) < 2 {
			continue
		}
		ledger := physics.Solve(physics.Window{
			VehicleID: vehicleID, Kind: "drive", Start: start, End: end,
			Samples: win, Params: params,
		})
		pt := apiscience.WeatherPoint{DriveID: d.ID, At: start}
		dist := d.DistanceM
		if ledger.Drive != nil && ledger.Drive.UnexplainedWh != nil && dist > 0 {
			r := *ledger.Drive.UnexplainedWh / dist
			pt.ResidualWhPerM = &r
		}
		if d.EnergyUsedWh != nil && dist > 0 {
			s := *d.EnergyUsedWh / dist
			pt.SessionWhPerM = &s
		}
		if d.StartLat == nil || d.StartLon == nil {
			rep.Missing = append(rep.Missing, "drive_start_coordinates")
			continue
		}
		pt.Lat, pt.Lon = *d.StartLat, *d.StartLon
		key := historyKey(pt.Lat, pt.Lon, start)
		hours, ok := cache[key]
		if !ok {
			if fetch == nil {
				rep.Missing = append(rep.Missing, "weather_archive_client")
				continue
			}
			fetched, err := fetch(ctx, pt.Lat, pt.Lon, start, end)
			if err != nil {
				log.Warn().Err(err).Str("trace_id", trace.SpanFromContext(ctx).SpanContext().TraceID().String()).Msg("science weather archive unavailable")
				rep.Missing = append(rep.Missing, "weather_archive")
				continue
			}
			hours = fetched
			cache[key] = hours
		}
		h := nearestHour(hours, start)
		if h == nil {
			rep.Missing = append(rep.Missing, "weather_archive_hour")
			continue
		}
		pt.TempC, pt.PressureHpa, pt.WindMps, pt.PrecipMm = &h.TempC, &h.PressureHpa, &h.WindMps, &h.PrecipMm
		dens := apiscience.AirDensityKgM3(h.TempC, h.PressureHpa)
		pt.DensityKgM3 = &dens
		rep.Points = append(rep.Points, pt)
	}
	var dens, wind, res []float64
	for _, p := range rep.Points {
		if p.DensityKgM3 == nil || p.WindMps == nil || p.ResidualWhPerM == nil {
			continue
		}
		dens = append(dens, *p.DensityKgM3)
		wind = append(wind, *p.WindMps)
		res = append(res, *p.ResidualWhPerM)
		if p.PrecipMm != nil && *p.PrecipMm > 0 {
			rep.RainN++
		} else {
			rep.DryN++
		}
	}
	rep.DensityR, rep.WindR = apiscience.WeatherCorrelations(dens, wind, res)
	if len(rep.Points) > 0 {
		rep.WeatherUnk = false
	} else {
		rep.Missing = append(rep.Missing, "weather")
	}
	rep.Missing = dedupeStrings(rep.Missing)
	return rep
}

func historyKey(lat, lng float64, at time.Time) string {
	return fmt.Sprintf("%.6f:%.6f:%s", lat, lng, at.UTC().Format("2006-01-02"))
}

func nearestHour(hours []HistoryHour, at time.Time) *HistoryHour {
	var best *HistoryHour
	bestD := -1.0
	for i := range hours {
		d := hours[i].At.Sub(at).Seconds()
		if d < 0 {
			d = -d
		}
		if best == nil || d < bestD {
			best, bestD = &hours[i], d
		}
	}
	if best != nil && bestD > 3600 {
		return nil
	}
	return best
}
