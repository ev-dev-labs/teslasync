// Package heretraffic qualifies HERE Routing estimates with HERE Traffic Flow.
package heretraffic

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

const (
	routingBase      = "https://router.hereapi.com/v8"
	trafficBase      = "https://data.traffic.hereapi.com/v7"
	maxFlowRefs      = 100
	maxRouteSegments = 500
	maxResponseBytes = 4 << 20
	flowFreshness    = 5 * time.Minute
)

var (
	ErrInsufficientEvidence = errors.New("HERE traffic evidence is incomplete or stale")
	ErrInvalidInput         = errors.New("invalid HERE traffic input")
)

type Client struct {
	httpClient *http.Client
	apiKey     string
	routingURL string
	trafficURL string
	now        func() time.Time
	health     port.EstimateHealth
}

var _ port.TrafficSource = (*Client)(nil)

func New(apiKey string, options ...func(*Client)) (*Client, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, ErrInvalidInput
	}
	c := &Client{
		apiKey: apiKey, routingURL: routingBase, trafficURL: trafficBase, now: time.Now,
		httpClient: &http.Client{
			Timeout:       10 * time.Second,
			Transport:     httputil.NewPrivateTransport(http.DefaultTransport),
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
	for _, option := range options {
		option(c)
	}
	return c, nil
}

func WithEstimateHealth(health port.EstimateHealth) func(*Client) {
	return func(c *Client) { c.health = health }
}

// Compare rechecks permission immediately before each external call. The caller
// must also recheck consent and evidence before persisting or dispatching a decision.
func (c *Client) Compare(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
	now := c.now().UTC()
	if authorize == nil || !query.DepartureAt.After(now) || query.DepartureAt.After(now.Add(time.Hour)) ||
		len(query.Trace) < 3 || len(query.Trace) > domain.MaxTrafficTracePoints {
		return domain.TrafficComparison{}, ErrInvalidInput
	}
	points := make([]waypoint, 0, len(query.Trace))
	for _, p := range query.Trace {
		if !inRange(p.Latitude, -90, 90) || !inRange(p.Longitude, -180, 180) ||
			(p.Latitude == 0 && p.Longitude == 0) {
			return domain.TrafficComparison{}, ErrInvalidInput
		}
		points = append(points, waypoint{Lat: p.Latitude, Lng: p.Longitude})
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	params := url.Values{
		"transportMode": {"car"}, "return": {"polyline,summary,routeLabels"}, "spans": {"segmentRef,length"},
		"departureTime": {query.DepartureAt.UTC().Format(time.RFC3339)},
	}
	var baseline routingResponse
	if err := c.call(ctx, authorize, http.MethodPost, c.routingURL+"/import", params,
		struct {
			Trace []waypoint `json:"trace"`
		}{points}, &baseline, port.HEREImport, func(_ port.EstimateAttempt) bool {
			if len(baseline.Routes) != 1 || len(baseline.Notices) != 0 {
				return false
			}
			_, valid := qualifyRoute(baseline.Routes[0])
			return valid
		}); err != nil {
		return domain.TrafficComparison{}, err
	}
	if len(baseline.Routes) != 1 || len(baseline.Notices) > 0 {
		return domain.TrafficComparison{}, ErrInsufficientEvidence
	}
	usual, ok := qualifyRoute(baseline.Routes[0])
	if !ok {
		return domain.TrafficComparison{}, ErrInsufficientEvidence
	}
	params.Set("origin", coordinateParam(points[0]))
	params.Set("destination", coordinateParam(points[len(points)-1]))
	params.Set("alternatives", "2")
	var routes routingResponse
	if err := c.call(ctx, authorize, http.MethodGet, c.routingURL+"/routes", params, nil, &routes,
		port.HERERoutes, func(_ port.EstimateAttempt) bool {
			if len(routes.Routes) == 0 || len(routes.Routes) > 3 || len(routes.Notices) > 0 {
				return false
			}
			for _, route := range routes.Routes {
				if _, valid := qualifyRoute(route); valid {
					return true
				}
			}
			return false
		}); err != nil {
		return domain.TrafficComparison{}, err
	}
	if len(routes.Routes) > 3 || len(routes.Notices) > 0 {
		return domain.TrafficComparison{}, ErrInsufficientEvidence
	}
	var best routeEstimate
	var bestSimilarS int64
	var offered []routeEstimate
	allQualified := query.RequireOfferedCoverage || query.IncludeRouteGeometry
	for _, raw := range routes.Routes {
		candidate, valid := qualifyRoute(raw)
		if !valid {
			allQualified = false
			continue
		}
		if query.RequireOfferedCoverage || query.IncludeRouteGeometry {
			offered = append(offered, candidate)
		}
		if !differsFrom(usual, candidate) {
			if bestSimilarS == 0 || candidate.durationS < bestSimilarS {
				bestSimilarS = candidate.durationS
			}
			continue
		}
		if best.durationS == 0 || candidate.durationS < best.durationS {
			best = candidate
		}
	}
	if best.durationS == 0 {
		return domain.TrafficComparison{}, ErrInsufficientEvidence
	}
	observedAt, coverage, err := c.liveCoverage(ctx, authorize, append([]routeEstimate{usual, best}, offered...))
	if err != nil {
		return domain.TrafficComparison{}, err
	}
	if !coverage[0] || !coverage[1] {
		return domain.TrafficComparison{}, ErrInsufficientEvidence
	}
	for _, covered := range coverage[2:] {
		allQualified = allQualified && covered
	}
	result := domain.TrafficComparison{
		Usual:                 domain.TrafficEstimate{DurationS: usual.durationS, FlowUpdatedAt: observedAt, RouteLabel: usual.label},
		Alternative:           domain.TrafficEstimate{DurationS: best.durationS, FlowUpdatedAt: observedAt, RouteLabel: best.label},
		AlternativesQualified: allQualified && (bestSimilarS == 0 || bestSimilarS >= min(usual.durationS, best.durationS)),
	}
	if query.IncludeRouteGeometry && allQualified {
		result.OfferedRoutes = coveredRouteGeometry(routes.Routes, offered, observedAt)
	}
	return result, nil
}

type waypoint struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

func coordinateParam(p waypoint) string {
	return strconv.FormatFloat(p.Lat, 'f', -1, 64) + "," + strconv.FormatFloat(p.Lng, 'f', -1, 64)
}

func inRange(value, min, max float64) bool {
	return !math.IsNaN(value) && value >= min && value <= max
}

func (c *Client) call(ctx context.Context, authorize func(context.Context) error, method, endpoint string,
	query url.Values, body any, result any, feed port.EstimateFeed, fresh func(port.EstimateAttempt) bool) error {
	if query == nil {
		query = make(url.Values)
	}
	query.Set("apiKey", c.apiKey)
	var reader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return ErrInvalidInput
		}
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint+"?"+query.Encode(), reader)
	if err != nil {
		return ErrInvalidInput
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache, no-store")
	if reader != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if err := authorize(ctx); err != nil {
		return err
	}
	var attempt port.EstimateAttempt
	track := c.health != nil
	if track {
		attempt, err = c.health.BeginEstimate(ctx, feed)
		if err != nil {
			return fmt.Errorf("check upstream estimate availability: %w", errors.Join(port.ErrEstimatesPaused, err))
		}
		if err := authorize(ctx); err != nil {
			return err
		}
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		// http.Client errors include the request URL, which contains the API key.
		if attempt.Recovery {
			return port.ErrEstimatesPaused
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("HERE request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		if track && resp.StatusCode == http.StatusServiceUnavailable && responseNotCached(resp) {
			if err := c.health.FinishEstimate(ctx, feed, attempt, false); err != nil {
				return fmt.Errorf("record upstream estimate outage: %w", errors.Join(port.ErrEstimatesPaused, err))
			}
			return port.ErrEstimatesPaused
		}
		if attempt.Recovery {
			return port.ErrEstimatesPaused
		}
		return fmt.Errorf("HERE request returned HTTP %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(data) > maxResponseBytes || json.Unmarshal(data, result) != nil {
		if attempt.Recovery {
			return port.ErrEstimatesPaused
		}
		return errors.New("invalid HERE response")
	}
	if track {
		valid := fresh(attempt)
		if !responseNotCached(resp) {
			return port.ErrEstimatesPaused
		}
		if valid {
			if err := c.health.FinishEstimate(ctx, feed, attempt, true); err != nil {
				return fmt.Errorf("record fresh upstream estimate: %w", errors.Join(port.ErrEstimatesPaused, err))
			}
		} else if attempt.Recovery {
			return port.ErrEstimatesPaused
		}
	}
	return nil
}

func responseNotCached(resp *http.Response) bool {
	age := strings.TrimSpace(resp.Header.Get("Age"))
	if age != "" && age != "0" {
		return false
	}
	for _, header := range []string{"Cache-Status", "X-Cache", "CF-Cache-Status"} {
		value := strings.ToLower(resp.Header.Get(header))
		if strings.Contains(value, "hit") || strings.Contains(value, "stale") {
			return false
		}
	}
	return true
}
