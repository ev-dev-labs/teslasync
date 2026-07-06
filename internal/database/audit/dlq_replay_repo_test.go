package audit

import (
	"context"
	"encoding/json"
	"errors"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ---------- knownDLQReplayResult ----------

func TestKnownDLQReplayResult(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   DLQReplayResult
		want bool
	}{
		{DLQReplayResultOK, true},
		{DLQReplayResultPublishFailed, true},
		{DLQReplayResultRateLimited, true},
		{DLQReplayResultDisabled, true},
		{DLQReplayResultNotFound, true},
		{DLQReplayResultUnparseable, true},
		{DLQReplayResult(""), false},
		{DLQReplayResult("bogus"), false},
		{DLQReplayResult("OK"), false}, // case sensitive
	}
	for _, tt := range tests {
		if got := knownDLQReplayResult(tt.in); got != tt.want {
			t.Errorf("knownDLQReplayResult(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

// ---------- constructor ----------

func TestNewDLQReplayAuditRepo_NilPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("NewDLQReplayAuditRepo(nil) did not panic")
		}
	}()
	_ = NewDLQReplayAuditRepo(nil)
}

func TestNewDLQReplayAuditRepo_OK(t *testing.T) {
	t.Parallel()
	repo := NewDLQReplayAuditRepo(&database.DB{Pool: &pgxpool.Pool{}})
	if repo == nil || repo.exec == nil {
		t.Fatal("expected a wired repo with a non-nil exec seam")
	}
}

// ---------- Insert validation ----------

func TestDLQInsert_Validation(t *testing.T) {
	t.Parallel()
	valid := DLQReplayAuditInsert{
		Actor: "alice", DLQID: "abc123", SrcTopic: "dlq/telemetry", Result: DLQReplayResultOK,
	}
	tests := []struct {
		name    string
		mutate  func(*DLQReplayAuditInsert)
		wantSub string
	}{
		{"empty actor", func(in *DLQReplayAuditInsert) { in.Actor = "" }, "actor must be non-empty"},
		{"empty dlq_id", func(in *DLQReplayAuditInsert) { in.DLQID = "" }, "dlq_id must be non-empty"},
		{"empty src_topic", func(in *DLQReplayAuditInsert) { in.SrcTopic = "" }, "src_topic must be non-empty"},
		{"unknown result", func(in *DLQReplayAuditInsert) { in.Result = "weird" }, "unknown result"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			repo := &DLQReplayAuditRepo{exec: f}
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

func TestDLQInsert_NilGuards(t *testing.T) {
	t.Parallel()
	valid := DLQReplayAuditInsert{Actor: "a", DLQID: "b", SrcTopic: "c", Result: DLQReplayResultOK}
	var nilRepo *DLQReplayAuditRepo
	if _, err := nilRepo.Insert(context.Background(), valid); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&DLQReplayAuditRepo{}).Insert(context.Background(), valid); err == nil {
		t.Error("nil exec should error")
	}
}

// ---------- Insert happy path + NULL mapping ----------

func TestDLQInsert_HappyPath(t *testing.T) {
	t.Parallel()
	ip := netip.MustParseAddr("10.0.0.1")
	f := &fakeDBTX{row: &fakeRow{scan: scanRow(int64(42))}}
	repo := &DLQReplayAuditRepo{exec: f}
	in := DLQReplayAuditInsert{
		Actor:    "alice",
		ActorIP:  &ip,
		DLQID:    "abc123",
		SrcTopic: "dlq/telemetry",
		DstTopic: "telemetry/v",
		Payload:  []byte(`{"k":"v"}`),
		Reason:   "codec drop",
		Result:   DLQReplayResultPublishFailed,
		Error:    "publish timeout",
		TraceID:  "trace-1",
	}
	id, err := repo.Insert(context.Background(), in)
	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if id != 42 {
		t.Errorf("id = %d, want 42 (from RETURNING)", id)
	}
	if len(f.queryRowCalls) != 1 {
		t.Fatalf("want 1 QueryRow, got %d", len(f.queryRowCalls))
	}
	c := f.queryRowCalls[0]
	for _, frag := range []string{
		"INSERT INTO dlq_replay_audit",
		"(actor, actor_ip, dlq_id, src_topic, dst_topic, payload, reason, result, error, trace_id)",
		"VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
		"RETURNING id",
	} {
		if !strings.Contains(c.SQL, frag) {
			t.Errorf("SQL missing %q\n%s", frag, c.SQL)
		}
	}
	if len(c.Args) != 10 {
		t.Fatalf("want 10 args, got %d: %v", len(c.Args), c.Args)
	}
	if c.Args[0] != "alice" {
		t.Errorf("args[0] actor = %v", c.Args[0])
	}
	if c.Args[1] != "10.0.0.1" {
		t.Errorf("args[1] actor_ip = %v, want stringified addr", c.Args[1])
	}
	if c.Args[2] != "abc123" || c.Args[3] != "dlq/telemetry" || c.Args[4] != "telemetry/v" {
		t.Errorf("args[2..4] = %v/%v/%v", c.Args[2], c.Args[3], c.Args[4])
	}
	if payload, ok := c.Args[5].([]byte); !ok || string(payload) != `{"k":"v"}` {
		t.Errorf("args[5] payload = %v, want raw JSON bytes", c.Args[5])
	}
	if c.Args[6] != "codec drop" {
		t.Errorf("args[6] reason = %v", c.Args[6])
	}
	if c.Args[7] != string(DLQReplayResultPublishFailed) {
		t.Errorf("args[7] result = %v, want %q", c.Args[7], DLQReplayResultPublishFailed)
	}
	if c.Args[8] != "publish timeout" || c.Args[9] != "trace-1" {
		t.Errorf("args[8,9] error/trace = %v/%v", c.Args[8], c.Args[9])
	}
}

func TestDLQInsert_NullMapping(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		in          DLQReplayAuditInsert
		wantIP      any
		wantDst     any
		wantPayload any // nil or the raw bytes
		wantReason  any
		wantError   any
		wantTrace   any
	}{
		{
			name:        "all optional empty → NULL",
			in:          DLQReplayAuditInsert{Actor: "a", DLQID: "b", SrcTopic: "c", Result: DLQReplayResultOK},
			wantIP:      nil,
			wantDst:     nil,
			wantPayload: nil,
			wantReason:  nil,
			wantError:   nil,
			wantTrace:   nil,
		},
		{
			name: "invalid JSON payload → NULL",
			in: DLQReplayAuditInsert{
				Actor: "a", DLQID: "b", SrcTopic: "c", Result: DLQReplayResultUnparseable,
				Payload: []byte("not json{"),
			},
			wantIP: nil, wantDst: nil, wantPayload: nil, wantReason: nil, wantError: nil, wantTrace: nil,
		},
		{
			name: "valid JSON payload → bytes",
			in: DLQReplayAuditInsert{
				Actor: "a", DLQID: "b", SrcTopic: "c", Result: DLQReplayResultOK,
				Payload: []byte(`[1,2,3]`),
			},
			wantIP: nil, wantDst: nil, wantPayload: []byte(`[1,2,3]`), wantReason: nil, wantError: nil, wantTrace: nil,
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{row: &fakeRow{scan: scanRow(int64(1))}}
			repo := &DLQReplayAuditRepo{exec: f}
			if _, err := repo.Insert(context.Background(), tt.in); err != nil {
				t.Fatal(err)
			}
			c := f.queryRowCalls[0]
			if c.Args[1] != tt.wantIP {
				t.Errorf("actor_ip arg = %v, want %v", c.Args[1], tt.wantIP)
			}
			if c.Args[4] != tt.wantDst {
				t.Errorf("dst_topic arg = %v, want %v", c.Args[4], tt.wantDst)
			}
			gotPayload := c.Args[5]
			if tt.wantPayload == nil {
				if gotPayload != nil {
					t.Errorf("payload arg = %v, want nil", gotPayload)
				}
			} else {
				pb, ok := gotPayload.([]byte)
				if !ok || !json.Valid(pb) || string(pb) != string(tt.wantPayload.([]byte)) {
					t.Errorf("payload arg = %v, want %s", gotPayload, tt.wantPayload)
				}
			}
			if c.Args[6] != tt.wantReason {
				t.Errorf("reason arg = %v, want %v", c.Args[6], tt.wantReason)
			}
			if c.Args[8] != tt.wantError {
				t.Errorf("error arg = %v, want %v", c.Args[8], tt.wantError)
			}
			if c.Args[9] != tt.wantTrace {
				t.Errorf("trace arg = %v, want %v", c.Args[9], tt.wantTrace)
			}
		})
	}
}

func TestDLQInsert_QueryRowError(t *testing.T) {
	t.Parallel()
	sentinel := errors.New("insert failed")
	f := &fakeDBTX{row: &fakeRow{scan: func(dest ...any) error { return sentinel }}}
	repo := &DLQReplayAuditRepo{exec: f}
	id, err := repo.Insert(context.Background(), DLQReplayAuditInsert{
		Actor: "a", DLQID: "b", SrcTopic: "c", Result: DLQReplayResultOK,
	})
	if !errors.Is(err, sentinel) {
		t.Errorf("want wrapped sentinel, got %v", err)
	}
	if !strings.Contains(err.Error(), "DLQReplayAuditRepo.Insert") {
		t.Errorf("error missing context: %v", err)
	}
	if id != 0 {
		t.Errorf("id on error = %d, want 0", id)
	}
}

// ---------- Recent ----------

func TestDLQRecent_NilGuards(t *testing.T) {
	t.Parallel()
	var nilRepo *DLQReplayAuditRepo
	if _, err := nilRepo.Recent(context.Background(), "", 10); err == nil {
		t.Error("nil repo should error")
	}
	if _, err := (&DLQReplayAuditRepo{}).Recent(context.Background(), "", 10); err == nil {
		t.Error("nil exec should error")
	}
}

func TestDLQRecent_LimitClampAndFilter(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		dlqID     string
		limit     int
		wantLimit int
		wantWhere bool
	}{
		{"zero → 50", "", 0, 50, false},
		{"negative → 50", "", -3, 50, false},
		{"over max → 500", "", 1000, 500, false},
		{"at max stays", "", 500, 500, false},
		{"over max by one → 500", "", 501, 500, false},
		{"in range stays", "", 42, 42, false},
		{"filtered by dlq_id", "abc123", 10, 10, true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{} // default Query → empty rows
			repo := &DLQReplayAuditRepo{exec: f}
			if _, err := repo.Recent(context.Background(), tt.dlqID, tt.limit); err != nil {
				t.Fatal(err)
			}
			if len(f.queryCalls) != 1 {
				t.Fatalf("want 1 Query, got %d", len(f.queryCalls))
			}
			c := f.queryCalls[0]
			hasWhere := strings.Contains(c.SQL, "WHERE dlq_id = $1")
			if hasWhere != tt.wantWhere {
				t.Errorf("WHERE dlq_id present = %v, want %v\n%s", hasWhere, tt.wantWhere, c.SQL)
			}
			// The clamped limit is always the last positional argument.
			lastArg := c.Args[len(c.Args)-1]
			if lastArg != tt.wantLimit {
				t.Errorf("limit arg = %v, want %d", lastArg, tt.wantLimit)
			}
			if tt.wantWhere {
				if len(c.Args) != 2 || c.Args[0] != tt.dlqID {
					t.Errorf("filtered args = %v, want [%q, %d]", c.Args, tt.dlqID, tt.wantLimit)
				}
			} else if len(c.Args) != 1 {
				t.Errorf("global args = %v, want [limit] only", c.Args)
			}
		})
	}
}

func TestDLQRecent_HappyPath(t *testing.T) {
	t.Parallel()
	replayedAt := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	f := &fakeDBTX{queryRows: rowsFrom(
		scanRow(int64(2), replayedAt, "alice", ptr("10.0.0.1"), "dlq1", "src/a",
			ptr("dst/a"), []byte(`{"a":1}`), ptr("reason-a"), "ok", ptr("err-a"), ptr("trace-a")),
		scanRow(int64(1), replayedAt, "bob", (*string)(nil), "dlq2", "src/b",
			(*string)(nil), []byte(nil), (*string)(nil), "publish_failed", (*string)(nil), (*string)(nil)),
	)}
	repo := &DLQReplayAuditRepo{exec: f}
	got, err := repo.Recent(context.Background(), "", 100)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 records, got %d", len(got))
	}
	r0 := got[0]
	if r0.ID != 2 || r0.Actor != "alice" || r0.DLQID != "dlq1" || r0.SrcTopic != "src/a" {
		t.Errorf("row0 core fields wrong: %+v", r0)
	}
	if !r0.ReplayedAt.Equal(replayedAt) {
		t.Errorf("row0 replayed_at = %v", r0.ReplayedAt)
	}
	if r0.ActorIP == nil || r0.ActorIP.String() != "10.0.0.1" {
		t.Errorf("row0 actor_ip = %v, want parsed 10.0.0.1", r0.ActorIP)
	}
	if r0.DstTopic == nil || *r0.DstTopic != "dst/a" {
		t.Errorf("row0 dst_topic = %v", r0.DstTopic)
	}
	if r0.Reason == nil || *r0.Reason != "reason-a" {
		t.Errorf("row0 reason = %v", r0.Reason)
	}
	if r0.Result != DLQReplayResultOK {
		t.Errorf("row0 result = %v, want ok", r0.Result)
	}
	if r0.Error == nil || *r0.Error != "err-a" {
		t.Errorf("row0 error = %v", r0.Error)
	}
	if r0.TraceID == nil || *r0.TraceID != "trace-a" {
		t.Errorf("row0 trace_id = %v", r0.TraceID)
	}
	if string(r0.Payload) != `{"a":1}` {
		t.Errorf("row0 payload = %s", r0.Payload)
	}
	// Row 1: all nullable columns NULL.
	r1 := got[1]
	if r1.ActorIP != nil {
		t.Errorf("row1 actor_ip should be nil, got %v", r1.ActorIP)
	}
	if r1.DstTopic != nil || r1.Reason != nil || r1.Error != nil || r1.TraceID != nil {
		t.Errorf("row1 nullable pointers should be nil: %+v", r1)
	}
	if r1.Result != DLQReplayResultPublishFailed {
		t.Errorf("row1 result = %v", r1.Result)
	}
	if r1.Payload != nil {
		t.Errorf("row1 payload should be nil, got %v", r1.Payload)
	}
}

func TestDLQRecent_Empty(t *testing.T) {
	t.Parallel()
	repo := &DLQReplayAuditRepo{exec: &fakeDBTX{}} // default → zero rows
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

func TestDLQRecent_Errors(t *testing.T) {
	t.Parallel()
	t.Run("query error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("q fail")
		repo := &DLQReplayAuditRepo{exec: &fakeDBTX{queryErr: sentinel}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: query") {
			t.Errorf("got %v", err)
		}
	})
	t.Run("scan error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("scan fail")
		repo := &DLQReplayAuditRepo{exec: &fakeDBTX{queryRows: rowsFrom(func(dest ...any) error { return sentinel })}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: scan") {
			t.Errorf("got %v", err)
		}
	})
	t.Run("rows error", func(t *testing.T) {
		t.Parallel()
		sentinel := errors.New("iter fail")
		rows := rowsFrom(scanRow(int64(1), time.Now(), "a", (*string)(nil), "d", "s",
			(*string)(nil), []byte(nil), (*string)(nil), "ok", (*string)(nil), (*string)(nil)))
		rows.err = sentinel
		repo := &DLQReplayAuditRepo{exec: &fakeDBTX{queryRows: rows}}
		_, err := repo.Recent(context.Background(), "", 10)
		if !errors.Is(err, sentinel) || !strings.Contains(err.Error(), "Recent: rows") {
			t.Errorf("got %v", err)
		}
	})
}
