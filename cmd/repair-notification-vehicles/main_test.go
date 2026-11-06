package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestRepairRejectsProductionTargets(t *testing.T) {
	for _, tc := range []struct {
		dsn string
		ok  bool
	}{
		{"postgres://localhost/teslasync", false},
		{"postgres://production/teslasync_notification_repair_copy", false},
		{"host=localhost,production dbname=teslasync_notification_repair_copy", false},
		{"postgres://localhost/teslasync_notification_repair_copy", true},
		{"postgres://127.0.0.1/teslasync_notification_repair_test", true},
	} {
		cfg, err := pgxpool.ParseConfig(tc.dsn)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateTarget(cfg); (err == nil) != tc.ok {
			t.Errorf("target acceptance: got %v, want %v", err, tc.ok)
		}
	}
}
