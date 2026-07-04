package observability

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FSM transitions are the audit trail behind the vehicle-state debug
// view. These tests drive Insert/Query entirely through the recording
// fakeDBTX so the argument marshalling, default handling, dynamic
// placeholder numbering, and error wrapping are pinned without a live
// signal_log/fsm_transitions table.

func TestNewFSMTransitionRepo(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		db      *database.DB
		wantSet bool
	}{
		{"nil_db", nil, false},
		{"db_nil_pool", &database.DB{}, false},
		{"db_with_pool", &database.DB{Pool: &pgxpool.Pool{}}, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			r := NewFSMTransitionRepo(tt.db)
			if r == nil {
				t.Fatal("constructor returned nil repo")
			}
			if got := r.exec != nil; got != tt.wantSet {
				t.Errorf("exec set = %v, want %v", got, tt.wantSet)
			}
		})
	}
}

func TestFSMTransitionRepo_Insert_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *FSMTransitionRepo
	if err := nilRepo.Insert(ctx, 1, time.Now(), "vehicle", "a", "b", "t", nil); !errors.Is(err, ErrFSMTransitionRepoUnconfigured) {
		t.Errorf("nil repo: want ErrFSMTransitionRepoUnconfigured, got %v", err)
	}
	unconfigured := &FSMTransitionRepo{}
	if err := unconfigured.Insert(ctx, 1, time.Now(), "vehicle", "a", "b", "t", nil); !errors.Is(err, ErrFSMTransitionRepoUnconfigured) {
		t.Errorf("nil exec: want ErrFSMTransitionRepoUnconfigured, got %v", err)
	}
}

func TestFSMTransitionRepo_Insert_ArgsAndDefaults(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		fsmName     string
		ts          time.Time
		details     map[string]interface{}
		wantFSM     string
		wantZeroTS  bool // ts arg should be a fresh (non-zero) timestamp
		wantDetails bool // details arg should be non-nil JSON
	}{
		{"empty_fsm_defaults_to_vehicle", "", ts, nil, "vehicle", false, false},
		{"explicit_fsm_preserved", "drive", ts, nil, "drive", false, false},
		{"zero_ts_defaults_to_now", "charge", time.Time{}, nil, "charge", true, false},
		{"details_marshalled", "vehicle", ts, map[string]interface{}{"reason": "timeout"}, "vehicle", false, true},
		{"empty_details_omitted", "vehicle", ts, map[string]interface{}{}, "vehicle", false, false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			r := &FSMTransitionRepo{exec: f}
			if err := r.Insert(context.Background(), 42, tt.ts, tt.fsmName, "parked", "driving", "speed>0", tt.details); err != nil {
				t.Fatalf("Insert: %v", err)
			}
			if len(f.execCalls) != 1 {
				t.Fatalf("execCalls = %d, want 1", len(f.execCalls))
			}
			call := f.lastExec()
			if !strings.Contains(call.SQL, "INSERT INTO fsm_transitions") {
				t.Errorf("SQL missing INSERT: %s", call.SQL)
			}
			if !strings.Contains(call.SQL, "NULLIF($4, '')") || !strings.Contains(call.SQL, "NULLIF($6, '')") {
				t.Errorf("SQL missing NULLIF guards: %s", call.SQL)
			}
			if len(call.Args) != 7 {
				t.Fatalf("args = %d, want 7", len(call.Args))
			}
			if got := call.Args[0].(int64); got != 42 {
				t.Errorf("vehicleID arg = %d, want 42", got)
			}
			if got := call.Args[2].(string); got != tt.wantFSM {
				t.Errorf("fsmName arg = %q, want %q", got, tt.wantFSM)
			}
			gotTS := call.Args[1].(time.Time)
			if tt.wantZeroTS && gotTS.IsZero() {
				t.Error("zero ts should have been defaulted to a fresh timestamp")
			}
			if !tt.wantZeroTS && !gotTS.Equal(tt.ts) {
				t.Errorf("ts arg = %v, want %v", gotTS, tt.ts)
			}
			detailsArg, _ := call.Args[6].([]byte)
			if tt.wantDetails {
				if len(detailsArg) == 0 {
					t.Error("expected non-empty details JSON arg")
				} else if !json.Valid(detailsArg) {
					t.Errorf("details arg not valid JSON: %s", detailsArg)
				}
			} else if len(detailsArg) != 0 {
				t.Errorf("expected nil details arg, got %s", detailsArg)
			}
		})
	}
}

func TestFSMTransitionRepo_Insert_MarshalError(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := &FSMTransitionRepo{exec: f}
	// A channel value cannot be JSON-marshalled → the marshal branch errors.
	details := map[string]interface{}{"bad": make(chan int)}
	err := r.Insert(context.Background(), 1, time.Now(), "vehicle", "a", "b", "t", details)
	if err == nil || !strings.Contains(err.Error(), "marshal details") {
		t.Fatalf("want marshal error, got %v", err)
	}
	if len(f.execCalls) != 0 {
		t.Errorf("no Exec should run when marshalling fails, got %d", len(f.execCalls))
	}
}

func TestFSMTransitionRepo_Insert_ExecError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("db down")
	f := (&fakeDBTX{}).pushExec(pgTag(""), sentinel)
	r := &FSMTransitionRepo{exec: f}
	err := r.Insert(context.Background(), 1, time.Now(), "vehicle", "a", "b", "t", nil)
	if err == nil || !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "insert") {
		t.Fatalf("want wrapped exec error, got %v", err)
	}
}

func TestFSMTransitionRepo_Query_Guards(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	var nilRepo *FSMTransitionRepo
	if _, _, err := nilRepo.Query(ctx, 1, "", time.Now(), time.Now(), 10, 0); !errors.Is(err, ErrFSMTransitionRepoUnconfigured) {
		t.Errorf("nil repo: want unconfigured, got %v", err)
	}
	if _, _, err := (&FSMTransitionRepo{}).Query(ctx, 1, "", time.Now(), time.Now(), 10, 0); !errors.Is(err, ErrFSMTransitionRepoUnconfigured) {
		t.Errorf("nil exec: want unconfigured, got %v", err)
	}
}

func TestFSMTransitionRepo_Query_ClampAndOffset(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		limit      int
		offset     int
		wantLimit  int
		wantOffset int
	}{
		{"negative_limit", -1, 5, 50, 5},
		{"zero_limit", 0, 0, 50, 0},
		{"over_max_limit", 500, 0, 100, 0},
		{"in_range_limit", 25, 10, 25, 10},
		{"negative_offset", 10, -7, 10, 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushRow(rowWith(int64(0))).pushQuery(rowsFrom(), nil)
			r := &FSMTransitionRepo{exec: f}
			if _, _, err := r.Query(context.Background(), 1, "", time.Now(), time.Now(), tt.limit, tt.offset); err != nil {
				t.Fatalf("Query: %v", err)
			}
			args := f.lastQuery().Args
			if len(args) != 5 {
				t.Fatalf("fetch args = %d, want 5", len(args))
			}
			if got := args[3].(int); got != tt.wantLimit {
				t.Errorf("limit arg = %d, want %d", got, tt.wantLimit)
			}
			if got := args[4].(int); got != tt.wantOffset {
				t.Errorf("offset arg = %d, want %d", got, tt.wantOffset)
			}
		})
	}
}

func TestFSMTransitionRepo_Query_NameFilterPlaceholders(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name          string
		fsmName       string
		wantFilterSQL bool
		wantArgLen    int
	}{
		{"empty_no_filter", "", false, 5},
		{"all_no_filter", "all", false, 5},
		{"specific_filter", "drive", true, 6},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := (&fakeDBTX{}).pushRow(rowWith(int64(0))).pushQuery(rowsFrom(), nil)
			r := &FSMTransitionRepo{exec: f}
			if _, _, err := r.Query(context.Background(), 7, tt.fsmName, time.Now(), time.Now(), 10, 0); err != nil {
				t.Fatalf("Query: %v", err)
			}
			countSQL := f.lastRow().SQL
			fetchSQL := f.lastQuery().SQL
			hasFilter := strings.Contains(countSQL, "AND fsm_name = $4")
			if hasFilter != tt.wantFilterSQL {
				t.Errorf("count filter present = %v, want %v (%s)", hasFilter, tt.wantFilterSQL, countSQL)
			}
			if got := len(f.lastQuery().Args); got != tt.wantArgLen {
				t.Errorf("fetch args = %d, want %d", got, tt.wantArgLen)
			}
			if tt.wantFilterSQL {
				if !strings.Contains(fetchSQL, "LIMIT $5") || !strings.Contains(fetchSQL, "OFFSET $6") {
					t.Errorf("filtered fetch should place LIMIT $5 OFFSET $6: %s", fetchSQL)
				}
				if f.lastQuery().Args[3].(string) != "drive" {
					t.Errorf("name arg = %v, want drive", f.lastQuery().Args[3])
				}
			} else if !strings.Contains(fetchSQL, "LIMIT $4") || !strings.Contains(fetchSQL, "OFFSET $5") {
				t.Errorf("unfiltered fetch should place LIMIT $4 OFFSET $5: %s", fetchSQL)
			}
		})
	}
}

func TestFSMTransitionRepo_Query_CountError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("count boom")
	f := (&fakeDBTX{}).pushRow(rowErr(sentinel))
	r := &FSMTransitionRepo{exec: f}
	_, _, err := r.Query(context.Background(), 1, "", time.Now(), time.Now(), 10, 0)
	if err == nil || !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "count") {
		t.Fatalf("want wrapped count error, got %v", err)
	}
}

func TestFSMTransitionRepo_Query_FetchError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("fetch boom")
	f := (&fakeDBTX{}).pushRow(rowWith(int64(3))).pushQuery(nil, sentinel)
	r := &FSMTransitionRepo{exec: f}
	_, _, err := r.Query(context.Background(), 1, "", time.Now(), time.Now(), 10, 0)
	if err == nil || !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "query") {
		t.Fatalf("want wrapped fetch error, got %v", err)
	}
}

func TestFSMTransitionRepo_Query_Happy(t *testing.T) {
	t.Parallel()
	ts1 := time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)
	ts2 := ts1.Add(-time.Hour)
	f := (&fakeDBTX{}).
		pushRow(rowWith(int64(2))).
		pushQuery(rowsFrom(
			scanRow(int64(1), int64(42), ts1, "drive", "parked", "driving", "speed>0", []byte(`{"k":"v"}`)),
			scanRow(int64(2), int64(42), ts2, "charge", "", "charging", "", []byte(nil)),
		), nil)
	r := &FSMTransitionRepo{exec: f}
	recs, total, err := r.Query(context.Background(), 42, "", time.Now(), time.Now(), 10, 0)
	if err != nil {
		t.Fatalf("Query: %v", err)
	}
	if total != 2 {
		t.Errorf("total = %d, want 2", total)
	}
	if len(recs) != 2 {
		t.Fatalf("records = %d, want 2", len(recs))
	}
	if recs[0].FSMName != "drive" || recs[0].FromState != "parked" || recs[0].ToState != "driving" {
		t.Errorf("record0 fields wrong: %+v", recs[0])
	}
	if recs[0].Details["k"] != "v" {
		t.Errorf("record0 details = %v, want k=v", recs[0].Details)
	}
	if recs[1].Details != nil {
		t.Errorf("record1 details should be nil for empty raw, got %v", recs[1].Details)
	}
}

func TestFSMTransitionRepo_Query_ScanError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).
		pushRow(rowWith(int64(1))).
		pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
	r := &FSMTransitionRepo{exec: f}
	_, _, err := r.Query(context.Background(), 42, "", time.Now(), time.Now(), 10, 0)
	if err == nil || !strings.Contains(err.Error(), "scan") {
		t.Fatalf("want wrapped scan error, got %v", err)
	}
}

func TestFSMTransitionRepo_Query_RowsErr(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("iteration boom")
	f := (&fakeDBTX{}).
		pushRow(rowWith(int64(0))).
		pushQuery(rowsErr(sentinel), nil)
	r := &FSMTransitionRepo{exec: f}
	_, _, err := r.Query(context.Background(), 42, "", time.Now(), time.Now(), 10, 0)
	if err == nil || !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "rows") {
		t.Fatalf("want wrapped rows error, got %v", err)
	}
}
