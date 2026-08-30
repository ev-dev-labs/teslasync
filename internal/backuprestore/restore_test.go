package backuprestore

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/backupverify"
)

// Pure-Go coverage. The schema-dependent behaviour — scratch reset,
// identity overriding, dependency ordering against the real catalog —
// lives in restore_realschema_test.go and runs against the actual
// migrated database, because a simplified fixture schema
// (`CREATE TABLE vehicles (id BIGINT PRIMARY KEY)`) cannot reproduce
// either seeded rows or GENERATED ALWAYS identity columns and therefore
// proved nothing about a real restore.

type fakeVerifier struct {
	result *backupverify.Result
	err    error
}

func (f fakeVerifier) VerifyLatest(context.Context) (*backupverify.Result, error) {
	return f.result, f.err
}

func TestRowCount(t *testing.T) {
	got, err := rowCount(json.RawMessage(`[{"id":1},{"id":2}]`))
	if err != nil || got != 2 {
		t.Fatalf("rowCount() = %d, %v; want 2, nil", got, err)
	}
	if _, err := rowCount(json.RawMessage(`{"id":1}`)); err == nil {
		t.Fatal("rowCount() accepted a non-array table payload")
	}
}

func TestScratchDatabaseName(t *testing.T) {
	for _, name := range []string{"teslasync_drill_restored", "weekly_restore_drill"} {
		if !scratchDatabaseName.MatchString(name) {
			t.Fatalf("scratch database name %q was rejected", name)
		}
	}
	for _, name := range []string{"teslasync", "production", "restored"} {
		if scratchDatabaseName.MatchString(name) {
			t.Fatalf("non-scratch database name %q was accepted", name)
		}
	}
}

// TestInsertStatementUsesOverridingSystemValue pins the exact SQL shape
// the real schema requires.
//
// `vehicles`, `alert_rules`, `geofences`, and `notification_channels`
// all declare `id bigint GENERATED ALWAYS AS IDENTITY`. Importing an
// artifact's explicit primary keys into such a table without
// OVERRIDING SYSTEM VALUE fails with
// "cannot insert a non-DEFAULT value into column id" — which is what
// made every production-artifact drill fail.
func TestInsertStatementUsesOverridingSystemValue(t *testing.T) {
	identity := scratchTable{
		name:           "vehicles",
		columns:        []string{"id", "vin", "display_name"},
		identityAlways: true,
	}
	got := identity.insertStatement()
	want := `INSERT INTO "vehicles" ("id", "vin", "display_name") OVERRIDING SYSTEM VALUE ` +
		`SELECT "id", "vin", "display_name" FROM json_populate_recordset(NULL::"vehicles", $1::json)`
	if got != want {
		t.Errorf("identity table statement:\n got: %s\nwant: %s", got, want)
	}

	// The clause is not free: on a table with no ALWAYS identity column
	// PostgreSQL rejects OVERRIDING SYSTEM VALUE outright, so it must be
	// emitted only where it is required.
	plain := scratchTable{name: "drives", columns: []string{"id", "vehicle_id"}}
	if strings.Contains(plain.insertStatement(), "OVERRIDING") {
		t.Errorf("non-identity table got an OVERRIDING clause: %s", plain.insertStatement())
	}
}

// TestInsertStatementQuotesEveryIdentifier guards the injection
// boundary: table and column names arrive from the catalog and are the
// only interpolated parts of the statement.
func TestInsertStatementQuotesEveryIdentifier(t *testing.T) {
	table := scratchTable{name: `we"ird`, columns: []string{`co"l`, "ok"}}
	got := table.insertStatement()
	if !strings.Contains(got, `"we""ird"`) || !strings.Contains(got, `"co""l"`) {
		t.Errorf("identifiers were not escaped: %s", got)
	}
	if strings.Count(got, "$1") != 1 {
		t.Errorf("the artifact payload must be the only bind parameter: %s", got)
	}
}

// TestTopologicalOrderPlacesParentsFirst covers the ordering that lets
// the reset run with foreign keys still enforced: parents are inserted
// first, and the reverse of this order deletes children first.
func TestTopologicalOrderPlacesParentsFirst(t *testing.T) {
	tables := []string{"trip_drives", "vehicles", "alert_rules", "drives", "trips", "settings"}
	parents := map[string]map[string]bool{
		"trip_drives": {"drives": true, "trips": true},
		"alert_rules": {"vehicles": true},
		"vehicles":    {},
		"drives":      {},
		"trips":       {},
		"settings":    {},
	}
	ordered, err := topologicalOrder(tables, parents)
	if err != nil {
		t.Fatalf("topologicalOrder() error = %v", err)
	}
	if len(ordered) != len(tables) {
		t.Fatalf("ordered %d tables, want %d: %v", len(ordered), len(tables), ordered)
	}
	position := map[string]int{}
	for i, table := range ordered {
		position[table] = i
	}
	for child, deps := range parents {
		for parent := range deps {
			if position[parent] >= position[child] {
				t.Errorf("%s (parent) is ordered after %s (child): %v", parent, child, ordered)
			}
		}
	}
	// Deterministic across runs so drill evidence stays comparable.
	again, err := topologicalOrder(
		[]string{"settings", "vehicles", "drives", "trips", "alert_rules", "trip_drives"}, parents)
	if err != nil {
		t.Fatalf("second topologicalOrder() error = %v", err)
	}
	if strings.Join(again, ",") != strings.Join(ordered, ",") {
		t.Errorf("order is input-dependent: %v vs %v", ordered, again)
	}
}

// TestTopologicalOrderRejectsCycles: silently picking an order would
// produce a restore whose foreign keys are wrong in a way no row count
// can detect.
func TestTopologicalOrderRejectsCycles(t *testing.T) {
	_, err := topologicalOrder([]string{"a", "b"}, map[string]map[string]bool{
		"a": {"b": true},
		"b": {"a": true},
	})
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("topologicalOrder() error = %v, want an explicit cycle rejection", err)
	}
}

func TestQuoteLiteralEscapesQuotes(t *testing.T) {
	if got := quoteLiteral("it's"); got != "'it''s'" {
		t.Errorf("quoteLiteral() = %s, want 'it''s'", got)
	}
}

func TestRestorerRejectsVerifierFailure(t *testing.T) {
	restorer := &Restorer{verifier: fakeVerifier{err: errors.New("bad artifact")}}
	result, err := restorer.Run(context.Background(), "guard", nil)
	if err == nil || result == nil || result.Error == "" {
		t.Fatalf("Run() = %+v, %v; want an explicit configuration failure", result, err)
	}
}

func TestRestorerRejectsUnconfiguredPools(t *testing.T) {
	result, err := (&Restorer{}).Run(context.Background(), "guard", nil)
	if err == nil || !strings.Contains(err.Error(), "not configured") {
		t.Fatalf("Run() error = %v, want a configuration rejection", err)
	}
	if result == nil || result.OK {
		t.Fatalf("result = %+v, want a failed result", result)
	}
}
