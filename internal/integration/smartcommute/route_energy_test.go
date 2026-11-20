package smartcommute_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/rs/zerolog"
)

func TestRouteEnergyRequiresExplicitConsentAndCompleteMeasuredHistory(t *testing.T) {
	for _, tt := range []struct {
		name        string
		optedIn     bool
		lowCoverage bool
		staleTemp   bool
		revoke      bool
	}{
		{name: "consented measured tradeoff", optedIn: true},
		{name: "no local route analysis before consent"},
		{name: "long gap in one completed drive", optedIn: true, lowCoverage: true},
		{name: "stale outside temperature", optedIn: true, staleTemp: true},
		{name: "revoked while history query is in flight", optedIn: true, revoke: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			ctx := t.Context()
			live := &energyLiveFixture{trafficLiveFixture: trafficLiveFixture{gear: "P"}}
			f := newFixture(t, smartcommutesvc.WithTrafficLiveReader(live))
			live.now = f.now
			if tt.staleTemp {
				live.temperatureAge = 3 * time.Minute
			}
			const root, owner = "/api/v1/smart-commute", "route-energy-owner"
			expectStatus(t, f.request(t, http.MethodPut, root, owner, settings(42, true, true, false)), http.StatusNoContent)
			expectStatus(t, f.request(t, http.MethodPost, root+"/routines", owner, manualRoutine(42)), http.StatusCreated)
			var routine domain.Routine
			for _, row := range snapshot(t, f.request(t, http.MethodGet, root+"?vehicle_id=42", owner, nil)).Routines {
				if row.Status == domain.RoutineConfirmed {
					routine = row
				}
			}
			offered, driveID := seedRouteEnergyHistory(t, f, routine, tt.lowCoverage)
			route := fmt.Sprintf("%s/routines/%d", root, routine.ID)
			body := map[string]any{"vehicle_id": 42, "drive_id": driveID}
			preview := f.request(t, http.MethodPost, route+"/traffic-preview", owner, body)
			expectStatus(t, preview, http.StatusOK)
			var response struct{ Data domain.TrafficPreview }
			if err := json.NewDecoder(preview.Body).Decode(&response); err != nil {
				t.Fatal(err)
			}
			body["fingerprint"], body["share_with_here"], body["lead_s"], body["min_savings_s"] =
				response.Data.Fingerprint, true, 900, 480
			body["compare_route_energy"] = tt.optedIn
			expectStatus(t, f.request(t, http.MethodPut, route+"/traffic-consent", owner, body), http.StatusNoContent)

			queries, pushes := 0, 0
			source := trafficSourceFixture(func(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error) {
				if err := authorize(ctx); err != nil {
					return domain.TrafficComparison{}, err
				}
				queries++
				if query.IncludeRouteGeometry != tt.optedIn || len(query.Trace) != len(response.Data.Trace) {
					t.Fatal("provider query did not use only the reviewed trace and expected comparison mode")
				}
				result := domain.TrafficComparison{Usual: offered[0].TrafficEstimate, Alternative: offered[1].TrafficEstimate}
				if query.IncludeRouteGeometry {
					result.OfferedRoutes = offered
				}
				return result, nil
			})
			repo := commutedb.NewRepository(f.db)
			worker := smartcommutesvc.New(repo, smartcommutesvc.WithClock(func() time.Time { return f.now }),
				smartcommutesvc.WithTrafficLiveReader(live),
				smartcommutesvc.WithRouteEnergyHistory(repo, signal.NewLogStateReader(f.db.Pool, zerolog.Nop())),
				smartcommutesvc.WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) { return false, nil }, nil),
				smartcommutesvc.WithTrafficNotifier(func(context.Context, string, int64, int64, time.Time) error { pushes++; return nil }))
			scans := f.spy.count.Load()
			if tt.revoke {
				f.spy.started, f.spy.release = make(chan struct{}), make(chan struct{})
				f.spy.block.Store(true)
				done := make(chan error, 1)
				go func() {
					_, err := worker.ProcessTrafficChecks(ctx, 10)
					done <- err
				}()
				select {
				case <-f.spy.started:
				case <-time.After(5 * time.Second):
					close(f.spy.release)
					t.Fatal("worker never queried route history")
				}
				result := f.request(t, http.MethodDelete, route+"/traffic-consent?vehicle_id=42", owner, nil)
				close(f.spy.release)
				expectStatus(t, result, http.StatusNoContent)
				if err := <-done; err != nil {
					t.Fatal(err)
				}
			} else if processed, err := worker.ProcessTrafficChecks(ctx, 10); err != nil || processed != 1 {
				t.Fatalf("worker processed %d: %v", processed, err)
			}
			if queries != 1 || pushes != 0 || ((!tt.optedIn || tt.staleTemp) && f.spy.count.Load() != scans) {
				t.Fatalf("unexpected requests or delivery: calls=%d pushes=%d scans=%d", queries, pushes, f.spy.count.Load()-scans)
			}
			rows, err := worker.ListTrafficDecisions(ctx, owner, nil, f.now, 10)
			if err != nil {
				t.Fatal(err)
			}
			if !tt.optedIn || tt.lowCoverage || tt.staleTemp || tt.revoke {
				if len(rows) != 0 {
					t.Fatalf("weak or unconsented evidence produced a decision: %+v", rows)
				}
				return
			}
			if len(rows) != 1 || rows[0].RouteEnergy == nil || !rows[0].RouteEnergyOnly ||
				rows[0].RouteEnergy.Fastest.DriveCount != 4 || rows[0].RouteEnergy.Saving.DriveCount != 4 ||
				rows[0].RouteEnergy.Fastest.MedianWh < 8_900 || rows[0].RouteEnergy.Saving.MedianWh > 6_000 {
				t.Fatalf("expected one materially lower-energy comparison, got %+v", rows)
			}
			const center = "/api/v1/action-center?vehicle_id=42"
			assertCard := func(subject string, want bool) {
				t.Helper()
				out := f.request(t, http.MethodGet, center, subject, nil)
				expectStatus(t, out, http.StatusOK)
				if strings.Contains(out.Body.String(), "Compare a lower-energy route before departure") != want {
					t.Fatalf("unexpected private card: %s", out.Body.String())
				}
			}
			assertCard(owner, true)
			assertCard("foreign-subject", false)
			expectStatus(t, f.request(t, http.MethodDelete, route+"/traffic-consent?vehicle_id=42", owner, nil), http.StatusNoContent)
			assertCard(owner, false)
		})
	}
}

type energyLiveFixture struct {
	trafficLiveFixture
	temperatureAge time.Duration
}

func (l *energyLiveFixture) GetAll(ctx context.Context, vehicle int64, preference signal.LiveSignalReadPreference) (map[string]*signal.Value, error) {
	values, err := l.trafficLiveFixture.GetAll(ctx, vehicle, preference)
	if err != nil {
		return nil, err
	}
	values["OutsideTemp"] = &signal.Value{Raw: 12.0, Timestamp: l.now.Add(-l.temperatureAge)}
	return values, nil
}

func seedRouteEnergyHistory(t *testing.T, f *fixture, routine domain.Routine, lowCoverage bool) ([]domain.TrafficRoute, int64) {
	t.Helper()
	var offered []domain.TrafficRoute
	var lastID int64
	for index, corner := range []domain.Point{
		{Latitude: 47.15, Longitude: -122.11}, {Latitude: 47.15, Longitude: -122.19},
	} {
		etaS := int64(1800 + index*360)
		var geometry []domain.Point
		for _, leg := range [][2]domain.Point{{routine.Origin, corner}, {corner, routine.Destination}} {
			for step := range 12 {
				fraction := float64(step) / 12
				geometry = append(geometry, domain.Point{
					Latitude:  leg[0].Latitude + (leg[1].Latitude-leg[0].Latitude)*fraction,
					Longitude: leg[0].Longitude + (leg[1].Longitude-leg[0].Longitude)*fraction,
				})
			}
		}
		geometry = append(geometry, routine.Destination)
		offered = append(offered, domain.TrafficRoute{
			TrafficEstimate: domain.TrafficEstimate{DurationS: etaS, FlowUpdatedAt: f.now.Add(-time.Minute)},
			Geometry:        geometry,
		})
		for day := range 4 {
			start := f.now.AddDate(0, 0, -(1 + index*4 + day))
			duration := time.Duration(etaS) * time.Second
			if err := f.db.Pool.QueryRow(t.Context(), `
				INSERT INTO drives (vehicle_id,started_at,ended_at,start_lat,start_lng,end_lat,end_lng)
				VALUES (42,$1,$2,$3,$4,$5,$6) RETURNING id`, start, start.Add(duration),
				routine.Origin.Latitude, routine.Origin.Longitude, routine.Destination.Latitude, routine.Destination.Longitude).Scan(&lastID); err != nil {
				t.Fatal(err)
			}
			current := 45 - 21*index
			if _, err := f.db.Pool.Exec(t.Context(), `
				INSERT INTO signal_log (vehicle_id,ts,field,value_kind,float_value,received_at)
				SELECT 42, $1::timestamptz + n * INTERVAL '15 seconds', m.field, $2, m.value, $1
				FROM generate_series(0,$3::int/15) n
				CROSS JOIN LATERAL (
				    SELECT CASE WHEN 30*n <= $3 THEN 30.0*n/$3 ELSE (30.0*n-$3)/$3 END AS f,
				           30*n <= $3 AS first
				) p
				CROSS JOIN LATERAL (VALUES
				    ('LocationLatitude', CASE WHEN p.first THEN $4::float8+(($6::float8-$4::float8)*p.f) ELSE $6::float8+(($8::float8-$6::float8)*p.f) END),
				    ('LocationLongitude', CASE WHEN p.first THEN $5::float8+(($7::float8-$5::float8)*p.f) ELSE $7::float8+(($9::float8-$7::float8)*p.f) END),
				    ('OutsideTemp', 12), ('PackVoltage', 400), ('PackCurrent', $10::float8)
				) m(field,value)
				WHERE NOT ($11 AND m.field='PackCurrent' AND n BETWEEN 5 AND 20)`,
				start, protomodel.ValueKindDouble, etaS, routine.Origin.Latitude, routine.Origin.Longitude,
				corner.Latitude, corner.Longitude, routine.Destination.Latitude, routine.Destination.Longitude,
				current, lowCoverage && index == 1 && day == 0); err != nil {
				t.Fatal(err)
			}
		}
	}
	return offered, lastID
}
