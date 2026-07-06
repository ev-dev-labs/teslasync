package observability

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Status incidents are the operator-managed timeline behind the System
// Status page. Coverage spans the value validators, the rune-safe
// truncation guard (regression for the invalid-UTF-8 write bug), the
// scanIncident column contract, and every CRUD method through the fake.

var tref = time.Date(2026, 5, 6, 11, 0, 0, 0, time.UTC)

const sampleUpdatesJSON = `[{"at":"2026-05-06T11:00:00Z","status":"investigating","message":"Incident opened.","author":"alice"}]`

// incidentRow builds the 14-column scanIncident projection for a valid
// row. updatesRaw and resolvedAt are caller-supplied so the null/JSON
// branches are reachable.
func incidentRow(id int64, status string, updatesRaw []byte, resolvedAt *time.Time) *fakeRow {
	return rowWith(
		id, "Outage", "desc", IncidentSeverityMajor, status, IncidentSourceManual,
		[]string{"api"}, updatesRaw, tref, resolvedAt, tref, tref, "alice", "",
	)
}

func TestValidateIncidentSeverity(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"minor", IncidentSeverityMinor, false},
		{"  MAJOR ", IncidentSeverityMajor, false},
		{"Critical", IncidentSeverityCritical, false},
		{"", "", true},
		{"fatal", "", true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			got, err := ValidateIncidentSeverity(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrIncidentInvalidSeverity) {
					t.Errorf("want ErrIncidentInvalidSeverity, got %v", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Errorf("ValidateIncidentSeverity(%q) = (%q, %v), want (%q, nil)", tt.in, got, err, tt.want)
			}
		})
	}
}

func TestValidateIncidentStatus(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"investigating", IncidentStatusInvestigating, false},
		{" Identified ", IncidentStatusIdentified, false},
		{"MONITORING", IncidentStatusMonitoring, false},
		{"resolved", IncidentStatusResolved, false},
		{"", "", true},
		{"closed", "", true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			got, err := ValidateIncidentStatus(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrIncidentInvalidStatus) {
					t.Errorf("want ErrIncidentInvalidStatus, got %v", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Errorf("ValidateIncidentStatus(%q) = (%q, %v), want (%q, nil)", tt.in, got, err, tt.want)
			}
		})
	}
}

func TestValidateIncidentSource(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		want    string
		wantErr bool
	}{
		{"manual", IncidentSourceManual, false},
		{" AUTO ", IncidentSourceAuto, false},
		{"", "", true},
		{"system", "", true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			got, err := ValidateIncidentSource(tt.in)
			if tt.wantErr {
				if !errors.Is(err, ErrIncidentInvalidSource) {
					t.Errorf("want ErrIncidentInvalidSource, got %v", err)
				}
				return
			}
			if err != nil || got != tt.want {
				t.Errorf("ValidateIncidentSource(%q) = (%q, %v), want (%q, nil)", tt.in, got, err, tt.want)
			}
		})
	}
}

func TestValidateIncidentTitle(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		in      string
		wantErr bool
	}{
		{"too_short", "ab", true},
		{"min_ok", "abc", false},
		{"typical", "Database outage", false},
		{"max_ok", strings.Repeat("x", IncidentTitleMaxLen), false},
		{"too_long", strings.Repeat("x", IncidentTitleMaxLen+1), true},
		{"whitespace_trimmed_too_short", "  a  ", true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			err := validateIncidentTitle(tt.in)
			if (err != nil) != tt.wantErr {
				t.Errorf("validateIncidentTitle(%q) err = %v, wantErr %v", tt.in, err, tt.wantErr)
			}
		})
	}
}

func TestCapText(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"empty", "", 10, ""},
		{"under_limit", "abc", 10, "abc"},
		{"exact_limit", "abcde", 5, "abcde"},
		{"ascii_truncate", "abcdefghij", 4, "abcd"},
		{"zero_max_returns_input", "abcdef", 0, "abcdef"},
		{"negative_max_returns_input", "abcdef", -1, "abcdef"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := capText(tt.in, tt.max); got != tt.want {
				t.Errorf("capText(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
			}
		})
	}
}

// TestCapText_RuneSafe is the regression guard for the byte-vs-rune
// truncation bug: a naive s[:max] slice can cut a multi-byte rune in
// half, yielding invalid UTF-8 that PostgreSQL rejects.
func TestCapText_RuneSafe(t *testing.T) {
	t.Parallel()
	multi := strings.Repeat("€", 100) // 3 bytes each → 300 bytes, 100 runes
	for _, max := range []int{1, 2, 4, 100, 299, 300} {
		got := capText(multi, max)
		if !utf8.ValidString(got) {
			t.Errorf("capText(max=%d) produced invalid UTF-8: %q", max, got)
		}
		if len(got) > max {
			t.Errorf("capText(max=%d) len=%d exceeds max", max, len(got))
		}
	}
	if got := capText(multi, 2); got != "" {
		t.Errorf("capText(max=2) with 3-byte runes = %q, want empty", got)
	}
}

func TestScanIncident(t *testing.T) {
	t.Parallel()
	t.Run("happy_with_updates", func(t *testing.T) {
		t.Parallel()
		inc, err := scanIncident(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
		if err != nil {
			t.Fatalf("scanIncident: %v", err)
		}
		if inc.ID != 1 || inc.Status != IncidentStatusInvestigating {
			t.Errorf("inc = %+v", inc)
		}
		if len(inc.Updates) != 1 || inc.Updates[0].Message != "Incident opened." {
			t.Errorf("updates = %+v", inc.Updates)
		}
		if len(inc.AffectedComponents) != 1 || inc.AffectedComponents[0] != "api" {
			t.Errorf("affected = %+v", inc.AffectedComponents)
		}
	})
	t.Run("null_updates_becomes_empty", func(t *testing.T) {
		t.Parallel()
		inc, err := scanIncident(incidentRow(2, IncidentStatusInvestigating, []byte(nil), nil))
		if err != nil {
			t.Fatalf("scanIncident: %v", err)
		}
		if inc.Updates == nil || len(inc.Updates) != 0 {
			t.Errorf("updates should be non-nil empty, got %+v", inc.Updates)
		}
	})
	t.Run("bad_updates_json_errors", func(t *testing.T) {
		t.Parallel()
		_, err := scanIncident(incidentRow(3, IncidentStatusInvestigating, []byte("{not-json"), nil))
		if err == nil || !strings.Contains(err.Error(), "unmarshal updates") {
			t.Fatalf("want unmarshal error, got %v", err)
		}
	})
	t.Run("scan_error_propagates", func(t *testing.T) {
		t.Parallel()
		_, err := scanIncident(rowErr(errors.New("scan boom")))
		if err == nil || !strings.Contains(err.Error(), "scan boom") {
			t.Fatalf("want scan error, got %v", err)
		}
	})
	t.Run("resolved_at_populated", func(t *testing.T) {
		t.Parallel()
		resolved := tref.Add(time.Hour)
		inc, err := scanIncident(incidentRow(4, IncidentStatusResolved, []byte(sampleUpdatesJSON), &resolved))
		if err != nil {
			t.Fatalf("scanIncident: %v", err)
		}
		if inc.ResolvedAt == nil || !inc.ResolvedAt.Equal(resolved) {
			t.Errorf("resolvedAt = %v, want %v", inc.ResolvedAt, resolved)
		}
	})
}

func TestNewIncidentRepo(t *testing.T) {
	t.Parallel()
	if r := NewIncidentRepo(nil); r == nil || r.exec != nil {
		t.Errorf("nil db should yield repo with nil exec, got %+v", r)
	}
	if r := NewIncidentRepo(&database.DB{}); r == nil || r.exec != nil {
		t.Error("nil pool should leave exec nil")
	}
	if r := NewIncidentRepo(&database.DB{Pool: &pgxpool.Pool{}}); r == nil || r.exec == nil {
		t.Error("db+pool should set exec")
	}
}

func TestIncidentRepo_Unconfigured(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	r := &IncidentRepo{} // exec nil
	if _, err := r.Insert(ctx, IncidentInsert{Title: "valid title"}); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("Insert: want unconfigured, got %v", err)
	}
	if _, err := r.Get(ctx, 1); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("Get: want unconfigured, got %v", err)
	}
	if _, err := r.List(ctx, IncidentListParams{}); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("List: want unconfigured, got %v", err)
	}
	if _, err := r.FindByDedupeKey(ctx, "k"); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("FindByDedupeKey: want unconfigured, got %v", err)
	}
	if err := r.Delete(ctx, 1); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("Delete: want unconfigured, got %v", err)
	}
	var nilRepo *IncidentRepo
	if _, err := nilRepo.Get(ctx, 1); !errors.Is(err, ErrIncidentRepoUnconfigured) {
		t.Errorf("nil repo Get: want unconfigured, got %v", err)
	}
}

func TestIncidentRepo_Insert_TitleValidation(t *testing.T) {
	t.Parallel()
	f := &fakeDBTX{}
	r := &IncidentRepo{exec: f}
	if _, err := r.Insert(context.Background(), IncidentInsert{Title: "ab"}); !errors.Is(err, ErrIncidentTitleLength) {
		t.Errorf("want ErrIncidentTitleLength, got %v", err)
	}
	if len(f.rowCalls) != 0 {
		t.Errorf("no query should run for invalid title, got %d", len(f.rowCalls))
	}
}

func TestIncidentRepo_Insert_Defaults(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushRow(rowWith(int64(99), tref, tref))
	r := &IncidentRepo{exec: f}
	inc, err := r.Insert(context.Background(), IncidentInsert{Title: "Partial outage"})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if inc.ID != 99 {
		t.Errorf("ID = %d, want 99", inc.ID)
	}
	if inc.Severity != IncidentSeverityMinor || inc.Status != IncidentStatusInvestigating || inc.Source != IncidentSourceManual {
		t.Errorf("defaults wrong: sev=%q status=%q source=%q", inc.Severity, inc.Status, inc.Source)
	}
	if inc.AffectedComponents == nil {
		t.Error("AffectedComponents should default to non-nil empty slice")
	}
	if len(inc.Updates) != 1 || inc.Updates[0].Message != "Incident opened." {
		t.Errorf("opening update wrong: %+v", inc.Updates)
	}
	// arg order: title,desc,severity,status,source,affected,updates,started,created_by,dedupe
	args := f.lastRow().Args
	if len(args) != 10 {
		t.Fatalf("insert args = %d, want 10", len(args))
	}
	if args[2].(string) != IncidentSeverityMinor || args[3].(string) != IncidentStatusInvestigating || args[4].(string) != IncidentSourceManual {
		t.Errorf("default args wrong: %v", args[2:5])
	}
}

func TestIncidentRepo_Insert_InvalidEnums(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   IncidentInsert
		want error
	}{
		{"bad_severity", IncidentInsert{Title: "valid title", Severity: "fatal"}, ErrIncidentInvalidSeverity},
		{"bad_status", IncidentInsert{Title: "valid title", Status: "closed"}, ErrIncidentInvalidStatus},
		{"bad_source", IncidentInsert{Title: "valid title", Source: "robot"}, ErrIncidentInvalidSource},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			f := &fakeDBTX{}
			r := &IncidentRepo{exec: f}
			if _, err := r.Insert(context.Background(), tt.in); !errors.Is(err, tt.want) {
				t.Errorf("want %v, got %v", tt.want, err)
			}
			if len(f.rowCalls) != 0 {
				t.Errorf("no query should run on validation failure")
			}
		})
	}
}

func TestIncidentRepo_Insert_TruncatesMultibyte(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushRow(rowWith(int64(1), tref, tref))
	r := &IncidentRepo{exec: f}
	longDesc := strings.Repeat("€", 1400) // 4200 bytes, 3-byte runes
	longMsg := strings.Repeat("€", 1400)
	if _, err := r.Insert(context.Background(), IncidentInsert{
		Title: "outage", Description: longDesc, InitialMessage: longMsg,
	}); err != nil {
		t.Fatalf("Insert: %v", err)
	}
	descArg := f.lastRow().Args[1].(string)
	if len(descArg) > IncidentDescriptionMaxLen || !utf8.ValidString(descArg) {
		t.Errorf("description not rune-safe truncated: len=%d valid=%v", len(descArg), utf8.ValidString(descArg))
	}
}

func TestIncidentRepo_Insert_ScanError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushRow(rowErr(errors.New("insert boom")))
	r := &IncidentRepo{exec: f}
	if _, err := r.Insert(context.Background(), IncidentInsert{Title: "outage"}); err == nil || !strings.Contains(err.Error(), "insert") {
		t.Fatalf("want wrapped insert error, got %v", err)
	}
}

func TestIncidentRepo_Insert_Happy(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushRow(rowWith(int64(7), tref, tref))
	r := &IncidentRepo{exec: f}
	inc, err := r.Insert(context.Background(), IncidentInsert{
		Title: "  Big outage  ", Description: "desc", Severity: "critical",
		Status: "identified", Source: "auto", AffectedComponents: []string{"api", "db"},
		StartedAt: tref, CreatedBy: "alice", InitialMessage: "Looking into it",
	})
	if err != nil {
		t.Fatalf("Insert: %v", err)
	}
	if inc.Title != "Big outage" {
		t.Errorf("title should be trimmed, got %q", inc.Title)
	}
	if inc.Severity != "critical" || inc.Status != "identified" || inc.Source != "auto" {
		t.Errorf("fields wrong: %+v", inc)
	}
	if len(inc.AffectedComponents) != 2 {
		t.Errorf("affected = %+v", inc.AffectedComponents)
	}
	if inc.Updates[0].Message != "Looking into it" || inc.Updates[0].Author != "alice" {
		t.Errorf("initial update wrong: %+v", inc.Updates[0])
	}
}

func TestIncidentRepo_Get(t *testing.T) {
	t.Parallel()
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(incidentRow(5, IncidentStatusMonitoring, []byte(sampleUpdatesJSON), nil))
		r := &IncidentRepo{exec: f}
		inc, err := r.Get(context.Background(), 5)
		if err != nil || inc.ID != 5 || inc.Status != IncidentStatusMonitoring {
			t.Errorf("Get = (%+v, %v)", inc, err)
		}
	})
	t.Run("not_found", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(pgx.ErrNoRows))
		r := &IncidentRepo{exec: f}
		if _, err := r.Get(context.Background(), 5); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
	})
	t.Run("other_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(errors.New("boom")))
		r := &IncidentRepo{exec: f}
		if _, err := r.Get(context.Background(), 5); err == nil || errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want raw error, got %v", err)
		}
	})
}

func TestIncidentRepo_List(t *testing.T) {
	t.Parallel()
	t.Run("limit_default_and_active_filter", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
		r := &IncidentRepo{exec: f}
		if _, err := r.List(context.Background(), IncidentListParams{ActiveOnly: true, Limit: 0}); err != nil {
			t.Fatalf("List: %v", err)
		}
		call := f.lastQuery()
		if !strings.Contains(call.SQL, "WHERE resolved_at IS NULL") {
			t.Errorf("ActiveOnly should filter unresolved: %s", call.SQL)
		}
		if call.Args[0].(int) != 50 {
			t.Errorf("limit = %v, want default 50", call.Args[0])
		}
	})
	t.Run("limit_over_max_defaults", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(), nil)
		r := &IncidentRepo{exec: f}
		if _, err := r.List(context.Background(), IncidentListParams{Limit: 9999}); err != nil {
			t.Fatalf("List: %v", err)
		}
		if f.lastQuery().Args[0].(int) != 50 {
			t.Errorf("over-max limit should default to 50")
		}
	})
	t.Run("query_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(nil, errors.New("boom"))
		r := &IncidentRepo{exec: f}
		if _, err := r.List(context.Background(), IncidentListParams{}); err == nil || !strings.Contains(err.Error(), "list") {
			t.Errorf("want wrapped list error, got %v", err)
		}
	})
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(
			incidentScan(1, IncidentStatusInvestigating),
			incidentScan(2, IncidentStatusResolved),
		), nil)
		r := &IncidentRepo{exec: f}
		out, err := r.List(context.Background(), IncidentListParams{})
		if err != nil {
			t.Fatalf("List: %v", err)
		}
		if len(out) != 2 || out[0].ID != 1 || out[1].ID != 2 {
			t.Errorf("out = %+v", out)
		}
	})
	t.Run("scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushQuery(rowsFrom(func(dest ...any) error { return errors.New("scan boom") }), nil)
		r := &IncidentRepo{exec: f}
		if _, err := r.List(context.Background(), IncidentListParams{}); err == nil {
			t.Error("want scan error")
		}
	})
}

func TestIncidentRepo_FindByDedupeKey(t *testing.T) {
	t.Parallel()
	t.Run("empty_key_no_query", func(t *testing.T) {
		t.Parallel()
		f := &fakeDBTX{}
		r := &IncidentRepo{exec: f}
		if _, err := r.FindByDedupeKey(context.Background(), ""); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
		if len(f.rowCalls) != 0 {
			t.Error("empty key should not query")
		}
	})
	t.Run("not_found", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(pgx.ErrNoRows))
		r := &IncidentRepo{exec: f}
		if _, err := r.FindByDedupeKey(context.Background(), "k"); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
	})
	t.Run("happy", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(incidentRow(8, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
		r := &IncidentRepo{exec: f}
		inc, err := r.FindByDedupeKey(context.Background(), "cpu-high")
		if err != nil || inc.ID != 8 {
			t.Errorf("FindByDedupeKey = (%+v, %v)", inc, err)
		}
	})
}

func TestIncidentRepo_Patch(t *testing.T) {
	t.Parallel()
	t.Run("get_not_found_propagates", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(pgx.ErrNoRows))
		r := &IncidentRepo{exec: f}
		if _, err := r.Patch(context.Background(), 1, IncidentPatch{}, "bob"); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
	})
	t.Run("invalid_title", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
		r := &IncidentRepo{exec: f}
		bad := "ab"
		if _, err := r.Patch(context.Background(), 1, IncidentPatch{Title: &bad}, "bob"); !errors.Is(err, ErrIncidentTitleLength) {
			t.Errorf("want ErrIncidentTitleLength, got %v", err)
		}
	})
	t.Run("invalid_severity", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
		r := &IncidentRepo{exec: f}
		bad := "fatal"
		if _, err := r.Patch(context.Background(), 1, IncidentPatch{Severity: &bad}, "bob"); !errors.Is(err, ErrIncidentInvalidSeverity) {
			t.Errorf("want ErrIncidentInvalidSeverity, got %v", err)
		}
	})
	t.Run("nil_affected_components_becomes_empty", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).
			pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
			pushRow(rowWith(tref))
		r := &IncidentRepo{exec: f}
		var nilSlice []string
		inc, err := r.Patch(context.Background(), 1, IncidentPatch{AffectedComponents: &nilSlice}, "bob")
		if err != nil {
			t.Fatalf("Patch: %v", err)
		}
		if inc.AffectedComponents == nil {
			t.Error("nil affected components should normalise to empty slice")
		}
	})
	t.Run("resolve", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).
			pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
			pushRow(rowWith(tref.Add(time.Hour)))
		r := &IncidentRepo{exec: f}
		resolve := true
		inc, err := r.Patch(context.Background(), 1, IncidentPatch{Resolved: &resolve}, "bob")
		if err != nil {
			t.Fatalf("Patch: %v", err)
		}
		if inc.Status != IncidentStatusResolved || inc.ResolvedAt == nil {
			t.Errorf("resolve should set status+resolvedAt: %+v", inc)
		}
		if got := inc.Updates[len(inc.Updates)-1].Message; got != "Incident resolved." {
			t.Errorf("final update = %q, want resolved marker", got)
		}
		// resolved_at arg ($8) must be non-nil on the UPDATE.
		if f.lastRow().Args[7] == nil {
			t.Error("resolved_at arg should be non-nil after resolve")
		}
	})
	t.Run("update_scan_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).
			pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
			pushRow(rowErr(errors.New("update boom")))
		r := &IncidentRepo{exec: f}
		if _, err := r.Patch(context.Background(), 1, IncidentPatch{}, "bob"); err == nil || !strings.Contains(err.Error(), "patch") {
			t.Errorf("want wrapped patch error, got %v", err)
		}
	})
}

func TestIncidentRepo_AppendUpdate(t *testing.T) {
	t.Parallel()
	t.Run("get_error_propagates", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(rowErr(pgx.ErrNoRows))
		r := &IncidentRepo{exec: f}
		if _, err := r.AppendUpdate(context.Background(), 1, "msg", "", "bob"); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
	})
	t.Run("empty_or_too_long_message", func(t *testing.T) {
		t.Parallel()
		for _, msg := range []string{"", "   ", strings.Repeat("x", IncidentMessageMaxLen+1)} {
			f := (&fakeDBTX{}).pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
			r := &IncidentRepo{exec: f}
			if _, err := r.AppendUpdate(context.Background(), 1, msg, "", "bob"); !errors.Is(err, ErrIncidentMessageLength) {
				t.Errorf("msg %q: want ErrIncidentMessageLength, got %v", msg, err)
			}
		}
	})
	t.Run("invalid_status", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil))
		r := &IncidentRepo{exec: f}
		if _, err := r.AppendUpdate(context.Background(), 1, "an update", "closed", "bob"); !errors.Is(err, ErrIncidentInvalidStatus) {
			t.Errorf("want ErrIncidentInvalidStatus, got %v", err)
		}
	})
	t.Run("resolve_via_status", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).
			pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
			pushRow(rowWith(tref.Add(time.Hour)))
		r := &IncidentRepo{exec: f}
		inc, err := r.AppendUpdate(context.Background(), 1, "resolving now", IncidentStatusResolved, "bob")
		if err != nil {
			t.Fatalf("AppendUpdate: %v", err)
		}
		if inc.Status != IncidentStatusResolved || inc.ResolvedAt == nil {
			t.Errorf("status→resolved should stamp resolvedAt: %+v", inc)
		}
		if inc.Updates[len(inc.Updates)-1].Message != "resolving now" {
			t.Errorf("appended message wrong: %+v", inc.Updates)
		}
	})
	t.Run("happy_no_status_change", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).
			pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
			pushRow(rowWith(tref.Add(time.Hour)))
		r := &IncidentRepo{exec: f}
		inc, err := r.AppendUpdate(context.Background(), 1, "still working", "", "bob")
		if err != nil {
			t.Fatalf("AppendUpdate: %v", err)
		}
		if inc.Status != IncidentStatusInvestigating {
			t.Errorf("status should be unchanged, got %q", inc.Status)
		}
		if len(inc.Updates) != 2 {
			t.Errorf("updates should grow to 2, got %d", len(inc.Updates))
		}
	})
}

func TestIncidentRepo_Delete(t *testing.T) {
	t.Parallel()
	t.Run("exec_error", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag(""), errors.New("boom"))
		r := &IncidentRepo{exec: f}
		if err := r.Delete(context.Background(), 1); err == nil || !strings.Contains(err.Error(), "delete") {
			t.Errorf("want wrapped delete error, got %v", err)
		}
	})
	t.Run("not_found_zero_rows", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag("DELETE 0"), nil)
		r := &IncidentRepo{exec: f}
		if err := r.Delete(context.Background(), 1); !errors.Is(err, ErrIncidentNotFound) {
			t.Errorf("want ErrIncidentNotFound, got %v", err)
		}
	})
	t.Run("success", func(t *testing.T) {
		t.Parallel()
		f := (&fakeDBTX{}).pushExec(pgTag("DELETE 1"), nil)
		r := &IncidentRepo{exec: f}
		if err := r.Delete(context.Background(), 1); err != nil {
			t.Errorf("Delete: %v", err)
		}
	})
}

// incidentScan is the row-callback form of incidentRow for use inside
// rowsFrom (List iterates pgx.Rows, not a single pgx.Row).
func incidentScan(id int64, status string) func(dest ...any) error {
	return scanRow(
		id, "Outage", "desc", IncidentSeverityMajor, status, IncidentSourceManual,
		[]string{"api"}, []byte(sampleUpdatesJSON), tref, (*time.Time)(nil), tref, tref, "alice", "",
	)
}

func TestScanIncident_NilAffectedComponents(t *testing.T) {
	t.Parallel()
	row := rowWith(
		int64(1), "Outage", "desc", IncidentSeverityMajor, IncidentStatusInvestigating,
		IncidentSourceManual, []string(nil), []byte(sampleUpdatesJSON), tref,
		(*time.Time)(nil), tref, tref, "alice", "",
	)
	inc, err := scanIncident(row)
	if err != nil {
		t.Fatalf("scanIncident: %v", err)
	}
	if inc.AffectedComponents == nil {
		t.Error("nil affected_components should normalise to non-nil empty slice")
	}
}

func TestIncidentRepo_FindByDedupeKey_OtherError(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).pushRow(rowErr(errors.New("boom")))
	r := &IncidentRepo{exec: f}
	_, err := r.FindByDedupeKey(context.Background(), "k")
	if err == nil || errors.Is(err, ErrIncidentNotFound) {
		t.Errorf("non-NotFound error should propagate raw, got %v", err)
	}
}

func TestIncidentRepo_Patch_AllFieldsApplied(t *testing.T) {
	t.Parallel()
	f := (&fakeDBTX{}).
		pushRow(incidentRow(1, IncidentStatusInvestigating, []byte(sampleUpdatesJSON), nil)).
		pushRow(rowWith(tref.Add(time.Hour)))
	r := &IncidentRepo{exec: f}
	title := "  Reworded title  "
	desc := "updated description"
	sev := "critical"
	status := "identified"
	comps := []string{"api", "db"}
	inc, err := r.Patch(context.Background(), 1, IncidentPatch{
		Title: &title, Description: &desc, Severity: &sev,
		Status: &status, AffectedComponents: &comps,
	}, "bob")
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if inc.Title != "Reworded title" || inc.Description != "updated description" {
		t.Errorf("title/desc not applied: %+v", inc)
	}
	if inc.Severity != "critical" || inc.Status != "identified" {
		t.Errorf("severity/status not applied: %+v", inc)
	}
	if len(inc.AffectedComponents) != 2 {
		t.Errorf("affected not applied: %+v", inc.AffectedComponents)
	}
	// UPDATE args: id,title,description,severity,status,affected,updates,resolvedAt
	args := f.lastRow().Args
	if args[1].(string) != "Reworded title" || args[4].(string) != "identified" {
		t.Errorf("update args wrong: title=%v status=%v", args[1], args[4])
	}
	if args[7] != nil {
		t.Errorf("resolved_at should stay nil for a non-resolving patch, got %v", args[7])
	}
}

func TestIncidentRepo_Patch_AlreadyResolvedPreserved(t *testing.T) {
	t.Parallel()
	resolved := tref.Add(time.Hour)
	f := (&fakeDBTX{}).
		pushRow(incidentRow(1, IncidentStatusResolved, []byte(sampleUpdatesJSON), &resolved)).
		pushRow(rowWith(tref.Add(2 * time.Hour)))
	r := &IncidentRepo{exec: f}
	newStatus := IncidentStatusMonitoring
	inc, err := r.Patch(context.Background(), 1, IncidentPatch{Status: &newStatus}, "bob")
	if err != nil {
		t.Fatalf("Patch: %v", err)
	}
	if inc.ResolvedAt == nil {
		t.Error("existing resolved_at must be preserved when not re-resolving")
	}
	// resolved_at arg ($8) must carry the preserved timestamp, not nil.
	if f.lastRow().Args[7] == nil {
		t.Error("resolved_at arg should carry the preserved timestamp")
	}
}

func TestIncidentRepo_AppendUpdate_AlreadyResolvedPreserved(t *testing.T) {
	t.Parallel()
	resolved := tref.Add(time.Hour)
	f := (&fakeDBTX{}).
		pushRow(incidentRow(1, IncidentStatusResolved, []byte(sampleUpdatesJSON), &resolved)).
		pushRow(rowWith(tref.Add(2 * time.Hour)))
	r := &IncidentRepo{exec: f}
	inc, err := r.AppendUpdate(context.Background(), 1, "post-mortem note", "", "bob")
	if err != nil {
		t.Fatalf("AppendUpdate: %v", err)
	}
	if inc.ResolvedAt == nil {
		t.Error("resolved_at must be preserved on a resolved incident")
	}
	if f.lastRow().Args[3] == nil {
		t.Error("resolved_at arg should carry the preserved timestamp")
	}
}
