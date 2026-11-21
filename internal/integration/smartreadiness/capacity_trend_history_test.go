package smartreadiness_test

import (
	"math"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func seedCapacityObservations(t *testing.T, db *database.DB, recentWh float64) (time.Time, time.Time, func(string, ...any)) {
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
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz, total_energy_added_wh float8);
		INSERT INTO vehicles(id,display_name) VALUES (8,'Another synthetic car') ON CONFLICT DO NOTHING`)
	seed := func(month time.Month, day int, wh float64) (start, end time.Time) {
		start = time.Date(2026, month, day, 1, 0, 0, 0, time.UTC)
		end = start.Add(5 * time.Hour)
		exec(`INSERT INTO charging_sessions(vehicle_id,started_at,ended_at,total_energy_added_wh)
			VALUES (7,$1,$2,999999),(8,$1,$2,20000)`, start, end)
		first, last := start, end.Add(-10*time.Minute)
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value) VALUES
			($1,7,'BatteryLevel',$3,30),($2,7,'BatteryLevel',$3,70),
			($1,7,'ModuleTempMin',$3,23),($2,7,'ModuleTempMin',$3,24),
			($1,7,'ModuleTempMax',$3,26),($2,7,'ModuleTempMax',$3,27),
			($1,7,'ACChargingPower',$3,7200),($2,7,'ACChargingPower',$3,7000),
			($1,7,'ACChargingEnergyIn',$3,1000),($2,7,'ACChargingEnergyIn',$3,40000),
			($4,7,'DCChargingEnergyIn',$3,500),($5,7,'DCChargingEnergyIn',$3,$6),
			($4,8,'DCChargingEnergyIn',$3,400),($5,8,'DCChargingEnergyIn',$3,35000)`,
			first, last, protomodel.ValueKindDouble, first, last.Add(time.Minute), 500+wh*.4)
		return start, end
	}
	for i := range 8 {
		seed(time.September, 2+i*3, 75_000+float64(i%2)*500)
	}
	var lastStart, lastEnd time.Time
	for i, day := range []int{2, 5, 9, 14, 17, 21, 25, 30} {
		lastStart, lastEnd = seed(time.October, day, recentWh+float64(i%2)*500)
	}
	exec(`UPDATE signal_log SET source_emitted_at=ts`)
	return lastStart, lastEnd, exec
}

func TestMonthlyCapacityChangeUsesMeasuredPackSideOnly(t *testing.T) {
	repo, db := testRepository(t)
	lastStart, lastEnd, exec := seedCapacityObservations(t, db, 69_000)
	ctx := t.Context()
	now := time.Date(2026, 11, 5, 6, 0, 0, 0, time.UTC)
	reader := smartreadinesssvc.NewCapacityTrendHistory(repo, signal.NewLogStateReader(db.Pool, zerolog.Nop()))
	review, reason, err := reader.Digest(ctx, 7, now)
	if err != nil || reason != domain.CapacityTrendChanged || review == nil || review.RecentDays != 8 ||
		math.Abs(review.Change.LowWh+6500) > .001 || math.Abs(review.Change.HighWh+5500) > .001 {
		t.Fatalf("want independent observed pack input, not charger input or summary: %+v (%s, %v)", review, reason, err)
	}
	if review, reason, err := reader.Digest(ctx, 8, now); err != nil || review != nil || reason != domain.CapacityTrendSparse {
		t.Fatalf("other vehicle must not inherit evidence: %+v (%s, %v)", review, reason, err)
	}
	exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value)
		VALUES ($1,7,'DCChargingPower',$2,20000)`, lastStart.Add(time.Hour), protomodel.ValueKindDouble)
	if review, reason, err := reader.Digest(ctx, 7, now); err != nil || review != nil || reason != domain.CapacityTrendSparse {
		t.Fatalf("mixed charging conditions must not support a digest: %+v (%s, %v)", review, reason, err)
	}
	exec(`DELETE FROM signal_log WHERE vehicle_id=7 AND field='DCChargingPower'`)
	exec(`UPDATE signal_log SET ts=$2,source_emitted_at=$2
		WHERE vehicle_id=7 AND field='DCChargingEnergyIn' AND ts=$1`,
		lastEnd.Add(-9*time.Minute), lastEnd.Add(-7*time.Minute))
	if review, reason, err := reader.Digest(ctx, 7, now); err != nil || review != nil || reason != domain.CapacityTrendSparse {
		t.Fatalf("noncoincident meter and SOC must not support a digest: %+v (%s, %v)", review, reason, err)
	}
	exec(`UPDATE signal_log SET ts=$2,source_emitted_at=NULL
		WHERE vehicle_id=7 AND field='DCChargingEnergyIn' AND ts=$1`,
		lastEnd.Add(-7*time.Minute), lastEnd.Add(-9*time.Minute))
	if review, reason, err := reader.Digest(ctx, 7, now); err != nil || review != nil || reason != domain.CapacityTrendSparse {
		t.Fatalf("receipt-only energy must not support a digest: %+v (%s, %v)", review, reason, err)
	}
}
