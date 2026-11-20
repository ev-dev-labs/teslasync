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
)

const (
	testKey = "synthetic-here-key"
	fromRef = "hrn:here:data::olp-here:rib-2:3217::377894451:here:cm:segment:"
)

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
	return fmt.Sprintf(`{"sections":[{
		"type":"vehicle","polyline":"BG-6kmkDw1zwZqqG6xmBsgL5rGmwFgqZ_oEw1d",
		"summary":{"duration":%d,"length":10000},
		"refReplacements":{"0":"hrn:here:data::olp-here:rib-2:3217:","1":"here:cm:segment"},
		"spans":[{"offset":0,"length":10000,"segmentRef":"$0:377894451:$1:%d#+0..1"}]
	}]}`, durationS, id)
}

func assertRoutingRequest(t *testing.T, r *http.Request) {
	t.Helper()
	params := r.URL.Query()
	if params.Get("departureTime") != "2026-04-07T12:00:00Z" || params.Get("return") != "polyline,summary" ||
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
