package benchmark

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	models "github.com/ev-dev-labs/teslasync/internal/models/benchmark"
)

func TestMigrationPrivacyContract(t *testing.T) {
	upPath := filepath.Join("..", "..", "..", "migrations", "000220_privacy_benchmarks.up.sql")
	downPath := filepath.Join("..", "..", "..", "migrations", "000220_privacy_benchmarks.down.sql")
	up, err := os.ReadFile(upPath)
	if err != nil {
		t.Fatal(err)
	}
	down, err := os.ReadFile(downPath)
	if err != nil {
		t.Fatal(err)
	}
	sql := strings.ToLower(string(up))
	for _, forbidden := range []string{"jsonb", "latitude", "longitude", "raw_trip", "raw_vin"} {
		if strings.Contains(sql, forbidden) {
			t.Fatalf("migration contains forbidden raw/known-schema storage token %q", forbidden)
		}
	}
	for _, required := range []string{
		"privacy_benchmark_consents",
		"privacy_benchmark_contributions",
		"privacy_benchmark_releases",
		"privacy_benchmark_release_metrics",
		"privacy_benchmark_release_bins",
		"privacy_benchmark_release_memberships",
		"privacy_benchmark_privacy_ledger",
		"source_version_hash",
		"epsilon_spent",
	} {
		if !strings.Contains(sql, required) {
			t.Fatalf("migration missing %q", required)
		}
		if !strings.Contains(strings.ToLower(string(down)), "drop table if exists") {
			t.Fatal("down migration is not idempotent")
		}
	}
}

func TestPrivacyBenchmarkModelTagsAreSnakeCaseAndSubjectIsHidden(t *testing.T) {
	typ := reflect.TypeOf(models.PrivacyBenchmarkConsent{})
	subject, _ := typ.FieldByName("Subject")
	if subject.Tag.Get("json") != "-" {
		t.Fatalf("Subject JSON tag=%q want hidden", subject.Tag.Get("json"))
	}
	for _, fieldName := range []string{"VehicleID", "EpsilonBudget", "OptedInAt", "RevokedAt"} {
		field, ok := typ.FieldByName(fieldName)
		if !ok {
			t.Fatalf("missing field %s", fieldName)
		}
		jsonTag := field.Tag.Get("json")
		dbTag := field.Tag.Get("db")
		if jsonTag != dbTag || strings.ToLower(jsonTag) != jsonTag {
			t.Fatalf("%s tags misaligned: db=%q json=%q", fieldName, dbTag, jsonTag)
		}
	}
}
