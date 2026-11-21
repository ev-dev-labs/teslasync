package smartcommute_test

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/smartcommutesvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	observabilitydb "github.com/ev-dev-labs/teslasync/internal/database/observability"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	commutedb "github.com/ev-dev-labs/teslasync/internal/database/smartcommute"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	commute "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
	delivery "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	commuteport "github.com/ev-dev-labs/teslasync/internal/port/smartcommute"
	deliveryport "github.com/ev-dev-labs/teslasync/internal/port/smartdelivery"
	"github.com/go-chi/chi/v5"
)

type capturedPush struct {
	mu       sync.Mutex
	messages []json.RawMessage
	unknown  bool
}

func (*capturedPush) IsEnabled() bool { return true }
func (*capturedPush) PublicKey() string {
	return "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM"
}

func (s *capturedPush) Send(_ context.Context, _ delivery.Subscription, payload []byte, _ time.Duration) (delivery.DeliveryStatus, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.messages = append(s.messages, append(json.RawMessage(nil), payload...))
	if s.unknown {
		return delivery.DeliveryUnknown, errors.New("synthetic transport timed out")
	}
	return delivery.DeliveryAccepted, nil
}

func (s *capturedPush) latest() (int, json.RawMessage) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if n := len(s.messages); n > 0 {
		return n, s.messages[n-1]
	}
	return 0, nil
}

func attachCommuteDelivery(t *testing.T, f *fixture, live *trafficLiveFixture, sender *capturedPush) *smartdeliverysvc.Service {
	t.Helper()
	ctx := context.Background()
	if _, err := f.db.Pool.Exec(ctx, `
		CREATE TABLE geofences (id bigint PRIMARY KEY);
		CREATE TABLE notification_logs (id bigint, status text, created_at timestamptz);
	`); err != nil {
		t.Fatal(err)
	}
	for _, file := range []string{
		"000170_quiet_hours", "000260_smart_charging_readiness", "000263_smart_personal_push",
		"000269_smart_commute_personal_push", "000274_smart_public_charging_fee_terms",
		"000275_smart_solar_charging",
		"000283_smart_cabin_prep",
		"000285_smart_park_reserve",
		"000288_smart_window_rain",
		"000289_smart_parked_closure",
		"000290_smart_parked_unlock",
		"000314_smart_backup_charging",
	} {
		content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", file+".up.sql"))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.Pool.Exec(ctx, string(content)); err != nil {
			t.Fatalf("apply %s: %v", file, err)
		}
	}
	cipher, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	repo := deliverydb.NewRepository(f.db)
	service := smartdeliverysvc.New(repo, cipher, sender,
		smartdeliverysvc.WithClock(func() time.Time { return f.now }),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(f.db)),
		smartdeliverysvc.WithCommuteDelivery(repo, func(ctx context.Context, vehicle int64, origin commute.Point, now time.Time) (bool, error) {
			return smartcommutesvc.ParkedAtTrafficOrigin(ctx, live, vehicle, origin, now)
		}))
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		deliveryhandler.NewHandler(service, "X-Test-Subject").MountRoutes(r)
	})
	app := f.router
	f.router = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasPrefix(r.URL.Path, "/api/v1/smart-delivery/") {
			app.ServeHTTP(w, r)
			return
		}
		if r.Header.Get("X-Test-Subject") == "" {
			if cookie, err := r.Cookie("commute_test_subject"); err == nil {
				r.Header.Set("X-Test-Subject", cookie.Value)
			}
		}
		router.ServeHTTP(w, r)
	})
	return service
}

func TestCommutePushClaimsAndSuppression(t *testing.T) {
	tests := []string{"accepted", "opt_out", "revoked", "stale", "moving", "reparked", "departed_during_dispatch",
		"expired", "replaced_device", "quiet", "unknown", "charging_cooldown", "outage_before_dispatch", "outage_after_reservation"}
	for _, scenario := range tests {
		t.Run(scenario, func(t *testing.T) {
			testCommuteDelivery(t, scenario)
		})
	}
}

func interruptHEREFlow(ctx context.Context, f *fixture) error {
	health := observabilitydb.NewEstimateHealth(f.db, "")
	attempt, err := health.BeginEstimate(ctx, commuteport.HEREFlow)
	if err != nil {
		return err
	}
	return health.FinishEstimate(ctx, commuteport.HEREFlow, attempt, false)
}

func testCommuteDelivery(t *testing.T, scenario string) {
	t.Helper()
	const subject = "synthetic-commute-delivery-owner"
	const settingsPath = "/api/v1/smart-commute"
	const devicesPath = "/api/v1/smart-delivery/devices"
	ctx := context.Background()
	live := &trafficLiveFixture{gear: "P"}
	var deliveryService *smartdeliverysvc.Service
	source := trafficSourceFixture(func(ctx context.Context, _ commute.TrafficQuery, authorize func(context.Context) error) (commute.TrafficComparison, error) {
		if err := authorize(ctx); err != nil {
			return commute.TrafficComparison{}, err
		}
		observed := live.now.Add(-time.Minute)
		return commute.TrafficComparison{
			Usual:       commute.TrafficEstimate{DurationS: 2580, FlowUpdatedAt: observed},
			Alternative: commute.TrafficEstimate{DurationS: 1740, FlowUpdatedAt: observed},
		}, nil
	})
	var f *fixture
	f = newFixture(t, smartcommutesvc.WithTrafficLiveReader(live),
		smartcommutesvc.WithTrafficEvaluator(source, func(context.Context, string, time.Time) (bool, error) { return false, nil }, nil),
		smartcommutesvc.WithTrafficNotifier(func(ctx context.Context, subject string, consentID, routineID int64, departure time.Time) error {
			if scenario == "outage_before_dispatch" {
				if err := interruptHEREFlow(ctx, f); err != nil {
					return err
				}
			}
			if scenario == "departed_during_dispatch" || scenario == "outage_after_reservation" {
				if scenario == "departed_during_dispatch" {
					f.now = f.now.Add(90 * time.Second)
					live.now = f.now
				}
				reads := 0
				live.beforeRead = func(ctx context.Context) error {
					reads++
					if reads == 2 {
						if scenario == "outage_after_reservation" {
							var status string
							if err := f.db.Pool.QueryRow(ctx, `SELECT status FROM smart_push_commute_deliveries`).Scan(&status); err != nil || status != "dispatching" {
								t.Fatalf("interruption must happen after reservation, got %q: %v", status, err)
							}
							return interruptHEREFlow(ctx, f)
						}
						recordTrafficDeparture(t, f)
					}
					return nil
				}
				defer func() { live.beforeRead = nil }()
			}
			return deliveryService.NotifyCommute(ctx, subject, consentID, routineID, departure)
		}))
	live.now = f.now
	sender := &capturedPush{}
	deliveryService = attachCommuteDelivery(t, f, live, sender)
	device := enrollCommuteBrowser(t, f, sender, subject, "first")
	path := fmt.Sprintf("%s/%d/commute", devicesPath, device)
	allow := map[string]any{"enabled": true, "copy": delivery.Copy{Title: "Smart Commute", Body: "Compare in TeslaSync."}}
	expectStatus(t, f.request(t, http.MethodPut, path, "other", allow), http.StatusNotFound)
	if scenario != "opt_out" {
		expectStatus(t, f.request(t, http.MethodPut, path, subject, allow), http.StatusNoContent)
	}
	if scenario == "quiet" {
		if _, err := f.db.Pool.Exec(ctx, `
			INSERT INTO notification_quiet_hours (user_id, start_local, end_local, timezone)
			VALUES ($1,'07:00','08:00','America/Los_Angeles')`, subject); err != nil {
			t.Fatal(err)
		}
	}
	if scenario == "charging_cooldown" {
		insertChargingAttempt(t, f, device, subject)
	}
	expectStatus(t, f.request(t, http.MethodPut, settingsPath, subject, settings(42, true, true, false)), http.StatusNoContent)
	expectStatus(t, f.request(t, http.MethodPost, settingsPath+"/routines", subject, manualRoutine(42)), http.StatusCreated)
	saved := snapshot(t, f.request(t, http.MethodGet, settingsPath+"?vehicle_id=42", subject, nil))
	var routine commute.Routine
	for _, row := range saved.Routines {
		if row.Status == commute.RoutineConfirmed {
			routine = row
		}
	}
	departure := f.now.Add(15 * time.Minute)
	repo := commutedb.NewRepository(f.db)
	if err := repo.SaveTrafficConsent(ctx, subject, routine, commute.TrafficConsent{
		Trace: []commute.Point{routine.Origin, {Latitude: 47.15, Longitude: -122.15}, routine.Destination},
		LeadS: 900, MinSavingsS: 480, CheckAt: f.now, DepartureAt: departure,
	}, f.now); err != nil {
		t.Fatal(err)
	}
	baseline, _ := sender.latest()
	sender.unknown = scenario == "unknown"
	for range 2 {
		if _, err := f.commute.ProcessTrafficChecks(ctx, 10); err != nil {
			t.Fatal(err)
		}
	}
	count, payload := sender.latest()
	if scenario == "opt_out" || scenario == "quiet" || scenario == "charging_cooldown" ||
		scenario == "departed_during_dispatch" || scenario == "outage_before_dispatch" || scenario == "outage_after_reservation" {
		if count != baseline {
			t.Fatal("a suppressed commute arrived at the push transport")
		}
		if scenario == "departed_during_dispatch" || scenario == "outage_after_reservation" {
			var state string
			if err := f.db.Pool.QueryRow(ctx, `SELECT status FROM smart_push_commute_deliveries`).Scan(&state); err != nil || state != "failed" {
				t.Fatalf("ineligibility after reservation did not abort the pending push: %q, %v", state, err)
			}
		}
		if scenario == "outage_before_dispatch" || scenario == "outage_after_reservation" {
			var active bool
			if err := f.db.Pool.QueryRow(ctx, `SELECT incident_id IS NOT NULL FROM here_estimate_health WHERE feed = 'here_flow'`).Scan(&active); err != nil || !active {
				t.Fatalf("the delivery was not tested during a persisted outage: %t, %v", active, err)
			}
			rows, err := f.commute.ListTrafficDecisions(ctx, subject, nil, f.now, 10)
			if err != nil || len(rows) != 0 {
				t.Fatalf("previous decision remained visible during outage: %v, %v", rows, err)
			}
		}
		return
	}
	var sent map[string]string
	if count != baseline+1 || json.Unmarshal(payload, &sent) != nil || len(sent) != 2 || sent["kind"] != "commute" || sent["token"] == "" {
		t.Fatalf("expected one opaque commute payload: %d attempts, %s", count-baseline, payload)
	}
	var consentID int64
	var status string
	if err := f.db.Pool.QueryRow(ctx, `SELECT consent_id, status FROM smart_push_commute_deliveries`).Scan(&consentID, &status); err != nil {
		t.Fatal(err)
	}
	if scenario == "unknown" && status != "unknown" {
		t.Fatalf("transport timeout recorded as %q", status)
	}
	if err := deliveryService.NotifyCommute(ctx, subject, consentID, routine.ID, departure); err != nil {
		t.Fatal(err)
	}
	if after, _ := sender.latest(); after != count {
		t.Fatal("deduplicated commute was replayed")
	}
	claim := func(as string) *delivery.Notification {
		t.Helper()
		if as != subject {
			_, err := deliveryService.ClaimCommute(ctx, as, sent["token"])
			if !errors.Is(err, deliveryport.ErrNotFound) {
				t.Fatalf("foreign subject claim: %v", err)
			}
			return nil
		}
		result, err := deliveryService.ClaimCommute(ctx, as, sent["token"])
		if err != nil && !errors.Is(err, deliveryport.ErrNotFound) {
			t.Fatal(err)
		}
		return result
	}
	claim("other")
	switch scenario {
	case "revoked":
		if err := repo.DeleteTrafficConsent(ctx, subject, 42, routine.ID); err != nil {
			t.Fatal(err)
		}
	case "stale":
		live.now = f.now.Add(-3 * time.Minute)
	case "moving":
		live.gear = "D"
	case "reparked":
		f.now = f.now.Add(90 * time.Second)
		live.now = f.now
		recordTrafficDeparture(t, f)
	case "expired":
		f.now, live.now = departure, departure
	case "replaced_device":
		next := enrollCommuteBrowser(t, f, sender, subject, "second")
		expectStatus(t, f.request(t, http.MethodPut, fmt.Sprintf("%s/%d/commute", devicesPath, next), subject, allow), http.StatusNoContent)
		afterEnroll, _ := sender.latest()
		if err := deliveryService.NotifyCommute(ctx, subject, consentID, routine.ID, departure); err != nil {
			t.Fatal(err)
		}
		if after, _ := sender.latest(); after != afterEnroll {
			t.Fatal("changing the device replayed the same commute")
		}
		expectStatus(t, f.request(t, http.MethodPut, path, subject, allow), http.StatusNoContent)
	}
	if result := claim(subject); scenario == "accepted" || scenario == "unknown" {
		want := commute.TrafficComparisonPath(42, commute.TrafficOccurrenceID(routine.ID, departure))
		if result == nil || result.Title != "Smart Commute" || result.URL != want {
			t.Fatalf("unexpected claim: %+v", result)
		}
	} else if result != nil {
		t.Fatalf("suppressed claim produced a notification: %+v", result)
	}
	if result := claim(subject); result != nil {
		t.Fatal("commute token could be consumed twice")
	}
}

func enrollCommuteBrowser(t *testing.T, f *fixture, sender *capturedPush, subject, name string) int64 {
	t.Helper()
	const root = "/api/v1/smart-delivery/devices"
	enrollment := f.request(t, http.MethodPost, root, subject, map[string]any{
		"subscription": delivery.Subscription{
			Endpoint: "https://push.example.invalid/" + name, P256DH: sender.PublicKey(),
			Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
		},
		"texts": delivery.Texts{
			VerificationTitle: "TeslaSync", VerificationBody: "This browser is ready.",
			ChargingTitle: "Charging readiness", ChargingBody: "Review in TeslaSync.",
		},
	})
	expectStatus(t, enrollment, http.StatusCreated)
	var response struct {
		Data delivery.Device `json:"data"`
	}
	if err := json.Unmarshal(enrollment.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	_, raw := sender.latest()
	var challenge map[string]any
	if err := json.Unmarshal(raw, &challenge); err != nil {
		t.Fatal(err)
	}
	verify := fmt.Sprintf("%s/%d/verify", root, response.Data.ID)
	expectStatus(t, f.request(t, http.MethodPost, verify, subject, map[string]any{"token": challenge["token"]}), http.StatusOK)
	return response.Data.ID
}

func insertChargingAttempt(t *testing.T, f *fixture, device int64, subject string) {
	t.Helper()
	if _, err := f.db.Pool.Exec(context.Background(), `
		WITH plan AS (
			INSERT INTO smart_charging_plans
			  (subject,vehicle_id,notify_at,departure_at,trip_use_low_pct,trip_use_high_pct,reserve_pct,created_at,updated_at)
			VALUES ($1,42,$2,$2::timestamptz + interval '4 hours',30,40,20,$2,$2)
			RETURNING id, departure_at)
		INSERT INTO smart_push_deliveries
		  (device_id,plan_id,plan_version,departure_at,place_updated_at,decision_kind,token_hash,status,created_at,expires_at)
		SELECT $3,id,1,departure_at,$2,'plug_in',decode(repeat('00',32),'hex'),'unknown',
		  $2::timestamptz - interval '30 minutes',$2::timestamptz - interval '29 minutes' FROM plan`, subject, f.now, device); err != nil {
		t.Fatal(err)
	}
}
