package database

import (
	"regexp"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// buildPartialUpdate
// ---------------------------------------------------------------------------

func TestBuildPartialUpdate_MultipleValidFields(t *testing.T) {
	allowed := map[string]string{
		"speed_avg": "speed_avg",
		"distance":  "distance",
	}
	fields := map[string]interface{}{
		"speed_avg": 65.5,
		"distance":  123.4,
	}

	query, args := buildPartialUpdate("drives", 42, fields, allowed)

	if query == "" {
		t.Fatal("expected non-empty query")
	}
	if !strings.HasPrefix(query, "UPDATE drives SET ") {
		t.Errorf("unexpected prefix: %s", query)
	}
	// 2 field args + 1 id arg
	if len(args) != 3 {
		t.Fatalf("expected 3 args, got %d", len(args))
	}
	// Last arg is always the id
	if args[len(args)-1] != int64(42) {
		t.Errorf("expected last arg=42, got %v", args[len(args)-1])
	}
	// WHERE clause should reference $3
	if !strings.Contains(query, "WHERE id=$3") {
		t.Errorf("expected WHERE id=$3, got %s", query)
	}
	// Both column names must appear in SET clause
	if !strings.Contains(query, "speed_avg=$") {
		t.Errorf("missing speed_avg in query: %s", query)
	}
	if !strings.Contains(query, "distance=$") {
		t.Errorf("missing distance in query: %s", query)
	}
}

func TestBuildPartialUpdate_SingleField(t *testing.T) {
	allowed := map[string]string{"cost": "cost"}
	fields := map[string]interface{}{"cost": 12.50}

	query, args := buildPartialUpdate("charging_sessions", 7, fields, allowed)

	if query == "" {
		t.Fatal("expected non-empty query")
	}
	want := "UPDATE charging_sessions SET cost=$1 WHERE id=$2"
	if query != want {
		t.Errorf("query = %q, want %q", query, want)
	}
	if len(args) != 2 {
		t.Fatalf("expected 2 args, got %d", len(args))
	}
	if args[0] != 12.50 {
		t.Errorf("args[0] = %v, want 12.50", args[0])
	}
	if args[1] != int64(7) {
		t.Errorf("args[1] = %v, want 7", args[1])
	}
}

func TestBuildPartialUpdate_SkipsDisallowedFields(t *testing.T) {
	allowed := map[string]string{
		"speed_avg": "speed_avg",
		"distance":  "distance",
	}
	fields := map[string]interface{}{
		"speed_avg": 65.5,
		"hacked":    "drop table",
	}

	query, args := buildPartialUpdate("drives", 1, fields, allowed)

	if query == "" {
		t.Fatal("expected non-empty query (speed_avg is allowed)")
	}
	// Only speed_avg should be in the SET clause, not "hacked"
	if strings.Contains(query, "hacked") {
		t.Errorf("disallowed field 'hacked' appeared in query: %s", query)
	}
	// 1 field + 1 id
	if len(args) != 2 {
		t.Errorf("expected 2 args, got %d", len(args))
	}
}

func TestBuildPartialUpdate_NoMatchingFields(t *testing.T) {
	allowed := map[string]string{"speed_avg": "speed_avg"}
	fields := map[string]interface{}{"unknown_field": 42}

	query, args := buildPartialUpdate("drives", 1, fields, allowed)

	if query != "" {
		t.Errorf("expected empty query for no matching fields, got %q", query)
	}
	if args != nil {
		t.Errorf("expected nil args, got %v", args)
	}
}

func TestBuildPartialUpdate_EmptyFields(t *testing.T) {
	allowed := map[string]string{"speed_avg": "speed_avg"}
	fields := map[string]interface{}{}

	query, args := buildPartialUpdate("drives", 1, fields, allowed)

	if query != "" {
		t.Errorf("expected empty query for empty fields, got %q", query)
	}
	if args != nil {
		t.Errorf("expected nil args, got %v", args)
	}
}

func TestBuildPartialUpdate_EmptyAllowed(t *testing.T) {
	allowed := map[string]string{}
	fields := map[string]interface{}{"speed_avg": 65.5}

	query, args := buildPartialUpdate("drives", 1, fields, allowed)

	if query != "" {
		t.Errorf("expected empty query for empty allowed, got %q", query)
	}
	if args != nil {
		t.Errorf("expected nil args, got %v", args)
	}
}

func TestBuildPartialUpdate_ColumnMapping(t *testing.T) {
	// Verify that keys and columns can differ (json key → DB column)
	allowed := map[string]string{
		"json_name": "db_column",
	}
	fields := map[string]interface{}{
		"json_name": "value",
	}

	query, args := buildPartialUpdate("tbl", 99, fields, allowed)

	want := "UPDATE tbl SET db_column=$1 WHERE id=$2"
	if query != want {
		t.Errorf("query = %q, want %q", query, want)
	}
	if args[0] != "value" {
		t.Errorf("args[0] = %v, want 'value'", args[0])
	}
}

func TestBuildPartialUpdate_ParameterIndexing(t *testing.T) {
	// With N allowed fields all present, params should be $1..$N for SET
	// and $N+1 for the WHERE id clause.
	allowed := map[string]string{
		"a": "a",
		"b": "b",
		"c": "c",
	}
	fields := map[string]interface{}{
		"a": 1,
		"b": 2,
		"c": 3,
	}

	query, args := buildPartialUpdate("t", 10, fields, allowed)

	// 3 fields + 1 id = 4 args
	if len(args) != 4 {
		t.Fatalf("expected 4 args, got %d", len(args))
	}
	if args[len(args)-1] != int64(10) {
		t.Errorf("last arg should be id=10, got %v", args[len(args)-1])
	}
	// WHERE should reference $4
	if !strings.Contains(query, "WHERE id=$4") {
		t.Errorf("expected WHERE id=$4, got %s", query)
	}
	// Should contain $1, $2, $3 in SET clause
	for i := 1; i <= 3; i++ {
		if !strings.Contains(query, "$"+string(rune('0'+i))) {
			t.Errorf("expected $%d in query: %s", i, query)
		}
	}
}

func TestBuildPartialUpdate_NilValues(t *testing.T) {
	// nil values should be passed through (e.g. for NULL updates)
	allowed := map[string]string{"end_date": "end_date"}
	fields := map[string]interface{}{"end_date": nil}

	query, args := buildPartialUpdate("drives", 5, fields, allowed)

	if query == "" {
		t.Fatal("expected non-empty query for nil value")
	}
	if args[0] != nil {
		t.Errorf("expected nil arg, got %v", args[0])
	}
}

func TestBuildPartialUpdate_SQLSafety(t *testing.T) {
	// Column names come from the allowed map (developer-controlled),
	// not from user input. Verify no user field names leak into the SQL.
	allowed := map[string]string{"safe": "safe_col"}
	fields := map[string]interface{}{
		"safe":                  42,
		"Robert'; DROP TABLE--": "evil",
	}

	query, _ := buildPartialUpdate("tbl", 1, fields, allowed)

	if strings.Contains(query, "DROP") {
		t.Errorf("SQL injection in query: %s", query)
	}
	if strings.Contains(query, "Robert") {
		t.Errorf("user input leaked into query: %s", query)
	}
}

// ---------------------------------------------------------------------------
// Validate the actual allowed-field maps used by drive and charging repos
// ---------------------------------------------------------------------------

func TestDrivePartialAllowed_Valid(t *testing.T) {
	if len(drivePartialAllowed) == 0 {
		t.Fatal("drivePartialAllowed is empty")
	}
	colRe := regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	for key, col := range drivePartialAllowed {
		if key == "" {
			t.Error("empty key in drivePartialAllowed")
		}
		if col == "" {
			t.Errorf("empty column for key %q", key)
		}
		if !colRe.MatchString(col) {
			t.Errorf("column %q doesn't look like a valid SQL identifier", col)
		}
	}
}

// ---------------------------------------------------------------------------
// ptrStr / ptrFloat
// ---------------------------------------------------------------------------

func TestPtrStr_Nil(t *testing.T) {
	if got := ptrStr(nil); got != "" {
		t.Errorf("ptrStr(nil) = %q, want empty", got)
	}
}

func TestPtrStr_Value(t *testing.T) {
	s := "hello"
	if got := ptrStr(&s); got != "hello" {
		t.Errorf("ptrStr(&hello) = %q, want hello", got)
	}
}

func TestPtrStr_Empty(t *testing.T) {
	s := ""
	if got := ptrStr(&s); got != "" {
		t.Errorf("ptrStr(&empty) = %q, want empty", got)
	}
}

func TestPtrFloat_Nil(t *testing.T) {
	if got := ptrFloat(nil); got != 0 {
		t.Errorf("ptrFloat(nil) = %v, want 0", got)
	}
}

func TestPtrFloat_Value(t *testing.T) {
	f := 3.14
	if got := ptrFloat(&f); got != 3.14 {
		t.Errorf("ptrFloat(&3.14) = %v, want 3.14", got)
	}
}

func TestPtrFloat_Zero(t *testing.T) {
	f := 0.0
	if got := ptrFloat(&f); got != 0 {
		t.Errorf("ptrFloat(&0) = %v, want 0", got)
	}
}
