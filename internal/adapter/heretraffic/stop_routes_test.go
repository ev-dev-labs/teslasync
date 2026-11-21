package heretraffic

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

func TestCompareStopRoutesRequiresQualifiedRoadsAndCurrentConsent(t *testing.T) {
	origin, destination := domain.RoutePoint{Latitude: 47, Longitude: -122}, domain.RoutePoint{Latitude: 48, Longitude: -121}
	stops := []domain.RoutingStop{
		{PlaceID: 11, Location: domain.RoutePoint{Latitude: 47.25, Longitude: -121.75}},
		{PlaceID: 13, Location: domain.RoutePoint{Latitude: 47.5, Longitude: -121.5}},
	}
	for _, tt := range []struct {
		name       string
		revokeAt   int
		invalidVia bool
		notice     bool
		calls      int32
		wantErr    error
	}{
		{name: "compare both stations against the same no-stop baseline", calls: 3},
		{name: "opt-in off", revokeAt: 1, wantErr: context.Canceled},
		{name: "revoked after baseline", revokeAt: 2, calls: 1, wantErr: context.Canceled},
		{name: "revoked before returning", revokeAt: 4, calls: 3, wantErr: context.Canceled},
		{name: "route does not reach nominated stop", invalidVia: true, calls: 2, wantErr: ErrInsufficientEvidence},
		{name: "provider qualified route with a notice", notice: true, calls: 2, wantErr: ErrInsufficientEvidence},
	} {
		t.Run(tt.name, func(t *testing.T) {
			var calls atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				call := calls.Add(1)
				q := r.URL.Query()
				if r.Method != http.MethodGet || r.URL.Path != "/v8/routes" || q.Get("apiKey") != testKey ||
					q.Get("origin") != "47,-122" || q.Get("destination") != "48,-121" ||
					q.Get("transportMode") != "car" || q.Get("return") != "travelSummary" ||
					q.Get("departureTime") != "any" || len(q) != 6+min(1, int(call)-1) {
					t.Errorf("unexpected routing contract for request %d", call)
				}
				points := []string{"47,-122", "48,-121"}
				if call == 2 || call == 3 {
					via := []string{"47.25,-121.75", "47.5,-121.5"}[call-2]
					if q.Get("via") != via {
						t.Errorf("request %d missed nominated station", call)
					}
					if tt.invalidVia {
						via = "44,-120"
					}
					points = []string{points[0], via, points[1]}
				}
				w.Header().Set("Content-Type", "application/json")
				sections := make([]string, 0, len(points)-1)
				for i := 1; i < len(points); i++ {
					length, base := 160000, 7200
					if call > 1 {
						length, base = int(call)*20000*i+20000, int(call)*1000*i
					}
					notices := "[]"
					if tt.notice && call > 1 {
						notices = `[{"code":"violation"}]`
					}
					sections = append(sections, fmt.Sprintf(`{"type":"vehicle","transport":{"mode":"car"},
						"departure":%s,"arrival":%s,"notices":%s,
						"travelSummary":{"length":%d,"duration":%d,"baseDuration":%d}}`,
						roadEndpointFixture(points[i-1]), roadEndpointFixture(points[i]), notices, length, base+100, base))
				}
				fmt.Fprintf(w, `{"routes":[{"sections":[%s]}]}`, strings.Join(sections, ","))
			}))
			t.Cleanup(srv.Close)
			client := fixtureClient(t, srv.URL, time.Now())
			checks := 0
			got, err := client.CompareStopRoutes(t.Context(), origin, destination, stops, func(context.Context) error {
				checks++
				if checks == tt.revokeAt {
					return context.Canceled
				}
				return nil
			})
			if !errors.Is(err, tt.wantErr) || calls.Load() != tt.calls {
				t.Fatalf("error = %v, calls = %d; want %v, %d", err, calls.Load(), tt.wantErr, tt.calls)
			}
			if tt.wantErr != nil {
				if len(got.Via) != 0 || got.Direct != (domain.RoadLeg{}) {
					t.Fatalf("incomplete or revoked comparison returned partial evidence: %+v", got)
				}
				return
			}
			if got.Direct != (domain.RoadLeg{DistanceM: 160000, DurationS: 7200}) || len(got.Via) != 2 ||
				got.Via[0].PlaceID != 11 || got.Via[0].ToStop.DistanceM != 60000 ||
				got.Via[0].AfterStop.DurationS != 4000 || got.Via[1].PlaceID != 13 ||
				got.Via[1].AfterStop.DistanceM != 140000 {
				t.Fatalf("road evidence = %+v", got)
			}
		})
	}
}

func roadEndpointFixture(coordinates string) string {
	lat, lng, _ := strings.Cut(coordinates, ",")
	return fmt.Sprintf(`{"place":{"location":{"lat":%s,"lng":%s}}}`, lat, lng)
}
