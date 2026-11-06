package datarepair

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func correctionTestTableDDL(t *testing.T, migration, table string) string {
	t.Helper()
	path := filepath.Join("..", "..", "..", "migrations", migration)
	contents, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	sql := string(contents)
	start := strings.Index(sql, "CREATE TABLE "+table+" (")
	if start < 0 {
		t.Fatalf("%s does not contain %s", path, table)
	}
	end := strings.Index(sql[start:], "\n);")
	if end < 0 {
		t.Fatalf("%s has no end for %s", path, table)
	}
	return sql[start : start+end+3]
}

func correctionPostgresFixture(t *testing.T) (*database.DB, *DataRepairHandler) {
	t.Helper()
	dsn := os.Getenv("TESLASYNC_DATA_REPAIR_TEST_DSN")
	if dsn == "" {
		t.Skip("TESLASYNC_DATA_REPAIR_TEST_DSN is not set; skipping isolated PostgreSQL correction test")
	}
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if config.ConnConfig.Host != "127.0.0.1" ||
		config.ConnConfig.Database != "teslasync_datarepair_test" ||
		config.ConnConfig.Port == 5432 {
		t.Fatal("correction integration tests require the dedicated local test database on a non-default port")
	}
	ctx := context.Background()
	admin, err := pgx.ConnectConfig(ctx, config.ConnConfig)
	if err != nil {
		t.Fatal(err)
	}
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		if closeErr := admin.Close(ctx); closeErr != nil {
			t.Errorf("close isolated test connection: %v", closeErr)
		}
		t.Fatal(err)
	}
	schema := "repair_test_" + hex.EncodeToString(random[:])
	identifier := pgx.Identifier{schema}.Sanitize()
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+identifier); err != nil {
		if closeErr := admin.Close(ctx); closeErr != nil {
			t.Errorf("close isolated test connection: %v", closeErr)
		}
		t.Fatal(err)
	}
	if config.ConnConfig.RuntimeParams == nil {
		config.ConnConfig.RuntimeParams = make(map[string]string)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema
	config.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		if _, cleanupErr := admin.Exec(ctx, "DROP SCHEMA "+identifier+" CASCADE"); cleanupErr != nil {
			t.Errorf("drop isolated test schema: %v", cleanupErr)
		}
		if closeErr := admin.Close(ctx); closeErr != nil {
			t.Errorf("close isolated test connection: %v", closeErr)
		}
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		if _, err := admin.Exec(ctx, "DROP SCHEMA "+identifier+" CASCADE"); err != nil {
			t.Errorf("drop isolated test schema: %v", err)
		}
		if err := admin.Close(ctx); err != nil {
			t.Errorf("close isolated test connection: %v", err)
		}
	})
	for _, spec := range [][2]string{
		{"000185_drives_si.up.sql", "drives"},
		{"000184_charging_si.up.sql", "charging_sessions"},
		{"000142_baseline_typed.up.sql", "audit_logs"},
	} {
		if _, err := pool.Exec(ctx, correctionTestTableDDL(t, spec[0], spec[1])); err != nil {
			t.Fatalf("create %s: %v", spec[1], err)
		}
	}
	if _, err := pool.Exec(ctx, `
		ALTER TABLE charging_sessions ADD COLUMN rate_id bigint,
			ADD COLUMN cost_source text CHECK (cost_source IS NULL OR cost_source IN
				('manual', 'tesla_actual', 'geofence_tariff', 'default_estimate', 'unknown'));
		ALTER TABLE audit_logs ADD COLUMN ip text, ADD COLUMN user_agent text;`); err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "migrations", "000231_data_repair_cases.up.sql"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("apply case migration: %v", err)
	}
	db := &database.DB{Pool: pool}
	handler := NewDataRepairHandler(db)
	handler.clock = func() time.Time { return testNow }
	return db, handler
}

func insertCorrectionCase(
	t *testing.T, db *database.DB, id, vehicleID, sessionID int64,
	kind, rule, status string, relatedID *int64, startedAt, endedAt time.Time,
) time.Time {
	t.Helper()
	var updated time.Time
	err := db.Pool.QueryRow(context.Background(), `
		INSERT INTO data_repair_cases (
			id, fingerprint, kind, session_id, related_session_id, vehicle_id, rule, confidence, status,
			evidence_started_at, evidence_stored_ended_at, evidence_contradiction_ts,
			evidence_contradiction_src, evidence_contradiction_field, evidence_contradiction_value,
			applicable, blocked_reason
		) VALUES ($1, $2, $3, $4, $5, $6, $7, 'high', $8, $9, $10, $10,
			'drives', 'measurement', 'test observation', false, 'structural_anomaly_requires_manual_correction')
		RETURNING updated_at`,
		id, fmt.Sprintf("%064x", id), kind, sessionID, relatedID, vehicleID, rule, status, startedAt, endedAt,
	).Scan(&updated)
	if err != nil {
		t.Fatal(err)
	}
	return updated
}

func postgresCorrectionPreview(t *testing.T, h *DataRepairHandler, id int64, body string) caseCorrectionPreview {
	t.Helper()
	path := fmt.Sprintf("/data-repair/cases/%d/correction-preview", id)
	rec := doCaseRequest(t, h, http.MethodPost, path, strings.NewReader(body))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview status %d: %s", rec.Code, rec.Body.String())
	}
	var preview caseCorrectionPreview
	if err := json.Unmarshal(rec.Body.Bytes(), &preview); err != nil {
		t.Fatal(err)
	}
	return preview
}

func TestCaseCorrectionsAgainstIsolatedPostgres(t *testing.T) {
	db, handler := correctionPostgresFixture(t)
	ctx := context.Background()
	start := testNow.Add(-4 * time.Hour)
	end := start.Add(time.Hour)

	t.Run("duration commit and active queue", func(t *testing.T) {
		if _, err := db.Pool.Exec(ctx, `INSERT INTO drives
			(id, vehicle_id, started_at, ended_at, duration_s) VALUES (10, 10, $1, $2, 900)`, start, end); err != nil {
			t.Fatal(err)
		}
		updated := insertCorrectionCase(t, db, 101, 10, 10, "drive", "duration_mismatch", "open", nil, start, end)
		preview := postgresCorrectionPreview(t, handler, 101, correctionRequestBody(updated, "duration_s", "derive", nil, ""))
		if len(preview.Changes) != 1 || *preview.Changes[0].After != 3600 {
			t.Fatalf("unexpected duration preview: %+v", preview)
		}
		tx, err := db.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := datarepairdb.NewCorrectionRepo(db).GetSource(ctx, tx, datarepairdb.AnomalyKindDrive, 10, true); err != nil {
			t.Fatal(err)
		}
		blockedTx, err := db.Pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := blockedTx.Exec(ctx, `SET LOCAL lock_timeout = '200ms'`); err != nil {
			t.Fatal(err)
		}
		_, blockedErr := blockedTx.Exec(ctx, `UPDATE drives SET duration_s=901 WHERE id=10`)
		if blockedErr == nil {
			t.Fatal("a concurrent writer passed the source row lock")
		}
		if err := blockedTx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		body := correctionRequestBody(updated, "duration_s", "derive", nil, preview.SourceHash)
		rec := doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/101/correction", strings.NewReader(body))
		if rec.Code != http.StatusOK {
			t.Fatalf("apply status %d: %s", rec.Code, rec.Body.String())
		}
		var duration int64
		var status string
		var audits int
		if err := db.Pool.QueryRow(ctx, `SELECT duration_s FROM drives WHERE id=10`).Scan(&duration); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool.QueryRow(ctx, `SELECT status FROM data_repair_cases WHERE id=101`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs`).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if duration != 3600 || status != "applied" || audits != 2 {
			t.Fatalf("duration=%d status=%s audits=%d", duration, status, audits)
		}
		rec = doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/101/correction", strings.NewReader(body))
		if rec.Code != http.StatusConflict {
			t.Fatalf("reapplying a closed case must conflict: %d %s", rec.Code, rec.Body.String())
		}
		insertCorrectionCase(t, db, 102, 10, 10, "drive", "negative_aggregate_distance_m", "open", nil, start, end)
		insertCorrectionCase(t, db, 103, 10, 10, "drive", "negative_aggregate_energy_used_wh", "in_review", nil, start, end)
		rec = doCaseRequest(t, handler, http.MethodGet, "/data-repair/cases?status=active", nil)
		var list repairCaseListResponse
		if rec.Code != http.StatusOK || json.Unmarshal(rec.Body.Bytes(), &list) != nil || len(list.Cases) != 2 {
			t.Fatalf("active list status=%d body=%s", rec.Code, rec.Body.String())
		}
		for _, repairCase := range list.Cases {
			if repairCase.Status != "open" && repairCase.Status != "in_review" {
				t.Fatalf("terminal case in active queue: %+v", repairCase)
			}
		}
	})

	t.Run("charging estimate and nulls", func(t *testing.T) {
		if _, err := db.Pool.Exec(ctx, `INSERT INTO charging_sessions
			(id, vehicle_id, started_at, ended_at, total_energy_added_wh, cost_decimal, cost_currency, cost_source, rate_id)
			VALUES (20, 20, $1, $2, -100, 4.1250, 'USD', 'default_estimate', 9)`, start, end); err != nil {
			t.Fatal(err)
		}
		updated := insertCorrectionCase(t, db, 201, 20, 20, "charging", "negative_aggregate_total_energy_added_wh", "open", nil, start, end)
		corrected := 1200.0
		preview := postgresCorrectionPreview(t, handler, 201, correctionRequestBody(updated, "total_energy_added_wh", "replace", &corrected, ""))
		if len(preview.Changes) != 3 || preview.Changes[1].BeforeText == nil || *preview.Changes[1].BeforeText != "4.1250" {
			t.Fatalf("estimated cost must be exactly represented in preview: %+v", preview)
		}
		body := correctionRequestBody(updated, "total_energy_added_wh", "replace", &corrected, preview.SourceHash)
		rec := doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/201/correction", strings.NewReader(body))
		if rec.Code != http.StatusOK {
			t.Fatalf("apply status %d: %s", rec.Code, rec.Body.String())
		}
		var energy float64
		var cost *string
		var source string
		var rateID int64
		if err := db.Pool.QueryRow(ctx, `SELECT total_energy_added_wh, cost_decimal::text, cost_source, rate_id
			FROM charging_sessions WHERE id=20`).Scan(&energy, &cost, &source, &rateID); err != nil {
			t.Fatal(err)
		}
		if energy != corrected || cost != nil || source != "unknown" || rateID != 9 {
			t.Fatalf("energy=%v cost=%v source=%s rate=%d", energy, cost, source, rateID)
		}

		if _, err := db.Pool.Exec(ctx, `INSERT INTO drives
			(id, vehicle_id, started_at, ended_at, regen_energy_wh) VALUES (21, 21, $1, $2, -50)`, start, end); err != nil {
			t.Fatal(err)
		}
		updated = insertCorrectionCase(t, db, 202, 21, 21, "drive", "negative_aggregate_regen_energy_wh", "open", nil, start, end)
		preview = postgresCorrectionPreview(t, handler, 202, correctionRequestBody(updated, "regen_energy_wh", "clear", nil, ""))
		body = correctionRequestBody(updated, "regen_energy_wh", "clear", nil, preview.SourceHash)
		rec = doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/202/correction", strings.NewReader(body))
		if rec.Code != http.StatusOK {
			t.Fatalf("clear status %d: %s", rec.Code, rec.Body.String())
		}
		var unknown *float64
		if err := db.Pool.QueryRow(ctx, `SELECT regen_energy_wh FROM drives WHERE id=21`).Scan(&unknown); err != nil || unknown != nil {
			t.Fatalf("cleared energy must be SQL NULL: value=%v error=%v", unknown, err)
		}
	})

	t.Run("audit failure rolls back every write", func(t *testing.T) {
		if _, err := db.Pool.Exec(ctx, `INSERT INTO drives
			(id, vehicle_id, started_at, ended_at, duration_s) VALUES (30, 30, $1, $2, 900)`, start, end); err != nil {
			t.Fatal(err)
		}
		updated := insertCorrectionCase(t, db, 301, 30, 30, "drive", "duration_mismatch", "open", nil, start, end)
		preview := postgresCorrectionPreview(t, handler, 301, correctionRequestBody(updated, "duration_s", "derive", nil, ""))
		calls := 0
		failing := NewDataRepairHandler(db, WithAuditFunc(func(ctx context.Context, tx database.DBTX, entry auditEntry) error {
			calls++
			if calls == 2 {
				return errors.New("injected audit failure")
			}
			return insertAuditLog(tx, ctx, testNow, entry)
		}))
		failing.clock = func() time.Time { return testNow }
		body := correctionRequestBody(updated, "duration_s", "derive", nil, preview.SourceHash)
		rec := doCaseRequest(t, failing, http.MethodPost, "/data-repair/cases/301/correction", strings.NewReader(body))
		if rec.Code != http.StatusInternalServerError {
			t.Fatalf("audit failure status %d: %s", rec.Code, rec.Body.String())
		}
		var duration int64
		var status string
		var audits int
		if err := db.Pool.QueryRow(ctx, `SELECT duration_s FROM drives WHERE id=30`).Scan(&duration); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool.QueryRow(ctx, `SELECT status FROM data_repair_cases WHERE id=301`).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if err := db.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_logs WHERE entity_id IN (30,301)`).Scan(&audits); err != nil {
			t.Fatal(err)
		}
		if duration != 900 || status != "open" || audits != 0 {
			t.Fatalf("rollback failed: duration=%d status=%s audits=%d", duration, status, audits)
		}
	})

	t.Run("related boundary rechecks both tables", func(t *testing.T) {
		driveStart := start.Add(30 * time.Minute)
		driveEnd := start.Add(60 * time.Minute)
		chargeEnd := start.Add(45 * time.Minute)
		if _, err := db.Pool.Exec(ctx, `INSERT INTO drives (id, vehicle_id, started_at, ended_at, duration_s)
			VALUES (40, 40, $1, $2, 1800)`, driveStart, driveEnd); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Pool.Exec(ctx, `INSERT INTO charging_sessions (id, vehicle_id, started_at, ended_at)
			VALUES (41, 40, $1, $2)`, start, chargeEnd); err != nil {
			t.Fatal(err)
		}
		relatedID := int64(41)
		updated := insertCorrectionCase(t, db, 401, 40, 40, "drive", "cross_kind_overlap_drive_charging", "open", &relatedID, driveStart, driveEnd)
		request := func(hash string) string {
			fields := map[string]interface{}{
				"expected_updated_at": updated.Format(time.RFC3339Nano), "field": "ended_at",
				"mode": "boundary", "target": "related", "ended_at": driveStart.Format(time.RFC3339Nano),
			}
			if hash != "" {
				fields["expected_source_hash"] = hash
			}
			encoded, err := json.Marshal(fields)
			if err != nil {
				t.Fatal(err)
			}
			return string(encoded)
		}
		preview := postgresCorrectionPreview(t, handler, 401, request(""))
		if preview.Kind != "charging" || preview.SessionID != 41 || preview.Other == nil || preview.Other.ID != 40 {
			t.Fatalf("related session preview: %+v", preview)
		}
		if _, err := db.Pool.Exec(ctx, `INSERT INTO drives (id, vehicle_id, started_at, ended_at)
			VALUES (42, 40, $1, $2)`, start.Add(10*time.Minute), start.Add(20*time.Minute)); err != nil {
			t.Fatal(err)
		}
		rec := doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/401/correction", strings.NewReader(request(preview.SourceHash)))
		if rec.Code != http.StatusConflict {
			t.Fatalf("new overlap must conflict: %d %s", rec.Code, rec.Body.String())
		}
		if _, err := db.Pool.Exec(ctx, `DELETE FROM drives WHERE id=42 AND vehicle_id=40`); err != nil {
			t.Fatal(err)
		}
		rec = doCaseRequest(t, handler, http.MethodPost, "/data-repair/cases/401/correction", strings.NewReader(request(preview.SourceHash)))
		if rec.Code != http.StatusOK {
			t.Fatalf("related boundary apply: %d %s", rec.Code, rec.Body.String())
		}
		var got time.Time
		if err := db.Pool.QueryRow(ctx, `SELECT ended_at FROM charging_sessions WHERE id=41`).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if !got.Equal(driveStart) {
			t.Fatalf("related end = %s, want %s", got, driveStart)
		}
	})
}
