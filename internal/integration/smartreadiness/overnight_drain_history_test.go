package smartreadiness_test

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	apiveh "github.com/ev-dev-labs/teslasync/internal/api/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	energydb "github.com/ev-dev-labs/teslasync/internal/database/energy"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

func seedOvernightEvidence(t *testing.T, db *database.DB, lossNow float64) (morning time.Time, exec func(string, ...any)) {
	t.Helper()
	seedCabinEvidence(t, db, nil)
	ctx := t.Context()
	exec = func(statement string, args ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE charging_sessions (
		vehicle_id bigint NOT NULL, started_at timestamptz NOT NULL, ended_at timestamptz);
		CREATE TABLE command_logs (
		id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
		vehicle_id bigint NOT NULL, command text NOT NULL, params jsonb, status text NOT NULL, error text,
		created_at timestamptz NOT NULL);
		INSERT INTO vehicles(id,display_name) VALUES (8,'Another synthetic car') ON CONFLICT DO NOTHING`)
	applyReadinessMigration(t, db, "000311_wake_request_evidence", "up")
	morning = time.Date(2026, 11, 20, 6, 0, 0, 0, time.UTC)
	for day, loss := range []float64{lossNow, 2, 1, 3, 2} {
		end := morning.AddDate(0, 0, -day)
		first, last := end.Add(-8*time.Hour+10*time.Minute), end.Add(-10*time.Minute)
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,str_value) VALUES
			($1,7,'Gear',$2,'P'),($1,7,'DetailedChargeState',$2,'Disconnected'),
			($1,7,'ChargePortLatch',$2,'Disengaged'),($1,7,'SentryMode',$2,'Off')`,
			first, protomodel.ValueKindString)
		exec(`INSERT INTO signal_log(ts,vehicle_id,field,value_kind,float_value) VALUES
			($1,7,'BatteryLevel',$3,60),($2,7,'BatteryLevel',$3,$4),
			($1,7,'OutsideTemp',$3,4),($2,7,'OutsideTemp',$3,3)`,
			first, last, protomodel.ValueKindDouble, 60-loss)
	}
	exec(`INSERT INTO signal_log(ts, vehicle_id,field,value_kind,str_value)
		VALUES ($1,7,'SentryMode',$2,'Armed')`, morning.Add(-3*time.Hour), protomodel.ValueKindString)
	exec(`INSERT INTO signal_log(ts, vehicle_id,field,value_kind,bool_value)
		VALUES ($1,7,'HvacPower',$2,true)`, morning.Add(-2*time.Hour), protomodel.ValueKindBool)
	exec(`UPDATE signal_log SET source_emitted_at=ts`)
	exec(`INSERT INTO command_logs (vehicle_id,command,status,created_at,wake_requested_at) VALUES
		(8,'wake_up','success',$1,$1),(7,'wake_up','failed',$1,$1),(7,'wake_up','success',$1,NULL),
		(7,'wake_up','success',$2,$2),(7,'wake','success',$3,$3)`,
		morning.Add(-4*time.Hour), morning.Add(-time.Hour), morning.Add(time.Minute))
	return morning, exec
}

func TestOvernightDrainRecordsExplicitWakeRequest(t *testing.T) {
	repo, db := testRepository(t)
	_, exec := seedOvernightEvidence(t, db, 7)
	exec(`DELETE FROM command_logs;
		ALTER TABLE vehicles ADD COLUMN tesla_id bigint NOT NULL DEFAULT 77,
			ADD COLUMN vin text NOT NULL DEFAULT '00000000000000001',
			ADD COLUMN model text NOT NULL DEFAULT 'Synthetic',
			ADD COLUMN trim_level text NOT NULL DEFAULT '',
			ADD COLUMN color text NOT NULL DEFAULT '',
			ADD COLUMN timezone text NOT NULL DEFAULT 'UTC',
			ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
			ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
		CREATE TABLE settings (key text PRIMARY KEY, value_bool boolean)`)
	var calls atomic.Int64
	successBoundary := make(chan time.Time, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/api/1/vehicles/00000000000000001/wake_up" ||
			r.Header.Get("Authorization") != "Bearer synthetic-wake-test-token" {
			t.Error("unexpected wake request on the loopback server")
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		boundary := time.Now().Add(20 * time.Millisecond)
		successBoundary <- boundary
		time.Sleep(time.Until(boundary))
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	client := tesla.NewClient(config.TeslaConfig{BaseURL: upstream.URL, Timeout: 3 * time.Second})
	client.SetTokens("synthetic-wake-test-token", "", time.Now().Add(time.Hour))
	handler := apiveh.NewHandler(service.NewVehicleService(db), client, nil).WithWakeCommandLog(energydb.NewCommandLogRepo(db))
	router := chi.NewRouter()
	const path = "/api/v1/vehicles/7/wake"
	router.Post("/api/v1/vehicles/{vehicleID}/wake", handler.Wake)
	send := func() int {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, path, nil))
		return rec.Code
	}
	ctx := t.Context()
	start := time.Now().Add(-time.Second)
	if status := send(); status < 400 || calls.Load() != 1 {
		t.Fatalf("the rejected wake must not appear successful (status=%d)", status)
	}
	if at, err := repo.OvernightWakeRequest(ctx, 7, start, time.Now()); err != nil || at != nil {
		t.Fatalf("rejected wake is not an accepted wake request: %v, %v", at, err)
	}
	if status := send(); status != http.StatusOK || calls.Load() != 2 {
		t.Fatalf("the normal wake route must accept one request without retry (status=%d)", status)
	}
	boundary, end := <-successBoundary, time.Now()
	if at, err := repo.OvernightWakeRequest(ctx, 7, start, boundary); err != nil || at == nil || !at.Before(boundary) {
		t.Fatalf("an accepted manual wake must be recorded as same-vehicle evidence: %v, %v", at, err)
	}
	if at, err := repo.OvernightWakeRequest(ctx, 7, boundary, end); err != nil || at != nil {
		t.Fatalf("a delayed response cannot move the request into a later measurement interval: %v, %v", at, err)
	}
	if at, err := repo.OvernightWakeRequest(ctx, 8, start, time.Now()); err != nil || at != nil {
		t.Fatalf("another vehicle must not inherit the accepted wake: %v, %v", at, err)
	}
	applyReadinessMigration(t, db, "000311_wake_request_evidence", "down")
	applyReadinessMigration(t, db, "000311_wake_request_evidence", "up")
	if at, err := repo.OvernightWakeRequest(ctx, 7, start, end); err != nil || at != nil {
		t.Fatalf("historical completion-only records cannot qualify: %v, %v", at, err)
	}
}

func TestOvernightDrainRequiresActualSameWindowEvidence(t *testing.T) {
	repo, db := testRepository(t)
	ctx := t.Context()
	morning, exec := seedOvernightEvidence(t, db, 7)
	now := morning.Add(time.Hour)
	history := smartreadinesssvc.NewOvernightDrainHistory(repo, signal.NewLogStateReader(db.Pool, zerolog.Nop()))
	review, reason, err := history.Review(ctx, 7, morning, now)
	if err != nil || reason != domain.OvernightAboveUsualRange || review == nil || review.MeasuredLossPct != 7 ||
		review.ComparableNights != 4 || len(review.Factors) != 3 ||
		review.Factors[2].Kind != domain.OvernightWakeRequested || !review.Factors[2].ObservedAt.Equal(morning.Add(-time.Hour)) {
		t.Fatalf("want same-window Sentry, HVAC, and exact vehicle's recorded wake request: %+v (%s, %v)", review, reason, err)
	}
	exec(`INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)`, morning.Add(-4*time.Hour), morning.Add(-3*time.Hour))
	if review, reason, err := history.Review(ctx, 7, morning, now); err != nil || review != nil || reason != domain.OvernightMissingEvidence {
		t.Fatalf("late overlapping drive must withdraw the review: %+v (%s, %v)", review, reason, err)
	}
	exec(`DELETE FROM drives WHERE vehicle_id=7`)
	exec(`UPDATE signal_log SET source_emitted_at=NULL
		WHERE vehicle_id=7 AND field='BatteryLevel' AND ts=$1`, morning.Add(-10*time.Minute))
	if review, reason, err := history.Review(ctx, 7, morning, now); err != nil || review != nil || reason != domain.OvernightMissingEvidence {
		t.Fatalf("receipt-only battery cannot replace an emitted measurement: %+v (%s, %v)", review, reason, err)
	}
}
