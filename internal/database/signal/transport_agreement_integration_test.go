package signal

import (
	"context"
	"fmt"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestTransportEvidenceRetainsCanonicalKeyAcrossOrigins(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DSN or DATABASE_URL is required for PostgreSQL integration coverage")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	const upsert = `
INSERT INTO signal_log (
    vehicle_id, ts, field, value_kind, float_value,
    normalization_version, normalization_write_token,
    ingest_origin, source_emitted_at, received_at, provenance_write_token
) VALUES ($1, $2, $3, 6, $4, 1, TRUE, $5, $2, $6, TRUE)
ON CONFLICT (vehicle_id, ts, field) DO UPDATE SET
    value_kind = EXCLUDED.value_kind,
    str_value = NULL,
    bool_value = NULL,
    int_value = NULL,
    float_value = EXCLUDED.float_value,
    time_value = NULL,
    normalization_version = EXCLUDED.normalization_version,
    normalization_write_token = NOT COALESCE(signal_log.normalization_write_token, FALSE),
    ingest_origin = EXCLUDED.ingest_origin,
    source_emitted_at = EXCLUDED.source_emitted_at,
    received_at = EXCLUDED.received_at,
    provenance_write_token = NOT COALESCE(signal_log.provenance_write_token, FALSE)`

	vehicleID := -time.Now().UnixNano()
	sourceAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	field := fmt.Sprintf("__transport_agreement_%d", -vehicleID)
	observations := []struct {
		origin     string
		value      float64
		receivedAt time.Time
	}{
		{"fleet_telemetry_http", 42.25, sourceAt.Add(time.Second)},
		{"fleet_telemetry_mqtt", 42.50, sourceAt.Add(2 * time.Second)},
	}
	for _, observation := range observations {
		if _, err := tx.Exec(
			ctx,
			upsert,
			vehicleID,
			sourceAt,
			field,
			observation.value,
			observation.origin,
			observation.receivedAt,
		); err != nil {
			t.Fatalf("upsert %s observation: %v", observation.origin, err)
		}
	}

	var canonicalCount int
	if err := tx.QueryRow(
		ctx,
		`SELECT count(*) FROM signal_log
		  WHERE vehicle_id = $1 AND ts = $2 AND field = $3`,
		vehicleID,
		sourceAt,
		field,
	).Scan(&canonicalCount); err != nil {
		t.Fatalf("count canonical rows: %v", err)
	}
	if canonicalCount != 1 {
		t.Fatalf("canonical rows = %d, want 1", canonicalCount)
	}

	rows, err := tx.Query(
		ctx,
		`SELECT ingest_origin, float_value
		   FROM signal_transport_evidence
		  WHERE vehicle_id = $1 AND source_emitted_at = $2 AND field = $3
		  ORDER BY ingest_origin`,
		vehicleID,
		sourceAt,
		field,
	)
	if err != nil {
		t.Fatalf("query transport evidence: %v", err)
	}
	defer rows.Close()

	got := make(map[string]float64)
	for rows.Next() {
		var origin string
		var value float64
		if err := rows.Scan(&origin, &value); err != nil {
			t.Fatalf("scan transport evidence: %v", err)
		}
		got[origin] = value
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("transport evidence rows: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("transport evidence origins = %v, want two independent rows", got)
	}
	for _, observation := range observations {
		if got[observation.origin] != observation.value {
			t.Errorf("%s value = %v, want %v", observation.origin, got[observation.origin], observation.value)
		}
	}
}

func TestTransportEvidenceConflictSelectsOneCompleteNormalizationTuple(t *testing.T) {
	dsn := os.Getenv("TESLASYNC_TEST_DSN")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TESLASYNC_TEST_DSN or DATABASE_URL is required for PostgreSQL integration coverage")
	}

	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect to PostgreSQL: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close(ctx) })

	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin transaction: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(ctx) })

	const upsert = `
INSERT INTO signal_log (
    vehicle_id, ts, field, value_kind, str_value, bool_value, int_value,
    float_value, time_value, normalization_version, normalization_write_token,
    ingest_origin, source_emitted_at, received_at, provenance_write_token
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, TRUE, $11, $2, $12, TRUE)
ON CONFLICT (vehicle_id, ts, field) DO UPDATE SET
    value_kind = EXCLUDED.value_kind,
    str_value = EXCLUDED.str_value,
    bool_value = EXCLUDED.bool_value,
    int_value = EXCLUDED.int_value,
    float_value = EXCLUDED.float_value,
    time_value = EXCLUDED.time_value,
    normalization_version = EXCLUDED.normalization_version,
    normalization_write_token = NOT COALESCE(signal_log.normalization_write_token, FALSE),
    ingest_origin = EXCLUDED.ingest_origin,
    source_emitted_at = EXCLUDED.source_emitted_at,
    received_at = EXCLUDED.received_at,
    provenance_write_token = NOT COALESCE(signal_log.provenance_write_token, FALSE)`

	type evidenceTuple struct {
		valueKind            int16
		strValue             *string
		boolValue            *bool
		intValue             *int64
		floatValue           *float64
		timeValue            *time.Time
		normalizationVersion int
		receivedAt           time.Time
	}

	vehicleID := -time.Now().UnixNano()
	sourceAt := time.Now().UTC().Add(-time.Minute).Truncate(time.Microsecond)
	field := fmt.Sprintf("__transport_order_%d", -vehicleID)
	origin := "fleet_telemetry_mqtt"
	write := func(normalizationVersion any, tuple evidenceTuple) {
		t.Helper()
		if _, err := tx.Exec(
			ctx,
			upsert,
			vehicleID,
			sourceAt,
			field,
			tuple.valueKind,
			tuple.strValue,
			tuple.boolValue,
			tuple.intValue,
			tuple.floatValue,
			tuple.timeValue,
			normalizationVersion,
			origin,
			tuple.receivedAt,
		); err != nil {
			t.Fatalf("upsert normalization %v evidence: %v", normalizationVersion, err)
		}
	}
	read := func() evidenceTuple {
		t.Helper()
		var got evidenceTuple
		if err := tx.QueryRow(
			ctx,
			`SELECT value_kind, str_value, bool_value, int_value, float_value, time_value,
			        normalization_version, received_at
			   FROM signal_transport_evidence
			  WHERE vehicle_id = $1
			    AND source_emitted_at = $2
			    AND field = $3
			    AND ingest_origin = $4`,
			vehicleID,
			sourceAt,
			field,
			origin,
		).Scan(
			&got.valueKind,
			&got.strValue,
			&got.boolValue,
			&got.intValue,
			&got.floatValue,
			&got.timeValue,
			&got.normalizationVersion,
			&got.receivedAt,
		); err != nil {
			t.Fatalf("read transport evidence: %v", err)
		}
		return got
	}
	assertTuple := func(stage string, want evidenceTuple) {
		t.Helper()
		got := read()
		if got.valueKind != want.valueKind ||
			!equalOptional(got.strValue, want.strValue) ||
			!equalOptional(got.boolValue, want.boolValue) ||
			!equalOptional(got.intValue, want.intValue) ||
			!equalOptional(got.floatValue, want.floatValue) ||
			!equalOptionalTime(got.timeValue, want.timeValue) ||
			got.normalizationVersion != want.normalizationVersion ||
			!got.receivedAt.Equal(want.receivedAt) {
			t.Fatalf("%s tuple = %+v, want %+v", stage, got, want)
		}
	}

	v2Value := 200.0
	v2 := evidenceTuple{
		valueKind:            6,
		floatValue:           &v2Value,
		normalizationVersion: 2,
		receivedAt:           sourceAt.Add(2 * time.Second),
	}
	write(v2.normalizationVersion, v2)

	delayedV1Value := int64(100)
	delayedV1 := evidenceTuple{
		valueKind:            4,
		intValue:             &delayedV1Value,
		normalizationVersion: 1,
		receivedAt:           sourceAt.Add(3 * time.Second),
	}
	write(delayedV1.normalizationVersion, delayedV1)
	assertTuple("after delayed lower version", v2)

	unknownValue := "unknown-version"
	unknown := evidenceTuple{
		valueKind:  1,
		strValue:   &unknownValue,
		receivedAt: sourceAt.Add(4 * time.Second),
	}
	write(nil, unknown)
	assertTuple("after unknown version", v2)

	laterV2Value := "later-v2"
	laterV2 := evidenceTuple{
		valueKind:            1,
		strValue:             &laterV2Value,
		normalizationVersion: 2,
		receivedAt:           sourceAt.Add(5 * time.Second),
	}
	write(laterV2.normalizationVersion, laterV2)
	assertTuple("after later equal version", v2)

	earlierV2Value := "earlier-v2"
	earlierV2 := evidenceTuple{
		valueKind:            1,
		strValue:             &earlierV2Value,
		normalizationVersion: 2,
		receivedAt:           sourceAt.Add(time.Second),
	}
	write(earlierV2.normalizationVersion, earlierV2)
	assertTuple("after earlier equal version", earlierV2)

	tiedV2Value := true
	tiedV2 := evidenceTuple{
		valueKind:            2,
		boolValue:            &tiedV2Value,
		normalizationVersion: 2,
		receivedAt:           earlierV2.receivedAt,
	}
	write(tiedV2.normalizationVersion, tiedV2)
	assertTuple("after exact-time equal-version replay", earlierV2)

	v3Value := sourceAt.Add(30 * time.Second)
	v3 := evidenceTuple{
		valueKind:            9,
		timeValue:            &v3Value,
		normalizationVersion: 3,
		receivedAt:           sourceAt.Add(6 * time.Second),
	}
	write(v3.normalizationVersion, v3)
	assertTuple("after higher version", v3)
}

func equalOptional[T comparable](left, right *T) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func equalOptionalTime(left, right *time.Time) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return left.Equal(*right)
}
