package smartfixture

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Policy applies the production policy migration to a schema containing only
// the feature tables needed by the suite.
func Policy(t *testing.T, pool *pgxpool.Pool, direction string) {
	t.Helper()
	for _, statement := range policyStatements(t, direction) {
		if table, ok := alterTable(statement); ok {
			var exists bool
			if err := pool.QueryRow(t.Context(), `SELECT to_regclass($1) IS NOT NULL`, table).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if !exists {
				continue
			}
		}
		execPolicy(t, pool, statement)
	}
}

func PolicyColumns(t *testing.T, pool *pgxpool.Pool, tables ...string) {
	t.Helper()
	statements := policyStatements(t, "up")
	for _, table := range tables {
		found := false
		for _, statement := range statements {
			if name, ok := alterTable(statement); ok && name == table {
				execPolicy(t, pool, statement)
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("policy migration does not extend %s", table)
		}
	}
}

func policyStatements(t *testing.T, direction string) []string {
	t.Helper()
	content, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000319_smart_feature_preferences."+direction+".sql"))
	if err != nil {
		t.Fatal(err)
	}
	return strings.Split(strings.TrimSpace(string(content)), ";\n")
}

func alterTable(statement string) (string, bool) {
	fields := strings.Fields(statement)
	if len(fields) >= 3 && fields[0] == "ALTER" && fields[1] == "TABLE" {
		return fields[2], true
	}
	return "", false
}

func execPolicy(t *testing.T, pool *pgxpool.Pool, statement string) {
	t.Helper()
	if _, err := pool.Exec(t.Context(), statement); err != nil {
		t.Fatalf("apply smart feature policy: %v", err)
	}
}
