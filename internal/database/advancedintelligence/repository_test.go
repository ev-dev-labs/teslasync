package advancedintelligence

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	port "github.com/ev-dev-labs/teslasync/internal/port/advancedintelligence"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type fakeRow struct {
	values []interface{}
	err    error
}

func (r fakeRow) Scan(destinations ...interface{}) error {
	if r.err != nil {
		return r.err
	}
	if len(destinations) != len(r.values) {
		return errors.New("scan destination count mismatch")
	}
	for i := range destinations {
		destination := reflect.ValueOf(destinations[i])
		if destination.Kind() != reflect.Pointer || destination.IsNil() {
			return errors.New("scan destination is not a pointer")
		}
		target := destination.Elem()
		if r.values[i] == nil {
			target.Set(reflect.Zero(target.Type()))
			continue
		}
		value := reflect.ValueOf(r.values[i])
		if value.Type().AssignableTo(target.Type()) {
			target.Set(value)
			continue
		}
		if value.Type().ConvertibleTo(target.Type()) {
			target.Set(value.Convert(target.Type()))
			continue
		}
		return errors.New("scan value is not assignable")
	}
	return nil
}

type fakeDBTX struct {
	row       pgx.Row
	lastQuery string
	lastArgs  []interface{}
}

func (f *fakeDBTX) Exec(
	context.Context, string, ...interface{},
) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}

func (f *fakeDBTX) Query(
	context.Context, string, ...interface{},
) (pgx.Rows, error) {
	return nil, errors.New("unexpected query")
}

func (f *fakeDBTX) QueryRow(
	_ context.Context, query string, args ...interface{},
) pgx.Row {
	f.lastQuery = query
	f.lastArgs = append([]interface{}(nil), args...)
	return f.row
}

func modelCardRow(
	subject string,
	version int,
	budget, spent float64,
) fakeRow {
	now := time.Date(2026, 8, 5, 12, 0, 0, 0, time.UTC)
	return fakeRow{values: []interface{}{
		int64(1), subject, int64(7), "local efficiency", "v1",
		"efficiency", version, budget, spent, 2,
		(*int)(nil), (*float64)(nil), (*string)(nil), now, now,
	}}
}

func TestCreateRoundEnforcesSubjectScopeAndVersionConflict(t *testing.T) {
	tx := &fakeDBTX{row: modelCardRow("subject-a", 3, 1, 0.2)}
	repository := &DurableRepository{
		withTx: func(ctx context.Context, fn func(database.DBTX) error) error {
			return fn(tx)
		},
	}
	_, _, err := repository.CreateRound(context.Background(), port.CreateRoundParams{
		Subject: "subject-a", VehicleID: 7, ModelName: "local efficiency",
		ModelVersion: "v1", Task: "efficiency", Epsilon: 0.1,
		EpsilonBudget: 1, ExpectedVersion: 2, SampleCount: 10,
		Status: "completed", Now: time.Now().UTC(),
	})
	if !errors.Is(err, port.ErrConflict) {
		t.Fatalf("error = %v, want ErrConflict", err)
	}
	if !strings.Contains(tx.lastQuery, "subject = $1") ||
		!strings.Contains(tx.lastQuery, "vehicle_id = $2") {
		t.Fatalf("lock query is not subject and vehicle scoped: %s", tx.lastQuery)
	}
	if len(tx.lastArgs) < 2 || tx.lastArgs[0] != "subject-a" || tx.lastArgs[1] != int64(7) {
		t.Fatalf("scope args = %#v", tx.lastArgs)
	}
}

func TestCreateRoundRejectsExhaustedPrivacyBudget(t *testing.T) {
	tx := &fakeDBTX{row: modelCardRow("subject-a", 3, 1, 0.95)}
	repository := &DurableRepository{
		withTx: func(ctx context.Context, fn func(database.DBTX) error) error {
			return fn(tx)
		},
	}
	_, _, err := repository.CreateRound(context.Background(), port.CreateRoundParams{
		Subject: "subject-a", VehicleID: 7, ModelName: "local efficiency",
		ModelVersion: "v1", Task: "efficiency", Epsilon: 0.1,
		EpsilonBudget: 1, ExpectedVersion: 3, SampleCount: 10,
		Status: "completed", Now: time.Now().UTC(),
	})
	if !errors.Is(err, port.ErrPrivacyBudgetExhausted) {
		t.Fatalf("error = %v, want privacy budget exhausted", err)
	}
}

func TestNewSchemaAndStructsUseSITagsOnly(t *testing.T) {
	root := repositoryRoot(t)
	files := []string{
		filepath.Join(root, "internal", "domain", "advancedintelligence", "common.go"),
		filepath.Join(root, "internal", "domain", "advancedintelligence", "twin_firmware.go"),
		filepath.Join(root, "internal", "domain", "advancedintelligence", "survival_security_charging.go"),
		filepath.Join(root, "internal", "domain", "advancedintelligence", "planning.go"),
		filepath.Join(root, "internal", "domain", "advancedintelligence", "federated_causal_tco.go"),
		filepath.Join(root, "internal", "port", "advancedintelligence", "records.go"),
		filepath.Join(root, "migrations", "000224_advanced_intelligence.up.sql"),
	}
	tagPattern := regexp.MustCompile(`(?:json|db):"([^"]+)"`)
	forbidden := regexp.MustCompile(`(?i)(?:_mi|_km|_mph|_kwh|_kw|_min|_sec|_psi|_bar)(?:_|$)`)
	for _, file := range files {
		content, err := os.ReadFile(file)
		if err != nil {
			t.Fatalf("read %s: %v", file, err)
		}
		if strings.HasSuffix(file, ".sql") {
			if forbidden.Match(content) {
				t.Fatalf("legacy unit suffix found in migration %s", file)
			}
			if regexp.MustCompile(`(?i)\bjsonb\b`).Match(content) {
				t.Fatalf("known-shape JSONB found in migration %s", file)
			}
			continue
		}
		for _, match := range tagPattern.FindAllSubmatch(content, -1) {
			if forbidden.Match(match[1]) {
				t.Fatalf("legacy unit suffix in tag %q in %s", match[1], file)
			}
		}
	}
}

func TestSourceRepositoryHasNoForbiddenLegacyTableReferences(t *testing.T) {
	root := repositoryRoot(t)
	content, err := os.ReadFile(filepath.Join(
		root, "internal", "database", "advancedintelligence", "source_repository.go",
	))
	if err != nil {
		t.Fatal(err)
	}
	forbidden := []string{
		"positions",
		"battery_snapshots",
		"charging_telemetry",
		"state_snapshots",
		"climate_snapshots",
		"tire_pressure_snapshots",
		"vehicle_live_state",
		"security_snapshots",
		"media_state",
		"vehicle_config_snapshots",
		"location_snapshots",
		"safety_snapshots",
		"user_preference_snapshots",
		"signal_history",
	}
	lower := strings.ToLower(string(content))
	for _, table := range forbidden {
		if strings.Contains(lower, table) {
			t.Fatalf("forbidden legacy table reference %q", table)
		}
	}
}

func TestMigrationDefinesOnlyTypedDurableTables(t *testing.T) {
	root := repositoryRoot(t)
	up, err := os.ReadFile(filepath.Join(root, "migrations", "000224_advanced_intelligence.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile(filepath.Join(root, "migrations", "000224_advanced_intelligence.down.sql"))
	if err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{
		"advanced_federated_model_cards",
		"advanced_federated_rounds",
		"advanced_causal_experiments",
		"advanced_causal_results",
	} {
		if !strings.Contains(string(up), "CREATE TABLE IF NOT EXISTS "+table) {
			t.Fatalf("up migration missing table %s", table)
		}
		if !strings.Contains(string(down), "DROP TABLE IF EXISTS "+table) {
			t.Fatalf("down migration missing table %s", table)
		}
	}
}

func TestDomainAndApplicationRemainAdapterAndOTelFree(t *testing.T) {
	root := repositoryRoot(t)
	for _, directory := range []string{
		filepath.Join(root, "internal", "domain", "advancedintelligence"),
		filepath.Join(root, "internal", "app", "advancedintelligencesvc"),
	} {
		err := filepath.WalkDir(directory, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") ||
				strings.HasSuffix(path, "_test.go") {
				return nil
			}
			content, readErr := os.ReadFile(path)
			if readErr != nil {
				return readErr
			}
			for _, forbidden := range []string{
				"go.opentelemetry.io/",
				"internal/database/",
				"internal/handler/",
			} {
				if strings.Contains(string(content), forbidden) {
					t.Fatalf("%s imports forbidden dependency %q", path, forbidden)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatalf("walk %s: %v", directory, err)
		}
	}
}

func repositoryRoot(t *testing.T) string {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve current test file")
	}
	return filepath.Clean(filepath.Join(filepath.Dir(current), "..", "..", ".."))
}
