package position

import (
	"context"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Pure-Go tests for the map-based insert path. buildInsertFromMap is the pure
// SQL/arg builder extracted from insertRowFromMap so the placeholder generation,
// column ordering, and injection-safety can be verified without a live pool.

// ---------- sortedKeys ----------

func TestSortedKeys(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   map[string]any
		want []string
	}{
		{"nil_map", nil, []string{}},
		{"empty_map", map[string]any{}, []string{}},
		{"single", map[string]any{"speed_mps": 1}, []string{"speed_mps"}},
		{
			"multiple_sorted_ascending",
			map[string]any{"speed_mps": 1, "altitude_m": 2, "heading_deg": 3},
			[]string{"altitude_m", "heading_deg", "speed_mps"},
		},
		{
			"already_sorted_stable",
			map[string]any{"a": 1, "b": 2, "c": 3},
			[]string{"a", "b", "c"},
		},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := sortedKeys(tt.in)
			if len(got) != len(tt.want) {
				t.Fatalf("sortedKeys(%v) = %v, want %v", tt.in, got, tt.want)
			}
			for i := range tt.want {
				if got[i] != tt.want[i] {
					t.Errorf("sortedKeys(%v)[%d] = %q, want %q", tt.in, i, got[i], tt.want[i])
				}
			}
		})
	}
}

// TestSortedKeys_Deterministic proves the sort removes Go's map-iteration
// randomness: the same logical map produces byte-identical ordering every time.
func TestSortedKeys_Deterministic(t *testing.T) {
	t.Parallel()
	m := map[string]any{"z": 1, "m": 2, "a": 3, "q": 4, "b": 5}
	first := sortedKeys(m)
	for i := 0; i < 50; i++ {
		got := sortedKeys(m)
		if !reflect.DeepEqual(got, first) {
			t.Fatalf("sortedKeys non-deterministic: %v vs %v", got, first)
		}
	}
}

// ---------- buildInsertFromMap ----------

func TestBuildInsertFromMap_QueryAndArgs(t *testing.T) {
	t.Parallel()
	ts := time.Date(2026, 7, 4, 12, 0, 0, 0, time.UTC)
	row := map[string]any{"speed_mps": 12.0, "altitude_m": 5.0}

	q, args := buildInsertFromMap("positions", 42, ts, row)

	// Columns: identity pair first, then sorted map keys.
	wantQ := "INSERT INTO positions (vehicle_id,ts,altitude_m,speed_mps) VALUES ($1,$2,$3,$4)"
	if q != wantQ {
		t.Errorf("query =\n  %q\nwant\n  %q", q, wantQ)
	}

	if len(args) != 4 {
		t.Fatalf("len(args) = %d, want 4", len(args))
	}
	if got, ok := args[0].(int64); !ok || got != 42 {
		t.Errorf("args[0] = %v, want int64(42)", args[0])
	}
	if got, ok := args[1].(time.Time); !ok || !got.Equal(ts) {
		t.Errorf("args[1] = %v, want %v", args[1], ts)
	}
	if got, ok := args[2].(float64); !ok || got != 5.0 {
		t.Errorf("args[2] altitude_m = %v, want 5.0", args[2])
	}
	if got, ok := args[3].(float64); !ok || got != 12.0 {
		t.Errorf("args[3] speed_mps = %v, want 12.0", args[3])
	}
}

func TestBuildInsertFromMap_SingleColumn(t *testing.T) {
	t.Parallel()
	ts := time.Now().UTC()
	q, args := buildInsertFromMap("positions", 1, ts, map[string]any{"gps_state": "good"})

	wantQ := "INSERT INTO positions (vehicle_id,ts,gps_state) VALUES ($1,$2,$3)"
	if q != wantQ {
		t.Errorf("query = %q, want %q", q, wantQ)
	}
	if len(args) != 3 {
		t.Fatalf("len(args) = %d, want 3", len(args))
	}
	if args[2] != "good" {
		t.Errorf("args[2] = %v, want \"good\"", args[2])
	}
}

// TestBuildInsertFromMap_PlaceholderCount pins the "$N count == column count"
// invariant across a range of widths — a mismatch is the classic cause of a
// "got N parameters, expected M" runtime failure.
func TestBuildInsertFromMap_PlaceholderCount(t *testing.T) {
	t.Parallel()
	for n := 1; n <= 6; n++ {
		row := make(map[string]any, n)
		for i := 0; i < n; i++ {
			row[fmt.Sprintf("col_%02d", i)] = i
		}
		q, args := buildInsertFromMap("positions", 1, time.Now().UTC(), row)

		wantCols := n + 2 // + vehicle_id + ts
		if got := strings.Count(q, "$"); got != wantCols {
			t.Errorf("n=%d: placeholder count = %d, want %d\nquery: %s", n, got, wantCols, q)
		}
		if len(args) != wantCols {
			t.Errorf("n=%d: len(args) = %d, want %d", n, len(args), wantCols)
		}
		// Placeholders must run $1..$wantCols in order.
		for i := 1; i <= wantCols; i++ {
			if !strings.Contains(q, fmt.Sprintf("$%d", i)) {
				t.Errorf("n=%d: query missing placeholder $%d\nquery: %s", n, i, q)
			}
		}
	}
}

// TestBuildInsertFromMap_Deterministic proves the generated SQL does not depend
// on Go map iteration order — critical for prepared-statement cache stability.
func TestBuildInsertFromMap_Deterministic(t *testing.T) {
	t.Parallel()
	ts := time.Now().UTC()
	row := map[string]any{"d": 4, "a": 1, "c": 3, "b": 2}
	first, _ := buildInsertFromMap("positions", 1, ts, row)
	for i := 0; i < 50; i++ {
		got, _ := buildInsertFromMap("positions", 1, ts, row)
		if got != first {
			t.Fatalf("query non-deterministic:\n  %q\n  %q", got, first)
		}
	}
}

// TestBuildInsertFromMap_ValuesAreParameterized is the injection-safety guard:
// a hostile map VALUE must travel only through the args slice and never appear
// as literal SQL text.
func TestBuildInsertFromMap_ValuesAreParameterized(t *testing.T) {
	t.Parallel()
	malicious := "'; DROP TABLE positions; --"
	q, args := buildInsertFromMap("positions", 1, time.Now().UTC(),
		map[string]any{"gps_state": malicious})

	if strings.Contains(q, "DROP TABLE") {
		t.Errorf("value leaked into SQL text: %s", q)
	}
	found := false
	for _, a := range args {
		if a == malicious {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("malicious value not carried as a bound argument: %v", args)
	}
}

// ---------- early-return paths (never touch the pool) ----------

func TestInsertFromMap_EmptyReturnsNil(t *testing.T) {
	t.Parallel()
	// nil Pool is intentional: the empty guard must return before pool access.
	r := NewPositionRepo(&database.DB{})
	ctx := context.Background()

	if err := r.InsertFromMap(ctx, 1, time.Now().UTC(), nil); err != nil {
		t.Errorf("InsertFromMap(nil row) = %v, want nil", err)
	}
	if err := r.InsertFromMap(ctx, 1, time.Now().UTC(), map[string]any{}); err != nil {
		t.Errorf("InsertFromMap(empty row) = %v, want nil", err)
	}
}

func TestInsertRowFromMap_EmptyReturnsNil(t *testing.T) {
	t.Parallel()
	db := &database.DB{}
	ctx := context.Background()

	if err := insertRowFromMap(ctx, db, "positions", 1, time.Now().UTC(), nil); err != nil {
		t.Errorf("insertRowFromMap(nil row) = %v, want nil", err)
	}
	if err := insertRowFromMap(ctx, db, "positions", 1, time.Now().UTC(), map[string]any{}); err != nil {
		t.Errorf("insertRowFromMap(empty row) = %v, want nil", err)
	}
}
