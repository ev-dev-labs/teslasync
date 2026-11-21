package smartreadiness_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/codec"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func TestCabinPrepUsesCompletedLocalMorningsAndCanonicalTelemetry(t *testing.T) {
	repo, db := testRepository(t)
	ctx := t.Context()
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	startTime := func(month time.Month, day int) time.Time {
		return time.Date(2026, month, day, 8, 0, 0, 0, loc)
	}
	departure := startTime(time.November, 9)
	now := departure.Add(-14 * time.Minute)
	days := []time.Time{startTime(time.November, 6), startTime(time.November, 5),
		startTime(time.November, 4), startTime(time.October, 30), startTime(time.November, 7)}
	seedCabinEvidence(t, db, days)
	history := smartreadinesssvc.NewCabinHistory(repo, signal.NewLogStateReader(db.Pool, zerolog.Nop()))
	live := domain.CabinPrepConditions{ObservedAt: now.Add(-time.Minute), CabinC: 10, OutsideC: 6, Parked: true}
	check := func(wantEpisodes int, reason domain.CabinPrepReason) {
		t.Helper()
		episodes, err := history.Episodes(ctx, 7, now, departure, loc)
		if err != nil || len(episodes) != wantEpisodes {
			t.Fatalf("episodes=%+v, err=%v; want %d", episodes, err, wantEpisodes)
		}
		forecast, got := smartreadinesssvc.EstimateCabinPrep(episodes, live, departure, now, loc, 21)
		if got != reason {
			t.Fatalf("estimate=%+v reason=%s; want %s", forecast, got, reason)
		}
		if reason == domain.CabinPrepEligible &&
			(forecast == nil || forecast.ComparableMornings != 4 || forecast.LeadLowS != 540 || forecast.LeadHighS != 780) {
			t.Fatalf("mixed-DST history should yield observed 9–13 minute range: %+v", forecast)
		}
	}
	check(4, domain.CabinPrepEligible)
	if _, err := db.Pool.Exec(ctx, `UPDATE signal_log SET source_emitted_at=NULL
		WHERE field='HvacPower' AND bool_value AND ts BETWEEN $1 AND $2`,
		startTime(time.November, 5).Add(-16*time.Minute), startTime(time.November, 6)); err != nil {
		t.Fatal(err)
	}
	check(2, domain.CabinPrepInsufficient)
	if _, err := db.Pool.Exec(ctx, `UPDATE signal_log SET source_emitted_at=ts
		WHERE field='HvacPower' AND source_emitted_at IS NULL`); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, "UPDATE drives SET ended_at=NULL WHERE started_at=$1", startTime(time.November, 6)); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool.Exec(ctx, "UPDATE signal_log SET str_value='FanOnly' WHERE field='CabinOverheatProtectionMode' AND ts=$1",
		startTime(time.November, 5).Add(-17*time.Minute)); err != nil {
		t.Fatal(err)
	}
	check(2, domain.CabinPrepInsufficient)
	foreign, err := history.Episodes(ctx, 8, now, departure, loc)
	if err != nil || len(foreign) != 0 {
		t.Fatalf("another vehicle must not inherit episodes: %+v %v", foreign, err)
	}
}

func seedCabinEvidence(t *testing.T, db *database.DB, days []time.Time) {
	t.Helper()
	ctx := t.Context()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE drives (
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, vehicle_id bigint NOT NULL,
		started_at timestamptz NOT NULL, ended_at timestamptz);
		CREATE TABLE signal_log (
			ts timestamptz NOT NULL, vehicle_id bigint NOT NULL, field text NOT NULL,
			value_kind smallint NOT NULL, str_value text, bool_value boolean, int_value bigint,
			float_value double precision, time_value timestamptz, received_at timestamptz, source_emitted_at timestamptz,
			PRIMARY KEY (vehicle_id, field, ts));
		INSERT INTO vehicles (id,display_name) VALUES (8,'Unrelated synthetic vehicle')`)
	emit := func(at time.Time, field, wire string) {
		t.Helper()
		payload := fmt.Sprintf(`{"value":%s,"ts":%q}`, wire, at.UTC().Format(time.RFC3339))
		atoms, err := codec.DecodeJSONField(field, []byte(payload), "00000000000000000", at)
		if err != nil || len(atoms) != 1 {
			t.Fatalf("decode fixture %s: %v, %v", field, atoms, err)
		}
		var kind protomodel.ValueKind
		var text *string
		var boolean *bool
		var measurement *float64
		switch v := atoms[0].Value.(type) {
		case string:
			kind, text = protomodel.ValueKindString, &v
		case bool:
			kind, boolean = protomodel.ValueKindBool, &v
		case float64:
			kind, measurement = protomodel.ValueKindDouble, &v
		case float32:
			number := float64(v)
			kind, measurement = protomodel.ValueKindFloat, &number
		default:
			t.Fatalf("unexpected canonical sample: %s %T", field, v)
		}
		exec(`INSERT INTO signal_log (ts,vehicle_id,field,value_kind,str_value,bool_value,float_value,source_emitted_at)
			VALUES ($1,7,$2,$3,$4,$5,$6,$7)`, atoms[0].EmittedAt, field, kind, text, boolean, measurement, atoms[0].SourceEmittedAt)
	}
	prepare := func(at time.Time) {
		t.Helper()
		exec("INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)", at, at.Add(15*time.Minute))
		off := at.Add(-17 * time.Minute)
		emit(off, "Gear", `"P"`)
		emit(off, "CabinOverheatProtectionMode", `"Off"`)
		emit(off, "HvacLeftTemperatureRequest", "21")
		emit(off, "HvacRightTemperatureRequest", "21")
		emit(off, "InsideTemp", "9")
		emit(off, "OutsideTemp", "6")
		emit(off, "HvacPower", `"Off"`)
		emit(off.Add(time.Minute), "HvacPower", `"Precondition"`)
		for _, sample := range []struct {
			minute time.Duration
			wire   string
		}{{2, "11"}, {4, "13"}, {6, "15"}, {8, "17"}, {10, "19"}, {11, "21"}} {
			emit(off.Add(sample.minute*time.Minute), "InsideTemp", sample.wire)
		}
	}
	for _, day := range days {
		prepare(day)
	}
}
