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

	smartadapter "github.com/ev-dev-labs/teslasync/internal/adapter/smartreadiness"
	apigeo "github.com/ev-dev-labs/teslasync/internal/api/geofence"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	geofencedb "github.com/ev-dev-labs/teslasync/internal/database/geofence"
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
	unlockEndpoint = "/security/parked-unlock?vehicle_id=7"
	unlockOwner    = "synthetic-unlock-owner"
	unlockOther    = "synthetic-unlock-other"
)

type parkedUnlockJourney struct {
	*parkedClosureJourney
	plans *smartreadinesssvc.ParkedUnlocks
}

func newParkedUnlockJourney(t *testing.T) *parkedUnlockJourney {
	t.Helper()
	j := &parkedUnlockJourney{parkedClosureJourney: newParkedClosureJourney(t)}
	j.exec(`UPDATE geofences SET name='Synthetic monitored place',updated_at=$1,is_charging_location=false,
		polygon_wkt='POLYGON((-122.30 47.10,-122.20 47.10,-122.20 47.20,-122.30 47.20,-122.30 47.10))' WHERE id=9`, j.start)
	j.exec(`INSERT INTO geofences(id,name,enabled,needs_review,is_charging_location,updated_at,polygon_wkt)
		VALUES (10,'Synthetic unreviewed place',true,true,false,$1,'POLYGON((-122.30 47.10,-122.20 47.10,-122.20 47.20,-122.30 47.20,-122.30 47.10))')`, j.start)
	j.compose()
	return j
}

func (j *parkedUnlockJourney) compose() {
	j.t.Helper()
	clock := func() time.Time { return j.now }
	repo := readinessdb.NewRepository(j.db)
	places := geofencedb.NewGeofenceRepo(j.db)
	j.plans = smartreadinesssvc.NewParkedUnlocks(repo, repo, smartadapter.NewSites(places), j.live, clock)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		j.t.Fatal(err)
	}
	deliveries := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveries, enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithParkedUnlockDelivery(deliveries, j.plans),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithParkedUnlock(j.plans, j.delivery.ParkedUnlockAvailable)).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
		r.Get("/geofences", apigeo.NewHandler(j.db).List)
	})
}

func (j *parkedUnlockJourney) read(endpoint, subject string) *domain.ParkedUnlockPlan {
	j.t.Helper()
	raw := j.status(http.MethodGet, endpoint, subject, nil, http.StatusOK)
	var out struct {
		Data struct {
			Plan *domain.ParkedUnlockPlan `json:"plan"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &out); err != nil || strings.Contains(string(raw), "device_id") || strings.Contains(string(raw), "polygon") {
		j.t.Fatalf("invalid private unlock response: %s (%v)", raw, err)
	}
	return out.Data.Plan
}

func (j *parkedUnlockJourney) emit(at time.Time, locked bool, lat, lon float64) {
	j.t.Helper()
	for _, field := range []struct{ name, raw string }{
		{"Gear", `"P"`}, {"Locked", fmt.Sprint(locked)}, {"Location", fmt.Sprintf(`{"latitude":%g,"longitude":%g}`, lat, lon)},
	} {
		body := fmt.Sprintf(`{"value":%s,"ts":%q}`, field.raw, at.UTC().Format(time.RFC3339))
		atoms, err := codec.DecodeJSONField(field.name, []byte(body), "00000000000000000", at.Add(time.Second))
		if err != nil || len(atoms) == 0 {
			j.t.Fatalf("decode fixture %s: %v, %v", field.name, atoms, err)
		}
		for _, atom := range atoms {
			var kind protomodel.ValueKind
			var text *string
			var flag *bool
			var number *float64
			switch val := atom.Value.(type) {
			case string:
				kind, text = protomodel.ValueKindString, &val
			case bool:
				kind, flag = protomodel.ValueKindBool, &val
			case float64:
				kind, number = protomodel.ValueKindDouble, &val
			default:
				j.t.Fatalf("unexpected %s value: %T", atom.Field, val)
			}
			j.exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,bool_value,str_value,float_value,source_emitted_at,received_at)
				VALUES($1,7,$2,$3,$4,$5,$6,$7,$8)
				ON CONFLICT (vehicle_id,field,ts) DO UPDATE SET bool_value=excluded.bool_value, str_value=excluded.str_value,
					float_value=excluded.float_value,source_emitted_at=excluded.source_emitted_at,received_at=excluded.received_at`,
				atom.EmittedAt, atom.Field, kind, flag, text, number, atom.SourceEmittedAt, at.Add(time.Second))
			j.live.mu.Lock()
			j.live.values[atom.Field] = &signal.Value{Raw: atom.Value, Timestamp: atom.EmittedAt}
			j.live.mu.Unlock()
		}
	}
	j.now = at.Add(2 * time.Second)
}

func (j *parkedUnlockJourney) tick(ctx context.Context) error {
	if _, err := j.plans.ProcessDue(ctx, 6); err != nil {
		return err
	}
	return j.delivery.DeliverParkedUnlocks(ctx, 6)
}

type unlockSetupRequest struct {
	domain.ParkedUnlockSetup
	ExpectedID int64 `json:"expected_plan_id"`
}

func (j *parkedUnlockJourney) setup(id int64) unlockSetupRequest {
	return unlockSetupRequest{ParkedUnlockSetup: domain.ParkedUnlockSetup{PlaceID: 9, PlaceRevision: j.start, DeviceID: id, Confirmed: true,
		PushTitle: "Check your parked vehicle", PushBody: "Check the vehicle in person if safe."}}
}

func TestParkedUnlockPrivateLifecycle(t *testing.T) {
	j := newParkedUnlockJourney(t)
	ownerBrowser := j.enroll(unlockOwner, "https://fcm.googleapis.com/fcm/send/synthetic-unlock-owner")
	foreignBrowser := j.enroll(unlockOther, "https://fcm.googleapis.com/fcm/send/synthetic-unlock-other")
	before, _ := j.sender.last()
	if j.read(unlockEndpoint, unlockOwner) != nil {
		t.Fatal("reminders must start off")
	}
	if err := j.tick(j.ctx); err != nil || j.live.reads != 0 {
		t.Fatalf("off must do no work: reads=%d err=%v", j.live.reads, err)
	}
	j.status(http.MethodPut, unlockEndpoint, unlockOwner, j.setup(foreignBrowser), http.StatusConflict)
	setup := j.setup(ownerBrowser)
	setup.PlaceID = 10
	j.status(http.MethodPut, unlockEndpoint, unlockOwner, setup, http.StatusConflict)
	setup = j.setup(ownerBrowser)
	setup.PlaceRevision = setup.PlaceRevision.Add(-time.Second)
	j.status(http.MethodPut, unlockEndpoint, unlockOwner, setup, http.StatusConflict)
	j.status(http.MethodPut, unlockEndpoint, unlockOwner, j.setup(ownerBrowser), http.StatusNoContent)
	j.completedPark(j.start.Add(time.Minute))
	for i := 1; i <= 5; i++ {
		j.emit(j.start.Add(time.Duration(i)*time.Minute), false, 47.15, -122.25)
		if i == 3 {
			at := j.start.Add(3*time.Minute + 30*time.Second)
			j.emit(at, false, 47.15, -122.24)
			j.exec("DELETE FROM signal_log WHERE ts=$1 AND field IN ('Gear','Locked')", at)
		}
	}
	if err := j.tick(j.ctx); err != nil {
		t.Fatal(err)
	}
	if count, _ := j.sender.last(); count != before || j.read(unlockEndpoint, unlockOwner).Reason != domain.UnlockGrace {
		t.Fatal("the alert must wait for the full observed grace interval")
	}
	j.emit(j.start.Add(6*time.Minute), false, 47.15, -122.25)
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
	if count != before+1 {
		t.Fatalf("want exactly one push after both workers: got %d", count-before)
	}
	var payload map[string]string
	if err := json.Unmarshal(push, &payload); err != nil || len(payload) != 2 ||
		payload["kind"] != "parked-unlock" || len(payload["token"]) != 43 {
		t.Fatalf("want only an opaque token and kind: %s (%v)", push, err)
	}
	plan := j.read(unlockEndpoint, unlockOwner)
	if plan.Risk == nil || !plan.Risk.UnlockedSince.Equal(j.start.Add(time.Minute)) || plan.PlaceName != "Synthetic monitored place" {
		t.Fatalf("want fresh scoped unlock evidence: %+v", plan)
	}
	if j.read(unlockEndpoint, unlockOther) != nil || j.read("/security/parked-unlock?vehicle_id=8", unlockOwner) != nil {
		t.Fatal("another user or vehicle inherited the private reminder")
	}
	j.compose()
	j.status(http.MethodPost, closureClaim, unlockOther, payload, http.StatusNotFound)
	answer := j.status(http.MethodPost, closureClaim, unlockOwner, payload, http.StatusOK)
	var claimed struct{ Data delivery.Notification }
	want := fmt.Sprintf("/security-access?vehicle_id=7&unlock_vehicle_id=7&unlock_plan_id=%d&unlock_park_id=%d#parked-unlock", plan.ID, plan.Risk.DriveID)
	if err := json.Unmarshal(answer, &claimed); err != nil || claimed.Data.URL != want {
		t.Fatalf("claim must link only to that private park: %s (%v)", answer, err)
	}
	j.status(http.MethodPost, closureClaim, unlockOwner, payload, http.StatusNotFound)
	j.emit(j.start.Add(7*time.Minute), false, 47.15, -122.25)
	if err := j.tick(j.ctx); err != nil {
		t.Fatal(err)
	}
	if count, _ := j.sender.last(); count != before+1 {
		t.Fatal("restart or repeated evidence retried a delivered parking occurrence")
	}
	endpoint := fmt.Sprintf("%s&plan_id=%d", unlockEndpoint, plan.ID)
	j.status(http.MethodPatch, endpoint, unlockOwner, map[string]string{"action": "snooze"}, http.StatusNoContent)
	if snoozed := j.read(unlockEndpoint, unlockOwner); snoozed.Risk != nil || snoozed.SnoozedUntil == nil {
		t.Fatalf("snooze must discard the pending evidence: %+v", snoozed)
	}
	j.status(http.MethodPatch, endpoint, unlockOwner, map[string]string{"action": "pause"}, http.StatusNoContent)
	j.status(http.MethodDelete, endpoint, unlockOther, nil, http.StatusConflict)
	j.status(http.MethodDelete, endpoint, unlockOwner, nil, http.StatusNoContent)
	if j.read(unlockEndpoint, unlockOwner) != nil {
		t.Fatal("cleared reminders must return to off")
	}
	var observations int
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT count(*) FROM signal_log WHERE vehicle_id=7`).Scan(&observations); err != nil || observations == 0 {
		t.Fatalf("clearing must preserve telemetry: count=%d err=%v", observations, err)
	}
}

func TestParkedUnlockSuppression(t *testing.T) {
	for _, scenario := range []string{"wrong_place", "relocked", "stale", "missing_source", "intervening_drive", "changed_place", "quiet", "revoked"} {
		t.Run(scenario, func(t *testing.T) {
			j := newParkedUnlockJourney(t)
			browser := j.enroll(unlockOwner, "https://fcm.googleapis.com/fcm/send/synthetic-unlock-suppression")
			before, _ := j.sender.last()
			j.status(http.MethodPut, unlockEndpoint, unlockOwner, j.setup(browser), http.StatusNoContent)
			j.completedPark(j.start.Add(time.Minute))
			for i := 1; i <= 6; i++ {
				lon := -122.25
				if scenario == "wrong_place" {
					lon = -122.5
				}
				j.emit(j.start.Add(time.Duration(i)*time.Minute), scenario == "relocked" && i == 6, 47.15, lon)
			}
			switch scenario {
			case "stale":
				j.now = j.now.Add(3 * time.Minute)
			case "missing_source":
				j.exec("UPDATE signal_log SET source_emitted_at=NULL WHERE ts=$1 AND field='Locked'", j.start.Add(3*time.Minute))
			case "intervening_drive":
				j.exec("INSERT INTO drives (vehicle_id,started_at) VALUES (7,$1)", j.start.Add(5*time.Minute))
			case "changed_place":
				j.exec("UPDATE geofences SET updated_at=$1 WHERE id=9", j.now)
			case "quiet":
				j.exec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone) VALUES ($1,'17:00','18:00','UTC')`, unlockOwner)
			case "revoked":
				j.exec("DELETE FROM smart_push_devices WHERE id=$1", browser)
			}
			if err := j.tick(j.ctx); err != nil {
				t.Fatal(err)
			}
			if calls, _ := j.sender.last(); calls != before {
				t.Fatalf("%s must stay quiet, got %d push attempts", scenario, calls-before)
			}
			if plan := j.read(unlockEndpoint, unlockOwner); scenario != "quiet" && plan.Risk != nil {
				t.Fatalf("%s published misleading evidence: %+v", scenario, plan.Risk)
			}
		})
	}
}
