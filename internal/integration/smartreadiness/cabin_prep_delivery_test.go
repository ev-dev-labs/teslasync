package smartreadiness_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

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
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const (
	cabinTestEndpoint = "/climate/cabin-prep?vehicle_id=7"
	cabinClaimPath    = "/smart-delivery/deliveries/claim"
	cabinTestOwner    = "synthetic-cabin-owner"
	cabinTestForeign  = "synthetic-cabin-other"
)

type cabinJourney struct {
	*chargingDeliveryJourney
	plans     *smartreadinesssvc.CabinPrep
	departure time.Time
}

func newCabinJourney(t *testing.T, departure time.Time) *cabinJourney {
	t.Helper()
	j := newChargingDeliveryJourney(t, nil)
	for field, raw := range map[string]signal.SignalValue{"HvacPower": false, "InsideTemp": 10.0, "OutsideTemp": 6.0} {
		j.live.values[field] = &signal.Value{Raw: raw}
	}
	j.advance(departure.Add(-time.Hour))
	var mornings []time.Time
	for day := departure.AddDate(0, 0, -1); len(mornings) < 4; day = day.AddDate(0, 0, -1) {
		if day.Weekday() >= time.Monday && day.Weekday() <= time.Friday {
			mornings = append(mornings, day)
		}
	}
	seedCabinEvidence(t, j.db, mornings)
	parkedAt := departure.Add(-10 * time.Hour)
	if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO signal_log (ts,vehicle_id,field,value_kind,str_value,source_emitted_at)
		VALUES ($1,7,'Gear',$2,'P',$1)`, parkedAt, protomodel.ValueKindString); err != nil {
		t.Fatal(err)
	}
	if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO signal_log (ts,vehicle_id,field,value_kind,bool_value,source_emitted_at)
		VALUES ($1,7,'HvacPower',$2,false,$1)`, parkedAt, protomodel.ValueKindBool); err != nil {
		t.Fatal(err)
	}
	j.live.values["Gear"].Timestamp = parkedAt
	j.live.values["HvacPower"].Timestamp = parkedAt
	result := &cabinJourney{chargingDeliveryJourney: j, departure: departure}
	result.compose()
	return result
}

func (j *cabinJourney) advance(now time.Time) {
	gearAt := j.live.values["Gear"].Timestamp
	powerAt := j.live.values["HvacPower"].Timestamp
	j.chargingDeliveryJourney.advance(now)
	j.live.values["Gear"].Timestamp = gearAt
	j.live.values["HvacPower"].Timestamp = powerAt
}

func (j *cabinJourney) compose() {
	j.t.Helper()
	clock := func() time.Time { return j.now }
	repo := readinessdb.NewRepository(j.db)
	history := smartreadinesssvc.NewCabinHistory(repo, signal.NewLogStateReader(j.db.Pool, zerolog.Nop()))
	j.plans = smartreadinesssvc.NewCabinPrep(repo, history, j.live, clock)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		j.t.Fatal(err)
	}
	deliveryRepo := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveryRepo, enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithCabinPrepDelivery(deliveryRepo, j.plans),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithCabinPrep(j.plans, j.delivery.CabinPrepAvailable)).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
	})
}

func (j *cabinJourney) setup(device, plan int64) map[string]any {
	return map[string]any{
		"departure_at": j.departure, "time_zone": "UTC", "target_c": 21, "push_device_id": device,
		"push_title": "Review cabin preparation", "push_body": "Four comparable synthetic mornings.",
		"departure_confirmed": true, "expected_plan_id": plan,
	}
}

func (j *cabinJourney) read(path, owner string) readiness.CabinPrepPlan {
	j.t.Helper()
	rec := j.request(http.MethodGet, path, owner, nil)
	var out struct {
		Data readiness.CabinPrepPlan `json:"data"`
	}
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" ||
		json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		j.t.Fatalf("private plan read = %d: %s", rec.Code, rec.Body)
	}
	return out.Data
}

func (j *cabinJourney) status(method, path, subject string, body any, want int) []byte {
	j.t.Helper()
	rec := j.request(method, path, subject, body)
	if rec.Code != want {
		j.t.Fatalf("%s %s = %d, want %d: %s", method, path, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func (j *cabinJourney) tick() map[readiness.CabinPrepReason]int {
	j.t.Helper()
	outcomes, err := j.plans.ProcessDue(j.ctx, 6)
	if err != nil {
		j.t.Fatal(err)
	}
	if err := j.delivery.DeliverCabinPrep(j.ctx, 6); err != nil {
		j.t.Fatal(err)
	}
	return outcomes
}

func TestCabinPrepPrivateTimedDelivery(t *testing.T) {
	j := newCabinJourney(t, time.Date(2026, 11, 9, 8, 0, 0, 0, time.UTC))
	if plan := j.read(cabinTestEndpoint, cabinTestOwner); plan.ID != 0 || plan.Estimate != nil {
		t.Fatalf("default must be off: %+v", plan)
	}
	if outcomes := j.tick(); len(outcomes) != 0 || j.live.readCount() != 0 {
		t.Fatalf("without consent there must be no evaluation: %v", outcomes)
	}
	j.status(http.MethodGet, cabinTestEndpoint, "", nil, http.StatusUnauthorized)
	j.status(http.MethodGet, "/climate/cabin-prep?vehicle_id=999", cabinTestOwner, nil, http.StatusNotFound)
	ownerEndpoint := "https://fcm.googleapis.com/fcm/send/cabin-owner-device"
	device := j.enroll(cabinTestOwner, ownerEndpoint)
	other := j.enroll(cabinTestForeign, "https://fcm.googleapis.com/fcm/send/cabin-other-device")
	j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, j.setup(other, 0), http.StatusConflict)
	setup := j.setup(device, 0)
	setup["departure_confirmed"] = false
	j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, setup, http.StatusBadRequest)
	setup["departure_confirmed"] = true
	j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, setup, http.StatusNoContent)
	j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, setup, http.StatusConflict)
	plan := j.read(cabinTestEndpoint, cabinTestOwner)
	if plan.ID == 0 || !plan.DeviceReady || plan.Estimate != nil || !plan.DepartureAt.Equal(j.departure) ||
		j.read(cabinTestEndpoint, cabinTestForeign).ID != 0 || j.read("/climate/cabin-prep?vehicle_id=8", cabinTestOwner).ID != 0 {
		t.Fatalf("plan is not scoped or not waiting: %+v", plan)
	}
	before, _ := j.sender.last()
	j.advance(j.departure.Add(-38 * time.Minute))
	j.tick()
	if j.live.readCount() != 0 {
		t.Fatal("live telemetry checked before the scheduled start")
	}
	j.advance(j.departure.Add(-37 * time.Minute))
	j.tick()
	if plan := j.read(cabinTestEndpoint, cabinTestOwner); plan.Estimate != nil || plan.Reason != "" {
		t.Fatalf("forecast exposed before useful window: %+v", plan)
	}
	if after, _ := j.sender.last(); after != before {
		t.Fatal("early forecast must not send")
	}
	j.compose() // Durable due time and forecast survive a service restart.
	j.advance(j.departure.Add(-13 * time.Minute))
	var workers sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := j.plans.ProcessDue(j.ctx, 6)
			if err == nil {
				err = j.delivery.DeliverCabinPrep(j.ctx, 6)
			}
			errs <- err
		})
	}
	workers.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	after, payload := j.sender.last()
	var message map[string]string
	if after != before+1 || json.Unmarshal(payload, &message) != nil || len(message) != 2 ||
		message["kind"] != "cabin-prep" || message["token"] == "" || j.sender.messages()[after-1].endpoint != ownerEndpoint {
		t.Fatalf("expected one opaque push on the verified owner's device, got %d: %s", after-before, payload)
	}
	current := j.read(cabinTestEndpoint, cabinTestOwner)
	if f := current.Estimate; f == nil || f.ComparableMornings != 4 || f.LeadLowS != 540 || f.LeadHighS != 780 ||
		current.ExpiresAt == nil || !current.ExpiresAt.Equal(j.departure.Add(-9*time.Minute)) {
		t.Fatalf("wrong estimate or expiry: %+v (%+v)", current, f)
	}
	j.status(http.MethodPost, cabinClaimPath, cabinTestForeign, message, http.StatusNotFound)
	j.live.values["OutsideTemp"].Raw = 9.0
	j.status(http.MethodPost, cabinClaimPath, cabinTestOwner, message, http.StatusNotFound)
	j.live.values["OutsideTemp"].Raw = 6.0
	var notification struct {
		Data delivery.Notification `json:"data"`
	}
	if json.Unmarshal(j.status(http.MethodPost, cabinClaimPath, cabinTestOwner, message, http.StatusOK), &notification) != nil ||
		notification.Data.Title != "Review cabin preparation" ||
		notification.Data.URL != "/preconditioning-effectiveness?vehicle_id=7&cabin_vehicle_id=7#cabin-prep-reminder" {
		t.Fatalf("wrong scoped action: %+v", notification)
	}
	j.status(http.MethodPost, cabinClaimPath, cabinTestOwner, message, http.StatusNotFound)
	j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, j.setup(device, plan.ID), http.StatusNoContent)
	j.tick()
	if count, _ := j.sender.last(); count != after {
		t.Fatal("replacement for the same departure must not re-deliver")
	}
	j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", cabinTestEndpoint, plan.ID), cabinTestOwner, nil, http.StatusConflict)
	j.advance(j.departure.Add(-9 * time.Minute))
	current = j.read(cabinTestEndpoint, cabinTestOwner)
	if current.Estimate != nil || current.Reason != readiness.CabinPrepExpired {
		t.Fatalf("offer did not expire while it was still before departure: %+v", current)
	}
	j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", cabinTestEndpoint, current.ID), cabinTestOwner, nil, http.StatusNoContent)
	if plan := j.read(cabinTestEndpoint, cabinTestOwner); plan.ID != 0 {
		t.Fatalf("expected off after clear, got %+v", plan)
	}
}

func TestCabinPrepSuppressesUnsafeConditions(t *testing.T) {
	cases := []struct {
		name      string
		field     string
		raw       signal.SignalValue
		change    func(*cabinJourney)
		reason    readiness.CabinPrepReason
		hideOffer bool
	}{
		{name: "moving", field: "Gear", raw: "D", reason: readiness.CabinPrepDeparted, hideOffer: true},
		{name: "already comfortable", field: "InsideTemp", raw: 20.0, reason: readiness.CabinPrepComfortable, hideOffer: true},
		{name: "already preparing", field: "HvacPower", raw: true, reason: readiness.CabinPrepAlreadyActive, hideOffer: true},
		{name: "weather changed", field: "OutsideTemp", raw: 9.0, reason: readiness.CabinPrepChanged, hideOffer: true},
		{name: "stale", change: func(j *cabinJourney) {
			j.live.values["Gear"].Timestamp = j.now.Add(-4 * time.Minute)
		}, reason: readiness.CabinPrepUnknownState, hideOffer: true},
		{name: "late recorded HVAC-on", change: func(j *cabinJourney) {
			at := j.now.Add(-time.Minute)
			if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO signal_log (ts,vehicle_id,field,value_kind,bool_value,source_emitted_at)
				VALUES ($1,7,'HvacPower',$2,true,$1)`, at, protomodel.ValueKindBool); err != nil {
				t.Fatal(err)
			}
		}, reason: readiness.CabinPrepUnknownState, hideOffer: true},
		{name: "unrecorded drive but changed gear", change: func(j *cabinJourney) {
			at := j.now.Add(-time.Minute)
			if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO signal_log (ts,vehicle_id,field,value_kind,str_value,source_emitted_at)
				VALUES ($1,7,'Gear',$2,'N',$1)`, at, protomodel.ValueKindString); err != nil {
				t.Fatal(err)
			}
		}, reason: readiness.CabinPrepUnknownState, hideOffer: true},
		{name: "synthetic", change: func(j *cabinJourney) {
			j.live.values["InsideTemp"].TimestampSynthetic = true
		}, reason: readiness.CabinPrepUnknownState, hideOffer: true},
		{name: "cleared", change: func(j *cabinJourney) {
			p := j.read(cabinTestEndpoint, cabinTestOwner)
			j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", cabinTestEndpoint, p.ID), cabinTestOwner, nil, http.StatusNoContent)
		}, hideOffer: true},
		{name: "quiet hours", change: func(j *cabinJourney) {
			if _, err := j.db.Pool.Exec(j.ctx, `INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone)
				VALUES($1,'07:00','08:00','UTC')`, cabinTestOwner); err != nil {
				t.Fatal(err)
			}
		}, reason: readiness.CabinPrepEligible},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			j := newCabinJourney(t, time.Date(2026, 11, 9, 8, 0, 0, 0, time.UTC))
			device := j.enroll(cabinTestOwner, "https://fcm.googleapis.com/fcm/send/cabin-suppression-test")
			j.status(http.MethodPut, cabinTestEndpoint, cabinTestOwner, j.setup(device, 0), http.StatusNoContent)
			j.advance(j.departure.Add(-37 * time.Minute))
			j.tick()
			j.advance(j.departure.Add(-13 * time.Minute))
			if tt.field != "" {
				j.live.values[tt.field].Raw = tt.raw
			}
			if tt.change != nil {
				tt.change(j)
			}
			before, _ := j.sender.last()
			if outcomes := j.tick(); tt.reason != "" && outcomes[tt.reason] != 1 {
				t.Fatalf("wrong worker outcome: %v, want %s", outcomes, tt.reason)
			}
			after, _ := j.sender.last()
			if offer := j.read(cabinTestEndpoint, cabinTestOwner).Estimate; after != before || (tt.hideOffer && offer != nil) {
				t.Fatalf("suppressed condition got delivery or unsafe offer: calls %d → %d, estimate %+v", before, after, offer)
			}
		})
	}
}
