package heretraffic

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

const (
	maxRoutingStops = 4
	maxRoadSnapM    = 250
)

// CompareStopRoutes requests driving legs only. Station compatibility, charge,
// wait and live traffic must not be inferred from these road estimates.
func (c *Client) CompareStopRoutes(
	ctx context.Context, origin, destination domain.RoutePoint, stops []domain.RoutingStop,
	authorize func(context.Context) error,
) (domain.StopRoutes, error) {
	if authorize == nil || !validRoadPoint(origin) || !validRoadPoint(destination) ||
		nearRoadPoint(origin, destination) || len(stops) < 2 || len(stops) > maxRoutingStops {
		return domain.StopRoutes{}, ErrInvalidInput
	}
	seen := make(map[int64]bool, len(stops))
	for i, stop := range stops {
		if stop.PlaceID <= 0 || seen[stop.PlaceID] || !validRoadPoint(stop.Location) ||
			nearRoadPoint(stop.Location, origin) || nearRoadPoint(stop.Location, destination) {
			return domain.StopRoutes{}, ErrInvalidInput
		}
		for _, prior := range stops[:i] {
			if nearRoadPoint(stop.Location, prior.Location) {
				return domain.StopRoutes{}, ErrInvalidInput
			}
		}
		seen[stop.PlaceID] = true
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	direct, err := c.stopRoadLegs(ctx, []domain.RoutePoint{origin, destination}, authorize)
	if err != nil {
		return domain.StopRoutes{}, err
	}
	result := domain.StopRoutes{Direct: direct[0], Via: make([]domain.StopRoute, 0, len(stops))}
	for _, stop := range stops {
		legs, err := c.stopRoadLegs(ctx, []domain.RoutePoint{origin, stop.Location, destination}, authorize)
		if err != nil {
			return domain.StopRoutes{}, err
		}
		result.Via = append(result.Via, domain.StopRoute{PlaceID: stop.PlaceID, ToStop: legs[0], AfterStop: legs[1]})
	}
	if err := authorize(ctx); err != nil {
		return domain.StopRoutes{}, err
	}
	return result, nil
}

type roadResponse struct {
	Notices []json.RawMessage `json:"notices"`
	Routes  []struct {
		Notices  []json.RawMessage `json:"notices"`
		Sections []struct {
			Type      string            `json:"type"`
			Notices   []json.RawMessage `json:"notices"`
			Departure roadEndpoint      `json:"departure"`
			Arrival   roadEndpoint      `json:"arrival"`
			Travel    struct {
				LengthM       int64 `json:"length"`
				BaseDurationS int64 `json:"baseDuration"`
			} `json:"travelSummary"`
			Transport struct {
				Mode string `json:"mode"`
			} `json:"transport"`
		} `json:"sections"`
	} `json:"routes"`
}

type roadEndpoint struct {
	Place struct {
		Location struct {
			Latitude  *float64 `json:"lat"`
			Longitude *float64 `json:"lng"`
		} `json:"location"`
	} `json:"place"`
}

func (c *Client) stopRoadLegs(
	ctx context.Context, points []domain.RoutePoint, authorize func(context.Context) error,
) ([]domain.RoadLeg, error) {
	params := url.Values{
		"transportMode": {"car"}, "return": {"travelSummary"}, "departureTime": {"any"},
		"origin": {roadPointParameter(points[0])}, "destination": {roadPointParameter(points[len(points)-1])},
	}
	if len(points) == 3 {
		params.Set("via", roadPointParameter(points[1]))
	}
	var response roadResponse
	var legs []domain.RoadLeg
	if err := c.call(ctx, authorize, http.MethodGet, c.routingURL+"/routes", params, nil, &response,
		port.HERERoutes, func(_ port.EstimateAttempt) bool {
			legs = qualifyRoadLegs(points, response)
			return len(legs) > 0
		}); err != nil {
		return nil, err
	}
	if c.health == nil {
		legs = qualifyRoadLegs(points, response)
	}
	if len(legs) == 0 {
		return nil, ErrInsufficientEvidence
	}
	return legs, nil
}

func qualifyRoadLegs(points []domain.RoutePoint, response roadResponse) []domain.RoadLeg {
	if len(response.Notices) != 0 || len(response.Routes) != 1 {
		return nil
	}
	route := response.Routes[0]
	if len(route.Notices) != 0 || len(route.Sections) != len(points)-1 {
		return nil
	}
	legs := make([]domain.RoadLeg, 0, len(route.Sections))
	for i, section := range route.Sections {
		if section.Type != "vehicle" || section.Transport.Mode != "car" || len(section.Notices) != 0 ||
			section.Travel.LengthM <= 0 || section.Travel.LengthM > 3_000_000 ||
			section.Travel.BaseDurationS <= 0 || section.Travel.BaseDurationS > 3*24*3600 ||
			!section.Departure.matches(points[i]) || !section.Arrival.matches(points[i+1]) {
			return nil
		}
		legs = append(legs, domain.RoadLeg{DistanceM: section.Travel.LengthM, DurationS: section.Travel.BaseDurationS})
	}
	return legs
}

func roadPointParameter(point domain.RoutePoint) string {
	return coordinateParam(waypoint{Lat: point.Latitude, Lng: point.Longitude})
}

func validRoadPoint(point domain.RoutePoint) bool {
	return inRange(point.Latitude, -90, 90) && inRange(point.Longitude, -180, 180) &&
		(point.Latitude != 0 || point.Longitude != 0)
}

func nearRoadPoint(first, second domain.RoutePoint) bool {
	return drivemodel.HaversineMeters(first.Latitude, first.Longitude, second.Latitude, second.Longitude) <= maxRoadSnapM
}

func (e roadEndpoint) matches(expected domain.RoutePoint) bool {
	if e.Place.Location.Latitude == nil || e.Place.Location.Longitude == nil {
		return false
	}
	point := domain.RoutePoint{Latitude: *e.Place.Location.Latitude, Longitude: *e.Place.Location.Longitude}
	return validRoadPoint(point) && nearRoadPoint(point, expected)
}
