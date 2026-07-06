package audit

import (
	"context"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------- constructor ----------

func TestNewFeatureFlagChangesRepo_NilPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewFeatureFlagChangesRepo(nil) did not panic")
		}
	}()
	_ = NewFeatureFlagChangesRepo(nil)
}

func TestNewFeatureFlagChangesRepo_OK(t *testing.T) {
	t.Parallel()
	repo := NewFeatureFlagChangesRepo(&database.DB{Pool: &pgxpool.Pool{}})
	if repo == nil || repo.exec == nil {
		t.Fatal("expected a wired repo with a non-nil exec seam")
	}
}

// ---------- Insert validation ----------

func TestFFInsert_Validation(t *testing.T) {
	t.Parallel()
	valid := FeatureFlagChangeInsert{
		Actor: "alice", FlagKey: "beta.charts", Operation: FeatureFlagOpSet, NewValue: "true",
	}
	tests := []struct {
		name    string
		mutate  func(*FeatureFlagChangeInsert)
		wantSub string
	}{
		{"empty actor", func(in *FeatureFlagChangeInsert) { in.Actor = "" }, "actor must be non-empty"},
		{"empty flag_key", func(in *FeatureFlagChangeInsert) { in.FlagKey = "" }, "flag_key must be non-empty"},
		{"unknown operation", func(in *FeatureFlagChangeInsert) { in.Operation = "toggle" }, "unknown operation"},
		{
			"delete carrying new_value",
			func(in *FeatureFlagChangeInsert) { in.Operation = FeatureFlagOpDelete; in.NewValue = "x" },
			"delete operation must not carry new_value",
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			repo := &FeatureFlagChangesRepo{exec: f}
			in := valid
			tt.mutate(&in)
			id, err := repo.Insert(context.Background(), in)
			if err == nil || !strings.Contains(err.Error(), tt.wantSub) {
				t.Errorf("want error containing %q, got %v", tt.wantSub, err)
			}
			if id != 0 {
				t.Errorf("id on validation failure = %d, want 0", id)
			}
			if len(f.queryRowCalls) != 0 {
				t.Errorf("no QueryRow should run on validation failure, got %d", len(f.queryRowCalls))
			}
		})
	}
}

func TestFFInsert_NilGuards(t *testing.T) {
	t.Parallel()
	valid := FeatureFlagChangeInsert{Actor: "a", FlagKey: "k", Operation: FeatureFlagOpSet}
	var nilRepo *FeatureFlagChangesRepo
	if _, err := nilRepo.Insert(context.Background(), valid); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&FeatureFlagChangesRepo{}).Insert(context.Background(), valid); err == nil {
		t.Error("nil exec should error")
	}
}

// ---------- Insert happy paths ----------

func TestFFInsert_HappyPath_Set(t *testing.T) {
	t.Parallel()
	ip := netip.MustParseAddr("192.168.1.5")
	f := &fakeDBTX{row: &fakeRow{scan: scanRow(int64(7))}}
	repo := &FeatureFlagChangesRepo{exec: f}
	id, err := repo.Insert(context.Background(), FeatureFlagChangeInsert{
		Actor:     "alice",
		ActorIP:   &ip,
		FlagKey:   "beta.charts",
		Operation: FeatureFlagOpSet,
		OldValue:  "false",
		NewValue:  "true",
		Reason:    "rollout",
		TraceID:   "trace-9",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if id != 7 {
		t.Errorf("id = %d, want 7", id)
	}
	if len(f.queryRowCalls) != 1 {
		t.Fatalf("want 1 QueryRow, got %d", len(f.queryRowCalls))
	}
	c := f.queryRowCalls[0]
	for _, frag := range []string{
		"INSERT INTO feature_flag_changes",
		"(actor, actor_ip, flag_key, operation, old_value, new_value, reason, trace_id)",
		"VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
		"RETURNING id",
	} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
	if len(c.Args) != 8 {
		t.Fatalf("want 8 args, got %d: %v", len(c.Args), c.Args)
	}
	if c.Args[0] != "alice" || c.Args[1] != "192.168.1.5" || c.Args[2] != "beta.charts" {
		t.Errorf("args[0..2] = %v/%v/%v", c.Args[0], c.Args[1], c.Args[2])
	}
	if c.Args[3] != string(FeatureFlagOpSet) {
		t.Errorf("args[3] operation = %v, want set", c.Args[3])
	}
	if c.Args[4] != "false" || c.Args[5] != "true" {
		t.Errorf("args[4,5] old/new = %v/%v", c.Args[4], c.Args[5])
	}
	if c.Args[6] != "rollout" || c.Args[7] != "trace-9" {
		t.Errorf("args[6,7] reason/trace = %v/%v", c.Args[6], c.Args[7])
	}
}

func TestFFInsert_HappyPath_Delete(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{row: &fakeRow{scan: scanRow(int64(3))}}
	repo := &FeatureFlagChangesRepo{exec: f}
	// A delete captures the old value being removed but carries no new value.
	id, err := repo.Insert(context.Background(), FeatureFlagChangeInsert{
		Actor:     "bob",
		FlagKey:   "beta.charts",
		Operation: FeatureFlagOpDelete,
		OldValue:  "true",
	})
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if id != 3 {
		t.Errorf("id = %d, want 3", id)
	}
	c := f.queryRowCalls[0]
	if c.Args[3] != string(FeatureFlagOpDelete) {
		t.Errorf("args[3] operation = %v, want delete", c.Args[3])
	}
	if c.Args[4] != "true" {
		t.Errorf("args[4] old_value = %v, want true", c.Args[4])
	}
	if c.Args[5] != nil {
		t.Errorf("args[5] new_value = %v, want nil for delete", c.Args[5])
	}
}

func TestFFInsert_NullMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name                                            string
		in                                              FeatureFlagChangeInsert
		wantIP, wantOld, wantNew, wantReason, wantTrace any
	}{
		{
			name:   "all optional empty → NULL",
			in:     FeatureFlagChangeInsert{Actor: "a", FlagKey: "k", Operation: FeatureFlagOpSet},
			wantIP: nil, wantOld: nil, wantNew: nil, wantReason: nil, wantTrace: nil,
		},
		{
			name: "all set",
			in: FeatureFlagChangeInsert{
				Actor: "a", FlagKey: "k", Operation: FeatureFlagOpSet,
				OldValue: "0", NewValue: "1", Reason: "r", TraceID: "t",
			},
			wantIP: nil, wantOld: "0", wantNew: "1", wantReason: "r", wantTrace: "t",
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{row: &fakeRow{scan: scanRow(int64(1))}}
			repo := &FeatureFlagChangesRepo{exec: f}
			if _, err := repo.Insert(context.Background(), tt.in); err != nil {
				t.Fatal(err)
			}
			c := f.queryRowCalls[0]
			if c.Args[1] != tt.wantIP {
				t.Errorf("actor_ip = %v, want %v", c.Args[1], tt.wantIP)
			}
			if c.Args[4] != tt.wantOld {
				t.Errorf("old_value = %v, want %v", c.Args[4], tt.wantOld)
			}
			if c.Args[5] != tt.wantNew {
				t.Errorf("new_value = %v, want %v", c.Args[5], tt.wantNew)
			}
			if c.Args[6] != tt.wantReason {
				t.Errorf("reason = %v, want %v", c.Args[6], tt.wantReason)
			}
			if c.Args[7] != tt.wantTrace {
				t.Errorf("trace_id = %v, want %v", c.Args[7], tt.wantTrace)
			}
		})
	}
}

func TestFFInsert_QueryRowError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("insert failed")
	f := &fakeDBTX{row: &fakeRow{scan: func(dest ...any) error { return sentinel }}}
	repo := &FeatureFlagChangesRepo{exec: f}
	id, err := repo.Insert(context.Background(), FeatureFlagChangeInsert{
		Actor: "a", FlagKey: "k", Operation: FeatureFlagOpSet,
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("want wrapped sentinel, got %v", err)
	}
	if !strings.Contains(err.Error(), "FeatureFlagChangesRepo.Insert") {
		t.Errorf("error missing context: %v", err)
	}
	if id != 0 {
		t.Errorf("id on error = %d, want 0", id)
	}
}

// ---------- Recent ----------

func TestFFRecent_NilGuards(t *testing.T) {
	t.Parallel()
	var nilRepo *FeatureFlagChangesRepo
	if _, err := nilRepo.Recent(context.Background(), "", 10); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&FeatureFlagChangesRepo{}).Recent(context.Background(), "", 10); err == nil {
		t.Error("nil exec should error")
	}
}

func TestFFRecent_LimitClampAndFilter(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		flagKey   string
		limit     int
		wantLimit int
		wantWhere bool
	}{
		{"zero → 50", "", 0, 50, false},
		{"negative → 50", "", -1, 50, false},
		{"over max → 500", "", 999, 500, false},
		{"at max stays", "", 500, 500, false},
		{"in range stays", "", 25, 25, false},
		{"filtered by flag_key", "beta.charts", 10, 10, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			repo := &FeatureFlagChangesRepo{exec: f}
			if _, err := repo.Recent(context.Background(), tt.flagKey, tt.limit); err != nil {
				t.Fatal(err)
			}
			c := f.queryCalls[0]
			hasWhere := strings.Contains(c.SQL, "WHERE flag_key = $1")
			if hasWhere != tt.wantWhere {
				t.Errorf("WHERE flag_key present = %v, want %v\n%s", hasWhere, tt.wantWhere, c.SQL)
			}
			lastArg := c.Args[len(c.Args)-1]
			if lastArg != tt.wantLimit {
				t.Errorf("limit arg = %v, want %d", lastArg, tt.wantLimit)
			}
			if tt.wantWhere {
				if len(c.Args) != 2 || c.Args[0] != tt.flagKey {
					t.Errorf("filtered args = %v, want [%q, %d]", c.Args, tt.flagKey, tt.wantLimit)
				}
			} else if len(c.Args) != 1 {
				t.Errorf("global args = %v, want [limit] only", c.Args)
			}
		})
	}
}

func TestFFRecent_HappyPath(t *testing.T) {
	t.Parallel()
	changedAt := time.Date(2026, 7, 4, 9, 30, 0, 0, time.UTC)
	f := &fakeDBTX{queryRows: rowsFrom(
		scanRow(int64(2), changedAt, "alice", ptr("10.1.1.1"), "beta.charts", "set",
			ptr("false"), ptr("true"), ptr("rollout"), ptr("trace-a")),
		scanRow(int64(1), changedAt, "bob", (*string)(nil), "beta.charts", "delete",
			ptr("true"), (*string)(nil), (*string)(nil), (*string)(nil)),
	)}
	repo := &FeatureFlagChangesRepo{exec: f}
	got, err := repo.Recent(context.Background(), "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 records, got %d", len(got))
	}
	r0 := got[0]
	if r0.ID != 2 || r0.Actor != "alice" || r0.FlagKey != "beta.charts" {
		t.Errorf("row0 core fields wrong: %+v", r0)
	}
	if !r0.ChangedAt.Equal(changedAt) {
		t.Errorf("row0 changed_at = %v", r0.ChangedAt)
	}
	if r0.Operation != FeatureFlagOpSet {
		t.Errorf("row0 operation = %v, want set", r0.Operation)
	}
	if r0.ActorIP == nil || r0.ActorIP.String() != "10.1.1.1" {
		t.Errorf("row0 actor_ip = %v", r0.ActorIP)
	}
	if r0.OldValue == nil || *r0.OldValue != "false" || r0.NewValue == nil || *r0.NewValue != "true" {
		t.Errorf("row0 old/new = %v/%v", r0.OldValue, r0.NewValue)
	}
	if r0.Reason == nil || *r0.Reason != "rollout" || r0.TraceID == nil || *r0.TraceID != "trace-a" {
		t.Errorf("row0 reason/trace = %v/%v", r0.Reason, r0.TraceID)
	}
	r1 := got[1]
	if r1.Operation != FeatureFlagOpDelete {
		t.Errorf("row1 operation = %v, want delete", r1.Operation)
	}
	if r1.ActorIP != nil || r1.NewValue != nil || r1.Reason != nil || r1.TraceID != nil {
		t.Errorf("row1 nullable pointers should be nil: %+v", r1)
	}
	if r1.OldValue == nil || *r1.OldValue != "true" {
		t.Errorf("row1 old_value = %v, want true", r1.OldValue)
	}
}

func TestFFRecent_Empty(t *testing.T) {
	t.Parallel()
	repo := &FeatureFlagChangesRepo{exec: &fakeDBTX{}}
	got, err := repo.Recent(context.Background(), "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if got == nil {
		t.Error("want non-nil empty slice")
	}
	if len(got) != 0 {
		t.Errorf("want 0 records, got %d", len(got))
	}
}

func TestFFRecent_Errors(t *testing.T) {
	t.Parallel()
	t.Run("query error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("q fail")
		repo := &FeatureFlagChangesRepo{exec: &fakeDBTX{queryErr: sentinel}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: query") {
			t.Errorf("got %v", err)
		}
	})
	t.Run("scan error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan fail")
		repo := &FeatureFlagChangesRepo{exec: &fakeDBTX{queryRows: rowsFrom(func(dest ...any) error { return sentinel })}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: scan") {
			t.Errorf("got %v", err)
		}
	})
	t.Run("rows error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("iter fail")
		rows := rowsFrom(scanRow(int64(1), time.Now(), "a", (*string)(nil), "k", "set",
			(*string)(nil), (*string)(nil), (*string)(nil), (*string)(nil)))
		rows.err = sentinel
		repo := &FeatureFlagChangesRepo{exec: &fakeDBTX{queryRows: rows}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: rows") {
			t.Errorf("got %v", err)
		}
	})
}
