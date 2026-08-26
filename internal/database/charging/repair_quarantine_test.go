package charging

import (
	"encoding/json"
	"errors"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database/repairsnapshot"
)

func validChargingQuarantinePayload(t *testing.T) json.RawMessage {
	t.Helper()
	row := make(map[string]any, len(chargingSnapshotColumns))
	for _, column := range chargingSnapshotColumns {
		row[column] = nil
	}
	row["id"] = int64(11)
	row["vehicle_id"] = int64(3)
	row["started_at"] = time.Date(2026, 8, 25, 12, 0, 0, 0, time.UTC)
	row["cost_decimal"] = json.Number("12.3400")
	payload, err := json.Marshal(map[string]any{
		"schema_version":   1,
		"charging_session": row,
	})
	if err != nil {
		t.Fatalf("marshal payload: %v", err)
	}
	return payload
}

func TestParseChargingQuarantineSnapshotAcceptsCurrentSIShape(t *testing.T) {
	t.Parallel()

	session, err := parseChargingQuarantineSnapshot(validChargingQuarantinePayload(t))
	if err != nil {
		t.Fatalf("parseChargingQuarantineSnapshot: %v", err)
	}
	if session.ID != 11 || session.VehicleID != 3 || session.CostDecimal == nil ||
		session.CostDecimal.String() != "12.3400" {
		t.Fatalf("unexpected parsed charging session: %+v", session)
	}
}

func TestParseChargingQuarantineSnapshotRejectsMissingRateProvenance(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	if err := json.Unmarshal(validChargingQuarantinePayload(t), &payload); err != nil {
		t.Fatal(err)
	}
	delete(payload["charging_session"].(map[string]any), "cost_source")
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	_, err = parseChargingQuarantineSnapshot(raw)
	if !errors.Is(err, repairsnapshot.ErrMalformedPayload) {
		t.Fatalf("error = %v, want malformed payload", err)
	}
}

func TestParseChargingQuarantineSnapshotPreservesPostgresSpecialFloat(t *testing.T) {
	t.Parallel()

	var payload map[string]any
	if err := json.Unmarshal(validChargingQuarantinePayload(t), &payload); err != nil {
		t.Fatal(err)
	}
	payload["charging_session"].(map[string]any)["peak_power_w"] = "Infinity"
	raw, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}
	session, err := parseChargingQuarantineSnapshot(raw)
	if err != nil {
		t.Fatalf("parse special float snapshot: %v", err)
	}
	if session.PeakPowerW == nil || !math.IsInf(float64(*session.PeakPowerW), 1) {
		t.Fatalf("peak_power_w = %v, want +Inf", session.PeakPowerW)
	}
}

func TestChargingSnapshotAndRestoreSQLShape(t *testing.T) {
	t.Parallel()

	for _, required := range []string{
		"FROM charging_sessions c",
		"FOR UPDATE",
		"'schema_version', 1",
		"'charging_session', to_jsonb(c)",
	} {
		if !strings.Contains(snapshotChargingForQuarantineSQL, required) {
			t.Errorf("snapshot SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"OVERRIDING SYSTEM VALUE",
		"geofence_id",
		"rate_id",
		"cost_source",
		"ON CONFLICT (id) DO NOTHING",
	} {
		if !strings.Contains(restoreChargingParentSQL, required) {
			t.Errorf("restore SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"last_value, is_called",
	} {
		if !strings.Contains(chargingSequenceStateSQL, required) {
			t.Errorf("sequence state SQL missing %q", required)
		}
	}
	for _, required := range []string{
		"pg_get_serial_sequence('charging_sessions', 'id')",
		"GREATEST($1, (SELECT last_value FROM charging_sessions_id_seq))",
	} {
		if !strings.Contains(advanceChargingSequenceSQL, required) {
			t.Errorf("sequence SQL missing %q", required)
		}
	}
}
