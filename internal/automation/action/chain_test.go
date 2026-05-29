package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

type mockActionExecutor struct {
	output json.RawMessage
	err    error
	delay  time.Duration // simulated execution time
	calls  []mockExecCall
}

type mockExecCall struct {
	VehicleID *int64
	Config    json.RawMessage
}

func (m *mockActionExecutor) Execute(_ context.Context, vehicleID *int64, config json.RawMessage) (json.RawMessage, error) {
	m.calls = append(m.calls, mockExecCall{VehicleID: vehicleID, Config: config})
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	return m.output, m.err
}

// perCallExecutor returns different results for each call.
type perCallExecutor struct {
	outputs []json.RawMessage
	errs    []error
	callIdx int
	calls   []mockExecCall
}

func (m *perCallExecutor) Execute(_ context.Context, vehicleID *int64, config json.RawMessage) (json.RawMessage, error) {
	m.calls = append(m.calls, mockExecCall{VehicleID: vehicleID, Config: config})
	idx := m.callIdx
	m.callIdx++
	var output json.RawMessage
	var err error
	if idx < len(m.outputs) {
		output = m.outputs[idx]
	}
	if idx < len(m.errs) {
		err = m.errs[idx]
	}
	return output, err
}

func TestParseActions_ValidArray(t *testing.T) {
	raw := json.RawMessage(`[
		{"type":"command","command":"wake_up"},
		{"type":"wait","duration":"10s"},
		{"type":"command","command":"climate_on","params":{"temp":22}}
	]`)

	configs, err := ParseActions(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(configs) != 3 {
		t.Fatalf("expected 3 configs, got %d", len(configs))
	}
	if configs[0].Type != "command" {
		t.Errorf("configs[0].Type = %q, want %q", configs[0].Type, "command")
	}
	if configs[1].Type != "wait" {
		t.Errorf("configs[1].Type = %q, want %q", configs[1].Type, "wait")
	}
	if configs[2].Type != "command" {
		t.Errorf("configs[2].Type = %q, want %q", configs[2].Type, "command")
	}
	if !strings.Contains(string(configs[0].Raw), "wake_up") {
		t.Errorf("configs[0].Raw should contain 'wake_up': %s", configs[0].Raw)
	}
}

func TestParseActions_EmptyTypeNormalizesToCommand(t *testing.T) {
	raw := json.RawMessage(`[{"command":"lock"}]`)

	configs, err := ParseActions(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(configs) != 1 {
		t.Fatalf("expected 1 config, got %d", len(configs))
	}
	if configs[0].Type != "command" {
		t.Errorf("configs[0].Type = %q, want %q (should normalize empty to command)", configs[0].Type, "command")
	}
}

func TestParseActions_ExplicitEmptyTypeNormalizes(t *testing.T) {
	raw := json.RawMessage(`[{"type":"","command":"unlock"}]`)

	configs, err := ParseActions(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if configs[0].Type != "command" {
		t.Errorf("type = %q, want %q", configs[0].Type, "command")
	}
}

func TestParseActions_EmptyArray(t *testing.T) {
	raw := json.RawMessage(`[]`)

	configs, err := ParseActions(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(configs) != 0 {
		t.Errorf("expected 0 configs, got %d", len(configs))
	}
}

func TestParseActions_EmptyInput(t *testing.T) {
	_, err := ParseActions(json.RawMessage(``))
	if err == nil || !strings.Contains(err.Error(), "empty") {
		t.Errorf("expected empty error, got: %v", err)
	}
}

func TestParseActions_NotArray(t *testing.T) {
	_, err := ParseActions(json.RawMessage(`{"type":"command"}`))
	if err == nil || !strings.Contains(err.Error(), "JSON array") {
		t.Errorf("expected JSON array error, got: %v", err)
	}
}

func TestParseActions_InvalidJSON(t *testing.T) {
	_, err := ParseActions(json.RawMessage(`[{broken`))
	if err == nil || !strings.Contains(err.Error(), "JSON array") {
		t.Errorf("expected JSON array error, got: %v", err)
	}
}

func TestParseActions_InvalidItemJSON(t *testing.T) {
	_, err := ParseActions(json.RawMessage(`[{"type":"command"}, {invalid}]`))
	if err == nil {
		t.Fatal("expected error for invalid item JSON")
	}
}

func TestParseActions_SingleItem(t *testing.T) {
	raw := json.RawMessage(`[{"type":"notify","message":"hello"}]`)

	configs, err := ParseActions(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(configs) != 1 {
		t.Fatalf("expected 1 config, got %d", len(configs))
	}
	if configs[0].Type != "notify" {
		t.Errorf("type = %q, want %q", configs[0].Type, "notify")
	}
}

// --- Validate Tests ---

func TestValidate_AllTypesRegistered(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	ce.Register("command", &mockActionExecutor{})
	ce.Register("wait", &mockActionExecutor{})

	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
		{Type: "wait", Raw: json.RawMessage(`{}`)},
	}

	if err := ce.Validate(actions); err != nil {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestValidate_UnknownType(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	ce.Register("command", &mockActionExecutor{})

	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
		{Type: "self_destruct", Raw: json.RawMessage(`{}`)},
	}

	err := ce.Validate(actions)
	if err == nil {
		t.Fatal("expected error for unknown type")
	}
	if !strings.Contains(err.Error(), "self_destruct") {
		t.Errorf("error should mention the unknown type: %v", err)
	}
	if !strings.Contains(err.Error(), "action 1") {
		t.Errorf("error should mention the action index: %v", err)
	}
}

func TestValidate_EmptyList(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	if err := ce.Validate(nil); err != nil {
		t.Errorf("empty list should be valid, got: %v", err)
	}
}

// --- Execute Tests ---

func TestExecute_AllActionsSucceed(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	cmd := &mockActionExecutor{output: json.RawMessage(`{"ok":true}`)}
	wait := &mockActionExecutor{output: json.RawMessage(`{"waited":"5s"}`)}
	ce.Register("command", cmd)
	ce.Register("wait", wait)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{"type":"command","command":"wake_up"}`)},
		{Type: "wait", Raw: json.RawMessage(`{"type":"wait","duration":"5s"}`)},
		{Type: "command", Raw: json.RawMessage(`{"type":"command","command":"climate_on"}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}
	for i, r := range results {
		if !r.Success {
			t.Errorf("results[%d] should be success, got error: %s", i, r.Error)
		}
		if r.Skipped {
			t.Errorf("results[%d] should not be skipped", i)
		}
		if r.Index != i {
			t.Errorf("results[%d].Index = %d, want %d", i, r.Index, i)
		}
	}

	// Verify correct executor was called.
	if len(cmd.calls) != 2 {
		t.Errorf("command executor called %d times, want 2", len(cmd.calls))
	}
	if len(wait.calls) != 1 {
		t.Errorf("wait executor called %d times, want 1", len(wait.calls))
	}

	// Verify vehicle ID was passed.
	for _, call := range cmd.calls {
		if call.VehicleID == nil || *call.VehicleID != 1 {
			t.Errorf("expected vehicleID=1, got %v", call.VehicleID)
		}
	}
}

func TestExecute_StopOnFailure(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	good := &mockActionExecutor{output: json.RawMessage(`{}`)}
	bad := &mockActionExecutor{err: fmt.Errorf("action failed")}
	never := &mockActionExecutor{}
	ce.Register("good", good)
	ce.Register("bad", bad)
	ce.Register("never", never)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "good", Raw: json.RawMessage(`{}`)},
		{Type: "bad", Raw: json.RawMessage(`{}`)},
		{Type: "never", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, true)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	// First action succeeds.
	if !results[0].Success {
		t.Error("results[0] should succeed")
	}

	// Second action fails.
	if results[1].Success || results[1].Error == "" {
		t.Error("results[1] should fail with error")
	}
	if results[1].Skipped {
		t.Error("results[1] should not be skipped (it was executed)")
	}

	// Third action skipped.
	if !results[2].Skipped {
		t.Error("results[2] should be skipped")
	}
	if results[2].SkipReason == "" {
		t.Error("results[2] should have a skip reason")
	}
	if !strings.Contains(results[2].SkipReason, "stop_on_failure") {
		t.Errorf("skip reason should mention stop_on_failure: %q", results[2].SkipReason)
	}

	// The never executor should not have been called.
	if len(never.calls) != 0 {
		t.Errorf("never executor should not have been called, got %d calls", len(never.calls))
	}
}

func TestExecute_ContinueOnFailure(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	good := &mockActionExecutor{output: json.RawMessage(`{}`)}
	bad := &mockActionExecutor{err: fmt.Errorf("action failed")}
	ce.Register("good", good)
	ce.Register("bad", bad)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "good", Raw: json.RawMessage(`{}`)},
		{Type: "bad", Raw: json.RawMessage(`{}`)},
		{Type: "good", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if len(results) != 3 {
		t.Fatalf("expected 3 results, got %d", len(results))
	}

	if !results[0].Success {
		t.Error("results[0] should succeed")
	}
	if results[1].Success {
		t.Error("results[1] should fail")
	}
	if !results[2].Success {
		t.Error("results[2] should succeed (continue on failure)")
	}
	if results[2].Skipped {
		t.Error("results[2] should not be skipped")
	}

	// good executor should have been called twice.
	if len(good.calls) != 2 {
		t.Errorf("good executor called %d times, want 2", len(good.calls))
	}
}

func TestExecute_EmptyActions(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	v := testVehicle(1, "VIN001", "Model 3")

	results := ce.Execute(context.Background(), []ActionConfig{}, v, false)

	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestExecute_NilActions(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	v := testVehicle(1, "VIN001", "Model 3")

	results := ce.Execute(context.Background(), nil, v, false)

	if len(results) != 0 {
		t.Errorf("expected 0 results, got %d", len(results))
	}
}

func TestExecute_UnknownActionType(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	ce.Register("command", &mockActionExecutor{})

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
		{Type: "teleport", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if !results[0].Success {
		t.Error("results[0] should succeed")
	}
	if results[1].Success {
		t.Error("results[1] should fail for unknown type")
	}
	if !strings.Contains(results[1].Error, "unknown action type") {
		t.Errorf("error should mention unknown type: %q", results[1].Error)
	}
}

func TestExecute_UnknownTypeStopsChain(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	after := &mockActionExecutor{}
	ce.Register("after", after)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "teleport", Raw: json.RawMessage(`{}`)},
		{Type: "after", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, true)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Success {
		t.Error("results[0] should fail")
	}
	if !results[1].Skipped {
		t.Error("results[1] should be skipped after unknown type with stop_on_failure")
	}
	if len(after.calls) != 0 {
		t.Error("after executor should not have been called")
	}
}

func TestExecute_ContextCancelledBeforeExecution(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	exec := &mockActionExecutor{}
	ce.Register("command", exec)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancel immediately

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(ctx, actions, v, false)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for i, r := range results {
		if !r.Skipped {
			t.Errorf("results[%d] should be skipped due to cancelled context", i)
		}
		if !strings.Contains(r.SkipReason, "context cancelled") {
			t.Errorf("results[%d] skip reason should mention context: %q", i, r.SkipReason)
		}
	}
	if len(exec.calls) != 0 {
		t.Error("executor should not have been called with cancelled context")
	}
}

func TestExecute_ContextCancelledBetweenActions(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	ctx, cancel := context.WithCancel(context.Background())

	// First action succeeds and cancels the context.
	cancelling := &mockActionExecutor{output: json.RawMessage(`{}`)}
	original := cancelling.Execute
	_ = original
	ce.Register("cancel_me", &cancellingExecutor{cancel: cancel})
	ce.Register("after", &mockActionExecutor{})

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "cancel_me", Raw: json.RawMessage(`{}`)},
		{Type: "after", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(ctx, actions, v, false)

	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if !results[0].Success {
		t.Error("results[0] should succeed")
	}
	if !results[1].Skipped {
		t.Error("results[1] should be skipped after context cancellation")
	}
}

// cancellingExecutor cancels the context on Execute.
type cancellingExecutor struct {
	cancel context.CancelFunc
}

func (e *cancellingExecutor) Execute(_ context.Context, _ *int64, _ json.RawMessage) (json.RawMessage, error) {
	e.cancel()
	return json.RawMessage(`{}`), nil
}

func TestExecute_NilVehicle(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	exec := &mockActionExecutor{output: json.RawMessage(`{}`)}
	ce.Register("command", exec)

	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, nil, false)

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if !results[0].Success {
		t.Error("should succeed")
	}
	// VehicleID should be nil.
	if exec.calls[0].VehicleID != nil {
		t.Errorf("expected nil vehicleID, got %v", exec.calls[0].VehicleID)
	}
}

func TestExecute_ActionOutputPreserved(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	exec := &mockActionExecutor{output: json.RawMessage(`[{"vehicle_id":1,"success":true}]`)}
	ce.Register("command", exec)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{"command":"lock"}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if results[0].Output == nil {
		t.Fatal("output should not be nil")
	}
	if !strings.Contains(string(results[0].Output), "vehicle_id") {
		t.Errorf("output should contain executor output: %s", results[0].Output)
	}
}

func TestExecute_ActionConfigPreserved(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	ce.Register("command", &mockActionExecutor{})

	v := testVehicle(1, "VIN001", "Model 3")
	rawConfig := json.RawMessage(`{"type":"command","command":"flash_lights"}`)
	actions := []ActionConfig{
		{Type: "command", Raw: rawConfig},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if string(results[0].Config) != string(rawConfig) {
		t.Errorf("config = %s, want %s", results[0].Config, rawConfig)
	}
	if results[0].ActionType != "command" {
		t.Errorf("action_type = %q, want %q", results[0].ActionType, "command")
	}
}

func TestExecute_DurationMsTracked(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	exec := &mockActionExecutor{delay: 10 * time.Millisecond}
	ce.Register("slow", exec)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "slow", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if results[0].DurationMs < 10 {
		t.Errorf("duration_ms = %d, expected >= 10", results[0].DurationMs)
	}
}

func TestExecute_FailedActionHasOutput(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})
	// Executor returns both output and error (like CommandExecutor does on partial failure).
	exec := &mockActionExecutor{
		output: json.RawMessage(`[{"success":false}]`),
		err:    fmt.Errorf("partial failure"),
	}
	ce.Register("command", exec)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if results[0].Success {
		t.Error("should report failure")
	}
	if results[0].Output == nil {
		t.Error("output should be preserved even on error")
	}
	if results[0].Error != "partial failure" {
		t.Errorf("error = %q, want %q", results[0].Error, "partial failure")
	}
}

// --- ExecuteFleet Tests ---

func TestExecuteFleet_TwoVehiclesTwoActions(t *testing.T) {
	v1 := testVehicle(1, "VIN001", "Model 3")
	v2 := testVehicle(2, "VIN002", "Model Y")
	vRepo := &mockVehicleRepo{vehicles: []*vehiclemodel.Vehicle{v1, v2}}

	ce := NewChainExecutor(vRepo)
	exec := &perCallExecutor{
		outputs: []json.RawMessage{
			json.RawMessage(`{"step":1}`), json.RawMessage(`{"step":2}`), // v1
			json.RawMessage(`{"step":1}`), json.RawMessage(`{"step":2}`), // v2
		},
		errs: []error{nil, nil, nil, nil},
	}
	ce.Register("action", exec)

	actions := []ActionConfig{
		{Type: "action", Raw: json.RawMessage(`{"step":1}`)},
		{Type: "action", Raw: json.RawMessage(`{"step":2}`)},
	}

	results, err := ce.ExecuteFleet(context.Background(), actions, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 vehicle results, got %d", len(results))
	}

	// Each vehicle should have 2 action results.
	for i, vr := range results {
		if len(vr.Results) != 2 {
			t.Errorf("vehicle %d: expected 2 results, got %d", i, len(vr.Results))
		}
		if !vr.Success {
			t.Errorf("vehicle %d: expected success", i)
		}
	}

	// Verify chain-per-vehicle ordering: v1's actions run first, then v2's.
	if len(exec.calls) != 4 {
		t.Fatalf("expected 4 calls total, got %d", len(exec.calls))
	}
	if *exec.calls[0].VehicleID != 1 || *exec.calls[1].VehicleID != 1 {
		t.Error("first two calls should be for vehicle 1")
	}
	if *exec.calls[2].VehicleID != 2 || *exec.calls[3].VehicleID != 2 {
		t.Error("last two calls should be for vehicle 2")
	}
}

func TestExecuteFleet_StopOnFailurePerVehicle(t *testing.T) {
	v1 := testVehicle(1, "VIN001", "Model 3")
	v2 := testVehicle(2, "VIN002", "Model Y")
	vRepo := &mockVehicleRepo{vehicles: []*vehiclemodel.Vehicle{v1, v2}}

	ce := NewChainExecutor(vRepo)

	// Executor fails on first call, succeeds on rest.
	exec := &perCallExecutor{
		outputs: []json.RawMessage{nil, nil, json.RawMessage(`{}`), json.RawMessage(`{}`)},
		errs:    []error{fmt.Errorf("v1 step 1 failed"), nil, nil, nil},
	}
	ce.Register("action", exec)

	actions := []ActionConfig{
		{Type: "action", Raw: json.RawMessage(`{"step":1}`)},
		{Type: "action", Raw: json.RawMessage(`{"step":2}`)},
	}

	results, err := ce.ExecuteFleet(context.Background(), actions, true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Vehicle 1: step 1 fails, step 2 skipped.
	if results[0].Success {
		t.Error("vehicle 1 chain should not be success")
	}
	if results[0].Results[0].Success {
		t.Error("v1 step 1 should fail")
	}
	if !results[0].Results[1].Skipped {
		t.Error("v1 step 2 should be skipped")
	}

	// Vehicle 2: both steps succeed (independent of v1).
	if !results[1].Success {
		t.Error("vehicle 2 chain should succeed")
	}
	if !results[1].Results[0].Success {
		t.Error("v2 step 1 should succeed")
	}
	if !results[1].Results[1].Success {
		t.Error("v2 step 2 should succeed")
	}
}

func TestExecuteFleet_NoVehicles(t *testing.T) {
	vRepo := &mockVehicleRepo{vehicles: []*vehiclemodel.Vehicle{}}
	ce := NewChainExecutor(vRepo)

	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	_, err := ce.ExecuteFleet(context.Background(), actions, false)
	if err == nil || !strings.Contains(err.Error(), "no vehicles found") {
		t.Errorf("expected no vehicles error, got: %v", err)
	}
}

func TestExecuteFleet_RepoError(t *testing.T) {
	vRepo := &mockVehicleRepo{err: fmt.Errorf("database offline")}
	ce := NewChainExecutor(vRepo)

	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	_, err := ce.ExecuteFleet(context.Background(), actions, false)
	if err == nil || !strings.Contains(err.Error(), "database offline") {
		t.Errorf("expected repo error, got: %v", err)
	}
}

func TestExecuteFleet_ContextCancelled(t *testing.T) {
	v1 := testVehicle(1, "VIN001", "Model 3")
	v2 := testVehicle(2, "VIN002", "Model Y")
	vRepo := &mockVehicleRepo{vehicles: []*vehiclemodel.Vehicle{v1, v2}}

	ce := NewChainExecutor(vRepo)
	ce.Register("action", &mockActionExecutor{output: json.RawMessage(`{}`)})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	actions := []ActionConfig{
		{Type: "action", Raw: json.RawMessage(`{}`)},
	}

	_, err := ce.ExecuteFleet(ctx, actions, false)
	if err == nil || !strings.Contains(err.Error(), "context cancelled") {
		t.Errorf("expected context cancelled error, got: %v", err)
	}
}

// --- Helper function tests ---

func TestSucceeded(t *testing.T) {
	results := []ActionResult{
		{Success: true},
		{Success: false, Error: "fail"},
		{Success: true},
		{Skipped: true},
	}
	if got := Succeeded(results); got != 2 {
		t.Errorf("Succeeded = %d, want 2", got)
	}
}

func TestFailed(t *testing.T) {
	results := []ActionResult{
		{Success: true},
		{Success: false, Error: "fail"},
		{Skipped: true}, // not counted as failed
		{Success: false, Error: "fail2"},
	}
	if got := Failed(results); got != 2 {
		t.Errorf("Failed = %d, want 2", got)
	}
}

func TestSkippedCount(t *testing.T) {
	results := []ActionResult{
		{Success: true},
		{Skipped: true},
		{Skipped: true},
	}
	if got := SkippedCount(results); got != 2 {
		t.Errorf("SkippedCount = %d, want 2", got)
	}
}

func TestSucceeded_Empty(t *testing.T) {
	if got := Succeeded(nil); got != 0 {
		t.Errorf("Succeeded(nil) = %d, want 0", got)
	}
}

func TestFailed_Empty(t *testing.T) {
	if got := Failed(nil); got != 0 {
		t.Errorf("Failed(nil) = %d, want 0", got)
	}
}

// --- Register Tests ---

func TestRegister_OverwritesPrevious(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	first := &mockActionExecutor{output: json.RawMessage(`{"first":true}`)}
	second := &mockActionExecutor{output: json.RawMessage(`{"second":true}`)}
	ce.Register("command", first)
	ce.Register("command", second)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if !strings.Contains(string(results[0].Output), "second") {
		t.Error("should use the second registered executor")
	}
	if len(first.calls) != 0 {
		t.Error("first executor should not have been called")
	}
	if len(second.calls) != 1 {
		t.Error("second executor should have been called once")
	}
}

// --- Integration-style: multiple action types in one chain ---

func TestExecute_MixedActionTypes(t *testing.T) {
	ce := NewChainExecutor(&mockVehicleRepo{})

	cmd := &mockActionExecutor{output: json.RawMessage(`{"sent":true}`)}
	wait := &mockActionExecutor{output: json.RawMessage(`{"waited":true}`)}
	notify := &mockActionExecutor{output: json.RawMessage(`{"notified":true}`)}
	setVar := &mockActionExecutor{output: json.RawMessage(`{"set":true}`)}

	ce.Register("command", cmd)
	ce.Register("wait", wait)
	ce.Register("notify", notify)
	ce.Register("set_variable", setVar)

	v := testVehicle(1, "VIN001", "Model 3")
	actions := []ActionConfig{
		{Type: "command", Raw: json.RawMessage(`{"command":"wake_up"}`)},
		{Type: "wait", Raw: json.RawMessage(`{"duration":"10s"}`)},
		{Type: "command", Raw: json.RawMessage(`{"command":"climate_on"}`)},
		{Type: "set_variable", Raw: json.RawMessage(`{"key":"last_climate","value":"on"}`)},
		{Type: "notify", Raw: json.RawMessage(`{"message":"Climate started"}`)},
	}

	results := ce.Execute(context.Background(), actions, v, false)

	if len(results) != 5 {
		t.Fatalf("expected 5 results, got %d", len(results))
	}

	expectedTypes := []string{"command", "wait", "command", "set_variable", "notify"}
	for i, r := range results {
		if !r.Success {
			t.Errorf("results[%d] should succeed, got error: %s", i, r.Error)
		}
		if r.ActionType != expectedTypes[i] {
			t.Errorf("results[%d].ActionType = %q, want %q", i, r.ActionType, expectedTypes[i])
		}
	}

	if len(cmd.calls) != 2 {
		t.Errorf("command executor called %d times, want 2", len(cmd.calls))
	}
	if len(wait.calls) != 1 {
		t.Errorf("wait executor called %d times, want 1", len(wait.calls))
	}
	if len(notify.calls) != 1 {
		t.Errorf("notify executor called %d times, want 1", len(notify.calls))
	}
	if len(setVar.calls) != 1 {
		t.Errorf("set_variable executor called %d times, want 1", len(setVar.calls))
	}
}
