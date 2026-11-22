package drivehistorysvc

import (
	"cmp"
	"slices"
	"time"
)

type Stats struct {
	Count                   int      `json:"count"`
	DistanceM               float64  `json:"total_distance_m"`
	DurationS               int64    `json:"total_duration_s"`
	EnergyWh                float64  `json:"total_energy_wh"`
	EnergyMeasuredCount     int      `json:"energy_measured_count"`
	EfficiencyMeasuredCount int      `json:"efficiency_measured_count"`
	EfficiencyWhPerM        *float64 `json:"efficiency_wh_per_m"`
	TopSpeedMps             *float64 `json:"top_speed_mps"`
	LongestDistanceM        *float64 `json:"longest_distance_m"`
}

type Day struct {
	Date string `json:"date"`
	Stats
}

type Evidence struct {
	ID           int64      `json:"id"`
	StartTs      time.Time  `json:"start_ts"`
	EndTs        *time.Time `json:"end_ts"`
	DistanceM    float64    `json:"distance_m"`
	EnergyUsedWh *float64   `json:"energy_used_wh"`
	StartAddress *string    `json:"start_address"`
	EndAddress   *string    `json:"end_address"`
	Anomalous    bool       `json:"anomalous"`
}

type Overview struct {
	Current           Stats      `json:"current"`
	Prior             *Stats     `json:"prior"`
	Days              []Day      `json:"days"`
	Evidence          []Evidence `json:"evidence"`
	AnomalyCount      int        `json:"anomaly_count"`
	NotableCount      int        `json:"notable_count"`
	CommuteCount      int        `json:"commute_count"`
	RouteContextCount int        `json:"route_context_count"`
}

type accumulator struct {
	stats              Stats
	efficiencyEnergy   float64
	efficiencyDistance float64
}

func (a *accumulator) add(record Record) {
	d := record.drive
	a.stats.Count++
	a.stats.DistanceM += d.DistanceM
	a.stats.DurationS += d.DurationS
	if d.EnergyUsedWh != nil && finite(*d.EnergyUsedWh) && *d.EnergyUsedWh > 0 {
		a.stats.EnergyWh += *d.EnergyUsedWh
		a.stats.EnergyMeasuredCount++
	}
	if record.efficiency() != nil {
		a.stats.EfficiencyMeasuredCount++
		a.efficiencyEnergy += *d.EnergyUsedWh
		a.efficiencyDistance += d.DistanceM
	}
	if d.MaxSpeedMps != nil && (a.stats.TopSpeedMps == nil || *d.MaxSpeedMps > *a.stats.TopSpeedMps) {
		a.stats.TopSpeedMps = d.MaxSpeedMps
	}
	if a.stats.LongestDistanceM == nil || d.DistanceM > *a.stats.LongestDistanceM {
		a.stats.LongestDistanceM = &d.DistanceM
	}
}

func (a accumulator) result() Stats {
	if a.efficiencyDistance > 0 {
		a.stats.EfficiencyWhPerM = ptr(a.efficiencyEnergy / a.efficiencyDistance)
	}
	return a.stats
}

func Summarize(rows []Record, start time.Time, hasPrior bool, zone *time.Location) Overview {
	current := make([]Record, 0, len(rows))
	var before, now accumulator
	for _, record := range rows {
		if record.drive.StartTs.Before(start) {
			before.add(record)
		} else {
			current = append(current, record)
		}
	}
	groups := collect(current)
	result := Overview{Days: []Day{}, Evidence: []Evidence{}}
	recent := make([]Evidence, 0, 5)
	daily := make(map[string]*accumulator)
	for _, record := range current {
		d := record.drive
		anomalous := groups.matches(record, "anomalies")
		if anomalous {
			result.AnomalyCount++
		}
		if groups.matches(record, "notable") {
			result.NotableCount++
		}
		if groups.matches(record, "commutes") {
			result.CommuteCount++
		}
		if (orEmpty(d.StartAddress) != "" || d.StartLat != nil && d.StartLon != nil) &&
			(orEmpty(d.EndAddress) != "" || d.EndLat != nil && d.EndLon != nil) {
			result.RouteContextCount++
		}
		sample := Evidence{
			ID: d.ID, StartTs: d.StartTs, EndTs: d.EndTs, DistanceM: d.DistanceM,
			EnergyUsedWh: d.EnergyUsedWh, StartAddress: d.StartAddress, EndAddress: d.EndAddress, Anomalous: anomalous,
		}
		if len(recent) < 5 {
			recent = append(recent, sample)
		}
		if anomalous && len(result.Evidence) < 5 {
			result.Evidence = append(result.Evidence, sample)
		}
		now.add(record)
		key := d.StartTs.In(zone).Format(time.DateOnly)
		if daily[key] == nil {
			daily[key] = &accumulator{}
		}
		daily[key].add(record)
	}
	result.Current = now.result()
	if hasPrior {
		previous := before.result()
		result.Prior = &previous
	}
	if len(result.Evidence) == 0 {
		result.Evidence = recent
	}
	for key, day := range daily {
		result.Days = append(result.Days, Day{Date: key, Stats: day.result()})
	}
	slices.SortFunc(result.Days, func(a, b Day) int { return cmp.Compare(a.Date, b.Date) })
	return result
}
