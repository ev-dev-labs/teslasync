package smartcommutesvc

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/driveevidence"
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
	tempC, ok := driveevidence.Number(outside.Raw)
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
		temperature, tempOK := driveevidence.OutsideTemperature(rows, drive.StartedAt, drive.EndedAt)
		if !pathOK || !tempOK {
			continue
		}
		power := driveevidence.IntegratePackEnergy(rows, drive.StartedAt, drive.EndedAt)
		out = append(out, routeEnergyObservation{
			driveID: drive.ID, trace: path, endedAt: drive.EndedAt, elapsedS: drive.EndedAt.Sub(drive.StartedAt).Seconds(),
			coveredS: power.CoveredS, netEnergyWh: power.DrawWh - power.RegenWh, temperatureC: temperature,
		})
	}
	return out, nil
}

func energyRouteGeometry(routes []domain.TrafficRoute) []energyRoute {
	result := make([]energyRoute, 0, len(routes))
	for _, route := range routes {
		if len(route.Geometry) < 3 {
			return nil
		}
		path := driveevidence.SimplifyPath(route.Geometry)
		if len(path) == 2 {
			path = []domain.Point{path[0], route.Geometry[len(route.Geometry)/2], path[1]}
		}
		if !driveevidence.ValidPath(path) {
			return nil
		}
		result = append(result, energyRoute{trace: path, etaS: route.DurationS})
	}
	return result
}
