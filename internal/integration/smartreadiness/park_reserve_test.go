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
)

const (
	parkEndpoint = "/charging/park-reserve?vehicle_id=7"
	parkClaim    = "/smart-delivery/deliveries/claim"
	parkOwner    = "synthetic-park-owner"
	parkOther    = "synthetic-park-other"
)

func parkFixtureNow() time.Time { return time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC) }

type parkJourney struct {
	*chargingDeliveryJourney
	plans      *smartreadinesssvc.ParkReserves
	start      time.Time
	latestPark time.Time
}

func newParkJourney(t *testing.T) *parkJourney {
	t.Helper()
	j := newChargingDeliveryJourney(t, nil)
	j.live.values["BatteryLevel"].Raw = 34.0
	j.live.values["OutsideTemp"] = &signal.Value{Raw: 4.0}
	j.live.values["SentryMode"] = &signal.Value{Raw: "Off"}
	now := parkFixtureNow()
	j.advance(now)
	result := &parkJourney{chargingDeliveryJourney: j, start: now, latestPark: seedParkReserve(t, j.db, now, false)}
	result.compose()
	return result
}

func (j *parkJourney) compose() {
	j.t.Helper()
	clock := func() time.Time { return j.now }
	repo := readinessdb.NewRepository(j.db)
	history := smartreadinesssvc.NewParkReserveHistory(repo, signal.NewLogStateReader(j.db.Pool, zerolog.Nop()))
	j.plans = smartreadinesssvc.NewParkReserves(repo, history, j.live, clock)
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		j.t.Fatal(err)
	}
	deliveries := deliverydb.NewRepository(j.db)
	j.delivery = smartdeliverysvc.New(deliveries, enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithParkReserveDelivery(deliveries, j.plans),
		smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(j.readiness, "X-Test-Subject",
			readinesshandler.WithParkReserve(j.plans, func() (bool, bool) { return true, j.delivery.ParkReserveAvailable() })).MountRoutes(r)
		deliveryhandler.NewHandler(j.delivery, "X-Test-Subject").MountRoutes(r)
	})
}

func (j *parkJourney) status(method, endpoint, subject string, body any, want int) []byte {
	j.t.Helper()
	rec := j.request(method, endpoint, subject, body)
	if rec.Code != want {
		j.t.Fatalf("%s %s = %d, want %d: %s", method, endpoint, rec.Code, want, rec.Body)
	}
	return rec.Body.Bytes()
}

func (j *parkJourney) read(endpoint, subject string) *readiness.ParkReservePlan {
	j.t.Helper()
	rec := j.request(http.MethodGet, endpoint, subject, nil)
	var out struct {
		Data struct {
			Plan *readiness.ParkReservePlan `json:"plan"`
		} `json:"data"`
	}
	if rec.Code != http.StatusOK || rec.Header().Get("Cache-Control") != "no-store" || json.Unmarshal(rec.Body.Bytes(), &out) != nil {
		j.t.Fatalf("private plan read = %d: %s", rec.Code, rec.Body)
	}
	return out.Data.Plan
}

func (j *parkJourney) setup(device, expectedID int64) map[string]any {
	setup := map[string]any{
		"return_at": j.now.Add(48 * time.Hour), "reserve_pct": 28,
		"park_confirmed": true, "expected_plan_id": expectedID,
	}
	if device != 0 {
		setup["push_device_id"], setup["push_title"], setup["push_body"] = device, "Review parked reserve", "Synthetic reserve reminder."
	}
	return setup
}

func (j *parkJourney) tick() {
	j.t.Helper()
	if _, err := j.plans.ProcessDue(j.ctx, 6); err != nil {
		j.t.Fatal(err)
	}
	if err := j.delivery.DeliverParkReserve(j.ctx, 6); err != nil {
		j.t.Fatal(err)
	}
}

func (j *parkJourney) exec(stmt string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.ctx, stmt, args...); err != nil {
		j.t.Fatal(err)
	}
}

func TestParkReservePrivateDeliveryAndLateEvidence(t *testing.T) {
	j := newParkJourney(t)
	j.tick()
	if j.read(parkEndpoint, parkOwner) != nil || j.live.readCount() != 0 {
		t.Fatal("default off must perform no lookup")
	}
	j.status(http.MethodGet, parkEndpoint, "", nil, http.StatusUnauthorized)
	j.status(http.MethodGet, "/charging/park-reserve?vehicle_id=999", parkOwner, nil, http.StatusNotFound)
	ownerURL := "https://fcm.googleapis.com/fcm/send/park-owner-device"
	device := j.enroll(parkOwner, ownerURL)
	other := j.enroll(parkOther, "https://fcm.googleapis.com/fcm/send/park-other-device")
	j.status(http.MethodPut, parkEndpoint, parkOwner, j.setup(other, 0), http.StatusConflict)
	unconfirmed := j.setup(device, 0)
	unconfirmed["park_confirmed"] = false
	j.status(http.MethodPut, parkEndpoint, parkOwner, unconfirmed, http.StatusBadRequest)
	j.status(http.MethodPut, parkEndpoint, parkOwner, j.setup(device, 0), http.StatusNoContent)
	j.status(http.MethodPut, parkEndpoint, parkOwner, j.setup(device, 0), http.StatusConflict)
	j.compose()
	j.sender.status = delivery.DeliveryUnknown
	before, _ := j.sender.last()
	var workers sync.WaitGroup
	errs := make(chan error, 2)
	for range 2 {
		workers.Go(func() {
			_, err := j.plans.ProcessDue(j.ctx, 6)
			if err == nil {
				err = j.delivery.DeliverParkReserve(j.ctx, 6)
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
	j.compose()
	j.tick()
	after, payload := j.sender.last()
	var message map[string]string
	if after != before+1 || json.Unmarshal(payload, &message) != nil || len(message) != 2 ||
		message["kind"] != "park-reserve" || message["token"] == "" || j.sender.messages()[after-1].endpoint != ownerURL {
		t.Fatalf("want a single opaque private push after concurrent workers and restart, got %d: %s", after-before, payload)
	}
	plan := j.read(parkEndpoint, parkOwner)
	if plan == nil || !plan.DeviceReady || plan.Reason != readiness.ParkReserveAtRisk || plan.Estimate == nil ||
		plan.Estimate.ComparableEpisodes != 3 || plan.Estimate.ReturnLowPct != 24 || plan.Estimate.ReturnHighPct != 30 ||
		j.read(parkEndpoint, parkOther) != nil || j.read("/charging/park-reserve?vehicle_id=8", parkOwner) != nil {
		t.Fatalf("wrong plan or private scope: %+v", plan)
	}
	j.status(http.MethodPost, parkClaim, parkOther, message, http.StatusNotFound)
	j.exec(`INSERT INTO charging_sessions(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`,
		j.latestPark.Add(time.Hour), j.latestPark.Add(2*time.Hour))
	if p := j.read(parkEndpoint, parkOwner); p.Reason != readiness.ParkReserveInsufficient || p.Estimate != nil {
		t.Fatalf("late historical overlap must also withdraw the in-app estimate: %+v", p)
	}
	j.status(http.MethodPost, parkClaim, parkOwner, message, http.StatusNotFound)
	j.exec(`DELETE FROM charging_sessions WHERE vehicle_id=7`)
	j.live.values["ChargePortLatch"].Raw = "Engaged"
	j.status(http.MethodPost, parkClaim, parkOwner, message, http.StatusNotFound)
	j.live.values["ChargePortLatch"].Raw = "Disengaged"
	body := j.status(http.MethodPost, parkClaim, parkOwner, message, http.StatusOK)
	var notice struct{ Data delivery.Notification }
	want := fmt.Sprintf("/vampire-drain?vehicle_id=7&park_vehicle_id=7&park_plan_id=%d#park-reserve", plan.ID)
	if err := json.Unmarshal(body, &notice); err != nil || notice.Data.URL != want {
		t.Fatalf("wrong private notification: %s", body)
	}
	j.status(http.MethodPost, parkClaim, parkOwner, message, http.StatusNotFound)
	j.status(http.MethodDelete, fmt.Sprintf("%s&plan_id=%d", parkEndpoint, plan.ID), parkOwner, nil, http.StatusNoContent)
	if j.read(parkEndpoint, parkOwner) != nil {
		t.Fatal("cleared plan is still readable")
	}
}

func TestParkReserveSuppressionAndRevocation(t *testing.T) {
	for _, mode := range []string{"in-app only", "no crossing", "quiet hours", "receipt-only history", "unknown until expiry", "remove browser", "replace plan", "late drive", "expiry"} {
		t.Run(mode, func(t *testing.T) {
			j := newParkJourney(t)
			device := int64(0)
			if mode != "in-app only" {
				device = j.enroll(parkOwner, "https://fcm.googleapis.com/fcm/send/park-owner-device")
			} else {
				j.sender.enabled = false
			}
			setup := j.setup(device, 0)
			switch mode {
			case "no crossing":
				setup["reserve_pct"] = 20
			case "quiet hours":
				j.exec(`INSERT INTO notification_quiet_hours(user_id,start_local,end_local,timezone)
					VALUES ($1,'08:30','09:30','America/Los_Angeles')`, parkOwner)
			case "unknown until expiry":
				j.live.values["Gear"].TimestampSynthetic = true
			case "receipt-only history":
				j.exec(`UPDATE signal_log SET source_emitted_at=NULL WHERE field='BatteryLevel' AND ts=$1`,
					j.latestPark.Add(48*time.Hour+10*time.Minute))
			}
			j.status(http.MethodPut, parkEndpoint, parkOwner, setup, http.StatusNoContent)
			before, _ := j.sender.last()
			j.tick()
			plan := j.read(parkEndpoint, parkOwner)
			if plan == nil {
				t.Fatal("plan not persisted")
			}
			after, payload := j.sender.last()
			switch mode {
			case "receipt-only history":
				if after != before || plan.Estimate != nil || plan.Reason != readiness.ParkReserveInsufficient {
					t.Fatalf("receipt-only history must not send a warning: %+v", plan)
				}
				return
			case "in-app only", "no crossing", "quiet hours", "unknown until expiry":
				if after != before {
					t.Fatal("no push expected")
				}
				expected := readiness.ParkReserveAtRisk
				if mode == "no crossing" {
					expected = readiness.ParkReserveAbove
				} else if mode == "unknown until expiry" {
					expected = readiness.ParkReserveExpired
					j.advance(j.start.Add(90 * time.Minute))
					j.tick()
					plan = j.read(parkEndpoint, parkOwner)
				}
				if plan.Reason != expected || (plan.Estimate != nil) == (expected == readiness.ParkReserveExpired) {
					t.Fatalf("unexpected in-app result: %+v", plan)
				}
				return
			}
			var message map[string]string
			if after != before+1 || json.Unmarshal(payload, &message) != nil {
				t.Fatalf("expected a pending token, got %s", payload)
			}
			switch mode {
			case "remove browser":
				j.status(http.MethodDelete, fmt.Sprintf("/smart-delivery/devices/%d", device), parkOwner, nil, http.StatusNoContent)
				if p := j.read(parkEndpoint, parkOwner); p.DeviceReady || p.Estimate == nil {
					t.Fatalf("removing browser must revoke only push: %+v", p)
				}
			case "replace plan":
				j.status(http.MethodPut, parkEndpoint, parkOwner, j.setup(device, plan.ID), http.StatusNoContent)
			case "late drive":
				j.exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, j.start, j.start.Add(time.Minute))
				if p := j.read(parkEndpoint, parkOwner); p.Reason != readiness.ParkReserveChanged || p.Estimate != nil {
					t.Fatalf("late overlapping drive must withdraw the estimate: %+v", p)
				}
			case "expiry":
				j.advance(j.start.Add(90 * time.Minute))
				if p := j.read(parkEndpoint, parkOwner); p.Reason != readiness.ParkReserveExpired || p.Estimate != nil {
					t.Fatalf("action expiry must withdraw current evidence before the planned return: %+v", p)
				}
			}
			j.tick()
			j.status(http.MethodPost, parkClaim, parkOwner, message, http.StatusNotFound)
			if current, _ := j.sender.last(); current != after {
				t.Fatal("expired, replaced or invalidated delivery must not replay")
			}
		})
	}
}
