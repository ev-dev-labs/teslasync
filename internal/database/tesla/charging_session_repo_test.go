package tesla

import (
	"context"
	"strings"
	"testing"

	teslamodel "github.com/ev-dev-labs/teslasync/internal/models/tesla"

	"github.com/jackc/pgx/v5"
)

// chargingSessionRow renders a session into the column-ordered []any that the
// GetAll / GetBySessionID SELECT projection scans.
func chargingSessionRow(s *teslamodel.TeslaChargingSession) []any {
	return []any{
		s.ID, s.SessionID, s.VIN, s.ChargerID, s.SiteLocationName,
		s.ChargeStartDatetime, s.ChargeStopDatetime,
		s.EnergyAddedKWh, s.PeakPowerKW, s.MaxChargeRateKW, s.ChargeDurationS,
		s.ChargerType, s.CurrencyCode, s.TotalCost, s.PerKWhRate, s.IdleFee, s.CongestionFee,
		s.Latitude, s.Longitude,
		s.FetchedAt, s.CreatedAt,
	}
}

func sampleSession() *teslamodel.TeslaChargingSession {
	return &teslamodel.TeslaChargingSession{
		ID:                  1,
		SessionID:           88001,
		VIN:                 "5YJ3E1EA7KF000002",
		ChargerID:           strp("SC-42"),
		SiteLocationName:    "Harris Ranch",
		ChargeStartDatetime: fixedTime,
		ChargeStopDatetime:  timePtr(fixedTime.Add(45 * 60 * 1e9)),
		EnergyAddedKWh:      f64p(52.4),
		PeakPowerKW:         f64p(210),
		MaxChargeRateKW:     f64p(250),
		ChargeDurationS:     intp(2700),
		ChargerType:         strp("v3"),
		CurrencyCode:        strp("USD"),
		TotalCost:           f64p(14.67),
		PerKWhRate:          f64p(0.28),
		IdleFee:             f64p(0),
		CongestionFee:       f64p(0),
		Latitude:            f64p(36.25),
		Longitude:           f64p(-120.24),
		FetchedAt:           fixedTime,
		CreatedAt:           fixedTime,
	}
}

func TestChargingSessionRepo_GetAll(t *testing.T) {
	t.Parallel()
	s1 := sampleSession()
	s2 := sampleSession()
	s2.ID = 2
	s2.SessionID = 88002

	tests := []struct {
		name     string
		vin      string
		script   queryResult
		wantLen  int
		wantArgs []any
		errFrag  string
	}{
		{name: "success no vin", vin: "", script: queryResult{rows: newFakeRows([][]any{chargingSessionRow(s1), chargingSessionRow(s2)})}, wantLen: 2, wantArgs: []any{10, 0}},
		{name: "success with vin", vin: "5YJ3E1EA7KF000002", script: queryResult{rows: newFakeRows([][]any{chargingSessionRow(s1)})}, wantLen: 1, wantArgs: []any{"5YJ3E1EA7KF000002", 10, 0}},
		{name: "empty", vin: "", script: queryResult{rows: newFakeRows(nil)}, wantLen: 0, wantArgs: []any{10, 0}},
		{name: "query error wrapped", vin: "", script: queryResult{err: errBoom}, errFrag: "query tesla charging sessions"},
		{name: "scan error wrapped", vin: "", script: queryResult{rows: &fakeRows{data: [][]any{chargingSessionRow(s1)}, cursor: -1, scanErrAt: 0}}, errFrag: "scan tesla charging session"},
		{name: "iter error surfaced", vin: "", script: queryResult{rows: &fakeRows{data: nil, cursor: -1, scanErrAt: -1, iterErr: errBoom}}, errFrag: "boom"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryQueue: []queryResult{tt.script}}
			repo := &TeslaChargingSessionRepo{pool: pool}
			got, err := repo.GetAll(context.Background(), tt.vin, 10, 0)
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
			if tt.vin != "" && !strings.Contains(call.sql, "WHERE vin = $1") {
				t.Errorf("expected WHERE vin filter: %s", call.sql)
			}
			assertArgsEqual(t, call.args, tt.wantArgs)
			if tt.wantLen == 2 {
				if got[0].ChargeDurationS == nil || *got[0].ChargeDurationS != 2700 {
					t.Errorf("nullable *int ChargeDurationS not scanned: %+v", got[0].ChargeDurationS)
				}
				if got[1].SessionID != 88002 {
					t.Errorf("second row SessionID=%d, want 88002", got[1].SessionID)
				}
			}
		})
	}
}

func TestChargingSessionRepo_GetBySessionID(t *testing.T) {
	t.Parallel()
	s := sampleSession()

	tests := []struct {
		name    string
		row     pgx.Row
		wantNil bool
		errFrag string
	}{
		{name: "found", row: fakeRow{vals: chargingSessionRow(s)}},
		{name: "not found maps to nil,nil", row: noRow(), wantNil: true},
		{name: "scan error wrapped", row: fakeRow{scanErr: errBoom}, errFrag: "get tesla charging session by session_id"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaChargingSessionRepo{pool: pool}
			got, err := repo.GetBySessionID(context.Background(), 88001)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			assertArgsEqual(t, pool.queryRowCalls[0].args, []any{int64(88001)})
			if tt.wantNil {
				if got != nil {
					t.Fatalf("want nil, got %+v", got)
				}
				return
			}
			if got == nil || got.SessionID != 88001 || got.PeakPowerKW == nil || *got.PeakPowerKW != 210 {
				t.Fatalf("unexpected row: %+v", got)
			}
		})
	}
}

func TestChargingSessionRepo_GetSummary(t *testing.T) {
	t.Parallel()
	full := []any{4, f64p(210400), f64p(58.68), f64p(0.279), f64p(250)}
	empty := []any{0, nil, nil, nil, nil}

	tests := []struct {
		name     string
		vin      string
		row      pgx.Row
		wantArgs []any
		wantSess int
		wantPeak *float64
		errFrag  string
	}{
		{name: "success no vin", vin: "", row: fakeRow{vals: full}, wantArgs: nil, wantSess: 4, wantPeak: f64p(250)},
		{name: "success with vin", vin: "5YJ", row: fakeRow{vals: full}, wantArgs: []any{"5YJ"}, wantSess: 4, wantPeak: f64p(250)},
		{name: "zero-row nullable aggregates", vin: "", row: fakeRow{vals: empty}, wantArgs: nil, wantSess: 0, wantPeak: nil},
		{name: "scan error wrapped", vin: "", row: fakeRow{scanErr: errBoom}, errFrag: "get tesla charging session summary"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			pool := &fakePool{queryRowQueue: []pgx.Row{tt.row}}
			repo := &TeslaChargingSessionRepo{pool: pool}
			got, err := repo.GetSummary(context.Background(), tt.vin)
			if tt.errFrag != "" {
				requireErr(t, err, tt.errFrag)
				return
			}
			if err != nil {
				t.Fatalf("unexpected err: %v", err)
			}
			call := pool.queryRowCalls[0]
			if !strings.Contains(call.sql, "MAX(peak_power_kw)") {
				t.Errorf("summary SQL missing MAX(peak_power_kw): %s", call.sql)
			}
			if tt.vin != "" && !strings.Contains(call.sql, "WHERE vin = $1") {
				t.Errorf("expected WHERE vin filter: %s", call.sql)
			}
			assertArgsEqual(t, call.args, tt.wantArgs)
			if got.TotalSessions != tt.wantSess {
				t.Errorf("TotalSessions=%d, want %d", got.TotalSessions, tt.wantSess)
			}
			switch {
			case tt.wantPeak == nil && got.PeakPowerKW != nil:
				t.Errorf("PeakPowerKW=%v, want nil", *got.PeakPowerKW)
			case tt.wantPeak != nil && (got.PeakPowerKW == nil || *got.PeakPowerKW != *tt.wantPeak):
				t.Errorf("PeakPowerKW=%v, want %v", got.PeakPowerKW, *tt.wantPeak)
			}
		})
	}
}

func TestChargingSessionRepo_UpsertBatch(t *testing.T) {
	t.Parallel()

	t.Run("empty short-circuits without Exec", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		repo := &TeslaChargingSessionRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), nil)
		if err != nil || n != 0 {
			t.Fatalf("want (0,nil), got (%d,%v)", n, err)
		}
		if len(pool.execCalls) != 0 {
			t.Fatalf("empty batch must not Exec, got %d", len(pool.execCalls))
		}
	})

	t.Run("success upserts every session", func(t *testing.T) {
		t.Parallel()
		s1 := sampleSession()
		s2 := sampleSession()
		s2.SessionID = 88002
		pool := &fakePool{execQueue: []execResult{{}, {}}}
		repo := &TeslaChargingSessionRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingSession{s1, s2})
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
		if args[0] != int64(88001) || args[1] != s1.VIN {
			t.Errorf("first-session args wrong: %#v", args[:2])
		}
		if !strings.Contains(pool.execCalls[1].sql, "ON CONFLICT (session_id) DO UPDATE") {
			t.Errorf("expected upsert conflict clause: %s", pool.execCalls[1].sql)
		}
	})

	t.Run("exec error returns partial count and wraps session id", func(t *testing.T) {
		t.Parallel()
		s1 := sampleSession()
		s2 := sampleSession()
		s2.SessionID = 70707
		pool := &fakePool{execQueue: []execResult{{}, {err: errBoom}}}
		repo := &TeslaChargingSessionRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingSession{s1, s2})
		if n != 1 {
			t.Errorf("partial count=%d, want 1", n)
		}
		requireErr(t, err, "upsert tesla charging session 70707")
	})

	t.Run("nil session rejected before deref", func(t *testing.T) {
		t.Parallel()
		pool := &fakePool{}
		repo := &TeslaChargingSessionRepo{pool: pool}
		n, err := repo.UpsertBatch(context.Background(), []*teslamodel.TeslaChargingSession{nil})
		if n != 0 {
			t.Errorf("count=%d, want 0", n)
		}
		requireErr(t, err, "nil entry at index 0")
	})
}
