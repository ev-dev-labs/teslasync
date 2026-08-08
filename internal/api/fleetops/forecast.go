package fleetops

import (
	"context"
	"fmt"
	"math"
	"sort"
	"time"

	dbfleetops "github.com/ev-dev-labs/teslasync/internal/database/fleetops"
	models "github.com/ev-dev-labs/teslasync/internal/models/fleetops"
)

const (
	forecastHistoryWindow = 56 * 24 * time.Hour
	maxForecastWindow     = 90 * 24 * time.Hour
	daySeconds            = int64(24 * 60 * 60)
)

type interval struct {
	start time.Time
	end   time.Time
}

func utcDay(value time.Time) time.Time {
	value = value.UTC()
	return time.Date(value.Year(), value.Month(), value.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Service) UtilizationForecast(
	ctx context.Context,
	vehicleID *int64,
	from time.Time,
	to time.Time,
) (*models.FleetUtilizationForecast, error) {
	if vehicleID != nil && *vehicleID <= 0 {
		return nil, validation("vehicle_id must be greater than zero")
	}
	from = utcDay(from)
	to = utcDay(to)
	if !to.After(from) {
		return nil, validation("to must be after from")
	}
	if to.Sub(from) > maxForecastWindow {
		return nil, validation("forecast window cannot exceed 90 days")
	}
	inputs, err := s.store.LoadForecastInputs(ctx, dbfleetops.ForecastFilter{
		VehicleID:   vehicleID,
		From:        from,
		To:          to,
		HistoryFrom: from.Add(-forecastHistoryWindow),
	})
	if err != nil {
		return nil, fmt.Errorf("load utilization forecast inputs: %w", err)
	}
	return buildForecast(inputs, from, to, s.now()), nil
}

func buildForecast(inputs *dbfleetops.ForecastInputs, from, to, generatedAt time.Time) *models.FleetUtilizationForecast {
	quality, width, historyDays := forecastQuality(inputs.Drives)
	limitations := []string{
		"Deterministic planning estimate; it does not model traffic, weather, charging delays, or driver cancellations.",
		"Daily buckets and recurring drive patterns are evaluated in UTC.",
	}
	if quality == "sparse" {
		limitations = append(limitations,
			"Sparse drive history: uncertainty is widened and reservations dominate the estimate.")
	} else if quality == "fair" {
		limitations = append(limitations,
			"Moderate drive history: weekday seasonality is available but uncertainty remains material.")
	}
	if len(inputs.Assignments) == 0 {
		limitations = append(limitations,
			"No assignment roster was found; vehicles are assumed available outside maintenance.")
	}

	history := historicalWeekdaySeconds(inputs.Drives, inputs.Vehicles, from.Add(-forecastHistoryWindow), from)
	points := make([]models.FleetForecastPoint, 0)
	for _, vehicle := range inputs.Vehicles {
		hasAssignments := false
		for _, assignment := range inputs.Assignments {
			if assignment.VehicleID == vehicle.VehicleID {
				hasAssignments = true
				break
			}
		}
		for day := from; day.Before(to); day = day.Add(24 * time.Hour) {
			dayEnd := day.Add(24 * time.Hour)
			base := []interval{{start: day, end: dayEnd}}
			if hasAssignments {
				base = assignmentIntervals(inputs.Assignments, vehicle.VehicleID, day, dayEnd)
			}
			downtime := workOrderIntervals(inputs.WorkOrders, vehicle.VehicleID, day, dayEnd)
			availableS := durationS(base) - intersectionDurationS(base, downtime)
			if availableS < 0 {
				availableS = 0
			}
			reservedS := durationS(reservationIntervals(inputs.Reservations, vehicle.VehicleID, day, dayEnd))
			historicalS := history[vehicle.VehicleID][day.Weekday()]
			expectedS := maxInt64(reservedS, historicalS)
			if expectedS > availableS {
				expectedS = availableS
			}
			expectedPct := utilizationPct(expectedS, availableS)
			lower := roundPct(math.Max(0, expectedPct-width))
			upper := roundPct(math.Min(100, expectedPct+width))
			points = append(points, models.FleetForecastPoint{
				VehicleID:              vehicle.VehicleID,
				VehicleDisplayName:     vehicle.VehicleDisplayName,
				ForecastDate:           day,
				AvailableS:             availableS,
				ReservedS:              reservedS,
				MaintenanceDowntimeS:   durationS(downtime),
				HistoricalExpectedS:    historicalS,
				ExpectedUtilizationPct: roundPct(expectedPct),
				LowerUtilizationPct:    lower,
				UpperUtilizationPct:    upper,
			})
		}
	}
	return &models.FleetUtilizationForecast{
		From:              from,
		To:                to,
		GeneratedAt:       generatedAt.UTC(),
		Quality:           quality,
		HistoryDriveCount: len(inputs.Drives),
		HistoryDayCount:   historyDays,
		Limitations:       limitations,
		Points:            points,
	}
}

func forecastQuality(drives []models.FleetForecastDrive) (string, float64, int) {
	days := make(map[string]struct{})
	for _, drive := range drives {
		days[fmt.Sprintf("%d/%s", drive.VehicleID, drive.StartedAt.UTC().Format("2006-01-02"))] = struct{}{}
	}
	if len(drives) < 10 || len(days) < 5 {
		return "sparse", 25, len(days)
	}
	if len(drives) < 40 || len(days) < 20 {
		return "fair", 15, len(days)
	}
	return "good", 8, len(days)
}

func historicalWeekdaySeconds(
	drives []models.FleetForecastDrive,
	vehicles []models.FleetForecastVehicle,
	from time.Time,
	to time.Time,
) map[int64]map[time.Weekday]int64 {
	daily := make(map[int64]map[string]int64)
	for _, drive := range drives {
		if drive.StartedAt.Before(from) || !drive.StartedAt.Before(to) {
			continue
		}
		if daily[drive.VehicleID] == nil {
			daily[drive.VehicleID] = make(map[string]int64)
		}
		daily[drive.VehicleID][drive.StartedAt.UTC().Format("2006-01-02")] += maxInt64(0, drive.DurationS)
	}
	result := make(map[int64]map[time.Weekday]int64)
	for _, vehicle := range vehicles {
		result[vehicle.VehicleID] = make(map[time.Weekday]int64)
		counts := make(map[time.Weekday]int64)
		for day := utcDay(from); day.Before(to); day = day.Add(24 * time.Hour) {
			weekday := day.Weekday()
			result[vehicle.VehicleID][weekday] += daily[vehicle.VehicleID][day.Format("2006-01-02")]
			counts[weekday]++
		}
		for weekday, count := range counts {
			if count > 0 {
				result[vehicle.VehicleID][weekday] /= count
			}
		}
	}
	return result
}

func assignmentIntervals(items []models.FleetVehicleDriverAssignment, vehicleID int64, start, end time.Time) []interval {
	out := make([]interval, 0)
	for _, item := range items {
		if item.VehicleID != vehicleID {
			continue
		}
		itemEnd := end
		if item.EndsAt != nil {
			itemEnd = *item.EndsAt
		}
		if clipped, ok := clipInterval(item.StartsAt, itemEnd, start, end); ok {
			out = append(out, clipped)
		}
	}
	return mergeIntervals(out)
}

func reservationIntervals(items []models.FleetReservation, vehicleID int64, start, end time.Time) []interval {
	out := make([]interval, 0)
	for _, item := range items {
		if item.VehicleID != vehicleID || (item.Status != "requested" && item.Status != "confirmed") {
			continue
		}
		if clipped, ok := clipInterval(item.StartsAt, item.EndsAt, start, end); ok {
			out = append(out, clipped)
		}
	}
	return mergeIntervals(out)
}

func workOrderIntervals(items []models.FleetMaintenanceWorkOrder, vehicleID int64, start, end time.Time) []interval {
	out := make([]interval, 0)
	for _, item := range items {
		if item.VehicleID != vehicleID || item.ScheduledStartAt == nil ||
			(item.Status != "scheduled" && item.Status != "in_progress") {
			continue
		}
		itemEnd := end
		if item.ScheduledEndAt != nil {
			itemEnd = *item.ScheduledEndAt
		}
		if clipped, ok := clipInterval(*item.ScheduledStartAt, itemEnd, start, end); ok {
			out = append(out, clipped)
		}
	}
	return mergeIntervals(out)
}

func clipInterval(itemStart, itemEnd, start, end time.Time) (interval, bool) {
	if itemStart.Before(start) {
		itemStart = start
	}
	if itemEnd.After(end) {
		itemEnd = end
	}
	return interval{start: itemStart, end: itemEnd}, itemEnd.After(itemStart)
}

func mergeIntervals(items []interval) []interval {
	if len(items) < 2 {
		return items
	}
	sort.Slice(items, func(i, j int) bool { return items[i].start.Before(items[j].start) })
	out := []interval{items[0]}
	for _, current := range items[1:] {
		last := &out[len(out)-1]
		if !current.start.After(last.end) {
			if current.end.After(last.end) {
				last.end = current.end
			}
			continue
		}
		out = append(out, current)
	}
	return out
}

func durationS(items []interval) int64 {
	var total int64
	for _, item := range mergeIntervals(items) {
		total += int64(item.end.Sub(item.start).Seconds())
	}
	return total
}

func intersectionDurationS(left, right []interval) int64 {
	left = mergeIntervals(left)
	right = mergeIntervals(right)
	var total int64
	for _, a := range left {
		for _, b := range right {
			start := a.start
			if b.start.After(start) {
				start = b.start
			}
			end := a.end
			if b.end.Before(end) {
				end = b.end
			}
			if end.After(start) {
				total += int64(end.Sub(start).Seconds())
			}
		}
	}
	return total
}

func utilizationPct(occupiedS, availableS int64) float64 {
	if availableS <= 0 {
		return 0
	}
	return float64(occupiedS) / float64(availableS) * 100
}

func roundPct(value float64) float64 { return math.Round(value*10) / 10 }

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
