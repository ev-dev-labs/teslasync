package tesla

import (
	"context"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// chargingHistoryRow renders an entry into the column-ordered []any that the
// GetAll / GetBySessionID SELECT projection scans. Keeping it beside the tests
// means a column reorder needs one edit.
func chargingHistoryRow(e *teslamodel.TeslaChargingHistoryEntry) []any {
	return []any{
		e.ID, e.SessionID, e.VIN, e.SiteLocationName,
		e.ChargeStartDatetime, e.ChargeStopDatetime,
		e.Country, e.State, e.County, e.PostalCode,
		e.BillingType, e.FeeType, e.CurrencyCode, e.PricingType,
		e.RateBase, e.UsageWh, e.TotalDue,
		e.HasInvoice, e.InvoiceContentID,
		e.FetchedAt, e.CreatedAt,
	}
}

func sampleHistoryEntry() *teslamodel.TeslaChargingHistoryEntry {
	return &teslamodel.TeslaChargingHistoryEntry{
		ID:                  7,
		SessionID:           4242,
		VIN:                 "5YJ3E1EA7KF000001",
		SiteLocationName:    "Mountain View Supercharger",
		ChargeStartDatetime: fixedTime,
		ChargeStopDatetime:  timePtr(fixedTime.Add(30 * 60 * 1e9)),
		Country:             strp("US"),
		State:               strp("CA"),
		County:              strp("Santa Clara"),
		PostalCode:          strp("94043"),
		BillingType:         strp("immediate"),
		FeeType:             strp("charging"),
		CurrencyCode:        strp("USD"),
		PricingType:         strp("per_kwh"),
		RateBase:            f64p(0.28),
		UsageWh:             f64p(42000),
		TotalDue:            f64p(11.76),
		HasInvoice:          true,
		InvoiceContentID:    strp("inv-1"),
		FetchedAt:           fixedTime,
		CreatedAt:           fixedTime,
	}
}

func TestChargingHistoryRepo_GetAll(t *testing.T) {
	t.Parallel()
	e1 := sampleHistoryEntry()
	e2 := sampleHistoryEntry()
	e2.ID = 8
	e2.SessionID = 4243

	tests := []struct {
		name     string
		vin      string
		script   queryResult
		wantLen  int
		wantArgs []any
		errFrag  string
	}{
		{
			name:     "success no vin filter",
			vin:      "",
			script:   queryResult{rows: newFakeRows([][]any{chargingHistoryRow(e1), chargingHistoryRow(e2)})},
			wantLen:  2,
			wantArgs: []any{25, 50},
		},
		{
			name:     "success with vin filter",
			vin:      "5YJ3E1EA7KF000001",
			script:   queryResult{rows: newFakeRows([][]any{chargingHistoryRow(e1)})},
			wantLen:  1,
			wantArgs: []any{"5YJ3E1EA7KF000001", 25, 50},
		},
		{
			name:     "empty result",
			vin:      "",
			script:   queryResult{rows: newFakeRows(nil)},
			wantLen:  0,
			wantArgs: []any{25, 50},
		},
		{
			name:    "query error wrapped",
			vin:     "",
			script:  queryResult{err: errBoom},
			errFrag: "query tesla charging history",
		},
		{
			name:    "scan error wrapped",
			vin:     "",
			script:  queryResult{rows: &fakeRows{data: [][]any{chargingHistoryRow(e1)}, cursor: -1, scanErrAt: 0}},
			errFrag: "scan tesla charging history",
		},
		{
			name:    "iter error surfaced",
			vin:     "",
			script:  queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errBoom}},
			errFrag: "boom",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &TeslaChargingHistoryRepo{pool: pool}
			got, err := repo.GetAll(context.Background(), tt.vin, 25, 50)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			if len(got) != tt.wantLen {
				t.Fatalf("len=%d, want %d", len(got), tt.wantLen)
			}
			call := pool.queryCalls[0]
			if !strings.Contains(call.sql, "ORDER BY charge_start_datetime DESC") ||
				!strings.Contains(call.sql, "LIMIT $") || !strings.Contains(call.sql, "OFFSET $") {
				t.Errorf("SQL missing paging clause: %s", call.sql)
			}
			if tt.vin == "" && strings.Contains(call.sql, "WHERE vin") {
				t.Errorf("expected no WHERE for empty vin: %s", call.sql)
			}
			if tt.vin != "" && !strings.Contains(call.sql, "WHERE vin = $1") {
				t.Errorf("expected WHERE vin filter: %s", call.sql)
			}
			assertArgsEqual(t, call.args, tt.wantArgs)
			if tt.wantLen == 2 && (got[0].SessionID != 4242 || got[1].SessionID != 4243) {
				t.Errorf("scanned rows wrong: %+v %+v", got[0], got[1])
			}
		})
	}
}

func TestChargingHistoryRepo_GetBySessionID(t *testing.T) {
	t.Parallel()
	e := sampleHistoryEntry()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: chargingHistoryRow(e)}},
		{name: "not found maps to nil,nil", row: noRow(), wantNil: true},
		{name: "scan error wrapped", row: fakeRow{scanErr: errBoom}, errFrag: "get tesla charging history by session"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaChargingHistoryRepo{pool: pool}
			got, err := repo.GetBySessionID(context.Background(), 4242)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			assertArgsEqual(t, pool.queryRowCalls[0].args, []any{int64(4242)})
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.SessionID != 4242 || got.VIN != e.VIN {
				t.Fatalf("unexpected row: %+v", got)
			}
			if got.Country == nil || *got.Country != "US" {
				t.Errorf("nullable Country not scanned: %+v", got.Country)
			}
		})
	}
}

func TestChargingHistoryRepo_GetSummary(t *testing.T) {
	t.Parallel()
	sum := &teslamodel.TeslaChargingHistorySummary{
		TotalSessions: 3,
		TotalWh:       f64p(120000),
		TotalSpend:    f64p(33.5),
		AvgCostPerKWh: f64p(0.279),
	}
	summaryRow := func() []any { return []any{sum.TotalSessions, sum.TotalWh, sum.TotalSpend, sum.AvgCostPerKWh} }
	// Zero-row aggregate: COUNT(*) = 0, every SUM/AVG is NULL.
	emptyRow := func() []any { return []any{0, nil, nil, nil} }

	tests := []struct {
		name     string
		vin      string
		row      pgx.Row
		wantArgs []any
		wantSess int
		wantNull bool
		errFrag  string
	}{
		{name: "success no vin", vin: "", row: fakeRow{vals: summaryRow()}, wantArgs: nil, wantSess: 3},
		{name: "success with vin", vin: "5YJ", row: fakeRow{vals: summaryRow()}, wantArgs: []any{"5YJ"}, wantSess: 3},
		{name: "zero-row nullable aggregates", vin: "", row: fakeRow{vals: emptyRow()}, wantArgs: nil, wantSess: 0, wantNull: true},
		{name: "scan error wrapped", vin: "", row: fakeRow{scanErr: errBoom}, errFrag: "get tesla charging history summary"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaChargingHistoryRepo{pool: pool}
			got, err := repo.GetSummary(context.Background(), tt.vin)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			call := pool.queryRowCalls[0]
			if tt.vin == "" && strings.Contains(call.sql, "WHERE vin") {
				t.Errorf("expected no WHERE for empty vin: %s", call.sql)
			}
			if tt.vin != "" && !strings.Contains(call.sql, "WHERE vin = $1") {
				t.Errorf("expected WHERE vin filter: %s", call.sql)
			}
			assertArgsEqual(t, call.args, tt.wantArgs)
			if got.TotalSessions != tt.wantSess {
				t.Errorf("TotalSessions=%d, want %d", got.TotalSessions, tt.wantSess)
			}
			if tt.wantNull && (got.TotalWh != nil || got.TotalSpend != nil || got.AvgCostPerKWh != nil) {
				t.Errorf("expected nil aggregates, got %+v", got)
			}
		})
	}
}

func TestChargingHistoryRepo_UpsertBatch(t *testing.T) {
	t.Parallel()

	t.Run("empty short-circuits without Exec", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		repo := &TeslaChargingHistoryRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), nil)
		if err != nil || n != 0 {
			t.Fatalf("want (0,nil), got (%d,%v)", n, err)
		}
		if len(pool.execCalls) != 0 {
			t.Fatalf("empty batch must not Exec, got %d calls", len(pool.execCalls))
		}
	})

	t.Run("success upserts every entry and binds args", func(t *testing.T) {
		t.Parallel()
		e1 := sampleHistoryEntry()
		e2 := sampleHistoryEntry()
		e2.SessionID = 4243
		pool := &fakePool{execQueue: []execResult{{}, {}}}
		repo := &TeslaChargingHistoryRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingHistoryEntry{e1, e2})
		if err != nil {
			t.Fatalf("UpsertBatch: %v", err)
		}
		if n != 2 || len(pool.execCalls) != 2 {
			t.Fatalf("upserted=%d execCalls=%d, want 2/2", n, len(pool.execCalls))
		}
		args := pool.execCalls[0].args
		if len(args) != 19 {
			t.Fatalf("want 19 bound args, got %d", len(args))
		}
		if args[0] != int64(4242) || args[1] != e1.VIN {
			t.Errorf("first-entry args wrong: %#v", args[:2])
		}
		if _, ok := args[18].(interface{ IsZero() bool }); !ok {
			t.Errorf("last arg should be a time.Time, got %T", args[18])
		}
		if !strings.Contains(pool.execCalls[0].sql, "ON CONFLICT (session_id) DO UPDATE") {
			t.Errorf("expected upsert conflict clause: %s", pool.execCalls[0].sql)
		}
	})

	t.Run("exec error returns partial count and wraps session id", func(t *testing.T) {
		t.Parallel()
		e1 := sampleHistoryEntry()
		e2 := sampleHistoryEntry()
		e2.SessionID = 9999
		pool := &fakePool{execQueue: []execResult{{}, {err: errBoom}}}
		repo := &TeslaChargingHistoryRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingHistoryEntry{e1, e2})
		if n != 1 {
			t.Errorf("partial count=%d, want 1", n)
		}
		requireErr(t, err, "upsert tesla charging history session 9999")
	})

	t.Run("nil entry rejected before deref", func(t *testing.T) {
		t.Parallel()
		e1 := sampleHistoryEntry()
		pool := &fakePool{execQueue: []execResult{{}}}
		repo := &TeslaChargingHistoryRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingHistoryEntry{e1, nil})
		if n != 1 {
			t.Errorf("count=%d, want 1 before nil", n)
		}
		requireErr(t, err, "nil entry at index 1")
	})
}
