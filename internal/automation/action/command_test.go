package action

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// --- Mocks ---

type mockVehicleRepo struct {
	vehicles []*models.Vehicle
	byID     map[int64]*models.Vehicle
	err      error
}

func (m *mockVehicleRepo) GetByID(_ context.Context, id int64) (*models.Vehicle, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.byID[id], nil
}

func (m *mockVehicleRepo) GetAll(_ context.Context) ([]*models.Vehicle, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.vehicles, nil
}

type mockCommandLogRepo struct {
	logs []*models.CommandLog
	err  error
}

func (m *mockCommandLogRepo) Create(_ context.Context, cl *models.CommandLog) error {
	if m.err != nil {
		return m.err
	}
	m.logs = append(m.logs, cl)
	return nil
}

type mockSettingsChecker struct {
	suspended    bool
	suspendErr   error
	pollingCfg   *models.PollingConfig
	pollingErr   error
}

func (m *mockSettingsChecker) IsAPISuspended(_ context.Context) (bool, error) {
	return m.suspended, m.suspendErr
}

func (m *mockSettingsChecker) GetPollingConfig(_ context.Context) (*models.PollingConfig, error) {
	if m.pollingErr != nil {
		return nil, m.pollingErr
	}
	return m.pollingCfg, nil
}

type mockTeslaCommander struct {
	hasToken   bool
	sendErr    error
	sendErrFor map[string]error // per-VIN errors
	calls      []sendCall
}

type sendCall struct {
	VIN     string
	Command string
	Params  map[string]interface{}
}

func (m *mockTeslaCommander) HasValidToken() bool {
	return m.hasToken
}

func (m *mockTeslaCommander) SendCommand(_ context.Context, vin string, command string, params map[string]interface{}) error {
	m.calls = append(m.calls, sendCall{VIN: vin, Command: command, Params: params})
	if m.sendErrFor != nil {
		if e, ok := m.sendErrFor[vin]; ok {
			return e
		}
	}
	return m.sendErr
}

// --- Helpers ---

func defaultPollingConfig() *models.PollingConfig {
	pc := models.DefaultPollingConfig()
	pc.Commands = true
	return &pc
}

func testVehicle(id int64, vin, name string) *models.Vehicle {
	return &models.Vehicle{ID: id, VIN: vin, DisplayName: name}
}

func makeConfig(t *testing.T, typ, command string, params map[string]interface{}) json.RawMessage {
	t.Helper()
	cfg := map[string]interface{}{
		"command": command,
	}
	if typ != "" {
		cfg["type"] = typ
	}
	if params != nil {
		cfg["params"] = params
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}
	return b
}

// --- ParseCommandConfig Tests ---

func TestParseCommandConfig(t *testing.T) {
	tests := []struct {
		name    string
		input   json.RawMessage
		wantCmd string
		wantErr string
	}{
		{
			name:    "valid with type",
			input:   json.RawMessage(`{"type":"command","command":"climate_on","params":{}}`),
			wantCmd: "climate_on",
		},
		{
			name:    "valid without type",
			input:   json.RawMessage(`{"command":"lock"}`),
			wantCmd: "lock",
		},
		{
			name:    "valid with params",
			input:   json.RawMessage(`{"command":"set_charge_limit","params":{"percent":80}}`),
			wantCmd: "set_charge_limit",
		},
		{
			name:    "empty config",
			input:   json.RawMessage(``),
			wantErr: "action config is empty",
		},
		{
			name:    "invalid JSON",
			input:   json.RawMessage(`{broken`),
			wantErr: "unmarshal command action config",
		},
		{
			name:    "wrong type",
			input:   json.RawMessage(`{"type":"notification","command":"lock"}`),
			wantErr: `expected type "command"`,
		},
		{
			name:    "missing command",
			input:   json.RawMessage(`{"type":"command"}`),
			wantErr: "command is required",
		},
		{
			name:    "unknown command",
			input:   json.RawMessage(`{"command":"self_destruct"}`),
			wantErr: `unknown command "self_destruct"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := ParseCommandConfig(tt.input)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("error %q does not contain %q", err.Error(), tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Command != tt.wantCmd {
				t.Errorf("command = %q, want %q", cfg.Command, tt.wantCmd)
			}
		})
	}
}

// --- Execute Tests ---

func TestExecute_SingleVehicle_Success(t *testing.T) {
	v := testVehicle(1, "VIN001", "Model 3")
	vehicleRepo := &mockVehicleRepo{byID: map[int64]*models.Vehicle{1: v}}
	commandRepo := &mockCommandLogRepo{}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	teslaCmd := &mockTeslaCommander{hasToken: true}

	exec := NewCommandExecutor(vehicleRepo, commandRepo, settings, teslaCmd)

	vid := int64(1)
	cfg := makeConfig(t, "command", "climate_on", nil)

	resultJSON, err := exec.Execute(context.Background(), &vid, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var results []CommandResult
	if err := json.Unmarshal(resultJSON, &results); err != nil {
		t.Fatalf("unmarshal results: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	r := results[0]
	if !r.Success {
		t.Errorf("expected success, got error: %s", r.Error)
	}
	if r.VehicleID != 1 {
		t.Errorf("vehicle_id = %d, want 1", r.VehicleID)
	}
	if r.Command != "climate_on" {
		t.Errorf("command = %q, want %q", r.Command, "climate_on")
	}

	// Verify command was logged.
	if len(commandRepo.logs) != 1 {
		t.Fatalf("expected 1 command log, got %d", len(commandRepo.logs))
	}
	if commandRepo.logs[0].Status != "success" {
		t.Errorf("log status = %q, want %q", commandRepo.logs[0].Status, "success")
	}

	// Verify Tesla client was called with correct args.
	if len(teslaCmd.calls) != 1 {
		t.Fatalf("expected 1 Tesla call, got %d", len(teslaCmd.calls))
	}
	if teslaCmd.calls[0].VIN != "VIN001" {
		t.Errorf("VIN = %q, want %q", teslaCmd.calls[0].VIN, "VIN001")
	}
}

func TestExecute_SingleVehicle_CommandFails(t *testing.T) {
	v := testVehicle(1, "VIN001", "Model 3")
	vehicleRepo := &mockVehicleRepo{byID: map[int64]*models.Vehicle{1: v}}
	commandRepo := &mockCommandLogRepo{}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	teslaCmd := &mockTeslaCommander{hasToken: true, sendErr: errors.New("vehicle not responding")}

	exec := NewCommandExecutor(vehicleRepo, commandRepo, settings, teslaCmd)

	vid := int64(1)
	cfg := makeConfig(t, "", "lock", nil)

	resultJSON, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !strings.Contains(err.Error(), "1 of 1 vehicle commands failed") {
		t.Errorf("unexpected error: %v", err)
	}

	// Results should still be returned.
	var results []CommandResult
	if err := json.Unmarshal(resultJSON, &results); err != nil {
		t.Fatalf("unmarshal results: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if results[0].Success {
		t.Error("expected failure result")
	}
	if results[0].Error != "vehicle not responding" {
		t.Errorf("error = %q, want %q", results[0].Error, "vehicle not responding")
	}

	// Command log should record the failure.
	if len(commandRepo.logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(commandRepo.logs))
	}
	if commandRepo.logs[0].Status != "failed" {
		t.Errorf("log status = %q, want %q", commandRepo.logs[0].Status, "failed")
	}
}

func TestExecute_FleetWide_MixedResults(t *testing.T) {
	v1 := testVehicle(1, "VIN001", "Model 3")
	v2 := testVehicle(2, "VIN002", "Model Y")
	v3 := testVehicle(3, "VIN003", "Model S")
	vehicleRepo := &mockVehicleRepo{vehicles: []*models.Vehicle{v1, v2, v3}}
	commandRepo := &mockCommandLogRepo{}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	teslaCmd := &mockTeslaCommander{
		hasToken:   true,
		sendErrFor: map[string]error{"VIN002": errors.New("timeout")},
	}

	exec := NewCommandExecutor(vehicleRepo, commandRepo, settings, teslaCmd)

	cfg := makeConfig(t, "", "flash_lights", nil)

	resultJSON, err := exec.Execute(context.Background(), nil, cfg)
	if err == nil {
		t.Fatal("expected partial failure error")
	}
	if !strings.Contains(err.Error(), "1 of 3") {
		t.Errorf("error = %q, want '1 of 3'", err.Error())
	}

	var results []CommandResult
	if err := json.Unmarshal(resultJSON, &results); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// v1 success, v2 failure, v3 success
	if !results[0].Success || results[1].Success || !results[2].Success {
		t.Errorf("unexpected result pattern: %+v", results)
	}
	if results[1].Error != "timeout" {
		t.Errorf("v2 error = %q, want %q", results[1].Error, "timeout")
	}

	// All 3 should be logged.
	if len(commandRepo.logs) != 3 {
		t.Errorf("expected 3 logs, got %d", len(commandRepo.logs))
	}
}

func TestExecute_FleetWide_NoVehicles(t *testing.T) {
	vehicleRepo := &mockVehicleRepo{vehicles: []*models.Vehicle{}}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	teslaCmd := &mockTeslaCommander{hasToken: true}

	exec := NewCommandExecutor(vehicleRepo, &mockCommandLogRepo{}, settings, teslaCmd)

	cfg := makeConfig(t, "", "lock", nil)

	_, err := exec.Execute(context.Background(), nil, cfg)
	if err == nil || !strings.Contains(err.Error(), "no vehicles found") {
		t.Errorf("expected 'no vehicles found' error, got: %v", err)
	}
}

func TestExecute_APISuspended(t *testing.T) {
	settings := &mockSettingsChecker{suspended: true, pollingCfg: defaultPollingConfig()}
	exec := NewCommandExecutor(&mockVehicleRepo{}, &mockCommandLogRepo{}, settings, &mockTeslaCommander{hasToken: true})

	vid := int64(1)
	cfg := makeConfig(t, "", "lock", nil)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil || !strings.Contains(err.Error(), "suspended") {
		t.Errorf("expected suspension error, got: %v", err)
	}
}

func TestExecute_CommandsDisabled(t *testing.T) {
	pc := defaultPollingConfig()
	pc.Commands = false
	settings := &mockSettingsChecker{pollingCfg: pc}
	exec := NewCommandExecutor(&mockVehicleRepo{}, &mockCommandLogRepo{}, settings, &mockTeslaCommander{hasToken: true})

	vid := int64(1)
	cfg := makeConfig(t, "", "lock", nil)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Errorf("expected disabled error, got: %v", err)
	}
}

func TestExecute_NoValidToken(t *testing.T) {
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	exec := NewCommandExecutor(&mockVehicleRepo{}, &mockCommandLogRepo{}, settings, &mockTeslaCommander{hasToken: false})

	vid := int64(1)
	cfg := makeConfig(t, "", "lock", nil)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil || !strings.Contains(err.Error(), "not authenticated") {
		t.Errorf("expected auth error, got: %v", err)
	}
}

func TestExecute_VehicleNotFound(t *testing.T) {
	vehicleRepo := &mockVehicleRepo{byID: map[int64]*models.Vehicle{}}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	exec := NewCommandExecutor(vehicleRepo, &mockCommandLogRepo{}, settings, &mockTeslaCommander{hasToken: true})

	vid := int64(99)
	cfg := makeConfig(t, "", "lock", nil)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil || !strings.Contains(err.Error(), "not found") {
		t.Errorf("expected not found error, got: %v", err)
	}
}

func TestExecute_InvalidConfig(t *testing.T) {
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	exec := NewCommandExecutor(&mockVehicleRepo{}, &mockCommandLogRepo{}, settings, &mockTeslaCommander{hasToken: true})

	vid := int64(1)
	cfg := json.RawMessage(`{"command":""}`)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err == nil || !strings.Contains(err.Error(), "invalid command action config") {
		t.Errorf("expected config error, got: %v", err)
	}
}

func TestExecute_ContextCancelled(t *testing.T) {
	v1 := testVehicle(1, "VIN001", "Model 3")
	v2 := testVehicle(2, "VIN002", "Model Y")
	vehicleRepo := &mockVehicleRepo{vehicles: []*models.Vehicle{v1, v2}}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}

	// Tesla client that cancels context on first call
	ctx, cancel := context.WithCancel(context.Background())
	teslaCmd := &mockTeslaCommander{hasToken: true}

	exec := NewCommandExecutor(vehicleRepo, &mockCommandLogRepo{}, settings, teslaCmd)
	cfg := makeConfig(t, "", "lock", nil)

	// Cancel before iteration gets to second vehicle.
	cancel()

	_, err := exec.Execute(ctx, nil, cfg)
	if err == nil || !strings.Contains(err.Error(), "context cancelled") {
		t.Errorf("expected context cancelled error, got: %v", err)
	}
}

func TestExecute_WithParams(t *testing.T) {
	v := testVehicle(1, "VIN001", "Model 3")
	vehicleRepo := &mockVehicleRepo{byID: map[int64]*models.Vehicle{1: v}}
	commandRepo := &mockCommandLogRepo{}
	settings := &mockSettingsChecker{pollingCfg: defaultPollingConfig()}
	teslaCmd := &mockTeslaCommander{hasToken: true}

	exec := NewCommandExecutor(vehicleRepo, commandRepo, settings, teslaCmd)

	vid := int64(1)
	params := map[string]interface{}{"percent": float64(80)}
	cfg := makeConfig(t, "", "set_charge_limit", params)

	_, err := exec.Execute(context.Background(), &vid, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify params were forwarded.
	if len(teslaCmd.calls) != 1 {
		t.Fatalf("expected 1 call, got %d", len(teslaCmd.calls))
	}
	if teslaCmd.calls[0].Params == nil {
		t.Fatal("expected params, got nil")
	}
	if v, ok := teslaCmd.calls[0].Params["percent"]; !ok || v != float64(80) {
		t.Errorf("params[percent] = %v, want 80", v)
	}

	// Verify logged params.
	if len(commandRepo.logs) != 1 {
		t.Fatalf("expected 1 log, got %d", len(commandRepo.logs))
	}
	if !strings.Contains(commandRepo.logs[0].Params, "80") {
		t.Errorf("logged params %q should contain '80'", commandRepo.logs[0].Params)
	}
}

func TestExecute_AllCommandsFromWhitelist(t *testing.T) {
	// Spot-check a representative sample of allowed commands to ensure parse-time validation works.
	commands := []string{
		"wake_up", "lock", "unlock", "honk_horn", "flash_lights",
		"climate_on", "climate_off", "set_temps",
		"charge_start", "charge_stop", "set_charge_limit",
		"actuate_frunk", "actuate_trunk", "set_sentry_mode",
		"vent_windows", "close_windows", "remote_start_drive",
		"dog_mode", "camp_mode", "trigger_homelink",
		"navigation_request", "set_vehicle_name",
	}

	for _, cmd := range commands {
		t.Run(cmd, func(t *testing.T) {
			raw := json.RawMessage(fmt.Sprintf(`{"command":%q}`, cmd))
			cfg, err := ParseCommandConfig(raw)
			if err != nil {
				t.Fatalf("command %q should be valid, got: %v", cmd, err)
			}
			if cfg.Command != cmd {
				t.Errorf("command = %q, want %q", cfg.Command, cmd)
			}
		})
	}
}
