package smartreadiness_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/adapter/openmeteo"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	delivery "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	rainEndpoint = "/security/window-rain?vehicle_id=7"
	rainClaim    = "/smart-delivery/deliveries/claim"
	rainOwner    = "synthetic-rain-owner"
	rainOther    = "synthetic-rain-other"
)

type rainFixtureTransport struct{ target *url.URL }

func (t rainFixtureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	copy := req.Clone(req.Context())
	copy.URL.Scheme, copy.URL.Host = t.target.Scheme, t.target.Host
	copy.Host = t.target.Host
	return http.DefaultTransport.RoundTrip(copy)
}

type windowRainJourney struct {
	*chargingDeliveryJourney
	plans    *smartreadinesssvc.WindowRainWatches
	provider *openmeteo.RainClient
	calls    atomic.Int32
	forecast atomic.Int32
	inFlight func()
	start    time.Time
}

func newWindowRainJourney(t *testing.T) *windowRainJourney {
	t.Helper()
	base := newChargingDeliveryJourney(t, nil)
	j := &windowRainJourney{chargingDeliveryJourney: base, start: time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)}
	j.live.values["FdWindow"] = &signal.Value{Raw: "PartiallyOpen"}
	j.live.values["LocationLatitude"].Raw = 47.123424
	j.live.values["LocationLongitude"].Raw = -122.353333
	j.advance(j.start)
	j.exec(`CREATE TABLE drives (vehicle_id bigint, started_at timestamptz, ended_at timestamptz);
		CREATE TABLE signal_log (vehicle_id bigint NOT NULL, field text NOT NULL, ts timestamptz NOT NULL,
			str_value text, float_value double precision, int_value bigint, source_emitted_at timestamptz,
			PRIMARY KEY(vehicle_id,field,ts));
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic other vehicle')`)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		j.calls.Add(1)
		want := url.Values{
			"latitude": {"47.12"}, "longitude": {"-122.35"},
			"hourly": {"precipitation_probability,rain,showers"}, "forecast_hours": {"4"}, "timezone": {"UTC"},
		}
		if r.Method != http.MethodGet || r.URL.Path != "/v1/forecast" || !reflect.DeepEqual(r.URL.Query(), want) {
			t.Errorf("unexpected forecast request: %s %s", r.Method, r.URL)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if j.inFlight != nil {
			j.inFlight()
		}
		chance := "80"
		switch j.forecast.Load() {
		case 1:
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		case 2:
			chance = "5"
		}
		_, _ = fmt.Fprintf(w, `{"utc_offset_seconds":0,"hourly_units":{"time":"iso8601","precipitation_probability":"%%","rain":"mm","showers":"mm"},
			"hourly":{"time":["2026-11-20T18:00","2026-11-20T19:00"],"precipitation_probability":[%s,5],
			"rain":[0.4,0],"showers":[0.3,0]}}`, chance)
	}))
	t.Cleanup(server.Close)
	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	j.provider = openmeteo.NewRainClient(rainFixtureTransport{target}, func() time.Time { return j.now })
	j.compose()
	return j
}

func (j *windowRainJourney) compose() {
	j.t.Helper()
	clock := func() time.Time { return j.now }
	repo := readinessdb.NewRepository(j.db)
	quiet := quiethoursdb.NewQuietHoursRepo(j.db)
	j.plans = smartreadinesssvc.NewWindowRainWatches(repo, j.live, j.provider, quiet, clock)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		j.t.Fatal(err)
	}
	deliveries := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveries, enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithWindowRainDelivery(deliveries, j.plans),
		smartdeliverysvc.WithQuietHours(quiet))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithWindowRain(j.plans, j.delivery.WindowRainAvailable)).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
	})
}

func (j *windowRainJourney) exec(stmt string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.ctx, stmt, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *windowRainJourney) status(method, endpoint, subject string, body any, want int) []byte {
	j.t.Helper()
	rec := j.request(method, endpoint, subject, body)
	if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
		j.t.Fatalf("%s %s = %d, want private %d: %s", method, endpoint, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func (j *windowRainJourney) read(endpoint, subject string) *readiness.WindowRainPlan {
	j.t.Helper()
	raw := j.status(http.MethodGet, endpoint, subject, nil, http.StatusOK)
	var out struct {
		Data struct {
			Plan *readiness.WindowRainPlan `json:"plan"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil ||
		strings.Contains(string(raw), "latitude") || strings.Contains(string(raw), "longitude") {
		j.t.Fatalf("invalid private watch response: %s (%v)", raw, err)
	}
	return out.Data.Plan
}

func (j *windowRainJourney) tick(ctx context.Context) error {
	if _, err := j.plans.ProcessDue(ctx, 2); err != nil {
		return err
	}
	return j.delivery.DeliverWindowRain(ctx, 4)
}

func (j *windowRainJourney) runTick() {
	j.t.Helper()
	if err := j.tick(j.ctx); err != nil {
		j.t.Fatal(err)
	}
}

func rainSetup(device, expectedID int64) map[string]any {
	return map[string]any{
		"duration_s": 3600, "device_id": device, "expected_plan_id": expectedID,
		"outdoor_confirmed": true, "forecast_consent": true, "free_terms_apply": true,
		"push_title": "Check the window", "push_body": "Possible rain nearby.",
	}
}

func TestWindowRainPrivateDeliveryAndLateParkEvidence(t *testing.T) {
	j := newWindowRainJourney(t)
	j.runTick()
	if j.read(rainEndpoint, rainOwner) != nil || j.live.readCount() != 0 || j.calls.Load() != 0 {
		t.Fatal("default off must perform no signal or forecast lookup")
	}
	j.status(http.MethodGet, rainEndpoint, "", nil, http.StatusUnauthorized)
	j.status(http.MethodGet, "/security/window-rain?vehicle_id=999", rainOwner, nil, http.StatusNotFound)
	ownerURL := "https://fcm.googleapis.com/fcm/send/window-rain-owner"
	device := j.enroll(rainOwner, ownerURL)
	other := j.enroll(rainOther, "https://fcm.googleapis.com/fcm/send/window-rain-other")
	j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(other, 0), http.StatusConflict)
	for _, field := range []string{"outdoor_confirmed", "forecast_consent", "free_terms_apply"} {
		denied := rainSetup(device, 0)
		denied[field] = false
		j.status(http.MethodPut, rainEndpoint, rainOwner, denied, http.StatusBadRequest)
	}
	j.runTick()
	if j.calls.Load() != 0 {
		t.Fatal("invalid outdoor/provider consent must not request weather")
	}
	parkAt := j.start.Add(-40 * time.Second)
	j.live.values["Gear"].Timestamp = parkAt
	j.exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`,
		parkAt.Add(-time.Hour), parkAt.Add(31*time.Second))
	j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, 0), http.StatusNoContent)
	j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, 0), http.StatusConflict)
	j.compose()
	j.sender.status = delivery.DeliveryUnknown
	before, _ := j.sender.last()
	var workers sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		workers.Go(func() { errs <- j.tick(j.ctx) })
	}
	workers.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	j.compose()
	j.runTick()
	after, payload := j.sender.last()
	var message map[string]string
	if j.calls.Load() != 1 || after != before+1 || json.Unmarshal(payload, &message) != nil || len(message) != 2 ||
		message["kind"] != "window-rain" || message["token"] == "" || j.sender.messages()[after-1].endpoint != ownerURL {
		t.Fatalf("want one weather read and opaque push after concurrent workers and restart, got %d/%d: %s", j.calls.Load(), after-before, payload)
	}
	plan := j.read(rainEndpoint, rainOwner)
	if plan == nil || !plan.DeviceReady || plan.Reason != readiness.WindowRainAtRisk || plan.Risk == nil ||
		plan.Risk.Window.Position != readiness.WindowFrontDriver || !plan.Risk.Window.ObservedAt.Equal(j.now) ||
		!plan.Risk.RiskStartAt.Equal(j.start.Truncate(time.Hour)) || !plan.Risk.RiskEndAt.Equal(j.start.Truncate(time.Hour).Add(time.Hour)) ||
		j.read(rainEndpoint, rainOther) != nil || j.read("/security/window-rain?vehicle_id=8", rainOwner) != nil {
		t.Fatalf("wrong rain evidence or private scope: %+v", plan)
	}
	j.status(http.MethodPost, rainClaim, rainOther, message, http.StatusNotFound)
	j.live.values["FdWindow"].Raw = "Closed"
	j.status(http.MethodPost, rainClaim, rainOwner, message, http.StatusNotFound)
	j.live.values["FdWindow"].Raw = "PartiallyOpen"
	body := j.status(http.MethodPost, rainClaim, rainOwner, message, http.StatusOK)
	var notice struct{ Data delivery.Notification }
	want := fmt.Sprintf("/security-access?vehicle_id=7&rain_vehicle_id=7&rain_plan_id=%d#window-rain", plan.ID)
	if err := json.Unmarshal(body, &notice); err != nil || notice.Data.URL != want {
		t.Fatalf("wrong private notification: %s", body)
	}
	j.status(http.MethodPost, rainClaim, rainOwner, message, http.StatusNotFound)
	j.exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, j.start, j.start.Add(time.Minute))
	if p := j.read(rainEndpoint, rainOwner); p.Reason != readiness.WindowRainMoved || p.Risk != nil {
		t.Fatalf("late driving evidence must withdraw the in-app alert: %+v", p)
	}
	j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", rainEndpoint, plan.ID), rainOwner, nil, http.StatusNoContent)
	if j.read(rainEndpoint, rainOwner) != nil {
		t.Fatal("cleared watch still readable")
	}
}

func TestWindowRainSuppressionAndRevocation(t *testing.T) {
	for _, name := range []string{"closed", "stale", "receipt-only window", "departure", "neutral then park", "changed grid", "weather unavailable",
		"dry forecast", "quiet hours", "revoked browser", "paused then rearmed", "withdrawn during forecast", "expired"} {
		t.Run(name, func(t *testing.T) {
			j := newWindowRainJourney(t)
			device := j.enroll(rainOwner, "https://fcm.googleapis.com/fcm/send/window-rain-suppression")
			j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, 0), http.StatusNoContent)
			old := j.read(rainEndpoint, rainOwner)
			planURL := fmt.Sprintf("%s&plan_id=%d", rainEndpoint, old.ID)
			var wantCalls int32
			switch name {
			case "closed":
				j.live.values["FdWindow"].Raw = "Closed"
			case "stale":
				j.live.values["FdWindow"].Timestamp = j.now.Add(-4 * time.Minute)
			case "receipt-only window":
				j.live.values["FdWindow"].TimestampSynthetic = true
			case "departure":
				j.live.values["Gear"].Raw = "D"
			case "neutral then park":
				j.exec(`INSERT INTO signal_log (vehicle_id,field,ts,str_value,source_emitted_at)
					VALUES (7,'Gear',$1,'N',$1),(7,'Gear',$2,'P',$2)`, j.start.Add(time.Second), j.start.Add(2*time.Second))
				j.advance(j.start.Add(3 * time.Second))
			case "changed grid":
				j.live.values["LocationLatitude"].Raw = 48.124
			case "weather unavailable":
				j.forecast.Store(1)
				wantCalls = 1
			case "dry forecast":
				j.forecast.Store(2)
				wantCalls = 1
			case "quiet hours":
				j.exec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone)
					VALUES ($1,'17:00','18:00','UTC')`, rainOwner)
				wantCalls = 1
			case "revoked browser":
				j.status(http.MethodDelete, fmt.Sprintf("/smart-delivery/devices/%d", device), rainOwner, nil, http.StatusNoContent)
			case "paused then rearmed":
				j.status(http.MethodPatch, planURL, rainOwner, nil, http.StatusNoContent)
			case "withdrawn during forecast":
				j.inFlight = func() {
					rec := j.request(http.MethodDelete, planURL, rainOwner, nil)
					if rec.Code != http.StatusNoContent {
						t.Errorf("clear in-flight watch = %d: %s", rec.Code, rec.Body)
					}
				}
				wantCalls = 1
			case "expired":
				j.advance(j.start.Add(time.Hour))
			}
			before, _ := j.sender.last()
			j.runTick()
			after, _ := j.sender.last()
			if before != after || j.calls.Load() != wantCalls {
				t.Fatalf("quiet branch: push delta=%d weather calls=%d, wanted 0 and %d", after-before, j.calls.Load(), wantCalls)
			}
			p := j.read(rainEndpoint, rainOwner)
			switch name {
			case "withdrawn during forecast":
				if p != nil {
					t.Fatal("withdrawn plan must not publish")
				}
			case "quiet hours":
				if p == nil || p.Risk == nil {
					t.Fatal("quiet hours suppress push, not the opted-in private manual review")
				}
				j.advance(j.start.Add(time.Hour))
				j.runTick()
				if pushes, _ := j.sender.last(); pushes != before {
					t.Fatal("expired quiet-hours push was delayed")
				}
			case "paused then rearmed":
				if p == nil || !p.Paused || p.Risk != nil {
					t.Fatal("paused watch remained active")
				}
				j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, old.ID), http.StatusNoContent)
				j.status(http.MethodPatch, planURL, rainOwner, nil, http.StatusConflict)
				j.runTick()
				if current := j.read(rainEndpoint, rainOwner); current == nil || current.ID == old.ID || current.Risk == nil {
					t.Fatal("rearming requires a new eligible revision")
				}
			default:
				if p == nil || p.Risk != nil {
					t.Fatalf("suppressed branch exposed risk: %+v", p)
				}
			}
			if name == "expired" || name == "departure" || name == "neutral then park" {
				var retained bool
				if err := j.db.Pool.QueryRow(j.ctx, `SELECT latitude_grid IS NOT NULL FROM smart_window_rain_plans WHERE id=$1`, old.ID).Scan(&retained); err != nil || retained {
					t.Fatalf("expired or departed watch retained grid: %v, %v", retained, err)
				}
			}
		})
	}
}

func TestWindowRainRechecksAfterQuietHoursBeforeAnyAttempt(t *testing.T) {
	j := newWindowRainJourney(t)
	device := j.enroll(rainOwner, "https://fcm.googleapis.com/fcm/send/window-rain-recheck")
	setup := rainSetup(device, 0)
	setup["duration_s"] = 900
	j.status(http.MethodPut, rainEndpoint, rainOwner, setup, http.StatusNoContent)
	j.exec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone)
		VALUES ($1,'17:00','17:16','UTC')`, rainOwner)
	before, _ := j.sender.last()
	j.runTick()
	if pushes, _ := j.sender.last(); pushes != before || j.calls.Load() != 1 {
		t.Fatalf("quiet-hours forecast must not reserve an attempt; pushes=%d, forecasts=%d", pushes-before, j.calls.Load())
	}
	j.advance(j.start.Add(time.Minute))
	j.runTick()
	if pushes, _ := j.sender.last(); pushes != before+1 || j.calls.Load() != 2 {
		t.Fatalf("renewed evidence after quiet hours must send once; pushes=%d, forecasts=%d", pushes-before, j.calls.Load())
	}
	j.advance(j.start.Add(6 * time.Minute))
	j.runTick()
	if pushes, _ := j.sender.last(); pushes != before+1 || j.calls.Load() != 2 {
		t.Fatal("an attempted watch must not run or send again")
	}
}

func TestWindowRainRejectsParkObservationSupersededBeforeConsent(t *testing.T) {
	for _, scenario := range []string{"gear change", "subsequent completed drive", "merged motion"} {
		t.Run(scenario, func(t *testing.T) {
			j := newWindowRainJourney(t)
			device := j.enroll(rainOwner, "https://fcm.googleapis.com/fcm/send/window-rain-previous-park")
			j.live.values["Gear"].Timestamp = j.start.Add(-time.Minute)
			later := j.start.Add(-30 * time.Second)
			switch scenario {
			case "gear change":
				j.exec(`INSERT INTO signal_log (vehicle_id,field,ts,str_value,source_emitted_at)
					VALUES (7,'Gear',$1,'N',$1)`, later)
			case "subsequent completed drive":
				j.exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, later, later.Add(20*time.Second))
			case "merged motion":
				j.exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, later.Add(-time.Hour), later.Add(20*time.Second))
				j.exec(`INSERT INTO signal_log (vehicle_id,field,ts,float_value,source_emitted_at)
					VALUES (7,'VehicleSpeed',$1,8.0,$1)`, later)
			}
			j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, 0), http.StatusConflict)
			j.advance(j.start.Add(time.Second))
			j.runTick()
			if j.calls.Load() != 0 || j.read(rainEndpoint, rainOwner) != nil {
				t.Fatal("a later Park must not inherit outdoor consent from a superseded observation")
			}
		})
	}
}

func TestWindowRainParkAnchorMigrationRetiresUnanchoredWatch(t *testing.T) {
	j := newWindowRainJourney(t)
	device := j.enroll(rainOwner, "https://fcm.googleapis.com/fcm/send/window-rain-legacy-park")
	j.status(http.MethodPut, rainEndpoint, rainOwner, rainSetup(device, 0), http.StatusNoContent)
	j.runTick()
	plan := j.read(rainEndpoint, rainOwner)
	pushes, payload := j.sender.last()
	if plan == nil || plan.Risk == nil || j.calls.Load() != 1 {
		t.Fatal("expected an active watch with a forecast and an outstanding delivery")
	}
	var claim map[string]string
	if err := json.Unmarshal(payload, &claim); err != nil || claim["token"] == "" {
		t.Fatalf("expected the unsatisfied private delivery token: %v", err)
	}
	const migration = "000312_window_rain_park_anchor"
	for _, direction := range []string{"down", "up", "down", "up"} {
		applyReadinessMigration(t, j.db, migration, direction)
	}
	var cleared bool
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT num_nonnulls(latitude_grid,longitude_grid,
		park_observed_at,next_check_at,lease_until,forecast_at)=0 FROM smart_window_rain_plans WHERE id=$1`,
		plan.ID).Scan(&cleared); err != nil || !cleared {
		t.Fatalf("migration retained the unanchored watch's location, lease or forecast: %v", err)
	}
	j.advance(j.start.Add(time.Minute))
	j.runTick()
	got := j.read(rainEndpoint, rainOwner)
	if sent, _ := j.sender.last(); got == nil || got.Reason != readiness.WindowRainMoved ||
		got.Risk != nil || sent != pushes || j.calls.Load() != 1 {
		t.Fatalf("migration reactivated the unanchored watch: %+v", got)
	}
	j.status(http.MethodPost, rainClaim, rainOwner, claim, http.StatusNotFound)
}
