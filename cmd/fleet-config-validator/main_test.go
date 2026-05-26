package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTemp(t *testing.T, name, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	return path
}

const goodFleetConfig = `{
  "host": "0.0.0.0",
  "port": 4443,
  "tls": { "server_cert": "/certs/server.crt", "server_key": "/certs/server.key" },
  "mqtt": { "broker": "mosquitto:1883", "client_id": "x", "topic_base": "telemetry", "qos": 1 },
  "records": { "V": ["mqtt"], "alerts": ["mqtt"] }
}`

const goodRouting = `routes:
  - field: VehicleSpeed
    dest: positions
    column: speed_mps
  - field: InsideTemp
    dest: climate_snapshot
    column: inside_temp_c
`

func TestValidate_HappyPath(t *testing.T) {
	fleetPath := writeTemp(t, "fleet.json", goodFleetConfig)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, err := validate(fleetPath, routingPath, false, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !r.OK {
		t.Errorf("expected OK, got failures: %+v", r.Failures)
	}
}

func TestValidate_PortOutOfRange(t *testing.T) {
	cfg := strings.Replace(goodFleetConfig, `"port": 4443`, `"port": 22`, 1)
	fleetPath := writeTemp(t, "fleet.json", cfg)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure for privileged port")
	}
	if !hasRule(r.Failures, "port_range") {
		t.Errorf("missing port_range failure: %+v", r.Failures)
	}
}

func TestValidate_BrokerWithScheme(t *testing.T) {
	cfg := strings.Replace(goodFleetConfig, `"mosquitto:1883"`, `"tcp://mosquitto:1883"`, 1)
	fleetPath := writeTemp(t, "fleet.json", cfg)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure for scheme-prefixed broker")
	}
	if !hasRule(r.Failures, "mqtt_broker_format") {
		t.Errorf("missing mqtt_broker_format failure: %+v", r.Failures)
	}
}

func TestValidate_RecordsVMissing(t *testing.T) {
	cfg := strings.Replace(goodFleetConfig,
		`"records": { "V": ["mqtt"], "alerts": ["mqtt"] }`,
		`"records": { "alerts": ["mqtt"] }`, 1)
	fleetPath := writeTemp(t, "fleet.json", cfg)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure when records.V missing")
	}
	if !hasRule(r.Failures, "records_v_missing") {
		t.Errorf("missing records_v_missing failure: %+v", r.Failures)
	}
}

func TestValidate_RoutingDuplicateField(t *testing.T) {
	dup := `routes:
  - field: VehicleSpeed
    dest: positions
    column: speed_mps
  - field: VehicleSpeed
    dest: drive_telemetry
    column: speed_mps
`
	fleetPath := writeTemp(t, "fleet.json", goodFleetConfig)
	routingPath := writeTemp(t, "routing.yaml", dup)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure for duplicate field")
	}
	if !hasRule(r.Failures, "field_duplicate") {
		t.Errorf("missing field_duplicate failure: %+v", r.Failures)
	}
}

func TestValidate_RoutingUnknownDest(t *testing.T) {
	bad := `routes:
  - field: VehicleSpeed
    dest: positons
`
	fleetPath := writeTemp(t, "fleet.json", goodFleetConfig)
	routingPath := writeTemp(t, "routing.yaml", bad)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure for typo in dest")
	}
	if !hasRule(r.Failures, "dest_unknown") {
		t.Errorf("missing dest_unknown failure: %+v", r.Failures)
	}
}

func TestValidate_FleetConfigMissing(t *testing.T) {
	_, err := validate("/does/not/exist.json", "", false, false)
	if err == nil {
		t.Error("expected IO error for missing file")
	}
}

func TestValidate_JSONParseError(t *testing.T) {
	fleetPath := writeTemp(t, "fleet.json", `{ not json`)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, _ := validate(fleetPath, routingPath, false, false)
	if r.OK {
		t.Error("expected failure on malformed JSON")
	}
	if !hasRule(r.Failures, "json_parse") {
		t.Errorf("missing json_parse failure: %+v", r.Failures)
	}
}

func TestValidate_StrictDestUnused(t *testing.T) {
	fleetPath := writeTemp(t, "fleet.json", goodFleetConfig)
	routingPath := writeTemp(t, "routing.yaml", goodRouting)
	r, _ := validate(fleetPath, routingPath, false, true)
	if r.OK {
		t.Error("expected failure for unused destinations in strict mode")
	}
	if !hasRule(r.Failures, "dest_unused") {
		t.Errorf("missing dest_unused failure: %+v", r.Failures)
	}
}

func hasRule(fs []failure, rule string) bool {
	for _, f := range fs {
		if f.Rule == rule {
			return true
		}
	}
	return false
}
