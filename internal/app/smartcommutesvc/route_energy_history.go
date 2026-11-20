package smartcommutesvc

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxRouteEnergyHistoryRows = 24
	routeEnergyHistoryTimeout = 12 * time.Second
	maxRouteEnergyEvents      = 20_000
)

type routeEnergySource struct {
	history port.RouteEnergyHistory
	trace   trafficTraceReader
}

func WithRouteEnergyHistory(history port.RouteEnergyHistory, trace trafficTraceReader) Option {
	return func(s *Service) {
		if history != nil && trace != nil {
			s.traffic.energy = &routeEnergySource{history: history, trace: trace}
		}
	}
}

func (s *Service) compareTrafficEnergy(
	ctx context.Context, check port.TrafficCheck, offered []domain.TrafficRoute, authorize func(context.Context) error,
) (evidence *domain.TrafficEnergyEvidence, observed, expires time.Time) {
	if !check.Consent.CompareRouteEnergy || s.traffic.energy == nil || len(offered) < 2 {
		return nil, time.Time{}, time.Time{}
	}
	deadline := time.Now().Add(routeEnergyHistoryTimeout)
	if parent, ok := ctx.Deadline(); ok {
		// Leave time to persist any already-qualified timing recommendation.
		deadline = minInstant(deadline, parent.Add(-2*time.Second))
	}
	ctx, cancel := context.WithDeadline(ctx, deadline)
	defer cancel()
	if ctx.Err() != nil {
		return nil, time.Time{}, time.Time{}
	}
	loc, err := time.LoadLocation(check.Routine.TimeZone)
	if err != nil {
		return nil, time.Time{}, time.Time{}
	}
	now := s.now()
	for i, route := range offered {
		if route.FlowUpdatedAt.IsZero() || route.FlowUpdatedAt.After(now) ||
			!now.Before(route.FlowUpdatedAt.Add(trafficEvidenceLifetime)) {
			return nil, time.Time{}, time.Time{}
		}
		if i == 0 || route.FlowUpdatedAt.Before(observed) {
			observed = route.FlowUpdatedAt
		}
	}
	routes := energyRouteGeometry(offered)
	if len(routes) < 2 || authorize(ctx) != nil {
		return nil, time.Time{}, time.Time{}
	}
	values, err := s.traffic.live.GetAll(ctx, check.Routine.VehicleID, signal.LiveSignalReadDistributed)
	outside := values["OutsideTemp"]
	if err != nil || outside == nil || outside.Timestamp.IsZero() || outside.Timestamp.After(now) ||
		now.Sub(outside.Timestamp) > signal.LiveSignalFreshnessThreshold {
		return nil, time.Time{}, time.Time{}
	}
	tempC, ok := routeEnergyNumber(outside.Raw)
	if !ok || !(tempC >= -40 && tempC <= 55) {
		return nil, time.Time{}, time.Time{}
	}
	rows, err := s.traffic.energy.observations(ctx, check, now, authorize)
	if err != nil {
		return nil, time.Time{}, time.Time{}
	}
	result, ok := compareRouteEnergy(routes, rows, tempC, now, loc)
	expires = minInstant(check.Consent.DepartureAt, observed.Add(trafficEvidenceLifetime),
		outside.Timestamp.Add(signal.LiveSignalFreshnessThreshold))
	if !ok || ctx.Err() != nil || !expires.After(s.now()) {
		return nil, time.Time{}, time.Time{}
	}
	band := func(index int, data routeEnergyBand) domain.TrafficRouteEnergy {
		return domain.TrafficRouteEnergy{
			ETAS: routes[index].etaS, DriveCount: data.count,
			LowWh: data.lowWh, MedianWh: data.medianWh, HighWh: data.highWh,
		}
	}
	return &domain.TrafficEnergyEvidence{
		Fastest: band(result.fastestIndex, result.fastest), Saving: band(result.savingIndex, result.saving), OutsideC: tempC,
		ExpiresAt: expires,
	}, observed, expires
}

func (s routeEnergySource) observations(
	ctx context.Context, check port.TrafficCheck, now time.Time, authorize func(context.Context) error,
) ([]routeEnergyObservation, error) {
	if err := authorize(ctx); err != nil {
		return nil, err
	}
	candidates, err := s.history.RouteEnergyDrives(ctx, check, now.Add(-routeEnergyHistoryLimit), now, maxRouteEnergyHistoryRows)
	if err != nil {
		return nil, fmt.Errorf("read comparable completed route history: %w", err)
	}
	out := make([]routeEnergyObservation, 0, len(candidates))
	for _, drive := range candidates {
		if err := authorize(ctx); err != nil {
			return nil, err
		}
		rows, err := s.trace.Timeline(ctx, check.Routine.VehicleID, []signal.FieldMapping{
			{Signal: "LocationLatitude", Field: "latitude"}, {Signal: "LocationLongitude", Field: "longitude"},
			{Signal: "OutsideTemp", Field: "outside_c"},
			{Signal: "PackVoltage", Field: "voltage"}, {Signal: "PackCurrent", Field: "current"},
		}, drive.StartedAt.Add(-time.Microsecond), drive.EndedAt, signal.TimelineOptions{MaxEvents: maxRouteEnergyEvents})
		if errors.Is(err, signal.ErrTimelineEventLimit) {
			continue
		}
		if err != nil {
			return nil, fmt.Errorf("read bounded route and temperature evidence: %w", err)
		}
		path, pathOK := prepareTrafficTrace(rows, drive.StartedAt, drive.EndedAt, check.Routine)
		temperature, tempOK := observedRouteTemperature(rows, drive.StartedAt, drive.EndedAt)
		if !pathOK || !tempOK {
			continue
		}
		power := measuredRouteEnergy(rows, drive.StartedAt, drive.EndedAt)
		out = append(out, routeEnergyObservation{
			driveID: drive.ID, trace: path, endedAt: drive.EndedAt, elapsedS: drive.EndedAt.Sub(drive.StartedAt).Seconds(),
			coveredS: power.CoveredS, netEnergyWh: power.DrawWh - power.RegenWh, temperatureC: temperature,
		})
	}
	return out, nil
}

func measuredRouteEnergy(rows []signal.TimelineRow, start, end time.Time) signal.PowerIntegral {
	var out signal.PowerIntegral
	const pairFreshness = 20 * time.Second
	for i, row := range rows {
		voltageAt, currentAt := row.ObservedAt["voltage"], row.ObservedAt["current"]
		if voltageAt.IsZero() || currentAt.IsZero() || row.Timestamp.After(end) {
			continue
		}
		voltage, vOK := routeEnergyNumber(row.Fields["voltage"])
		current, cOK := routeEnergyNumber(row.Fields["current"])
		if !vOK || !cOK || !(voltage >= 100 && voltage <= 1000 && math.Abs(current) <= 1200) {
			continue
		}
		until := minInstant(end, voltageAt.Add(pairFreshness), currentAt.Add(pairFreshness))
		if i+1 < len(rows) {
			until = minInstant(until, rows[i+1].Timestamp)
		}
		coveredS := until.Sub(maxInstant(start, row.Timestamp)).Seconds()
		if coveredS <= 0 {
			continue
		}
		energyWh := voltage * current * coveredS / 3600
		out.CoveredS += coveredS
		out.DrawWh += max(0, energyWh)
		out.RegenWh += max(0, -energyWh)
	}
	return out
}

func routeEnergyNumber(value any) (float64, bool) {
	switch value.(type) {
	case bool, map[string]any:
		return 0, false
	default:
		return signal.Float64(value)
	}
}

func observedRouteTemperature(rows []signal.TimelineRow, start, end time.Time) (float64, bool) {
	var firstAt, lastAt time.Time
	var sumS, previous, minC, maxC float64
	const maxGap = 10 * time.Minute
	for _, row := range rows {
		if row.Timestamp.Before(start) || row.Timestamp.After(end) ||
			!row.ObservedAt["outside_c"].Equal(row.Timestamp) {
			continue
		}
		temp, ok := routeEnergyNumber(row.Fields["outside_c"])
		if !ok || !(temp >= -40 && temp <= 55) {
			return 0, false
		}
		if firstAt.IsZero() {
			if row.Timestamp.Sub(start) > 2*time.Minute {
				return 0, false
			}
			firstAt, minC, maxC = row.Timestamp, temp, temp
		} else {
			gap := row.Timestamp.Sub(lastAt)
			if gap <= 0 || gap > maxGap {
				return 0, false
			}
			sumS += previous * gap.Seconds()
			minC, maxC = math.Min(minC, temp), math.Max(maxC, temp)
		}
		lastAt, previous = row.Timestamp, temp
	}
	if firstAt.IsZero() || !lastAt.After(firstAt) || end.Sub(lastAt) > 2*time.Minute || maxC-minC > 5 {
		return 0, false
	}
	return sumS / lastAt.Sub(firstAt).Seconds(), true
}

func energyRouteGeometry(routes []domain.TrafficRoute) []energyRoute {
	result := make([]energyRoute, 0, len(routes))
	for _, route := range routes {
		if len(route.Geometry) < 3 {
			return nil
		}
		path := simplifyTrafficTrace(route.Geometry)
		if len(path) == 2 {
			path = []domain.Point{path[0], route.Geometry[len(route.Geometry)/2], path[1]}
		}
		if !validEnergyTrace(path) {
			return nil
		}
		result = append(result, energyRoute{trace: path, etaS: route.DurationS})
	}
	return result
}
