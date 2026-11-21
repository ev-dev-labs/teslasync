package smartreadiness_test

import (
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func seedParkReserve(t *testing.T, db *database.DB, now time.Time, includeRejected bool) time.Time {
	t.Helper()
	seedCabinEvidence(t, db, nil)
	ctx := t.Context()
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE charging_sessions (
		vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz)`)
	stay := 48 * time.Hour
	seed := func(vehicle int64, daysAgo int, drop float64, secondBattery bool) time.Time {
		t.Helper()
		parkedAt := now.AddDate(0, 0, -daysAgo)
		departure := parkedAt.Add(stay + 20*time.Minute)
		start, end := parkedAt.Add(10*time.Minute), departure.Add(-10*time.Minute)
		exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES ($1,$2,$3),($1,$4,$5)`,
			vehicle, parkedAt.Add(-time.Hour), parkedAt, departure, departure.Add(time.Hour))
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,str_value) VALUES
			($1,$2,'Gear',$3,'P'),($1,$2,'DetailedChargeState',$3,'Disconnected'),
			($1,$2,'ChargePortLatch',$3,'Disengaged'),($1,$2,'SentryMode',$3,'Off')`,
			start, vehicle, protomodel.ValueKindString)
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value) VALUES
			($1,$3,'BatteryLevel',$4,36),($1,$3,'OutsideTemp',$4,4),($2,$3,'OutsideTemp',$4,5)`,
			start, end, vehicle, protomodel.ValueKindDouble)
		if secondBattery {
			exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value) VALUES
				($1,$2,'BatteryLevel',$3,$4)`, end, vehicle, protomodel.ValueKindDouble, 36-drop)
		}
		return parkedAt
	}

	seed(7, 62, 5, true)
	seed(7, 52, 7, true)
	latest := seed(7, 42, 9, true)
	if includeRejected {
		seed(7, 32, 19, false)
		plugged := seed(7, 22, 18, true)
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,str_value) VALUES
			($1,7,'ChargePortLatch',$3,'Engaged'),($2,7,'ChargePortLatch',$3,'Disengaged')`,
			plugged.Add(48*time.Hour+12*time.Minute), plugged.Add(48*time.Hour+17*time.Minute), protomodel.ValueKindString)
		charged := seed(7, 12, 17, true)
		exec(`INSERT INTO charging_sessions(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`,
			charged.Add(10*time.Hour), charged.Add(11*time.Hour))
		seed(8, 12, 28, true)
	}
	exec(`UPDATE signal_log SET source_emitted_at=ts`)
	return latest
}

func TestParkReserveUsesMeasuredUnpluggedDriveBrackets(t *testing.T) {
	repo, db := testRepository(t)
	ctx := t.Context()
	now := time.Date(2026, 11, 20, 17, 0, 0, 0, time.UTC)
	stay := 48 * time.Hour
	latest := seedParkReserve(t, db, now, true)
	history := smartreadinesssvc.NewParkReserveHistory(repo, signal.NewLogStateReader(db.Pool, zerolog.Nop()))
	live := domain.ParkReserveConditions{
		ObservedAt: now.Add(-time.Minute), BatteryPct: 34, OutsideC: 4, SentryMode: "Off", Parked: true, Unplugged: true,
	}
	episodes, err := history.Episodes(ctx, 7, now, stay)
	if err != nil || len(episodes) != 3 {
		t.Fatalf("want three complete same-vehicle unplugged observations, got %+v: %v", episodes, err)
	}
	estimate, reason := smartreadinesssvc.EstimateParkReserve(episodes, live, now, now.Add(stay), 28)
	if estimate == nil || reason != domain.ParkReserveAtRisk || estimate.ReturnLowPct != 24 || estimate.ReturnHighPct != 30 {
		t.Fatalf("want 24–30%% and reserve warning, got %+v (%s)", estimate, reason)
	}
	at := latest.Add(48*time.Hour + 10*time.Minute)
	if _, err := db.Pool.Exec(ctx, `UPDATE signal_log SET source_emitted_at=NULL
		WHERE vehicle_id=7 AND field='BatteryLevel' AND ts=$1`, at); err != nil {
		t.Fatal(err)
	}
	if episodes, err = history.Episodes(ctx, 7, now, stay); err != nil || len(episodes) != 2 {
		t.Fatalf("receipt-only battery cannot qualify as a measured drain: %+v (%v)", episodes, err)
	}
	if _, err := db.Pool.Exec(ctx, `UPDATE signal_log SET source_emitted_at=ts
		WHERE vehicle_id=7 AND field='BatteryLevel' AND ts=$1`, at); err != nil {
		t.Fatal(err)
	}

	if _, err := db.Pool.Exec(ctx, `INSERT INTO charging_sessions(vehicle_id,started_at) VALUES (7,$1)`, latest.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	episodes, err = history.Episodes(ctx, 7, now, stay)
	if err != nil || len(episodes) != 2 {
		t.Fatalf("late overlapping open session must remove the historical observation: %+v (%v)", episodes, err)
	}
	if estimate, reason = smartreadinesssvc.EstimateParkReserve(episodes, live, now, now.Add(stay), 28); estimate != nil ||
		reason != domain.ParkReserveInsufficient {
		t.Fatalf("no estimate without three observations: %+v (%s)", estimate, reason)
	}
}
