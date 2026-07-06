package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/backupverify"
)

// TestMain silences the global zerolog logger so the boundary log lines
// emitted by runWithDeps/parseDuration don't pollute test output. It is
// set once before any test goroutine starts, so concurrent (t.Parallel)
// reads of log.Logger stay race-free.
func TestMain(m *testing.M) {
	log.Logger = zerolog.New(io.Discard)
	os.Exit(m.Run())
}

// fakeVerifier is an in-memory verifier stub. It records the call count so
// tests can assert VerifyLatest is invoked exactly once per run, and lets
// each case pin the (result, error) pair returned to runWithDeps without a
// real database, storage provider, or backup artifact.
type fakeVerifier struct {
	res   *backupverify.Result
	err   error
	calls int
}

func (f *fakeVerifier) VerifyLatest(_ context.Context) (*backupverify.Result, error) {
	f.calls++
	return f.res, f.err
}

func TestParseCriticals(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		raw  string
		want []string
	}{
		{name: "empty returns nil (verifier applies default)", raw: "", want: nil},
		{name: "single table", raw: "vehicles", want: []string{"vehicles"}},
		{
			name: "multiple tables",
			raw:  "vehicles,drives,charging_sessions",
			want: []string{"vehicles", "drives", "charging_sessions"},
		},
		{name: "trims surrounding whitespace", raw: " vehicles , drives ", want: []string{"vehicles", "drives"}},
		{name: "skips empty segments", raw: "vehicles,,drives", want: []string{"vehicles", "drives"}},
		{name: "trailing comma ignored", raw: "vehicles,", want: []string{"vehicles"}},
		{name: "leading comma ignored", raw: ",vehicles", want: []string{"vehicles"}},
		{name: "only commas yields empty non-nil slice", raw: ",,,", want: []string{}},
		{name: "only whitespace yields empty non-nil slice", raw: "   ", want: []string{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			got := parseCriticals(tc.raw)
			if !reflect.DeepEqual(got, tc.want) {
				t.Fatalf("parseCriticals(%q) = %#v, want %#v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseCriticals_EmptyIsNil pins the nil-vs-empty distinction that the
// verifier relies on: an unset env var must yield a nil slice so
// NewVerifier substitutes its {"vehicles"} default, whereas an explicitly
// comma-only value yields a non-nil empty slice.
func TestParseCriticals_EmptyIsNil(t *testing.T) {
	t.Parallel()
	if got := parseCriticals(""); got != nil {
		t.Fatalf(`parseCriticals("") = %#v, want nil`, got)
	}
	if got := parseCriticals(","); got == nil {
		t.Fatal(`parseCriticals(",") = nil, want non-nil empty slice`)
	}
}

func TestParseDuration(t *testing.T) {
	t.Parallel()
	def := 7 * 24 * time.Hour
	tests := []struct {
		name string
		raw  string
		want time.Duration
	}{
		{name: "empty uses default", raw: "", want: def},
		{name: "hours", raw: "24h", want: 24 * time.Hour},
		{name: "milliseconds", raw: "500ms", want: 500 * time.Millisecond},
		{name: "compound", raw: "1h30m", want: 90 * time.Minute},
		{name: "zero parses to zero", raw: "0s", want: 0},
		{name: "negative parses as-is", raw: "-5m", want: -5 * time.Minute},
		{name: "garbage falls back to default", raw: "garbage", want: def},
		{name: "day unit unsupported falls back", raw: "7d", want: def},
		{name: "missing unit falls back", raw: "10", want: def},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := parseDuration(tc.raw, def); got != tc.want {
				t.Fatalf("parseDuration(%q) = %v, want %v", tc.raw, got, tc.want)
			}
		})
	}
}

// TestParseDuration_DefaultIndependentOfValue ensures the fallback returns
// whatever default the caller supplied, not a hard-coded 7d.
func TestParseDuration_DefaultIndependentOfValue(t *testing.T) {
	t.Parallel()
	custom := 3 * time.Hour
	if got := parseDuration("nonsense", custom); got != custom {
		t.Fatalf("parseDuration fallback = %v, want caller default %v", got, custom)
	}
}

func TestEmit(t *testing.T) {
	t.Parallel()

	t.Run("nil result emits sentinel line", func(t *testing.T) {
		t.Parallel()
		var buf bytes.Buffer
		emit(&buf, nil)
		want := `{"ok":false,"error":"nil result"}` + "\n"
		if buf.String() != want {
			t.Fatalf("emit(nil) = %q, want %q", buf.String(), want)
		}
	})

	t.Run("success result marshals and round-trips", func(t *testing.T) {
		t.Parallel()
		var buf bytes.Buffer
		in := &backupverify.Result{
			RunID:      42,
			OK:         true,
			DurationMs: 123,
			ChecksumOK: true,
			TablesVerified: []backupverify.TableResult{
				{Table: "vehicles", RowCount: 3, OK: true},
			},
		}
		emit(&buf, in)

		out := buf.String()
		if !strings.HasSuffix(out, "\n") {
			t.Fatalf("emit output not newline-terminated: %q", out)
		}
		var got backupverify.Result
		if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &got); err != nil {
			t.Fatalf("emit produced invalid JSON %q: %v", out, err)
		}
		if got.RunID != 42 || !got.OK || got.DurationMs != 123 || !got.ChecksumOK {
			t.Fatalf("round-trip mismatch: %+v", got)
		}
		if len(got.TablesVerified) != 1 || got.TablesVerified[0].Table != "vehicles" || got.TablesVerified[0].RowCount != 3 {
			t.Fatalf("tables not preserved: %+v", got.TablesVerified)
		}
	})

	t.Run("failure result preserves error field", func(t *testing.T) {
		t.Parallel()
		var buf bytes.Buffer
		emit(&buf, &backupverify.Result{OK: false, Error: "checksum mismatch"})
		var got backupverify.Result
		if err := json.Unmarshal([]byte(strings.TrimSpace(buf.String())), &got); err != nil {
			t.Fatalf("invalid JSON %q: %v", buf.String(), err)
		}
		if got.OK {
			t.Fatal("expected ok=false")
		}
		if got.Error != "checksum mismatch" {
			t.Fatalf("error field = %q, want %q", got.Error, "checksum mismatch")
		}
	})
}

func TestRunWithDeps(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name         string
		res          *backupverify.Result
		err          error
		wantExit     int
		wantEmitNil  bool // stdout should be the nil-result sentinel line
		wantRunIDOut int64
	}{
		{
			name:         "clean pass exits zero",
			res:          &backupverify.Result{OK: true, RunID: 7, DurationMs: 12},
			err:          nil,
			wantExit:     0,
			wantRunIDOut: 7,
		},
		{
			name:     "verifier error exits one",
			res:      &backupverify.Result{OK: false, Error: "boom"},
			err:      errors.New("boom"),
			wantExit: 1,
		},
		{
			name:     "not ok without error exits one",
			res:      &backupverify.Result{OK: false, Error: "one or more critical tables failed verification"},
			err:      nil,
			wantExit: 1,
		},
		{
			name:        "nil result with error exits one and emits sentinel",
			res:         nil,
			err:         errors.New("db down"),
			wantExit:    1,
			wantEmitNil: true,
		},
		{
			name:        "nil result without error exits one and emits sentinel",
			res:         nil,
			err:         nil,
			wantExit:    1,
			wantEmitNil: true,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			fv := &fakeVerifier{res: tc.res, err: tc.err}
			var buf bytes.Buffer

			got := runWithDeps(context.Background(), fv, &buf)

			if got != tc.wantExit {
				t.Fatalf("runWithDeps exit = %d, want %d", got, tc.wantExit)
			}
			if fv.calls != 1 {
				t.Fatalf("VerifyLatest called %d times, want exactly 1", fv.calls)
			}
			out := buf.String()
			if out == "" {
				t.Fatal("runWithDeps emitted nothing to stdout")
			}
			if tc.wantEmitNil {
				want := `{"ok":false,"error":"nil result"}` + "\n"
				if out != want {
					t.Fatalf("stdout = %q, want sentinel %q", out, want)
				}
				return
			}
			var res backupverify.Result
			if err := json.Unmarshal([]byte(strings.TrimSpace(out)), &res); err != nil {
				t.Fatalf("stdout not valid JSON %q: %v", out, err)
			}
			if tc.wantRunIDOut != 0 && res.RunID != tc.wantRunIDOut {
				t.Fatalf("emitted run_id = %d, want %d", res.RunID, tc.wantRunIDOut)
			}
			if tc.wantExit == 0 && !res.OK {
				t.Fatalf("exit 0 but emitted ok=false: %+v", res)
			}
			if tc.wantExit == 1 && res.OK {
				t.Fatalf("exit 1 but emitted ok=true: %+v", res)
			}
		})
	}
}

// TestRunWithDeps_EmitsBeforeDeciding guards the ordering contract: the
// JSON result line must be written to stdout even on failure, because the
// cron/CronJob wrapper records that line regardless of exit code.
func TestRunWithDeps_EmitsBeforeDeciding(t *testing.T) {
	t.Parallel()
	fv := &fakeVerifier{res: &backupverify.Result{OK: false, Error: "stale"}, err: errors.New("stale")}
	var buf bytes.Buffer
	exit := runWithDeps(context.Background(), fv, &buf)
	if exit != 1 {
		t.Fatalf("exit = %d, want 1", exit)
	}
	if !strings.Contains(buf.String(), `"stale"`) {
		t.Fatalf("failure result not emitted to stdout: %q", buf.String())
	}
}
