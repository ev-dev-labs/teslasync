package main

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestValidateTarget(t *testing.T) {
	for _, tt := range []struct {
		dsn   string
		valid bool
	}{
		{"postgres://localhost/teslasync_charging_repair_test", true},
		{"postgres://127.0.0.1/teslasync_charging_repair_test", true},
		{"postgres://[::1]/teslasync_charging_repair_test", true},
		{"postgres://localhost/teslasync", false},
		{"postgres://database.example/teslasync_charging_repair_test", false},
		{"host=127.0.0.1,remote.example dbname=teslasync_charging_repair_test", false},
	} {
		t.Run(tt.dsn, func(t *testing.T) {
			cfg, err := pgxpool.ParseConfig(tt.dsn)
			if err != nil {
				t.Fatal(err)
			}
			if err := validateTarget(cfg); (err == nil) != tt.valid {
				t.Fatalf("validateTarget() = %v; valid=%v", err, tt.valid)
			}
		})
	}
}
