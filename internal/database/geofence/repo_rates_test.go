package geofence

import (
	"context"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// ---------------------------------------------------------------------------
// validateGeofenceRate
// ---------------------------------------------------------------------------

func TestValidateGeofenceRate(t *testing.T) {
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)

	valid := func() *systemmodel.GeofenceRate {
		return &systemmodel.GeofenceRate{GeofenceID: 1, RatePerWh: 0.0001005, Currency: "USD", EffectiveFrom: from}
	}

	tests := []struct {
		name    string
		mutate  func(*systemmodel.GeofenceRate)
		nilRate bool
		wantErr string
	}{
		{name: "valid open interval", mutate: func(gr *systemmodel.GeofenceRate) {}},
		{name: "valid closed interval", mutate: func(gr *systemmodel.GeofenceRate) { gr.EffectiveTo = &to }},
		{name: "valid zero rate", mutate: func(gr *systemmodel.GeofenceRate) { gr.RatePerWh = 0 }},
		{name: "rate exceeds database precision bound", mutate: func(gr *systemmodel.GeofenceRate) { gr.RatePerWh = 1_000_000 }, wantErr: "1000000"},
		{name: "nil rate", nilRate: true, wantErr: "nil"},
		{name: "geofence id zero", mutate: func(gr *systemmodel.GeofenceRate) { gr.GeofenceID = 0 }, wantErr: "geofence_id required"},
		{name: "geofence id negative", mutate: func(gr *systemmodel.GeofenceRate) { gr.GeofenceID = -1 }, wantErr: "geofence_id required"},
		{name: "NaN rate", mutate: func(gr *systemmodel.GeofenceRate) { gr.RatePerWh = math.NaN() }, wantErr: "must be finite"},
		{name: "Inf rate", mutate: func(gr *systemmodel.GeofenceRate) { gr.RatePerWh = math.Inf(1) }, wantErr: "must be finite"},
		{name: "negative rate", mutate: func(gr *systemmodel.GeofenceRate) { gr.RatePerWh = -0.0001 }, wantErr: "must be finite"},
		{name: "currency too short", mutate: func(gr *systemmodel.GeofenceRate) { gr.Currency = "US" }, wantErr: "3-letter ISO 4217"},
		{name: "currency too long", mutate: func(gr *systemmodel.GeofenceRate) { gr.Currency = "USDD" }, wantErr: "3-letter ISO 4217"},
		{name: "currency lowercase", mutate: func(gr *systemmodel.GeofenceRate) { gr.Currency = "usd" }, wantErr: "uppercase ISO 4217"},
		{name: "currency mixed case", mutate: func(gr *systemmodel.GeofenceRate) { gr.Currency = "Usd" }, wantErr: "uppercase ISO 4217"},
		{name: "currency with digit", mutate: func(gr *systemmodel.GeofenceRate) { gr.Currency = "US1" }, wantErr: "uppercase ISO 4217"},
		{name: "effective_from zero", mutate: func(gr *systemmodel.GeofenceRate) { gr.EffectiveFrom = time.Time{} }, wantErr: "effective_from required"},
		{name: "effective_to equal effective_from", mutate: func(gr *systemmodel.GeofenceRate) { t := from; gr.EffectiveTo = &t }, wantErr: "effective_to must be after"},
		{name: "effective_to before effective_from", mutate: func(gr *systemmodel.GeofenceRate) { t := from.Add(-time.Hour); gr.EffectiveTo = &t }, wantErr: "effective_to must be after"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var gr *systemmodel.GeofenceRate
			if !tc.nilRate {
				gr = valid()
				tc.mutate(gr)
			}
			err := validateGeofenceRate(gr)
			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("error=%v, want substring %q", err, tc.wantErr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// classifyRateConflict
// ---------------------------------------------------------------------------

func TestClassifyRateConflict(t *testing.T) {
	t.Run("nil passthrough", func(t *testing.T) {
		if err := classifyRateConflict(nil); err != nil {
			t.Fatalf("want nil, got %v", err)
		}
	})
	t.Run("exclusion violation 23P01 maps to ErrRateConflict", func(t *testing.T) {
		err := classifyRateConflict(&pgconn.PgError{Code: "23P01", Message: "conflicting key value"})
		if !errors.Is(err, ErrRateConflict) {
			t.Fatalf("err=%v, want wrapped ErrRateConflict", err)
		}
	})
	t.Run("unique violation 23505 maps to ErrRateConflict", func(t *testing.T) {
		err := classifyRateConflict(&pgconn.PgError{Code: "23505", Message: "duplicate key value"})
		if !errors.Is(err, ErrRateConflict) {
			t.Fatalf("err=%v, want wrapped ErrRateConflict", err)
		}
	})
	t.Run("unrelated pg error passes through unchanged", func(t *testing.T) {
		orig := &pgconn.PgError{Code: "42P01", Message: "relation does not exist"}
		err := classifyRateConflict(orig)
		if !errors.Is(err, orig) || errors.Is(err, ErrRateConflict) {
			t.Fatalf("err=%v, want unchanged passthrough (not ErrRateConflict)", err)
		}
	})
	t.Run("non-pg error passes through unchanged", func(t *testing.T) {
		if err := classifyRateConflict(errBoom); !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want errBoom passthrough", err)
		}
	})
}

// ---------------------------------------------------------------------------
// CreateRate
// ---------------------------------------------------------------------------

func sampleRate() *systemmodel.GeofenceRate {
	return &systemmodel.GeofenceRate{
		GeofenceID:    1,
		RatePerWh:     0.0001005,
		Currency:      "USD",
		EffectiveFrom: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC),
	}
}

func TestCreateRate_ValidationRejectedBeforeAnyDBCall(t *testing.T) {
	pool := &fakePool{}
	gr := sampleRate()
	gr.Currency = "us" // invalid
	err := newRepo(pool).CreateRate(context.Background(), gr)
	if err == nil {
		t.Fatal("want validation error")
	}
	if pool.beginCalls != 0 {
		t.Fatalf("validation failure must not open a transaction, got %d Begin calls", pool.beginCalls)
	}
}

func TestCreateRate_Success(t *testing.T) {
	tx := &fakeTx{
		execQueue: []execResult{
			{tag: tag(0)}, // close-open UPDATE (no prior open interval)
			{tag: tag(2)}, // exact-interval sessions
			{tag: tag(3)}, // uncovered legacy estimates
		},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(99), fixedTime}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	gr := sampleRate()

	if err := newRepo(pool).CreateRate(context.Background(), gr); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if gr.ID != 99 || !gr.CreatedAt.Equal(fixedTime) {
		t.Fatalf("rate not populated from RETURNING: %+v", gr)
	}
	if tx.commitCalls != 1 {
		t.Fatalf("want 1 commit, got %d", tx.commitCalls)
	}
	if len(tx.execCalls) != 3 {
		t.Fatalf("want close-open + exact + uncovered Exec calls, got %d", len(tx.execCalls))
	}
	closeCall := tx.execCalls[0]
	for _, sub := range []string{"UPDATE geofence_rates", "effective_to IS NULL", "effective_from < $2"} {
		if !strings.Contains(closeCall.sql, sub) {
			t.Errorf("close-open SQL missing %q:\n%s", sub, closeCall.sql)
		}
	}
	if closeCall.args[0] != gr.GeofenceID || closeCall.args[1] != gr.EffectiveFrom {
		t.Errorf("close-open args mismatch: %v", closeCall.args)
	}
	exactCall := tx.execCalls[1]
	for _, sub := range []string{
		"cost_source   = 'geofence_tariff'",
		"started_at >= $5",
		"cost_source = 'default_estimate'",
		"cost_source = 'geofence_tariff' AND rate_id = $2",
	} {
		if !strings.Contains(exactCall.sql, sub) {
			t.Errorf("exact-session SQL missing %q:\n%s", sub, exactCall.sql)
		}
	}
	uncoveredCall := tx.execCalls[2]
	for _, sub := range []string{
		"cost_source   = 'default_estimate'",
		"NOT EXISTS",
		"historical.effective_from <= cs.started_at",
		"cs.rate_id IS NULL OR cs.rate_id = $2",
	} {
		if !strings.Contains(uncoveredCall.sql, sub) {
			t.Errorf("uncovered-session SQL missing %q:\n%s", sub, uncoveredCall.sql)
		}
	}
	insertCall := tx.queryRowCalls[0]
	for _, sub := range []string{"INSERT INTO geofence_rates", "RETURNING id, created_at"} {
		if !strings.Contains(insertCall.sql, sub) {
			t.Errorf("insert SQL missing %q:\n%s", sub, insertCall.sql)
		}
	}
	if insertCall.args[0] != gr.GeofenceID || insertCall.args[1] != gr.RatePerWh || insertCall.args[2] != gr.Currency {
		t.Errorf("insert args mismatch: %v", insertCall.args)
	}
}

func TestCreateRate_BoundedIntervalDoesNotTruncateOpenRate(t *testing.T) {
	to := sampleRate().EffectiveFrom.Add(24 * time.Hour)
	tx := &fakeTx{
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(100), fixedTime}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	gr := sampleRate()
	gr.EffectiveTo = &to

	if err := newRepo(pool).CreateRate(context.Background(), gr); err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(tx.execCalls) != 0 {
		t.Fatalf("bounded rate must not truncate an open-ended rate, got %d UPDATE calls", len(tx.execCalls))
	}
	if tx.commitCalls != 1 {
		t.Fatalf("want 1 commit, got %d", tx.commitCalls)
	}
}

func TestCreateRate_ConflictMapped(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},
		queryRowQueue: []pgx.Row{fakeRow{scanErr: &pgconn.PgError{Code: "23P01", Message: "conflicting key value"}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}

	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, ErrRateConflict) {
		t.Fatalf("err=%v, want wrapped ErrRateConflict", err)
	}
}

func TestCreateRate_BeginError(t *testing.T) {
	pool := &fakePool{beginQueue: []beginResult{{err: errBoom}}}
	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, errBoom) {
		t.Fatalf("err=%v, want wrapped errBoom", err)
	}
}

func TestCreateRate_CloseOpenExecError(t *testing.T) {
	tx := &fakeTx{execQueue: []execResult{{err: errBoom}}}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "close-open") {
		t.Fatalf("err=%v, want wrapped close-open errBoom", err)
	}
}

func TestCreateRate_ExactSessionBackfillErrorRollsBack(t *testing.T) {
	tx := &fakeTx{
		execQueue: []execResult{
			{tag: tag(0)},
			{err: errBoom},
		},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(1), fixedTime}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "apply exact sessions") {
		t.Fatalf("err=%v, want wrapped exact-session errBoom", err)
	}
	if tx.commitCalls != 0 {
		t.Fatalf("failed backfill must not commit, got %d commits", tx.commitCalls)
	}
}

func TestCreateRate_CurrentEstimateBackfillErrorRollsBack(t *testing.T) {
	tx := &fakeTx{
		execQueue: []execResult{
			{tag: tag(0)},
			{tag: tag(1)},
			{err: errBoom},
		},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(1), fixedTime}}},
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "apply current estimate") {
		t.Fatalf("err=%v, want wrapped current-estimate errBoom", err)
	}
	if tx.commitCalls != 0 {
		t.Fatalf("failed backfill must not commit, got %d commits", tx.commitCalls)
	}
}

func TestCreateRate_CommitError(t *testing.T) {
	tx := &fakeTx{
		execQueue:     []execResult{{tag: tag(0)}},
		queryRowQueue: []pgx.Row{fakeRow{vals: []any{int64(1), fixedTime}}},
		commitErr:     errBoom,
	}
	pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
	err := newRepo(pool).CreateRate(context.Background(), sampleRate())
	if !errors.Is(err, errBoom) || !strings.Contains(err.Error(), "commit") {
		t.Fatalf("err=%v, want wrapped commit errBoom", err)
	}
}

// ---------------------------------------------------------------------------
// ListRates
// ---------------------------------------------------------------------------

func TestListRates(t *testing.T) {
	r1 := &systemmodel.GeofenceRate{ID: 2, GeofenceID: 1, RatePerWh: 0.00012, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}
	r2 := &systemmodel.GeofenceRate{ID: 1, GeofenceID: 1, RatePerWh: 0.0001, Currency: "USD", EffectiveFrom: fixedTime.Add(-24 * time.Hour), CreatedAt: fixedTime}

	t.Run("returns rows newest first as scripted", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows([][]any{geofenceRateRowVals(r1), geofenceRateRowVals(r2)})}}}
		got, err := newRepo(pool).ListRates(context.Background(), 1)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 2 || got[0].ID != 2 || got[1].ID != 1 {
			t.Fatalf("unexpected rates: %+v", got)
		}
		call := pool.queryCalls[0]
		if !strings.Contains(call.sql, "WHERE geofence_id=$1") || !strings.Contains(call.sql, "ORDER BY effective_from DESC") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if len(call.args) != 1 || call.args[0] != int64(1) {
			t.Errorf("args: want [1], got %v", call.args)
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).ListRates(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRateRowVals(r1)})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).ListRates(context.Background(), 1)
		if err == nil || !strings.Contains(err.Error(), "list scan") {
			t.Fatalf("err=%v, want list scan error", err)
		}
	})

	t.Run("iteration error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRateRowVals(r1)})
		rows.iterErr = errBoom
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).ListRates(context.Background(), 1)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// GetRateByID
// ---------------------------------------------------------------------------

func TestGetRateByID(t *testing.T) {
	want := &systemmodel.GeofenceRate{ID: 5, GeofenceID: 1, RatePerWh: 0.00012, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}

	t.Run("found", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRateRowVals(want)}}}
		got, err := newRepo(pool).GetRateByID(context.Background(), 1, 5)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got == nil || got.ID != 5 {
			t.Fatalf("got=%+v, want id=5", got)
		}
		call := pool.queryRowCalls[0]
		if !strings.Contains(call.sql, "WHERE id=$1 AND geofence_id=$2") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0] != int64(5) || call.args[1] != int64(1) {
			t.Errorf("args: want [5 1], got %v", call.args)
		}
	})

	t.Run("no rows returns nil,nil", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{noRow()}}
		got, err := newRepo(pool).GetRateByID(context.Background(), 1, 999)
		if err != nil || got != nil {
			t.Fatalf("got=%v err=%v, want nil,nil", got, err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		_, err := newRepo(pool).GetRateByID(context.Background(), 1, 5)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// GetActiveRateAt — exact cutoff-boundary keying (must query by the given
// instant, never "now()", so a session's own started_at always resolves the
// rate that was active when IT started).
// ---------------------------------------------------------------------------

func TestGetActiveRateAt(t *testing.T) {
	at := time.Date(2026, 8, 27, 0, 0, 0, 0, time.UTC)
	want := &systemmodel.GeofenceRate{ID: 2, GeofenceID: 1, RatePerWh: 0.00012, Currency: "USD", EffectiveFrom: at, CreatedAt: fixedTime}

	t.Run("queries by the supplied instant, not now()", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{vals: geofenceRateRowVals(want)}}}
		got, err := newRepo(pool).GetActiveRateAt(context.Background(), 1, at)
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if got == nil || got.ID != 2 {
			t.Fatalf("got=%+v, want id=2", got)
		}
		call := pool.queryRowCalls[0]
		if strings.Contains(strings.ToLower(call.sql), "now()") {
			t.Errorf("GetActiveRateAt must key off the passed instant, not now(): %s", call.sql)
		}
		for _, sub := range []string{"effective_from <= $2", "effective_to IS NULL OR effective_to > $2", "ORDER BY effective_from DESC", "LIMIT 1"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
		if call.args[0] != int64(1) || call.args[1] != at {
			t.Errorf("args: want [1 %v], got %v", at, call.args)
		}
	})

	t.Run("no matching interval returns nil,nil", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{noRow()}}
		got, err := newRepo(pool).GetActiveRateAt(context.Background(), 1, at)
		if err != nil || got != nil {
			t.Fatalf("got=%v err=%v, want nil,nil", got, err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		pool := &fakePool{queryRowQueue: []pgx.Row{fakeRow{scanErr: errBoom}}}
		_, err := newRepo(pool).GetActiveRateAt(context.Background(), 1, at)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// ListActiveRatesNow
// ---------------------------------------------------------------------------

func TestListActiveRatesNow(t *testing.T) {
	r1 := &systemmodel.GeofenceRate{ID: 1, GeofenceID: 1, RatePerWh: 0.0001, Currency: "USD", EffectiveFrom: fixedTime, CreatedAt: fixedTime}

	t.Run("queries the now()-open interval across all geofences", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{rows: newFakeRows([][]any{geofenceRateRowVals(r1)})}}}
		got, err := newRepo(pool).ListActiveRatesNow(context.Background())
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(got) != 1 || got[0].ID != 1 {
			t.Fatalf("unexpected rates: %+v", got)
		}
		call := pool.queryCalls[0]
		for _, sub := range []string{"effective_from <= now()", "effective_to IS NULL OR effective_to > now()", "ORDER BY geofence_id"} {
			if !strings.Contains(call.sql, sub) {
				t.Errorf("SQL missing %q:\n%s", sub, call.sql)
			}
		}
		if len(call.args) != 0 {
			t.Errorf("ListActiveRatesNow should take no args, got %v", call.args)
		}
	})

	t.Run("query error wrapped", func(t *testing.T) {
		pool := &fakePool{queryQueue: []queryResult{{err: errBoom}}}
		_, err := newRepo(pool).ListActiveRatesNow(context.Background())
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})

	t.Run("scan error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRateRowVals(r1)})
		rows.scanErrAt = 0
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).ListActiveRatesNow(context.Background())
		if err == nil || !strings.Contains(err.Error(), "list_active_now scan") {
			t.Fatalf("err=%v, want list_active_now scan error", err)
		}
	})

	t.Run("iteration error wrapped", func(t *testing.T) {
		rows := newFakeRows([][]any{geofenceRateRowVals(r1)})
		rows.iterErr = errBoom
		pool := &fakePool{queryQueue: []queryResult{{rows: rows}}}
		_, err := newRepo(pool).ListActiveRatesNow(context.Background())
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}

// ---------------------------------------------------------------------------
// DeleteRate
// ---------------------------------------------------------------------------

func TestDeleteRate(t *testing.T) {
	future := time.Now().UTC().Add(24 * time.Hour)
	futureRateRow := func(id int64) []any {
		return []any{id, int64(1), 0.0001005, "USD", future, (*time.Time)(nil), fixedTime, true}
	}

	t.Run("cancels unused future schedule", func(t *testing.T) {
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{
				fakeRow{vals: futureRateRow(5)},
				fakeRow{vals: []any{false}},
			},
			execQueue: []execResult{{tag: tag(1)}, {tag: tag(1)}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		if err := newRepo(pool).DeleteRate(context.Background(), 1, 5); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		call := tx.execCalls[0]
		if !strings.Contains(call.sql, "DELETE FROM geofence_rates") {
			t.Errorf("unexpected SQL: %s", call.sql)
		}
		if call.args[0] != int64(5) || call.args[1] != int64(1) {
			t.Errorf("args: want [5 1], got %v", call.args)
		}
		if tx.commitCalls != 1 {
			t.Fatalf("want 1 commit, got %d", tx.commitCalls)
		}
	})

	t.Run("missing rate returns ErrRateNotFound", func(t *testing.T) {
		tx := &fakeTx{queryRowQueue: []pgx.Row{noRow()}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		err := newRepo(pool).DeleteRate(context.Background(), 1, 999)
		if !errors.Is(err, ErrRateNotFound) {
			t.Fatalf("err=%v, want ErrRateNotFound", err)
		}
	})

	t.Run("effective rate is immutable", func(t *testing.T) {
		effective := time.Now().UTC().Add(-time.Hour)
		row := futureRateRow(5)
		row[4] = effective
		row[7] = false
		tx := &fakeTx{queryRowQueue: []pgx.Row{fakeRow{vals: row}}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		err := newRepo(pool).DeleteRate(context.Background(), 1, 5)
		if !errors.Is(err, ErrRateImmutable) {
			t.Fatalf("err=%v, want ErrRateImmutable", err)
		}
	})

	t.Run("referenced future rate cannot be cancelled", func(t *testing.T) {
		tx := &fakeTx{queryRowQueue: []pgx.Row{
			fakeRow{vals: futureRateRow(5)},
			fakeRow{vals: []any{true}},
		}}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		err := newRepo(pool).DeleteRate(context.Background(), 1, 5)
		if !errors.Is(err, ErrRateInUse) {
			t.Fatalf("err=%v, want ErrRateInUse", err)
		}
	})

	t.Run("restores adjacent predecessor before deleting schedule", func(t *testing.T) {
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{
				fakeRow{vals: futureRateRow(5)},
				fakeRow{vals: []any{false}},
			},
			execQueue: []execResult{{tag: tag(1)}, {tag: tag(1)}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		if err := newRepo(pool).DeleteRate(context.Background(), 1, 5); err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
		if len(tx.execCalls) != 2 || !strings.Contains(tx.execCalls[1].sql, "UPDATE geofence_rates") {
			t.Fatalf("expected DELETE then predecessor UPDATE, got %+v", tx.execCalls)
		}
		if tx.execCalls[1].args[2] != (*time.Time)(nil) {
			t.Errorf("open schedule cancellation must restore predecessor to open-ended")
		}
	})

	t.Run("delete error is wrapped", func(t *testing.T) {
		tx := &fakeTx{
			queryRowQueue: []pgx.Row{fakeRow{vals: futureRateRow(5)}, fakeRow{vals: []any{false}}},
			execQueue:     []execResult{{err: errBoom}},
		}
		pool := &fakePool{beginQueue: []beginResult{{tx: tx}}}
		err := newRepo(pool).DeleteRate(context.Background(), 1, 5)
		if !errors.Is(err, errBoom) {
			t.Fatalf("err=%v, want wrapped errBoom", err)
		}
	})
}
