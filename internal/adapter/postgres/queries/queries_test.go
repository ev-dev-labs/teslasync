package queries

import (
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/domain/charging"
	"github.com/ev-dev-labs/teslasync/internal/domain/export"
	"github.com/ev-dev-labs/teslasync/internal/domain/notification"
	"github.com/ev-dev-labs/teslasync/internal/domain/trip"
	"github.com/ev-dev-labs/teslasync/internal/domain/user"
	"github.com/ev-dev-labs/teslasync/internal/domain/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/port/repository"
)

// namedQuery pairs an exported query constant with a stable name for
// table-driven, sub-test-per-query assertions.
type namedQuery struct {
	name string
	sql  string
}

// allQueries lists every exported SQL constant in the package. Keeping this
// exhaustive means a newly added constant that violates a structural invariant
// is caught the moment it is wired into a test row here.
func allQueries() []namedQuery {
	return []namedQuery{
		// charging.go
		{"GetChargingSessionByID", GetChargingSessionByID},
		{"GetChargingSessionsByVehicleID", GetChargingSessionsByVehicleID},
		{"ListChargingSessionsByDateRange", ListChargingSessionsByDateRange},
		{"GetChargingSessionByIDForUpdate", GetChargingSessionByIDForUpdate},
		{"UpsertChargingSession", UpsertChargingSession},
		// export.go
		{"GetExportJobByID", GetExportJobByID},
		{"GetExportJobsByUserID", GetExportJobsByUserID},
		{"GetExportJobByIDForUpdate", GetExportJobByIDForUpdate},
		{"UpsertExportJob", UpsertExportJob},
		// fsm_history.go
		{"InsertFSMTransition", InsertFSMTransition},
		{"GetFSMHistory", GetFSMHistory},
		{"GetFSMHistoryByEntityID", GetFSMHistoryByEntityID},
		// notification.go
		{"GetNotificationByID", GetNotificationByID},
		{"GetNotificationsByUserID", GetNotificationsByUserID},
		{"GetPendingNotifications", GetPendingNotifications},
		{"GetNotificationByIDForUpdate", GetNotificationByIDForUpdate},
		{"UpsertNotification", UpsertNotification},
		// trip.go
		{"GetTripByID", GetTripByID},
		{"GetTripsByVehicleID", GetTripsByVehicleID},
		{"ListTripsByDateRange", ListTripsByDateRange},
		{"GetTripByIDForUpdate", GetTripByIDForUpdate},
		{"UpsertTrip", UpsertTrip},
		// user.go
		{"GetUserByID", GetUserByID},
		{"GetUserByEmail", GetUserByEmail},
		{"UpsertUser", UpsertUser},
		{"DeleteUser", DeleteUser},
		// vehicle.go
		{"GetVehicleByID", GetVehicleByID},
		{"GetVehicleByVIN", GetVehicleByVIN},
		{"GetVehiclesByUserID", GetVehiclesByUserID},
		{"GetVehicleByIDForUpdate", GetVehicleByIDForUpdate},
		{"UpsertVehicle", UpsertVehicle},
		{"DeleteVehicle", DeleteVehicle},
	}
}

// insertQueries lists the write statements whose (column) / VALUES (…) arity
// must line up.
func insertQueries() []namedQuery {
	return []namedQuery{
		{"UpsertChargingSession", UpsertChargingSession},
		{"UpsertExportJob", UpsertExportJob},
		{"InsertFSMTransition", InsertFSMTransition},
		{"UpsertNotification", UpsertNotification},
		{"UpsertTrip", UpsertTrip},
		{"UpsertUser", UpsertUser},
		{"UpsertVehicle", UpsertVehicle},
	}
}

// ── low-level SQL scanners ─────────────────────────────────────────────────

func isWordByte(b byte) bool {
	return b == '_' ||
		(b >= 'a' && b <= 'z') ||
		(b >= 'A' && b <= 'Z') ||
		(b >= '0' && b <= '9')
}

// splitTopLevel splits s on commas that sit at parenthesis depth 0 and outside
// single-quoted string literals.
func splitTopLevel(s string) []string {
	var parts []string
	depth, last := 0, 0
	inStr := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case inStr:
			if c == '\'' {
				inStr = false
			}
		case c == '\'':
			inStr = true
		case c == '(':
			depth++
		case c == ')':
			depth--
		case c == ',' && depth == 0:
			parts = append(parts, strings.TrimSpace(s[last:i]))
			last = i + 1
		}
	}
	if t := strings.TrimSpace(s[last:]); t != "" {
		parts = append(parts, t)
	}
	return parts
}

// firstParenGroup returns the contents of the first balanced (…) group at or
// after index `from`, respecting nested parens and single-quoted literals.
func firstParenGroup(s string, from int) (string, bool) {
	start := -1
	depth := 0
	inStr := false
	for i := from; i < len(s); i++ {
		c := s[i]
		if inStr {
			if c == '\'' {
				inStr = false
			}
			continue
		}
		switch c {
		case '\'':
			inStr = true
		case '(':
			if depth == 0 {
				start = i
			}
			depth++
		case ')':
			depth--
			if depth == 0 && start >= 0 {
				return s[start+1 : i], true
			}
		}
	}
	return "", false
}

// selectList returns the raw column list between the first SELECT and the first
// FROM that sits at paren depth 0 (so subquery FROMs inside LATERAL joins are
// ignored).
func selectList(sql string) string {
	up := strings.ToUpper(sql)
	sidx := strings.Index(up, "SELECT")
	if sidx < 0 {
		return ""
	}
	start := sidx + len("SELECT")
	depth := 0
	inStr := false
	for i := start; i+4 <= len(sql); i++ {
		c := sql[i]
		if inStr {
			if c == '\'' {
				inStr = false
			}
			continue
		}
		switch c {
		case '\'':
			inStr = true
			continue
		case '(':
			depth++
			continue
		case ')':
			depth--
			continue
		}
		if depth != 0 {
			continue
		}
		if strings.EqualFold(sql[i:i+4], "FROM") {
			before := sql[i-1]
			var after byte = ' '
			if i+4 < len(sql) {
				after = sql[i+4]
			}
			if !isWordByte(before) && !isWordByte(after) {
				return sql[start:i]
			}
		}
	}
	return sql[start:]
}

var trailingAliasRe = regexp.MustCompile(`(?is)\bAS\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?\s*$`)
var trailingIdentRe = regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_]*)\s*$`)

// aliasOf resolves the output column name of a single SELECT expression,
// preferring an explicit `AS alias`, else the rightmost identifier.
func aliasOf(part string) string {
	if m := trailingAliasRe.FindStringSubmatch(part); m != nil {
		return strings.ToLower(m[1])
	}
	name := part
	if k := strings.Index(name, "::"); k >= 0 {
		name = name[:k]
	}
	if m := trailingIdentRe.FindStringSubmatch(name); m != nil {
		return strings.ToLower(m[1])
	}
	return strings.ToLower(strings.TrimSpace(part))
}

func selectColumns(sql string) []string {
	list := selectList(sql)
	parts := splitTopLevel(list)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		out = append(out, aliasOf(p))
	}
	return out
}

var placeholderRe = regexp.MustCompile(`\$(\d+)`)

// placeholderNums returns the sorted, de-duplicated set of $N parameter indexes.
func placeholderNums(sql string) []int {
	matches := placeholderRe.FindAllStringSubmatch(sql, -1)
	seen := map[int]bool{}
	var out []int
	for _, m := range matches {
		n, err := strconv.Atoi(m[1])
		if err != nil {
			continue
		}
		if !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}
	sort.Ints(out)
	return out
}

// dbTagSet reflects the non-ignored `db` struct tags of a value.
func dbTagSet(v any) map[string]bool {
	t := reflect.TypeOf(v)
	m := map[string]bool{}
	for i := 0; i < t.NumField(); i++ {
		tag := t.Field(i).Tag.Get("db")
		if tag == "" || tag == "-" {
			continue
		}
		m[strings.Split(tag, ",")[0]] = true
	}
	return m
}

// ── tests ──────────────────────────────────────────────────────────────────

// TestPlaceholdersAreContiguous asserts that every query references a gapless
// run of parameters $1..$N. A gap (as UpsertTrip once had: $1,$2,$14,$15) means
// the statement's max placeholder implies more parameters than the caller
// supplies, so pgx's extended-protocol Bind fails with an arg-count mismatch on
// every call.
func TestPlaceholdersAreContiguous(t *testing.T) {
	for _, q := range allQueries() {
		q := q
		t.Run(q.name, func(t *testing.T) {
			nums := placeholderNums(q.sql)
			if len(nums) == 0 {
				t.Fatalf("%s: expected at least one $N placeholder (parameterised SQL only)", q.name)
			}
			if nums[0] != 1 {
				t.Fatalf("%s: placeholders must start at $1, got $%d first", q.name, nums[0])
			}
			max := nums[len(nums)-1]
			if max != len(nums) {
				t.Errorf("%s: non-contiguous placeholders %v (max $%d but only %d distinct) — Bind will mismatch caller arg count",
					q.name, nums, max, len(nums))
			}
		})
	}
}

// TestInsertColumnArity asserts the column list and the VALUES tuple of every
// write statement have equal arity — a classic off-by-one source.
func TestInsertColumnArity(t *testing.T) {
	for _, q := range insertQueries() {
		q := q
		t.Run(q.name, func(t *testing.T) {
			up := strings.ToUpper(q.sql)
			into := strings.Index(up, "INTO")
			if into < 0 {
				t.Fatalf("%s: no INTO clause", q.name)
			}
			cols, ok := firstParenGroup(q.sql, into)
			if !ok {
				t.Fatalf("%s: could not locate column list", q.name)
			}
			vpos := strings.Index(up, "VALUES")
			if vpos < 0 {
				t.Fatalf("%s: no VALUES clause", q.name)
			}
			vals, ok := firstParenGroup(q.sql, vpos)
			if !ok {
				t.Fatalf("%s: could not locate VALUES tuple", q.name)
			}
			colN := len(splitTopLevel(cols))
			valN := len(splitTopLevel(vals))
			if colN == 0 {
				t.Fatalf("%s: parsed zero columns", q.name)
			}
			if colN != valN {
				t.Errorf("%s: %d columns but %d VALUES expressions\n cols=%q\n vals=%q",
					q.name, colN, valN, cols, vals)
			}
		})
	}
}

// TestParameterisedOnly guards against string-interpolated SQL: no printf verbs,
// no stray statement terminators, and every statement is actually parameterised.
func TestParameterisedOnly(t *testing.T) {
	badTokens := []string{"%s", "%d", "%v", "%q", "%w", "fmt.", "Sprintf"}
	for _, q := range allQueries() {
		q := q
		t.Run(q.name, func(t *testing.T) {
			for _, tok := range badTokens {
				if strings.Contains(q.sql, tok) {
					t.Errorf("%s: contains interpolation token %q — use $N bind params only", q.name, tok)
				}
			}
			if strings.Contains(q.sql, ";") {
				t.Errorf("%s: contains ';' — statements must be single, terminator-free", q.name)
			}
			if !strings.Contains(q.sql, "$1") {
				t.Errorf("%s: no $1 bind parameter found", q.name)
			}
		})
	}
}

// TestWellFormed checks each constant is non-empty, starts with a DML keyword,
// and has balanced parentheses.
func TestWellFormed(t *testing.T) {
	keywords := []string{"SELECT", "INSERT", "UPDATE", "DELETE", "WITH"}
	for _, q := range allQueries() {
		q := q
		t.Run(q.name, func(t *testing.T) {
			trimmed := strings.TrimSpace(q.sql)
			if trimmed == "" {
				t.Fatalf("%s: empty query", q.name)
			}
			upper := strings.ToUpper(trimmed)
			ok := false
			for _, k := range keywords {
				if strings.HasPrefix(upper, k) {
					ok = true
					break
				}
			}
			if !ok {
				t.Errorf("%s: does not start with a DML keyword: %.20q", q.name, trimmed)
			}
			depth := 0
			inStr := false
			for i := 0; i < len(q.sql); i++ {
				c := q.sql[i]
				if inStr {
					if c == '\'' {
						inStr = false
					}
					continue
				}
				switch c {
				case '\'':
					inStr = true
				case '(':
					depth++
				case ')':
					depth--
				}
				if depth < 0 {
					t.Fatalf("%s: unbalanced ')' at index %d", q.name, i)
				}
			}
			if depth != 0 {
				t.Errorf("%s: unbalanced parentheses (net depth %d)", q.name, depth)
			}
			if inStr {
				t.Errorf("%s: unterminated string literal", q.name)
			}
		})
	}
}

// TestSICanonicalUnits enforces ADR-004 SI-on-disk for the migrated
// SI-canonical statements (charging & trips): no imperial/legacy unit suffixes,
// and the expected SI aliases are present. Vehicle statements are intentionally
// excluded — odometer_miles / range_miles are grandfathered legacy columns.
func TestSICanonicalUnits(t *testing.T) {
	siQueries := []namedQuery{
		{"GetChargingSessionByID", GetChargingSessionByID},
		{"UpsertChargingSession", UpsertChargingSession},
		{"GetTripByID", GetTripByID},
		{"UpsertTrip", UpsertTrip},
	}
	// Whole-word imperial/legacy unit endings that must never appear on disk.
	forbidden := regexp.MustCompile(`(?i)(_mi|_mph|_kwh|_kw|_psi|_min|miles|_kmh)\b`)
	for _, q := range siQueries {
		q := q
		t.Run("no_forbidden_units/"+q.name, func(t *testing.T) {
			if loc := forbidden.FindString(q.sql); loc != "" {
				t.Errorf("%s: forbidden imperial/legacy unit token %q — SI columns must use _m/_mps/_wh/_w/_kpa", q.name, loc)
			}
		})
	}

	mustContain := map[string][]string{
		"GetChargingSessionByID": {"energy_added_wh", "max_power_w"},
		"UpsertChargingSession":  {"total_energy_added_wh", "peak_power_w"},
		"GetTripByID":            {"distance_m", "energy_used_wh", "max_speed_mps", "efficiency_wh_per_m"},
	}
	for name, tokens := range mustContain {
		var sql string
		for _, q := range siQueries {
			if q.name == name {
				sql = q.sql
			}
		}
		for _, tok := range tokens {
			tok := tok
			t.Run("has_si_alias/"+name+"/"+tok, func(t *testing.T) {
				if !strings.Contains(sql, tok) {
					t.Errorf("%s: expected SI column/alias %q", name, tok)
				}
			})
		}
	}
}

// TestSelectColumnsMatchStructTags asserts every read query projects exactly the
// column set that pgx.RowToStructByName expects for its destination struct.
// RowToStructByName is a strict bijection: any drift between a SELECT alias and a
// domain `db` tag would fail at scan time against a real database.
func TestSelectColumnsMatchStructTags(t *testing.T) {
	cases := []struct {
		name string
		sql  string
		dst  any
	}{
		{"GetVehicleByID", GetVehicleByID, vehicle.Vehicle{}},
		{"GetVehicleByVIN", GetVehicleByVIN, vehicle.Vehicle{}},
		{"GetVehiclesByUserID", GetVehiclesByUserID, vehicle.Vehicle{}},
		{"GetVehicleByIDForUpdate", GetVehicleByIDForUpdate, vehicle.Vehicle{}},
		{"GetChargingSessionByID", GetChargingSessionByID, charging.ChargingSession{}},
		{"GetChargingSessionsByVehicleID", GetChargingSessionsByVehicleID, charging.ChargingSession{}},
		{"ListChargingSessionsByDateRange", ListChargingSessionsByDateRange, charging.ChargingSession{}},
		{"GetChargingSessionByIDForUpdate", GetChargingSessionByIDForUpdate, charging.ChargingSession{}},
		{"GetTripByID", GetTripByID, trip.Trip{}},
		{"GetTripsByVehicleID", GetTripsByVehicleID, trip.Trip{}},
		{"ListTripsByDateRange", ListTripsByDateRange, trip.Trip{}},
		{"GetTripByIDForUpdate", GetTripByIDForUpdate, trip.Trip{}},
		{"GetExportJobByID", GetExportJobByID, export.ExportJob{}},
		{"GetExportJobsByUserID", GetExportJobsByUserID, export.ExportJob{}},
		{"GetExportJobByIDForUpdate", GetExportJobByIDForUpdate, export.ExportJob{}},
		{"GetNotificationByID", GetNotificationByID, notification.Notification{}},
		{"GetNotificationsByUserID", GetNotificationsByUserID, notification.Notification{}},
		{"GetPendingNotifications", GetPendingNotifications, notification.Notification{}},
		{"GetNotificationByIDForUpdate", GetNotificationByIDForUpdate, notification.Notification{}},
		{"GetUserByID", GetUserByID, user.User{}},
		{"GetUserByEmail", GetUserByEmail, user.User{}},
		{"GetFSMHistory", GetFSMHistory, repository.FSMTransitionRecord{}},
		{"GetFSMHistoryByEntityID", GetFSMHistoryByEntityID, repository.FSMTransitionRecord{}},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			cols := selectColumns(tc.sql)
			want := dbTagSet(tc.dst)
			got := map[string]bool{}
			for _, c := range cols {
				if got[c] {
					t.Errorf("%s: duplicate output column %q", tc.name, c)
				}
				got[c] = true
			}
			for c := range got {
				if !want[c] {
					t.Errorf("%s: SELECT projects %q which has no matching db tag on %T", tc.name, c, tc.dst)
				}
			}
			for w := range want {
				if !got[w] {
					t.Errorf("%s: db tag %q on %T is not projected by the SELECT", tc.name, w, tc.dst)
				}
			}
			if len(got) != len(want) {
				t.Errorf("%s: column count %d != struct field count %d (cols=%v)", tc.name, len(got), len(want), cols)
			}
		})
	}
}

// TestUpsertTripDerivedFieldsNotStored documents the trips-table contract: the
// aggregate's distance/energy/geo fields are derived from joined drives at read
// time, so the write statement persists only the four owned columns.
func TestUpsertTripDerivedFieldsNotStored(t *testing.T) {
	cols, ok := firstParenGroup(UpsertTrip, strings.Index(strings.ToUpper(UpsertTrip), "INTO"))
	if !ok {
		t.Fatal("UpsertTrip: could not parse column list")
	}
	want := []string{"id", "vehicle_id", "started_at", "ended_at"}
	got := splitTopLevel(cols)
	if len(got) != len(want) {
		t.Fatalf("UpsertTrip: expected %d owned columns, got %d (%v)", len(want), len(got), got)
	}
	for i, c := range got {
		if strings.TrimSpace(c) != want[i] {
			t.Errorf("UpsertTrip: column %d = %q, want %q", i, strings.TrimSpace(c), want[i])
		}
	}
	for _, derived := range []string{"distance_m", "energy_used_wh", "max_speed_mps", "start_lat"} {
		if strings.Contains(cols, derived) {
			t.Errorf("UpsertTrip: must not persist derived column %q", derived)
		}
	}
}
