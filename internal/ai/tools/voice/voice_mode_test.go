// Unit tests for the stream_chatbot_response voice-mode tool.
//
// The tool wraps two narrow read-only ports (ChatContextSource for
// chat history, VehicleSnapshotSource for the install-wide vehicle
// snapshot). The production adapters wrap the canonical ChatRepo +
// vehicles/state/drives readers; the tests substitute deterministic
// hermetic fakes so the unit tests stay free of database, network,
// and Tesla-API IO.
//
// The tool also enforces per-request SESSION-scope binding as a
// defence against prompt-injection exfiltration: the AI handler
// installs the body-supplied session_id in ctx via
// WithScopedVoiceModeSession, and Execute REFUSES any LLM-supplied
// session_id that does not match. The scope-binding tests pin that
// contract (missing scope ⇒ refuse; mismatched scope ⇒ refuse;
// matched scope ⇒ delegate) so a future edit that bypasses any gate
// surfaces here.

package voice

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Compile-time contract assertions
// ---------------------------------------------------------------------------

var (
	_ ChatContextSource     = (*fakeChatSource)(nil)
	_ VehicleSnapshotSource = (*fakeVehicleSource)(nil)
	_ tools.Tool            = (*streamChatbotResponse)(nil)
)

// ---------------------------------------------------------------------------
// Hermetic fakes
// ---------------------------------------------------------------------------

// fakeChatSource is a deterministic stand-in for the production chat
// history adapter. It records the session_id + limit it was called
// with so the tests can assert the tool passes the in-scope values
// (not the raw LLM input) to the port.
type fakeChatSource struct {
	turns    []VoiceModeChatTurn
	err      error
	gotSess  string
	gotLimit int
	calls    int
}

func (f *fakeChatSource) LoadRecentTurns(_ context.Context, sessionID string, limit int) ([]VoiceModeChatTurn, error) {
	f.calls++
	f.gotSess = sessionID
	f.gotLimit = limit
	if f.err != nil {
		return nil, f.err
	}
	return f.turns, nil
}

// fakeVehicleSource is a deterministic stand-in for the production
// vehicle-snapshot adapter.
type fakeVehicleSource struct {
	snap  VoiceModeVehicleSnapshot
	err   error
	calls int
}

func (f *fakeVehicleSource) LoadVehicleSnapshot(_ context.Context) (VoiceModeVehicleSnapshot, error) {
	f.calls++
	if f.err != nil {
		return VoiceModeVehicleSnapshot{}, f.err
	}
	return f.snap, nil
}

func ptrInt(v int) *int { return &v }

// ---------------------------------------------------------------------------
// Metadata contract
// ---------------------------------------------------------------------------

func TestStreamChatbotResponse_Name(t *testing.T) {
	t.Parallel()
	tool := &streamChatbotResponse{}
	if got := tool.Name(); got != "stream_chatbot_response" {
		t.Errorf("Name() = %q, want stream_chatbot_response", got)
	}
}

func TestStreamChatbotResponse_ReadOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &streamChatbotResponse{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only tool)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	if tool.OutputSchema() != nil {
		t.Errorf("OutputSchema() = %s, want nil (free-form output)", tool.OutputSchema())
	}
}

func TestStreamChatbotResponse_Description(t *testing.T) {
	t.Parallel()
	tool := &streamChatbotResponse{}
	desc := tool.Description()
	for _, must := range []string{
		"history",
		"vehicle_snapshot",
		"voice_mode_hint",
		"soc_percent",
		"charging_state",
		// Honest "no location leaves the boundary" disclosure.
		"NO GPS",
		"NO street names",
		// Honest read-only + no-write disclosure.
		"READ-only",
		"NO database write",
		// Honest scope-binding disclosure mirrors the runtime guard.
		"in-scope session_id",
		"cross-session requests are refused",
	} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
}

func TestStreamChatbotResponse_InputSchema(t *testing.T) {
	t.Parallel()
	tool := &streamChatbotResponse{}
	schema := tool.InputSchema()
	if len(schema) == 0 {
		t.Fatal("InputSchema() returned empty bytes")
	}
	var got map[string]any
	if err := json.Unmarshal(schema, &got); err != nil {
		t.Fatalf("InputSchema() did not decode as JSON: %v", err)
	}
	if got["type"] != "object" {
		t.Errorf("InputSchema().type = %v, want object", got["type"])
	}
	// session_id carries validate:"required" so the schema MUST list
	// it in `required` — the LLM cannot omit it.
	if !schemaRequires(got, "session_id") {
		t.Errorf("InputSchema().required = %v, want it to contain session_id", got["required"])
	}
	// Both fields must appear as properties so the LLM knows the shape.
	props, ok := got["properties"].(map[string]any)
	if !ok {
		t.Fatalf("InputSchema().properties = %v, want an object", got["properties"])
	}
	for _, field := range []string{"session_id", "history_limit"} {
		if _, present := props[field]; !present {
			t.Errorf("InputSchema().properties missing %q", field)
		}
	}
}

// schemaRequires reports whether the generated schema's `required`
// array contains field. The generator emits []any of strings after a
// JSON round-trip, so we normalise here.
func schemaRequires(schema map[string]any, field string) bool {
	req, ok := schema["required"].([]any)
	if !ok {
		return false
	}
	for _, r := range req {
		if s, ok := r.(string); ok && s == field {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

func TestStreamChatbotResponse_Validate(t *testing.T) {
	t.Parallel()
	tool := &streamChatbotResponse{}

	tests := []struct {
		name      string
		raw       string
		wantErr   bool
		errSubstr string
		wantLimit int // asserted only when wantErr == false
	}{
		{
			name:      "valid without history_limit",
			raw:       `{"session_id":"sess-1"}`,
			wantLimit: 0,
		},
		{
			name:      "valid with history_limit",
			raw:       `{"session_id":"sess-1","history_limit":8}`,
			wantLimit: 8,
		},
		{
			name:      "valid at min boundary",
			raw:       `{"session_id":"sess-1","history_limit":1}`,
			wantLimit: 1,
		},
		{
			name:      "valid at max boundary",
			raw:       `{"session_id":"sess-1","history_limit":32}`,
			wantLimit: 32,
		},
		{
			name:      "history_limit over max is rejected",
			raw:       `{"session_id":"sess-1","history_limit":33}`,
			wantErr:   true,
			errSubstr: "exceeds the maximum",
		},
		{
			name:      "negative history_limit is rejected",
			raw:       `{"session_id":"sess-1","history_limit":-1}`,
			wantErr:   true,
			errSubstr: "must be >= 0",
		},
		{
			name:      "missing session_id is rejected",
			raw:       `{"history_limit":8}`,
			wantErr:   true,
			errSubstr: "session_id",
		},
		{
			name:      "empty object is rejected (session_id required)",
			raw:       `{}`,
			wantErr:   true,
			errSubstr: "session_id",
		},
		{
			name:      "unknown field is rejected",
			raw:       `{"session_id":"sess-1","injected":"evil"}`,
			wantErr:   true,
			errSubstr: "unknown field",
		},
		{
			name:      "malformed JSON is rejected",
			raw:       `{"session_id":`,
			wantErr:   true,
			errSubstr: "decode",
		},
		{
			name:      "null payload is rejected (session_id required)",
			raw:       `null`,
			wantErr:   true,
			errSubstr: "session_id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			v, err := tool.Validate(json.RawMessage(tt.raw))
			if tt.wantErr {
				if err == nil {
					t.Fatalf("Validate(%s) err = nil, want error", tt.raw)
				}
				if !strings.Contains(err.Error(), tt.errSubstr) {
					t.Errorf("Validate(%s) err = %q, want substring %q", tt.raw, err, tt.errSubstr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Validate(%s) err = %v, want nil", tt.raw, err)
			}
			in, ok := v.(streamChatbotResponseInput)
			if !ok {
				t.Fatalf("Validate(%s) returned %T, want streamChatbotResponseInput", tt.raw, v)
			}
			if in.HistoryLimit != tt.wantLimit {
				t.Errorf("Validate(%s).HistoryLimit = %d, want %d", tt.raw, in.HistoryLimit, tt.wantLimit)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Execute — refusal / error paths
// ---------------------------------------------------------------------------

var (
	errChatDown    = errors.New("chat-source-down")
	errVehicleDown = errors.New("vehicle-source-down")
)

func TestStreamChatbotResponse_Execute_Refusals(t *testing.T) {
	t.Parallel()

	const inScope = "in-scope-session"

	tests := []struct {
		name         string
		chat         ChatContextSource
		vehicle      VehicleSnapshotSource
		installScope bool
		scope        ScopedVoiceModeSession
		in           any
		errSubstr    string
		wrapErr      error // asserted with errors.Is when non-nil
	}{
		{
			name:         "wrong input type is refused, not a panic",
			chat:         &fakeChatSource{},
			vehicle:      &fakeVehicleSource{},
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           "not-the-input-struct",
			errSubstr:    "wrong type",
		},
		{
			name:         "nil chat source is refused",
			chat:         nil,
			vehicle:      &fakeVehicleSource{},
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           streamChatbotResponseInput{SessionID: inScope},
			errSubstr:    "no ChatContextSource wired",
		},
		{
			name:         "nil vehicle source is refused",
			chat:         &fakeChatSource{},
			vehicle:      nil,
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           streamChatbotResponseInput{SessionID: inScope},
			errSubstr:    "no VehicleSnapshotSource wired",
		},
		{
			name:         "missing scope is refused",
			chat:         &fakeChatSource{},
			vehicle:      &fakeVehicleSource{},
			installScope: false,
			in:           streamChatbotResponseInput{SessionID: inScope},
			errSubstr:    "no in-scope voice-mode session",
		},
		{
			name:         "cross-session request is refused",
			chat:         &fakeChatSource{},
			vehicle:      &fakeVehicleSource{},
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           streamChatbotResponseInput{SessionID: "attacker-session"},
			errSubstr:    "does not match in-scope",
		},
		{
			name:         "chat source error is wrapped with context",
			chat:         &fakeChatSource{err: errChatDown},
			vehicle:      &fakeVehicleSource{},
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           streamChatbotResponseInput{SessionID: inScope},
			errSubstr:    "load chat history",
			wrapErr:      errChatDown,
		},
		{
			name:         "vehicle source error is wrapped with context",
			chat:         &fakeChatSource{},
			vehicle:      &fakeVehicleSource{err: errVehicleDown},
			installScope: true,
			scope:        ScopedVoiceModeSession{SessionID: inScope, HistoryLimit: 8},
			in:           streamChatbotResponseInput{SessionID: inScope},
			errSubstr:    "load vehicle snapshot",
			wrapErr:      errVehicleDown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			tool := &streamChatbotResponse{chat: tt.chat, vehicle: tt.vehicle}
			ctx := context.Background()
			if tt.installScope {
				ctx = WithScopedVoiceModeSession(ctx, tt.scope)
			}
			out, err := tool.Execute(ctx, tt.in)
			if err == nil {
				t.Fatalf("Execute(%s) err = nil, want refusal", tt.name)
			}
			if out != nil {
				t.Errorf("Execute(%s) out = %v, want nil on error", tt.name, out)
			}
			if !strings.Contains(err.Error(), tt.errSubstr) {
				t.Errorf("Execute(%s) err = %q, want substring %q", tt.name, err, tt.errSubstr)
			}
			if tt.wrapErr != nil && !errors.Is(err, tt.wrapErr) {
				t.Errorf("Execute(%s) err = %v, want it to wrap %v", tt.name, err, tt.wrapErr)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Execute — history-limit resolution
// ---------------------------------------------------------------------------

func TestStreamChatbotResponse_Execute_HistoryLimitResolution(t *testing.T) {
	t.Parallel()

	const sess = "sess-limit"

	tests := []struct {
		name          string
		inputLimit    int
		scopedLimit   int
		wantPortLimit int
	}{
		{"explicit input limit is used verbatim", 5, 8, 5},
		{"zero input falls back to scoped default", 0, 8, 8},
		{"zero input and zero scoped fall back to 8", 0, 0, 8},
		{"zero input and negative scoped fall back to 8", 0, -3, 8},
		{"negative input falls back to 8", -5, 8, 8},
		{"input over max is clamped to 32", 100, 8, voiceModeMaxHistoryLimit},
		{"scoped over max is clamped to 32", 0, 100, voiceModeMaxHistoryLimit},
		{"input at min boundary", 1, 8, 1},
		{"input at max boundary", 32, 8, voiceModeMaxHistoryLimit},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			chat := &fakeChatSource{}
			vehicle := &fakeVehicleSource{}
			tool := &streamChatbotResponse{chat: chat, vehicle: vehicle}
			ctx := WithScopedVoiceModeSession(context.Background(), ScopedVoiceModeSession{
				SessionID:    sess,
				HistoryLimit: tt.scopedLimit,
			})
			_, err := tool.Execute(ctx, streamChatbotResponseInput{
				SessionID:    sess,
				HistoryLimit: tt.inputLimit,
			})
			if err != nil {
				t.Fatalf("Execute err = %v, want nil", err)
			}
			if chat.gotLimit != tt.wantPortLimit {
				t.Errorf("port received limit = %d, want %d", chat.gotLimit, tt.wantPortLimit)
			}
			// The port must always receive the IN-SCOPE session id,
			// never a raw LLM-supplied one.
			if chat.gotSess != sess {
				t.Errorf("port received session = %q, want %q", chat.gotSess, sess)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Execute — happy path
// ---------------------------------------------------------------------------

func TestStreamChatbotResponse_Execute_HappyPath(t *testing.T) {
	t.Parallel()

	const sess = "sess-happy"
	chat := &fakeChatSource{
		turns: []VoiceModeChatTurn{
			{Role: "user", Content: "how much charge do I have"},
			{Role: "assistant", Content: "82 percent"},
		},
	}
	vehicle := &fakeVehicleSource{
		snap: VoiceModeVehicleSnapshot{
			VIN:              "5YJ3E1EA0KF000000",
			DisplayName:      "Bumblebee",
			SOCPercent:       ptrInt(82),
			ChargingState:    "Charging",
			LastDriveSummary: "12 miles yesterday afternoon",
		},
	}
	tool := &streamChatbotResponse{chat: chat, vehicle: vehicle}
	ctx := WithScopedVoiceModeSession(context.Background(), ScopedVoiceModeSession{
		SessionID:    sess,
		HistoryLimit: 8,
	})

	out, err := tool.Execute(ctx, streamChatbotResponseInput{SessionID: sess})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*VoiceModeEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *VoiceModeEnvelope", out)
	}

	// Both ports must be consulted exactly once.
	if chat.calls != 1 {
		t.Errorf("chat.calls = %d, want 1", chat.calls)
	}
	if vehicle.calls != 1 {
		t.Errorf("vehicle.calls = %d, want 1", vehicle.calls)
	}

	// History passthrough.
	if len(env.History) != 2 {
		t.Fatalf("env.History len = %d, want 2", len(env.History))
	}
	if env.History[0].Role != "user" || env.History[1].Role != "assistant" {
		t.Errorf("env.History roles = [%q,%q], want [user,assistant]", env.History[0].Role, env.History[1].Role)
	}

	// Snapshot passthrough.
	if env.VehicleSnapshot.VIN != "5YJ3E1EA0KF000000" {
		t.Errorf("snapshot.VIN = %q, want 5YJ3E1EA0KF000000", env.VehicleSnapshot.VIN)
	}
	if env.VehicleSnapshot.SOCPercent == nil || *env.VehicleSnapshot.SOCPercent != 82 {
		t.Errorf("snapshot.SOCPercent = %v, want 82", env.VehicleSnapshot.SOCPercent)
	}
	if env.VehicleSnapshot.ChargingState != "Charging" {
		t.Errorf("snapshot.ChargingState = %q, want Charging", env.VehicleSnapshot.ChargingState)
	}

	// Deterministic hint + breadcrumb.
	if !strings.Contains(env.VoiceModeHint, "spoken aloud") {
		t.Errorf("VoiceModeHint = %q, want it to mention 'spoken aloud'", env.VoiceModeHint)
	}
	if !strings.Contains(env.VoiceModeHint, "82 percent") {
		t.Errorf("VoiceModeHint = %q, want the TTS-friendly number example", env.VoiceModeHint)
	}
	if env.Source == "" {
		t.Error("env.Source breadcrumb is empty (LLM cannot attribute values)")
	}
	if !strings.Contains(env.Source, "GetHistory") {
		t.Errorf("env.Source = %q, want it to cite the ChatRepo reader", env.Source)
	}
}

func TestStreamChatbotResponse_Execute_PromotesNilHistory(t *testing.T) {
	t.Parallel()

	const sess = "sess-nil"
	chat := &fakeChatSource{turns: nil} // adapter returned a nil slice
	vehicle := &fakeVehicleSource{}
	tool := &streamChatbotResponse{chat: chat, vehicle: vehicle}
	ctx := WithScopedVoiceModeSession(context.Background(), ScopedVoiceModeSession{
		SessionID:    sess,
		HistoryLimit: 8,
	})

	out, err := tool.Execute(ctx, streamChatbotResponseInput{SessionID: sess})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env := out.(*VoiceModeEnvelope)
	if env.History == nil {
		t.Fatal("Execute did not promote nil History to empty slice (LLM could falsely claim any turn present)")
	}
	if len(env.History) != 0 {
		t.Errorf("env.History len = %d, want 0", len(env.History))
	}
}

func TestStreamChatbotResponse_Execute_EmptyScopeSessionMatchesEmptyInput(t *testing.T) {
	t.Parallel()
	// Defensive edge: an empty in-scope session_id matches an empty
	// input session_id (both ""), and the tool still resolves the
	// defensive default limit rather than crashing.
	chat := &fakeChatSource{}
	vehicle := &fakeVehicleSource{}
	tool := &streamChatbotResponse{chat: chat, vehicle: vehicle}
	ctx := WithScopedVoiceModeSession(context.Background(), ScopedVoiceModeSession{SessionID: "", HistoryLimit: 0})

	_, err := tool.Execute(ctx, streamChatbotResponseInput{SessionID: ""})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	if chat.gotLimit != 8 {
		t.Errorf("port received limit = %d, want defensive default 8", chat.gotLimit)
	}
}

// ---------------------------------------------------------------------------
// Envelope JSON shape
// ---------------------------------------------------------------------------

func TestVoiceModeEnvelope_JSONShape(t *testing.T) {
	t.Parallel()

	env := &VoiceModeEnvelope{
		History:         []VoiceModeChatTurn{{Role: "user", Content: "hi"}},
		VehicleSnapshot: VoiceModeVehicleSnapshot{SOCPercent: ptrInt(50), ChargingState: "Complete"},
		VoiceModeHint:   "keep it short",
		Source:          "readers: ...",
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("Marshal err = %v", err)
	}
	var got map[string]json.RawMessage
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("Unmarshal err = %v", err)
	}
	for _, key := range []string{"history", "vehicle_snapshot", "voice_mode_hint", "source"} {
		if _, ok := got[key]; !ok {
			t.Errorf("envelope JSON missing key %q; got=%s", key, raw)
		}
	}

	// The snapshot's omitempty fields must be absent when zero so a
	// leaked transcript never carries an empty VIN / display_name.
	var snap map[string]json.RawMessage
	if err := json.Unmarshal(got["vehicle_snapshot"], &snap); err != nil {
		t.Fatalf("Unmarshal vehicle_snapshot err = %v", err)
	}
	if _, present := snap["vin"]; present {
		t.Errorf("vehicle_snapshot included empty vin; want omitted")
	}
	if _, present := snap["soc_percent"]; !present {
		t.Errorf("vehicle_snapshot missing soc_percent; want present")
	}
}

func TestVoiceModeVehicleSnapshot_ZeroValueOmitsAllFields(t *testing.T) {
	t.Parallel()
	raw, err := json.Marshal(VoiceModeVehicleSnapshot{})
	if err != nil {
		t.Fatalf("Marshal err = %v", err)
	}
	// Every field is omitempty, so the zero snapshot marshals to `{}`
	// — the honest "no current vehicle data" answer.
	if string(raw) != "{}" {
		t.Errorf("zero snapshot marshalled to %s, want {}", raw)
	}
}

// ---------------------------------------------------------------------------
// Scope context helpers
// ---------------------------------------------------------------------------

func TestScopedVoiceModeSession_ContextRoundTrip(t *testing.T) {
	t.Parallel()

	// Absent scope reports (zero, false).
	if got, ok := ScopedVoiceModeSessionFromContext(context.Background()); ok {
		t.Errorf("FromContext(empty ctx) ok = true (got %+v), want false", got)
	}

	want := ScopedVoiceModeSession{SessionID: "sess-xyz", HistoryLimit: 12}
	ctx := WithScopedVoiceModeSession(context.Background(), want)
	got, ok := ScopedVoiceModeSessionFromContext(ctx)
	if !ok {
		t.Fatal("FromContext(installed ctx) ok = false, want true")
	}
	if got != want {
		t.Errorf("FromContext = %+v, want %+v", got, want)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterVoiceModeTools_RegistersOneTool(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterVoiceModeTools(r, VoiceModeSources{
		Chat:    &fakeChatSource{},
		Vehicle: &fakeVehicleSource{},
	})
	want := "stream_chatbot_response"
	if _, ok := r.Get(want); !ok {
		t.Errorf("Registry missing %q after RegisterVoiceModeTools", want)
	}
	if names := r.Names(); len(names) != 1 {
		t.Errorf("Registry has %d tools (%v), want exactly 1", len(names), names)
	}
}

func TestRegisterVoiceModeTools_PanicsOnDuplicate(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	s := VoiceModeSources{Chat: &fakeChatSource{}, Vehicle: &fakeVehicleSource{}}
	RegisterVoiceModeTools(r, s)
	defer func() {
		if recover() == nil {
			t.Error("second RegisterVoiceModeTools did not panic on duplicate")
		}
	}()
	RegisterVoiceModeTools(r, s)
}

// TestRegisterVoiceModeTools_WiresBothPorts proves registration wires
// non-nil ports: a full Validate→Execute round-trip through the
// registry must succeed end-to-end.
func TestRegisterVoiceModeTools_WiresBothPorts(t *testing.T) {
	t.Parallel()
	const sess = "sess-wired"
	chat := &fakeChatSource{turns: []VoiceModeChatTurn{{Role: "user", Content: "hi"}}}
	vehicle := &fakeVehicleSource{snap: VoiceModeVehicleSnapshot{ChargingState: "Disconnected"}}

	r := tools.NewRegistry()
	RegisterVoiceModeTools(r, VoiceModeSources{Chat: chat, Vehicle: vehicle})
	tool, ok := r.Get("stream_chatbot_response")
	if !ok {
		t.Fatal("registry missing stream_chatbot_response")
	}

	in, err := tool.Validate(json.RawMessage(`{"session_id":"` + sess + `","history_limit":4}`))
	if err != nil {
		t.Fatalf("Validate err = %v, want nil", err)
	}
	ctx := WithScopedVoiceModeSession(context.Background(), ScopedVoiceModeSession{SessionID: sess, HistoryLimit: 8})
	out, err := tool.Execute(ctx, in)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*VoiceModeEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *VoiceModeEnvelope", out)
	}
	if len(env.History) != 1 {
		t.Errorf("env.History len = %d, want 1", len(env.History))
	}
	if chat.gotLimit != 4 {
		t.Errorf("chat.gotLimit = %d, want 4 (explicit input limit)", chat.gotLimit)
	}
	if env.VehicleSnapshot.ChargingState != "Disconnected" {
		t.Errorf("snapshot.ChargingState = %q, want Disconnected", env.VehicleSnapshot.ChargingState)
	}
}
