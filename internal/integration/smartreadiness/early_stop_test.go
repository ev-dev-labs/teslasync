package smartreadiness_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartdeliverysvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/crypto"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	quiethoursdb "github.com/ev-dev-labs/teslasync/internal/database/quiethours"
	deliverydb "github.com/ev-dev-labs/teslasync/internal/database/smartdelivery"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	readiness "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	deliveryhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartdelivery"
	readinessport "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/normalize"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
)

func TestEarlyStopPrivateDeliveryAfterGrace(t *testing.T) {
	j, stoppedAt := newEarlyStopJourney(t, true)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.enroll("subject-b", "https://push.example.invalid/device-b")
	j.process()
	if count, _ := j.sender.last(); count != 2 || len(j.earlyStopCards("subject-a")) != 0 {
		t.Fatal("an interruption in the grace period produced a card or recommendation push")
	}
	j.setEarlyStop(stoppedAt.Add(70*time.Second), stoppedAt)
	j.process()
	j.process()
	messages := j.sender.messages()
	if len(messages) != 3 || messages[2].endpoint != "https://push.example.invalid/device-a" {
		t.Fatalf("want exactly one scoped recommendation after device verification, got %d messages", len(messages))
	}
	cards := j.earlyStopCards("subject-a")
	if len(cards) != 1 || cards[0].NavigationPath == nil || *cards[0].NavigationPath != "/vehicles/7#vehicle-systems" ||
		len(cards[0].Evidence) != 1 || cards[0].Evidence[0].ChargingReadiness == nil {
		t.Fatalf("want one actionable interruption card: %+v", cards)
	}
	evidence := cards[0].Evidence[0].ChargingReadiness
	if evidence.Kind != string(readiness.DecisionEarlyStop) || evidence.InterruptedAt == nil || !evidence.InterruptedAt.Equal(stoppedAt) ||
		evidence.ArrivalHighPct >= evidence.ReservePct || len(j.earlyStopCards("subject-b")) != 0 {
		t.Fatalf("incorrect or foreign interruption evidence: %+v", evidence)
	}
	token := j.claimToken()
	if rec := j.claim("subject-b", token); rec.Code != http.StatusNotFound {
		t.Fatalf("foreign subject could claim stop: %d", rec.Code)
	}
	if rec := j.claim("subject-a", token); rec.Code != http.StatusOK ||
		!strings.Contains(rec.Body.String(), "/action-center?vehicle_id=7") {
		t.Fatalf("notification has no authorized decision link: %d %s", rec.Code, rec.Body)
	}
	j.live.setChargeState("Charging")
	if got := j.earlyStopCards("subject-a"); len(got) != 0 {
		t.Fatal("resumed charging left an interruption actionable")
	}
}

func TestEarlyStopDueCheckSurvivesWorkerJitter(t *testing.T) {
	j, stop := newEarlyStopJourney(t, true)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.setEarlyStop(stop.Add(59*time.Second), stop)
	j.process()
	if count, _ := j.sender.last(); count != 1 || len(j.earlyStopCards("subject-a")) != 0 {
		t.Fatal("sent before the interruption grace period ended")
	}
	// A minute-only check with the same jitter would arrive after the unchanged
	// NoPower sample expired. Do not edit the persisted due time or restamp it.
	j.now = stop.Add(79 * time.Second)
	j.process()
	if count, _ := j.sender.last(); count != 2 || len(j.earlyStopCards("subject-a")) != 1 {
		t.Fatal("the next worker check missed the unchanged interruption")
	}
}

func TestEarlyStopAfterSteadySessionAndEarlierPlugInReminder(t *testing.T) {
	j := newChargingDeliveryJourney(t, nil)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	plan := testPlan(j.now)
	plan.EarlyStopWatch = true
	if rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan); rec.Code != http.StatusCreated {
		t.Fatalf("save readiness plan: %d %s", rec.Code, rec.Body)
	}
	j.process()
	if got, _ := j.sender.last(); got != 2 {
		t.Fatalf("expected verification and an earlier plug-in reminder, got %d pushes", got)
	}
	j.mountEarlyStop()
	stopped := j.now.Add(80 * time.Minute)
	j.seedEarlyStop(stopped)
	steady := stopped.Add(-20 * time.Minute)
	j.earlyStopExec(`UPDATE signal_log SET ts=$1,source_emitted_at=$1,received_at=$1
		WHERE field='DetailedChargeState' AND ts<$2`, steady, stopped)
	j.earlyStopExec(`UPDATE signal_log SET ts=$1,source_emitted_at=$1,received_at=$1
		WHERE field='ACChargingPower'`, steady.Add(10*time.Second))
	j.setEarlyStop(stopped.Add(70*time.Second), stopped)
	for _, field := range []string{"Gear", "ChargePortLatch", "LocationLatitude", "LocationLongitude", "ChargeLimitSoc", "NominalFullPackEnergyKwh"} {
		j.live.values[field].Timestamp = steady
	}
	j.live.values["BatteryLevel"].Timestamp = stopped.Add(-5 * time.Minute)
	j.process()
	if got, _ := j.sender.last(); got != 3 || len(j.earlyStopCards("subject-a")) != 1 {
		t.Fatalf("steady unchanged session did not deliver separate interruption advice: %d pushes", got)
	}
}

func TestEarlyStopFromChangeOnlyFleetTelemetry(t *testing.T) {
	for _, mode := range []string{"interrupted", "intentional", "unplugged", "resumed"} {
		t.Run(mode, func(t *testing.T) {
			j := newChargingDeliveryJourney(t, nil)
			j.enroll("subject-a", "https://push.example.invalid/device-a")
			plan := testPlan(j.now)
			plan.EarlyStopWatch = true
			if rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan); rec.Code != http.StatusCreated {
				t.Fatalf("save readiness plan: %d %s", rec.Code, rec.Body)
			}
			j.mountEarlyStop()
			j.earlyStopExec(`ALTER TABLE vehicles ADD COLUMN vin text;
				UPDATE vehicles SET vin='SYNTHETIC-EARLY-STOP' WHERE id=7;
				ALTER TABLE signal_log ADD COLUMN time_value timestamptz, ADD COLUMN normalization_version smallint,
				  ADD COLUMN normalization_write_token boolean, ADD COLUMN ingest_origin text, ADD COLUMN provenance_write_token boolean;
				CREATE TABLE charging_telemetry (vehicle_id bigint, ts timestamptz, ac_charging_power_w double precision,
				  charge_port_latch text,
				  PRIMARY KEY(vehicle_id,ts));`)
			pool := j.db.Pool
			pipeline := normalize.New(unithistory.NewRepo(pool, nil), testTelemetryRouter(t, pool), zerolog.Nop())
			ingest := func(at time.Time, field, value string, deliverLive bool) {
				t.Helper()
				received := at.Add(time.Second)
				body := fmt.Appendf(nil, `{"value":%s,"ts":%q}`, value, at.Format(time.RFC3339))
				atoms, err := codec.DecodeJSONField(field, body, "SYNTHETIC-EARLY-STOP", received)
				if err != nil || len(atoms) != 1 {
					t.Fatalf("decode %s: %v (%d fields)", field, err, len(atoms))
				}
				if err := pipeline.ProcessAtomics(j.ctx, codec.StampTransport(atoms, codec.IngestOriginFleetTelemetryMQTT, received), 7); err != nil {
					t.Fatal(err)
				}
				if deliverLive {
					var raw any
					if err := pool.QueryRow(j.ctx, `SELECT COALESCE(to_jsonb(str_value),to_jsonb(float_value),
						to_jsonb(bool_value)) FROM signal_log WHERE vehicle_id=7 AND field=$1 AND ts=$2
						AND source_emitted_at=ts AND received_at=$3 AND ingest_origin='fleet_telemetry_mqtt'`,
						field, at, received).Scan(&raw); err != nil {
						t.Fatalf("read normalized %s: %v", field, err)
					}
					j.live.values[field] = &signal.Value{Raw: raw, Timestamp: at}
				}
			}
			steady, stop := j.now.Add(time.Second), j.now.Add(21*time.Minute)
			j.live.values["ChargePortLatch"].Raw = "Engaged"
			j.live.values["ChargeLimitSoc"] = &signal.Value{Raw: 80.0, Timestamp: steady}
			ingest(steady, "NominalFullPackEnergyKwh", "80", true)
			ingest(steady, "DetailedChargeState", `"DetailedChargeStateCharging"`, true)
			ingest(steady.Add(time.Second), "ACChargingPower", "6.6", true)
			ingest(stop.Add(-5*time.Minute), "BatteryLevel", "46", true)
			if mode == "intentional" {
				ingest(stop.Add(-5*time.Second), "ChargeEnableRequest", "false", false)
			}
			if mode == "unplugged" {
				ingest(stop.Add(-5*time.Second), "ChargePortLatch", `"ChargePortLatchDisengaged"`, false)
			}
			ingest(stop, "DetailedChargeState", `"DetailedChargeStateNoPower"`, true)
			if mode == "resumed" {
				ingest(stop.Add(40*time.Second), "DetailedChargeState", `"DetailedChargeStateCharging"`, false)
			}
			j.now = stop.Add(70 * time.Second)
			j.process()
			want := 0
			if mode == "interrupted" {
				want = 1
			}
			if pushes, _ := j.sender.last(); pushes != 1+want || len(j.earlyStopCards("subject-a")) != want {
				t.Fatalf("expected %d actionable interruptions from change-only data, got %d pushes including verification", want, pushes)
			}
		})
	}
}

func TestEarlyStopSuppressesAmbiguousOrResolvedEvidence(t *testing.T) {
	for _, tt := range []struct {
		name  string
		off   bool
		amend func(*chargingDeliveryJourney, time.Time)
	}{
		{name: "default off", off: true},
		{name: "resumed", amend: func(j *chargingDeliveryJourney, _ time.Time) { j.live.setChargeState("Charging") }},
		{name: "ambiguous intentional stop", amend: func(j *chargingDeliveryJourney, _ time.Time) { j.live.setChargeState("Stopped") }},
		{name: "planned wait", amend: func(j *chargingDeliveryJourney, _ time.Time) {
			j.live.values["ScheduledChargingPending"] = &signal.Value{Raw: true, Timestamp: j.now}
		}},
		{name: "unseen durable disabled request", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,bool_value) VALUES
				(7,'ChargeEnableRequest',$1,$2,false)`, stop.Add(-time.Second), protomodel.ValueKindBool)
		}},
		{name: "older unexpired pending intent even before charging", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,bool_value) VALUES
				(7,'ScheduledChargingPending',$1,$2,true)`, stop.Add(-100*time.Second), protomodel.ValueKindBool)
		}},
		{name: "unseen durable positive power", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,float_value) VALUES
				(7,'ACChargingPower',$1,$2,6600)`, stop.Add(30*time.Second), protomodel.ValueKindDouble)
		}},
		{name: "unseen movement shortly before interruption", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,int_value) VALUES
				(7,'Gear',$1,$2,$3)`, stop.Add(-5*time.Second), protomodel.ValueKindEnum, protomodel.ShiftState_ShiftStateD)
		}},
		{name: "intentional command", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO command_logs VALUES (7,'charge_stop',$1)`, stop.Add(-time.Second))
		}},
		{name: "stale live", amend: func(j *chargingDeliveryJourney, stop time.Time) { j.setEarlyStop(stop.Add(3*time.Minute), stop) }},
		{name: "unattested history", amend: func(j *chargingDeliveryJourney, _ time.Time) {
			j.earlyStopExec(`UPDATE signal_log SET source_emitted_at=NULL WHERE field='ACChargingPower'`)
		}},
		{name: "newer durable resume", amend: func(j *chargingDeliveryJourney, stop time.Time) {
			j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,str_value,source_emitted_at,received_at)
				VALUES (7,'DetailedChargeState',$1,$2,'Charging',$1,$1)`, stop.Add(30*time.Second), protomodel.ValueKindString)
		}},
		{name: "inconsequential stop", amend: func(j *chargingDeliveryJourney, _ time.Time) { j.live.values["BatteryLevel"].Raw = 75.0 }},
		{name: "could not meet the target anyway", amend: func(j *chargingDeliveryJourney, _ time.Time) {
			j.earlyStopExec(`UPDATE signal_log SET float_value=100 WHERE field='ACChargingPower'`)
		}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			j, stop := newEarlyStopJourney(t, !tt.off)
			j.enroll("subject-a", "https://push.example.invalid/device-a")
			j.setEarlyStop(stop.Add(70*time.Second), stop)
			if tt.amend != nil {
				tt.amend(j, stop)
			}
			j.process()
			if count, _ := j.sender.last(); count != 1 || len(j.earlyStopCards("subject-a")) != 0 {
				t.Fatal("unqualified evidence produced an interruption recommendation")
			}
		})
	}
}

func TestEarlyStopRechecksUnclaimedDelivery(t *testing.T) {
	for _, action := range []string{"resume", "pause", "disable watch"} {
		t.Run(action, func(t *testing.T) {
			j, stop := newEarlyStopJourney(t, true)
			j.enroll("subject-a", "https://push.example.invalid/device-a")
			j.setEarlyStop(stop.Add(70*time.Second), stop)
			j.process()
			token := j.claimToken()
			if action == "resume" {
				j.live.setChargeState("Charging")
			} else {
				path := "/smart-charging/plans?vehicle_id=7"
				response := j.request(http.MethodGet, path, "subject-a", nil)
				plans := playlistData[[]readiness.Plan](t, response)
				if len(plans) != 1 {
					t.Fatalf("want exactly one plan to revise: %s", response.Body)
				}
				prior, updated := plans[0], plans[0]
				updated.Enabled = action != "pause"
				updated.EarlyStopWatch = action != "disable watch"
				rec := j.request(http.MethodPut, fmt.Sprintf("/smart-charging/plans/%d", prior.ID), "subject-a", planReplacement(updated, prior))
				if rec.Code != http.StatusOK {
					t.Fatalf("could not update charging consent: %d %s", rec.Code, rec.Body)
				}
			}
			if rec := j.claim("subject-a", token); rec.Code != http.StatusNotFound ||
				len(j.earlyStopCards("subject-a")) != 0 {
				t.Fatalf("outdated interruption remained actionable: %d %s", rec.Code, rec.Body)
			}
		})
	}
}

type interruptingCandidateReader struct {
	*smartreadinesssvc.Service
	after func()
}

func (s interruptingCandidateReader) FindCandidate(ctx context.Context, subject string, vehicle, plan int64,
	kind readiness.DecisionKind,
) (*readinessport.Candidate, error) {
	candidate, err := s.Service.FindCandidate(ctx, subject, vehicle, plan, kind)
	if candidate != nil {
		s.after()
	}
	return candidate, err
}

func TestEarlyStopVetoesDurableResumeAfterCandidateValidation(t *testing.T) {
	for _, operation := range []string{"reserve", "consume"} {
		t.Run(operation, func(t *testing.T) {
			j, stop := newEarlyStopJourney(t, true)
			var planID int64
			if err := j.db.Pool.QueryRow(j.ctx, `SELECT id FROM smart_charging_plans WHERE subject='subject-a'`).Scan(&planID); err != nil {
				t.Fatal(err)
			}
			if operation == "consume" {
				j.enroll("subject-a", "https://push.example.invalid/device-a")
			}
			j.setEarlyStop(stop.Add(70*time.Second), stop)
			j.process()
			candidate, err := j.readiness.FindCandidate(j.ctx, "subject-a", 7, planID, readiness.DecisionEarlyStop)
			if err != nil || candidate == nil {
				t.Fatalf("expected validated interruption candidate: %v", err)
			}
			if operation == "reserve" {
				j.enroll("subject-a", "https://push.example.invalid/device-a")
			}
			enc, err := crypto.New("synthetic-test-encryption-key")
			if err != nil {
				t.Fatal(err)
			}
			interleaved := false
			reader := interruptingCandidateReader{Service: j.readiness, after: func() {
				j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,str_value,source_emitted_at,received_at)
					VALUES (7,'DetailedChargeState',$1,$2,'Charging',$1,$1)`, j.now.Add(time.Second), protomodel.ValueKindString)
				interleaved = true
			}}
			service := smartdeliverysvc.New(deliverydb.NewRepository(j.db), enc, j.sender,
				smartdeliverysvc.WithClock(func() time.Time { return j.now }),
				smartdeliverysvc.WithChargingCandidates(reader), smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
			before, _ := j.sender.last()
			if operation == "reserve" {
				if err := service.NotifyCharging(j.ctx, *candidate); err != nil {
					t.Fatal(err)
				}
			} else {
				token := j.claimToken()
				j.router = chi.NewRouter()
				j.router.Route("/api/v1", deliveryhandler.NewHandler(service, "X-Test-Subject").MountRoutes)
				if claim := j.claim("subject-a", token); claim.Code != http.StatusNotFound {
					t.Fatalf("committed resume did not invalidate claim: %d %s", claim.Code, claim.Body)
				}
			}
			if after, _ := j.sender.last(); !interleaved || after != before {
				t.Fatalf("missed interleaving or sent despite resume: ran=%v pushes=%d->%d", interleaved, before, after)
			}
		})
	}
}

func TestEarlyStopClaimExpiresWhileWaitingForDeliveryLock(t *testing.T) {
	j, stop := newEarlyStopJourney(t, true)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.setEarlyStop(stop.Add(70*time.Second), stop)
	j.process()
	token := j.claimToken()
	enc, err := crypto.New("synthetic-test-encryption-key")
	if err != nil {
		t.Fatal(err)
	}
	var current atomic.Int64
	current.Store(j.now.UnixMicro())
	clock := func() time.Time { return time.UnixMicro(current.Load()).UTC() }
	svc := smartdeliverysvc.New(deliverydb.NewRepository(j.db), enc, j.sender, smartdeliverysvc.WithClock(clock),
		smartdeliverysvc.WithChargingCandidates(j.readiness), smartdeliverysvc.WithQuietHours(quiethoursdb.NewQuietHoursRepo(j.db)))
	j.router = chi.NewRouter()
	j.router.Route("/api/v1", deliveryhandler.NewHandler(svc, "X-Test-Subject").MountRoutes)
	rec := j.claimAfterLockWait(`SELECT id FROM smart_push_deliveries FOR UPDATE`, "%SELECT dev.charging_title%",
		func() *httptest.ResponseRecorder { return j.claim("subject-a", token) },
		func() { current.Store(stop.Add(2 * time.Minute).UnixMicro()) })
	if rec.Code != http.StatusNotFound {
		t.Fatalf("expired interruption remained claimable: %d %s", rec.Code, rec.Body)
	}
	var consumed bool
	if err := j.db.Pool.QueryRow(j.ctx, `SELECT EXISTS (SELECT 1 FROM smart_push_deliveries WHERE claimed_at IS NOT NULL)`).
		Scan(&consumed); err != nil || consumed {
		t.Fatalf("expired claim consumed=%t err=%v", consumed, err)
	}
}

func TestEarlyStopMigrationRollsBackOnlyNewEvidence(t *testing.T) {
	j, stop := newEarlyStopJourney(t, true)
	j.enroll("subject-a", "https://push.example.invalid/device-a")
	j.setEarlyStop(stop.Add(70*time.Second), stop)
	j.process()
	token := j.claimToken()
	if len(j.earlyStopCards("subject-a")) != 1 {
		t.Fatal("expected interruption evidence before rollback")
	}
	applyReadinessMigration(t, j.db, "000313_smart_charging_early_stop", "down")
	applyReadinessMigration(t, j.db, "000313_smart_charging_early_stop", "up")
	rec := j.request(http.MethodGet, "/smart-charging/plans?vehicle_id=7", "subject-a", nil)
	plans := playlistData[[]readiness.Plan](t, rec)
	if rec.Code != http.StatusOK || len(plans) != 1 || plans[0].EarlyStopWatch || !plans[0].Enabled {
		t.Fatalf("rollback must preserve the plan but reset the removed opt-in: %d %s", rec.Code, rec.Body)
	}
	if len(j.earlyStopCards("subject-a")) != 0 {
		t.Fatal("migration restored withdrawn interruption evidence")
	}
	if claim := j.claim("subject-a", token); claim.Code != http.StatusNotFound {
		t.Fatalf("rollback left the withdrawn interruption token claimable: %d", claim.Code)
	}
}

func newEarlyStopJourney(t *testing.T, watch bool) (*chargingDeliveryJourney, time.Time) {
	t.Helper()
	j := newChargingDeliveryJourney(t, nil)
	if !watch {
		j.savePlan()
	} else {
		plan := testPlan(j.now)
		plan.EarlyStopWatch = true
		rec := j.request(http.MethodPost, "/smart-charging/plans", "subject-a", plan)
		if rec.Code != http.StatusCreated || !playlistData[readiness.Plan](t, rec).EarlyStopWatch {
			t.Fatalf("early stop consent not saved: %d %s", rec.Code, rec.Body)
		}
	}
	j.mountEarlyStop()
	stop := j.now.Add(10 * time.Second)
	j.seedEarlyStop(stop)
	j.setEarlyStop(stop.Add(20*time.Second), stop)
	return j, stop
}

func (j *chargingDeliveryJourney) mountEarlyStop() {
	j.t.Helper()
	j.earlyStopExec(`CREATE TABLE signal_log (vehicle_id bigint, field text, ts timestamptz, str_value text,
		value_kind smallint NOT NULL, float_value double precision, int_value bigint,
		bool_value boolean, source_emitted_at timestamptz, received_at timestamptz,
		PRIMARY KEY(vehicle_id,field,ts))`)
	j.createEarlyStopCommandLog()
	applyReadinessMigration(j.t, j.db, "000223_action_center_state", "up")
	actionService := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(j.db),
		actioncentersvc.WithSmartCharging(j.readiness), actioncentersvc.WithClock(func() time.Time { return j.now }))
	j.router.Get("/api/v1/action-center", actionhandler.NewHandler(actionService, "X-Test-Subject").List)
}

func (j *chargingDeliveryJourney) createEarlyStopCommandLog() {
	j.t.Helper()
	j.earlyStopExec(`CREATE TABLE command_logs (vehicle_id bigint, command text, created_at timestamptz)`)
}

func (j *chargingDeliveryJourney) seedEarlyStop(stop time.Time) {
	j.t.Helper()
	j.earlyStopExec(`INSERT INTO signal_log (vehicle_id,field,ts,value_kind,str_value,int_value,float_value,source_emitted_at,received_at) VALUES
		(7,'DetailedChargeState',$1,$5,NULL,$4,NULL,$1,$1),
		(7,'DetailedChargeState',$2,$6,'Charging',NULL,NULL,$2,$2),
		(7,'ACChargingPower',$3,$7,NULL,NULL,6600,$3,$3)`, stop, stop.Add(-90*time.Second), stop.Add(-30*time.Second),
		protomodel.DetailedChargeStateValue_DetailedChargeStateNoPower,
		protomodel.ValueKindEnum, protomodel.ValueKindString, protomodel.ValueKindDouble)
	j.live.values["NominalFullPackEnergyKwh"] = &signal.Value{Raw: 80000.0}
	j.live.values["ChargeLimitSoc"] = &signal.Value{Raw: 80.0}
}

func (j *chargingDeliveryJourney) earlyStopExec(sql string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.ctx, sql, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *chargingDeliveryJourney) setEarlyStop(now, stop time.Time) {
	j.advance(now)
	j.live.setChargeState("NoPower")
	j.live.values["DetailedChargeState"].Timestamp = stop
}

func (j *chargingDeliveryJourney) earlyStopCards(subject string) []actiondomain.Recommendation {
	j.t.Helper()
	rec := j.request(http.MethodGet, "/action-center?vehicle_id=7", subject, nil)
	var page actiondomain.Response
	if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &page) != nil {
		j.t.Fatalf("action center response = %d %s", rec.Code, rec.Body)
	}
	return page.Items
}
