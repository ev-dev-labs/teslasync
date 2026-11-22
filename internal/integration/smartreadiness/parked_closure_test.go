package smartreadiness_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	delivery "github.com/ev-dev-labs/teslasync/internal/domain/smartdelivery"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	closureEndpoint = "/security/parked-closure?vehicle_id=7"
	closureClaim    = "/smart-delivery/deliveries/claim"
	closureOwner    = "synthetic-closure-owner"
	closureOther    = "synthetic-closure-other"
)

type parkedClosureJourney struct {
	*chargingDeliveryJourney
	plans *smartreadinesssvc.ParkedClosures
	start time.Time
}

func newParkedClosureJourney(t *testing.T) *parkedClosureJourney {
	t.Helper()
	j := &parkedClosureJourney{chargingDeliveryJourney: newChargingDeliveryJourney(t, nil),
		start: time.Date(2026, 11, 20, 17, 15, 0, 0, time.UTC)}
	j.ctx = t.Context()
	j.advance(j.start)
	j.exec(`CREATE TABLE drives (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz);
		CREATE TABLE signal_log (ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL,
			value_kind smallint NOT NULL, bool_value boolean, str_value text, float_value double precision,
			source_emitted_at timestamptz, received_at timestamptz,
			PRIMARY KEY(vehicle_id,field,ts));
		INSERT INTO vehicles(id,display_name) VALUES (8,'Synthetic other vehicle')`)
	j.compose()
	return j
}

func (j *parkedClosureJourney) compose() {
	j.t.Helper()
	clock := func() time.Time { return j.now }
	repo := readinessdb.NewRepository(j.db)
	j.plans = smartreadinesssvc.NewParkedClosures(repo, smartreadinesssvc.NewParkedClosureHistory(repo, j.live), clock)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		j.t.Fatal(err)
	}
	deliveries := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveries, enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithParkedClosureDelivery(deliveries, j.plans),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithParkedClosure(j.plans, j.delivery.ParkedClosureAvailable)).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
	})
}

func (j *parkedClosureJourney) exec(stmt string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.ctx, stmt, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *parkedClosureJourney) status(method, endpoint, subject string, body any, want int) []byte {
	j.t.Helper()
	rec := j.request(method, endpoint, subject, body)
	if rec.Code != want || rec.Header().Get("Cache-Control") != "no-store" {
		j.t.Fatalf("%s %s = %d, want private %d: %s", method, endpoint, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func (j *parkedClosureJourney) read(endpoint, subject string) *domain.ParkedClosurePlan {
	j.t.Helper()
	raw := j.status(http.MethodGet, endpoint, subject, nil, http.StatusOK)
	var out struct {
		Data struct {
			Plan *domain.ParkedClosurePlan `json:"plan"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || strings.Contains(string(raw), "device_id") {
		j.t.Fatalf("invalid private closure response: %s (%v)", raw, err)
	}
	return out.Data.Plan
}

func (j *parkedClosureJourney) emit(at time.Time, trunk, service, occupied bool) {
	j.t.Helper()
	door := fmt.Sprintf(`{"DriverFront":false,"DriverRear":false,"PassengerFront":false,"PassengerRear":false,"FrontTrunk":false,"RearTrunk":%t}`, trunk)
	wire, err := json.Marshal(door)
	if err != nil {
		j.t.Fatal(err)
	}
	for _, field := range []struct{ name, raw string }{
		{"DoorState", string(wire)}, {"Gear", `"P"`}, {"ServiceMode", fmt.Sprint(service)}, {"DriverSeatOccupied", fmt.Sprint(occupied)},
	} {
		body := fmt.Sprintf(`{"value":%s,"ts":%q}`, field.raw, at.UTC().Format(time.RFC3339))
		atoms, err := codec.DecodeJSONField(field.name, []byte(body), "00000000000000000", at.Add(time.Second))
		if err != nil || len(atoms) == 0 {
			j.t.Fatalf("decode fixture %s: %v, %v", field.name, atoms, err)
		}
		for _, atom := range atoms {
			kind := protomodel.ValueKindString
			var text *string
			var flag *bool
			switch val := atom.Value.(type) {
			case string:
				text = &val
			case bool:
				kind, flag = protomodel.ValueKindBool, &val
			default:
				j.t.Fatalf("unexpected %s value: %T", atom.Field, val)
			}
			j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,bool_value,str_value,source_emitted_at,received_at)
				VALUES($1,7,$2,$3,$4,$5,$6,$7)
				ON CONFLICT (vehicle_id,field,ts) DO UPDATE SET bool_value=excluded.bool_value, str_value=excluded.str_value,
					source_emitted_at=excluded.source_emitted_at,received_at=excluded.received_at`,
				atom.EmittedAt, atom.Field, kind, flag, text, atom.SourceEmittedAt, at.Add(time.Second))
			j.live.mu.Lock()
			j.live.values[atom.Field] = &signal.Value{Raw: atom.Value, Timestamp: atom.EmittedAt}
			j.live.mu.Unlock()
		}
	}
	j.now = at.Add(2 * time.Second)
}

func (j *parkedClosureJourney) completedPark(at time.Time) {
	j.t.Helper()
	j.exec(`INSERT INTO drives (vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, at.Add(-time.Hour), at)
}

func (j *parkedClosureJourney) tick(ctx context.Context) error {
	if _, err := j.plans.ProcessDue(ctx, 6); err != nil {
		return err
	}
	return j.delivery.DeliverParkedClosures(ctx, 6)
}

type closureSetupRequest struct {
	domain.ParkedClosureSetup
	ExpectedID int64 `json:"expected_plan_id"`
}

func closureSetup(id int64) closureSetupRequest {
	return closureSetupRequest{ParkedClosureSetup: domain.ParkedClosureSetup{GraceS: 300, DeviceID: id, Confirmed: true,
		PushTitle: "Check your parked vehicle", PushBody: "Check the door or trunk in person if safe."}}
}

func TestParkedClosurePrivateLifecycle(t *testing.T) {
	j := newParkedClosureJourney(t)
	ownerBrowser := j.enroll(closureOwner, "https://fcm.googleapis.com/fcm/send/synthetic-closure-owner")
	foreignBrowser := j.enroll(closureOther, "https://fcm.googleapis.com/fcm/send/synthetic-closure-other")
	before, _ := j.sender.last()
	if j.read(closureEndpoint, closureOwner) != nil {
		t.Fatal("reminders must start off")
	}
	if err := j.tick(j.ctx); err != nil || j.live.reads != 0 {
		t.Fatalf("off must do no work: reads=%d err=%v", j.live.reads, err)
	}
	j.status(http.MethodPut, closureEndpoint, closureOwner, closureSetup(foreignBrowser), http.StatusConflict)
	j.status(http.MethodPut, closureEndpoint, closureOwner, closureSetup(ownerBrowser), http.StatusNoContent)
	j.status(http.MethodPut, closureEndpoint, closureOwner, closureSetup(ownerBrowser), http.StatusConflict)
	j.completedPark(j.start.Add(time.Minute))
	for i := 1; i <= 5; i++ {
		j.emit(j.start.Add(time.Duration(i)*time.Minute), true, false, false)
	}
	if err := j.tick(j.ctx); err != nil {
		t.Fatal(err)
	}
	if count, _ := j.sender.last(); count != before || j.read(closureEndpoint, closureOwner).Reason != domain.ClosureGrace {
		t.Fatal("the alert must wait for the full observed grace interval")
	}
	j.emit(j.start.Add(6*time.Minute), true, false, false)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := j.tick(j.ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	count, push := j.sender.last()
	var payload map[string]string
	if err := json.Unmarshal(push, &payload); err != nil || len(payload) != 2 || count != before+1 ||
		payload["kind"] != "parked-closure" || len(payload["token"]) != 43 {
		t.Fatalf("want exactly one opaque push after both workers: %s (%v) count=%d", push, err, count)
	}
	plan := j.read(closureEndpoint, closureOwner)
	if plan.Risk == nil || plan.Risk.Position != domain.ClosureRearTrunk || !plan.Risk.OpenSince.Equal(j.start.Add(time.Minute)) {
		t.Fatalf("want fresh specific closure and real opening evidence: %+v", plan.Risk)
	}
	if j.read(closureEndpoint, closureOther) != nil || j.read("/security/parked-closure?vehicle_id=8", closureOwner) != nil {
		t.Fatal("another user or vehicle inherited a private closure")
	}
	j.compose()
	j.status(http.MethodPost, closureClaim, closureOther, payload, http.StatusNotFound)
	j.live.values["ServiceMode"].Raw = true
	j.status(http.MethodPost, closureClaim, closureOwner, payload, http.StatusNotFound)
	j.live.values["ServiceMode"].Raw = false
	answer := j.status(http.MethodPost, closureClaim, closureOwner, payload, http.StatusOK)
	var claimed struct{ Data delivery.Notification }
	want := fmt.Sprintf("/security-access?vehicle_id=7&closure_vehicle_id=7&closure_plan_id=%d&closure_park_id=%d#parked-closure", plan.ID, plan.Risk.DriveID)
	if err := json.Unmarshal(answer, &claimed); err != nil || claimed.Data.URL != want {
		t.Fatalf("claim must link only to that private park: %s (%v)", answer, err)
	}
	j.status(http.MethodPost, closureClaim, closureOwner, payload, http.StatusNotFound)
	j.emit(j.start.Add(7*time.Minute), true, false, false)
	if err := j.tick(j.ctx); err != nil {
		t.Fatal(err)
	}
	if count, _ := j.sender.last(); count != before+1 {
		t.Fatal("restart or repeated evidence retried a delivered parking occurrence")
	}
	endpoint := fmt.Sprintf("%s&plan_id=%d", closureEndpoint, plan.ID)
	j.status(http.MethodPatch, endpoint, closureOwner, map[string]string{"action": "snooze"}, http.StatusNoContent)
	if snoozed := j.read(closureEndpoint, closureOwner); snoozed.Risk != nil || snoozed.SnoozedUntil == nil {
		t.Fatalf("snooze must discard the pending evidence: %+v", snoozed)
	}
	j.status(http.MethodPatch, endpoint, closureOwner, map[string]string{"action": "pause"}, http.StatusNoContent)
	j.status(http.MethodDelete, endpoint, closureOther, nil, http.StatusConflict)
	j.status(http.MethodDelete, endpoint, closureOwner, nil, http.StatusNoContent)
	if j.read(closureEndpoint, closureOwner) != nil {
		t.Fatal("cleared reminders must return to off")
	}
	var observations int
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT count(*) FROM signal_log WHERE vehicle_id=7`).Scan(&observations); err != nil || observations == 0 {
		t.Fatalf("clearing must preserve telemetry: count=%d err=%v", observations, err)
	}
}

func TestParkedClosureSuppression(t *testing.T) {
	for _, scenario := range []string{"no_completed_park", "intervening_drive", "no_source_time", "service", "loading", "seat_coverage_gap", "closed", "stale", "quiet", "revoked"} {
		t.Run(scenario, func(t *testing.T) {
			j := newParkedClosureJourney(t)
			browser := j.enroll(closureOwner, "https://fcm.googleapis.com/fcm/send/synthetic-closure-suppression")
			before, _ := j.sender.last()
			j.status(http.MethodPut, closureEndpoint, closureOwner, closureSetup(browser), http.StatusNoContent)
			if scenario != "no_completed_park" {
				j.completedPark(j.start.Add(time.Minute))
			}
			for i := 1; i <= 6; i++ {
				j.emit(j.start.Add(time.Duration(i)*time.Minute), scenario != "closed" || i != 6,
					scenario == "service" && i >= 3, scenario == "loading" && i == 4)
			}
			switch scenario {
			case "intervening_drive":
				j.exec("INSERT INTO drives (vehicle_id,started_at) VALUES (7,$1)", j.start.Add(5*time.Minute))
			case "no_source_time":
				j.exec("UPDATE signal_log SET source_emitted_at=NULL WHERE ts=$1 AND field='DoorStateRearTrunk'", j.start.Add(3*time.Minute))
			case "seat_coverage_gap":
				j.exec("DELETE FROM signal_log WHERE ts=$1 AND field='DriverSeatOccupied'", j.start.Add(3*time.Minute))
			case "quiet":
				j.exec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone) VALUES ($1,'17:00','18:00','UTC')`, closureOwner)
			case "stale":
				j.now = j.now.Add(3 * time.Minute)
			case "revoked":
				j.exec("DELETE FROM smart_push_devices WHERE id=$1", browser)
			}
			if err := j.tick(j.ctx); err != nil {
				t.Fatal(err)
			}
			if calls, _ := j.sender.last(); calls != before {
				t.Fatalf("%s must stay quiet, got %d push attempts", scenario, calls-before)
			}
			if plan := j.read(closureEndpoint, closureOwner); scenario != "quiet" && plan.Risk != nil {
				t.Fatalf("%s published misleading evidence: %+v", scenario, plan.Risk)
			}
		})
	}
}
