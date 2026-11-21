package heretraffic

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	ready "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
)

const (
	testKey = "synthetic-here-key"
	fromRef = "hrn:here:data::olp-here:rib-2:3217::377894451:here:cm:segment:"
)

func TestHEREOutageRequiresExplicitUnavailableAndFreshFlowRecovery(t *testing.T) {
	now := time.Date(2026, 4, 7, 11, 45, 0, 0, time.UTC)
	var flowStatus atomic.Int32
	flowStatus.Store(http.StatusUnauthorized)
	var cached, stale, malformed, oppositeDirection atomic.Bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v8/import":
			fmt.Fprintf(w, `{"routes":[%s]}`, routeFixture(1001, 2580))
		case "/v8/routes":
			if r.URL.Query().Get("departureTime") == "any" {
				fmt.Fprintf(w, `{"routes":[{"sections":[{"type":"vehicle","transport":{"mode":"car"},
					"departure":%s,"arrival":%s,
					"travelSummary":{"length":160000,"baseDuration":7200}}]}]}`,
					roadEndpointFixture("47,-122"), roadEndpointFixture("48,-121"))
				return
			}
			fmt.Fprintf(w, `{"routes":[%s,%s]}`, routeFixture(1001, 2580), routeFixture(1002, 1740))
		case "/v7/flow":
			if cached.Load() {
				w.Header().Set("Age", "180")
			}
			code := int(flowStatus.Load())
			w.WriteHeader(code)
			if code == http.StatusOK {
				if malformed.Load() {
					fmt.Fprint(w, "{")
					return
				}
				updated := now.Add(-time.Minute)
				if stale.Load() {
					updated = now.Add(-3 * time.Minute)
				}
				direction := "#+0..1"
				if oppositeDirection.Load() {
					direction = "#-0..1"
				}
				fmt.Fprintf(w, `{"sourceUpdated":%q,"results":[%s,%s]}`, updated.Format(time.RFC3339),
					flowRouteFixture(fromRef+"1001"+direction), flowRouteFixture(fromRef+"1002"+direction))
			}
		default:
			t.Errorf("unexpected provider path %q", r.URL.Path)
		}
	}))
	defer srv.Close()
	client := fixtureClient(t, srv.URL, now)
	health := &testEstimateHealth{now: now}
	client.health = health
	var timedOut atomic.Bool
	transport := client.httpClient.Transport
	client.httpClient.Transport = fixtureRoundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.URL.Path == "/v7/flow" && timedOut.Load() {
			return nil, context.DeadlineExceeded
		}
		return transport.RoundTrip(r)
	})
	allow := func(context.Context) error { return nil }
	compare := func() error {
		_, err := client.Compare(t.Context(), fixtureQuery(now), allow)
		return err
	}
	if err := compare(); err == nil || health.unavailable != 0 {
		t.Fatalf("authorization failure triggered outage: %v, %d", err, health.unavailable)
	}
	timedOut.Store(true)
	if err := compare(); err == nil || errors.Is(err, port.ErrEstimatesPaused) || health.unavailable != 0 {
		t.Fatalf("timeout triggered an outage: %v, %d", err, health.unavailable)
	}
	timedOut.Store(false)
	flowStatus.Store(http.StatusServiceUnavailable)
	cached.Store(true)
	if err := compare(); err == nil || health.unavailable != 0 {
		t.Fatalf("cached unavailable response triggered outage: %v, %d", err, health.unavailable)
	}
	cached.Store(false)
	if _, err := client.Compare(t.Context(), fixtureQuery(now), func(context.Context) error {
		return context.Canceled
	}); !errors.Is(err, context.Canceled) || health.unavailable != 0 {
		t.Fatalf("unconsented traffic demand observed provider failure: %v, %d", err, health.unavailable)
	}
	if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.unavailable != 1 {
		t.Fatalf("verified Flow outage did not pause estimates: %v, %d", err, health.unavailable)
	}
	if legs, err := client.stopRoadLegs(t.Context(), []ready.RoutePoint{
		{Latitude: 47, Longitude: -122}, {Latitude: 48, Longitude: -121},
	}, allow); err != nil || len(legs) != 1 {
		t.Fatalf("unaffected route-only estimate failed: %+v, %v", legs, err)
	}
	for _, status := range []int{http.StatusUnauthorized, http.StatusNotFound, http.StatusTooManyRequests, http.StatusBadGateway} {
		flowStatus.Store(int32(status))
		if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.recoveries != 0 || health.unavailable != 1 {
			t.Fatalf("unknown replay status %d changed the existing outage: %v, %d/%d", status, err, health.unavailable, health.recoveries)
		}
	}
	flowStatus.Store(http.StatusOK)
	malformed.Store(true)
	if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.recoveries != 0 {
		t.Fatalf("malformed Flow data recovered outage: %v, %d", err, health.recoveries)
	}
	malformed.Store(false)
	stale.Store(true)
	if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.recoveries != 0 {
		t.Fatalf("pre-outage Flow data recovered outage: %v, %d", err, health.recoveries)
	}
	stale.Store(false)
	oppositeDirection.Store(true)
	if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.recoveries != 0 {
		t.Fatalf("Flow evidence for the opposite direction recovered outage: %v, %d", err, health.recoveries)
	}
	oppositeDirection.Store(false)
	cached.Store(true)
	if err := compare(); !errors.Is(err, port.ErrEstimatesPaused) || health.recoveries != 0 {
		t.Fatalf("cached Flow data recovered outage: %v, %d", err, health.recoveries)
	}
	cached.Store(false)
	if err := compare(); err != nil || health.recoveries != 1 {
		t.Fatalf("fresh Flow data did not resume estimates: %v, %d", err, health.recoveries)
	}
}

type fixtureRoundTripFunc func(*http.Request) (*http.Response, error)

func (f fixtureRoundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type testEstimateHealth struct {
	now                     time.Time
	unavailable, recoveries int
}

func (h *testEstimateHealth) BeginEstimate(_ context.Context, feed port.EstimateFeed) (port.EstimateAttempt, error) {
	attempt := port.EstimateAttempt{StartedAt: h.now}
	if feed == port.HEREFlow && h.unavailable > h.recoveries {
		attempt.OutageAt, attempt.Recovery = h.now.Add(-2*time.Minute), true
	}
	return attempt, nil
}

func (h *testEstimateHealth) FinishEstimate(_ context.Context, feed port.EstimateFeed, attempt port.EstimateAttempt, available bool) error {
	if feed == port.HEREFlow {
		if !available {
			h.unavailable++
		} else if attempt.Recovery {
			h.recoveries++
		}
	}
	return nil
}

func TestCompareHEREWireContract(t *testing.T) {
	now := time.Date(2026, 4, 7, 11, 45, 0, 0, time.UTC)
	for _, tt := range []struct {
		name        string
		sourceAge   time.Duration
		flowRef     string
		confidence  float64
		closed      bool
		revokeAfter int32
		wantCalls   int32
		want        error
	}{
		{"fresh matching routes", time.Minute, fromRef + "1002#+0..1", .91, false, 0, 3, nil},
		{"whole trip not covered by partial live span", time.Minute, fromRef + "1002#+0.2..1", .91, false, 0, 3, ErrInsufficientEvidence},
		{"opposite direction does not qualify", time.Minute, fromRef + "1002#-0..1", .91, false, 0, 3, ErrInsufficientEvidence},
		{"historical flow does not qualify", time.Minute, fromRef + "1002#+0..1", .70, false, 0, 3, ErrInsufficientEvidence},
		{"closed route not offered", time.Minute, fromRef + "1002#+0..1", .91, true, 0, 3, ErrInsufficientEvidence},
		{"stale source timestamp", 6 * time.Minute, fromRef + "1002#+0..1", .91, false, 0, 3, ErrInsufficientEvidence},
		{"consent withdrawn before route import", time.Minute, "", 0, false, 1, 0, context.Canceled},
		{"consent withdrawn before flow request", time.Minute, "", 0, false, 3, 2, context.Canceled},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.URL.Query().Get("apiKey") != testKey {
					t.Error("provider request did not use configured key")
				}
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v8/import", "/v8/routes":
					assertRoutingRequest(t, r)
					if r.URL.Path == "/v8/import" {
						fmt.Fprintf(w, `{"routes":[%s]}`, routeFixture(1001, 2580))
						return
					}
					fmt.Fprintf(w, `{"routes":[%s,%s]}`, routeFixture(1001, 2580), routeFixture(1002, 1740))
				case "/v7/flow":
					if r.Method != http.MethodPost || r.URL.RawQuery != "apiKey="+testKey {
						t.Errorf("unexpected flow request: %s %s", r.Method, r.URL.Path)
					}
					var body flowRequest
					if json.NewDecoder(r.Body).Decode(&body) != nil || body.In.Type != "segmentRef" ||
						len(body.LocationReferencing) != 1 || body.LocationReferencing[0] != "segmentRef" ||
						len(body.In.Segments) != 2 || body.In.Segments[0].Ref != fromRef+"1001#+0..1" ||
						body.In.Segments[1].Ref != fromRef+"1002#+0..1" {
						t.Errorf("unexpected flow body: %+v", body)
					}
					state := "open"
					if tt.closed {
						state = "closed"
					}
					fmt.Fprintf(w, `{"sourceUpdated":%q,"results":[
						{"location":{"segmentRef":{"segments":[{"ref":%q,"length":10000}]}},
						 "currentFlow":{"speed":10,"confidence":0.97,"traversability":"open"}},
						{"location":{"segmentRef":{"segments":[{"ref":%q,"length":10000}]}},
						 "currentFlow":{"speed":20,"confidence":%g,"traversability":%q}}
					]}`, now.Add(-tt.sourceAge).Format(time.RFC3339), fromRef+"1001#+0..1", tt.flowRef, tt.confidence, state)
				default:
					t.Errorf("unexpected provider path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(server.Close)
			client := fixtureClient(t, server.URL, now)
			var checks int32
			comparison, err := client.Compare(t.Context(), fixtureQuery(now), func(context.Context) error {
				checks++
				if checks == tt.revokeAfter {
					return context.Canceled
				}
				return nil
			})
			if !errors.Is(err, tt.want) || calls.Load() != tt.wantCalls {
				t.Fatalf("compare error = %v, calls = %d; want %v, %d", err, calls.Load(), tt.want, tt.wantCalls)
			}
			if tt.want == nil && (comparison.Usual.DurationS != 2580 || comparison.Alternative.DurationS != 1740 ||
				comparison.Usual.RouteLabel != "Synthetic Parkway, SR 1001" || comparison.Alternative.RouteLabel != "Synthetic Bypass, SR 1002" ||
				len(comparison.OfferedRoutes) != 0 ||
				!comparison.Usual.FlowUpdatedAt.Equal(now.Add(-time.Minute)) ||
				!comparison.Alternative.FlowUpdatedAt.Equal(now.Add(-time.Minute))) {
				t.Fatalf("unexpected fresh comparison: %+v", comparison)
			}
		})
	}
}

func TestCompareDoesNotFollowProviderRedirect(t *testing.T) {
	var redirected atomic.Bool
	trap := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { redirected.Store(true) }))
	t.Cleanup(trap.Close)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, trap.URL, http.StatusTemporaryRedirect)
	}))
	t.Cleanup(server.Close)
	now := time.Date(2026, 4, 7, 11, 45, 0, 0, time.UTC)
	client := fixtureClient(t, server.URL, now)
	_, err := client.Compare(t.Context(), fixtureQuery(now), func(context.Context) error { return nil })
	if err == nil || strings.Contains(err.Error(), testKey) || redirected.Load() {
		t.Fatalf("redirect was followed or exposed request credentials: %v", err)
	}
}

func TestDeadlineEvidenceRequiresEveryOfferedRoute(t *testing.T) {
	now := time.Date(2026, 4, 7, 11, 45, 0, 0, time.UTC)
	for _, tt := range []struct {
		name        string
		includeFlow bool
		want        bool
	}{
		{name: "all offered routes covered", includeFlow: true, want: true},
		{name: "only the compared pair covered"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				switch r.URL.Path {
				case "/v8/import":
					assertRoutingRequest(t, r)
					fmt.Fprintf(w, `{"routes":[%s]}`, routeFixture(1001, 2580))
				case "/v8/routes":
					assertRoutingRequest(t, r)
					fmt.Fprintf(w, `{"routes":[%s,%s,%s]}`, routeFixture(1001, 2580), routeFixture(1002, 2760), routeFixture(1003, 3000))
				case "/v7/flow":
					var body flowRequest
					if json.NewDecoder(r.Body).Decode(&body) != nil || len(body.In.Segments) != 3 ||
						body.In.Segments[2].Ref != fromRef+"1003#+0..1" {
						t.Errorf("third offered route was not requested: %+v", body)
					}
					results := []string{
						flowRouteFixture(fromRef + "1001#+0..1"), flowRouteFixture(fromRef + "1002#+0..1"),
					}
					if tt.includeFlow {
						results = append(results, flowRouteFixture(fromRef+"1003#+0..1"))
					}
					fmt.Fprintf(w, `{"sourceUpdated":%q,"results":[%s]}`, now.Add(-time.Minute).Format(time.RFC3339), strings.Join(results, ","))
				default:
					t.Errorf("unexpected provider path %s", r.URL.Path)
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			t.Cleanup(server.Close)
			query := fixtureQuery(now)
			query.RequireOfferedCoverage = true
			query.IncludeRouteGeometry = true
			result, err := fixtureClient(t, server.URL, now).Compare(t.Context(), query, func(context.Context) error { return nil })
			if err != nil || result.Alternative.DurationS != 2760 || result.AlternativesQualified != tt.want {
				t.Fatalf("unexpected deadline evidence: %+v, %v", result, err)
			}
			if tt.want {
				if len(result.OfferedRoutes) != 3 || len(result.OfferedRoutes[0].Geometry) < 3 ||
					result.OfferedRoutes[2].DurationS != 3000 {
					t.Fatal("covered offered routes were not returned with their geometry and ETA")
				}
			} else if len(result.OfferedRoutes) != 0 {
				t.Fatal("incomplete coverage must not expose route geometry for comparison")
			}
		})
	}
}

func flowRouteFixture(ref string) string {
	return fmt.Sprintf(`{"location":{"segmentRef":{"segments":[{"ref":%q,"length":10000}]}},
		"currentFlow":{"speed":10,"confidence":0.97,"traversability":"open"}}`, ref)
}

func fixtureClient(t *testing.T, base string, now time.Time) *Client {
	t.Helper()
	client, err := New(testKey)
	if err != nil {
		t.Fatal(err)
	}
	client.routingURL, client.trafficURL = base+"/v8", base+"/v7"
	client.now = func() time.Time { return now }
	return client
}

func fixtureQuery(now time.Time) smartcommute.TrafficQuery {
	return smartcommute.TrafficQuery{DepartureAt: now.Add(15 * time.Minute), Trace: []smartcommute.Point{
		{Latitude: 47.1, Longitude: -122.1},
		{Latitude: 47.15, Longitude: -122.12},
		{Latitude: 47.2, Longitude: -122.2},
	}}
}

func routeFixture(id, durationS int) string {
	name := "Synthetic Parkway"
	if id != 1001 {
		name = "Synthetic Bypass"
	}
	return fmt.Sprintf(`{"routeLabels":[{"label_type":"Name","name":{"value":%q,"language":"en"}},
		{"label_type":"RouteNumber","name":{"value":"SR %d"}}],"sections":[{
		"type":"vehicle","polyline":"BG-6kmkDw1zwZqqG6xmBsgL5rGmwFgqZ_oEw1d",
		"summary":{"duration":%d,"length":10000},
		"refReplacements":{"0":"hrn:here:data::olp-here:rib-2:3217:","1":"here:cm:segment"},
		"spans":[{"offset":0,"length":10000,"segmentRef":"$0:377894451:$1:%d#+0..1"}]
	}]}`, name, id, durationS, id)
}

func assertRoutingRequest(t *testing.T, r *http.Request) {
	t.Helper()
	params := r.URL.Query()
	if params.Get("departureTime") != "2026-04-07T12:00:00Z" || params.Get("return") != "polyline,summary,routeLabels" ||
		params.Get("spans") != "segmentRef,length" || params.Get("transportMode") != "car" {
		t.Errorf("unexpected routing contract for %s", r.URL.Path)
	}
	if r.URL.Path == "/v8/import" {
		var body map[string][]waypoint
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/json" ||
			json.NewDecoder(r.Body).Decode(&body) != nil || len(body) != 1 || len(body["trace"]) != 3 ||
			body["trace"][1] != (waypoint{Lat: 47.15, Lng: -122.12}) || len(params) != 5 {
			t.Error("route import must send only the approved synthetic trace and route settings")
		}
		return
	}
	if r.Method != http.MethodGet || params.Get("origin") != "47.1,-122.1" ||
		params.Get("destination") != "47.2,-122.2" || params.Get("alternatives") != "2" || len(params) != 8 {
		t.Error("alternative routing must send only the approved endpoints and route settings")
	}
}
