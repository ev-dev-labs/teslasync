// Phase-50 / 0056 — V2 Helix watch-face natural-language response.
//
// Unit tests for the query_watch_context tool. The tool wraps
// two narrow ports (WatchContextSource + AlertHistorySource); in
// production those wrap the canonical VehicleRepo +
// signal.LiveStateReader + NotificationRepo, but the test
// substitutes hermetic fakes so the tool unit tests stay free
// of database / Redis IO.

package tools

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

// ---------------------------------------------------------------------------
// Fake sources
// ---------------------------------------------------------------------------

// fakeWatchContextSource is a hermetic stand-in for the
// production adapter (*api.AIWatchFaceNLContextSource).
type fakeWatchContextSource struct {
	loadFn func(ctx context.Context) (*WatchContextEnvelope, error)
}

func (f *fakeWatchContextSource) LoadWatchContext(ctx context.Context) (*WatchContextEnvelope, error) {
	if f.loadFn == nil {
		return &WatchContextEnvelope{
			VehicleName:  "Model 3",
			SOCPercent:   82,
			RangeKm:      278.4,
			RangeMi:      173.0,
			IsCharging:   false,
			IsLocked:     true,
			SentryMode:   true,
			IsClimateOn:  false,
			InsideTempC:  21.0,
			InsideTempF:  69.8,
			OutsideTempC: 12.5,
			OutsideTempF: 54.5,
			LastUpdated:  "2024-04-01T12:00:00Z",
			Source:       "fake",
		}, nil
	}
	return f.loadFn(ctx)
}

// fakeAlertHistorySource is a hermetic stand-in for the
// production adapter (*api.AIWatchFaceNLAlertHistorySource).
type fakeAlertHistorySource struct {
	loadFn func(ctx context.Context, max int) ([]WatchAlertEntry, error)
}

func (f *fakeAlertHistorySource) LoadRecentAlerts(ctx context.Context, max int) ([]WatchAlertEntry, error) {
	if f.loadFn == nil {
		return []WatchAlertEntry{
			{Severity: "warn", AgeSeconds: 3600},
			{Severity: "info", AgeSeconds: 7200},
		}, nil
	}
	return f.loadFn(ctx, max)
}

// ---------------------------------------------------------------------------
// query_watch_context
// ---------------------------------------------------------------------------

func TestQueryWatchContext_Name(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{}
	if got := tool.Name(); got != "query_watch_context" {
		t.Errorf("Name() = %q, want query_watch_context", got)
	}
}

func TestQueryWatchContext_ReadOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
}

func TestQueryWatchContext_Description(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{}
	desc := tool.Description()
	for _, must := range []string{
		"watch face",
		"soc_percent",
		"range_km",
		"range_mi",
		"inside_temp_c",
		"inside_temp_f",
		"outside_temp_c",
		"outside_temp_f",
		"recent_alerts",
		"max 5",
		"non-critical",
		"READ-only",
		"NO database write",
		// Honest "no PII crosses the boundary" disclosure.
		"NO PII",
		"NO title or message body",
		// Honest "null means unknown" disclosure mirrors the
		// strategy's "do not fabricate" directive.
		"refer the user to the watch-face tap icon",
	} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q; got=%q", must, desc)
		}
	}
}

func TestQueryWatchContext_InputSchemaIsEmpty(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{}
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
	if req, ok := got["required"].([]any); ok && len(req) > 0 {
		t.Errorf("InputSchema().required = %v, want empty (tool takes no arguments)", req)
	}
}

func TestQueryWatchContext_ValidateAcceptsEmptyObject(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{}
	in, err := tool.Validate(json.RawMessage(`{}`))
	if err != nil {
		t.Fatalf("Validate({}) err = %v, want nil", err)
	}
	if _, ok := in.(queryWatchContextInput); !ok {
		t.Fatalf("Validate({}) returned %T, want queryWatchContextInput", in)
	}
}

func TestQueryWatchContext_ExecuteRefusesMissingSource(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{} // source intentionally nil
	_, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err == nil {
		t.Fatal("Execute with nil source = nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "no WatchContextSource wired") {
		t.Errorf("Execute err = %q, want substring 'no WatchContextSource wired'", err)
	}
}

func TestQueryWatchContext_ExecuteSurfacesSourceError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("source-down")
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{
			loadFn: func(ctx context.Context) (*WatchContextEnvelope, error) {
				return nil, wantErr
			},
		},
	}
	_, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if !errors.Is(err, wantErr) {
		t.Errorf("Execute err = %v, want wraps %v", err, wantErr)
	}
}

func TestQueryWatchContext_ExecuteRefusesNilEnvelope(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{
			loadFn: func(ctx context.Context) (*WatchContextEnvelope, error) {
				return nil, nil
			},
		},
	}
	_, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err == nil {
		t.Fatal("Execute with nil envelope = nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "nil envelope") {
		t.Errorf("Execute err = %q, want substring 'nil envelope'", err)
	}
}

// TestQueryWatchContext_ExecutePromotesNilAlerts proves the
// defensive "always non-nil RecentAlerts" invariant. The LLM
// uses len(recent_alerts) == 0 to honestly say "no recent
// alerts"; a nil slice would JSON-marshal as `null`, which the
// LLM might misread as "alert list is unavailable" and refuse
// to answer.
func TestQueryWatchContext_ExecutePromotesNilAlerts(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{}, // canned envelope
		alerts: &fakeAlertHistorySource{
			loadFn: func(ctx context.Context, max int) ([]WatchAlertEntry, error) {
				return nil, nil
			},
		},
	}
	out, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*WatchContextEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *WatchContextEnvelope", out)
	}
	if env.RecentAlerts == nil {
		t.Fatal("Execute did not promote nil RecentAlerts to empty slice")
	}
	if len(env.RecentAlerts) != 0 {
		t.Errorf("Execute promoted nil to non-empty slice: %v", env.RecentAlerts)
	}
}

// TestQueryWatchContext_ExecuteSurvivesAlertSourceFailure
// proves the "best-effort alert hydration" invariant: a
// failure on the alert side does NOT abort the tool. The
// user's "how much battery" question is still answerable
// when the notification store is unavailable.
func TestQueryWatchContext_ExecuteSurvivesAlertSourceFailure(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{},
		alerts: &fakeAlertHistorySource{
			loadFn: func(ctx context.Context, max int) ([]WatchAlertEntry, error) {
				return nil, errors.New("notif-repo-down")
			},
		},
	}
	out, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (alert failure should NOT abort tool)", err)
	}
	env, ok := out.(*WatchContextEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *WatchContextEnvelope", out)
	}
	if env.RecentAlerts == nil {
		t.Fatal("Execute did not initialize RecentAlerts to empty slice after alert source failure")
	}
	if env.VehicleName != "Model 3" {
		t.Errorf("Execute lost vehicle snapshot after alert source failure: VehicleName = %q", env.VehicleName)
	}
}

// TestQueryWatchContext_ExecuteSurvivesNilAlertSource proves the
// tool runs even when the AlertHistorySource is not wired —
// future deployments may disable the alert hydration entirely
// without breaking the basic vehicle snapshot.
func TestQueryWatchContext_ExecuteSurvivesNilAlertSource(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{},
		// alerts intentionally nil
	}
	out, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil (nil alert source should be tolerated)", err)
	}
	env, ok := out.(*WatchContextEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *WatchContextEnvelope", out)
	}
	if env.RecentAlerts == nil {
		t.Fatal("Execute did not initialize RecentAlerts to empty slice with nil alert source")
	}
}

func TestQueryWatchContext_ExecuteHappyPathDelegates(t *testing.T) {
	t.Parallel()
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{},
		alerts: &fakeAlertHistorySource{},
	}
	out, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	env, ok := out.(*WatchContextEnvelope)
	if !ok {
		t.Fatalf("Execute returned %T, want *WatchContextEnvelope", out)
	}
	if env.Source == "" {
		t.Error("Execute returned envelope with empty Source breadcrumb")
	}
	if env.VehicleName != "Model 3" {
		t.Errorf("Execute envelope VehicleName = %q, want Model 3", env.VehicleName)
	}
	// Both km AND mi must be populated side by side
	// (cToFPtr precedent).
	if env.RangeKm == nil {
		t.Error("Execute envelope missing RangeKm (cToFPtr-style dual unit precedent)")
	}
	if env.RangeMi == nil {
		t.Error("Execute envelope missing RangeMi (cToFPtr-style dual unit precedent)")
	}
	if env.InsideTempC == nil || env.InsideTempF == nil {
		t.Error("Execute envelope missing dual-unit inside temperature pair")
	}
	if env.OutsideTempC == nil || env.OutsideTempF == nil {
		t.Error("Execute envelope missing dual-unit outside temperature pair")
	}
	if len(env.RecentAlerts) != 2 {
		t.Errorf("Execute envelope RecentAlerts length = %d, want 2", len(env.RecentAlerts))
	}
}

// TestQueryWatchContext_ExecutePassesMaxToAlertSource proves
// the tool passes maxWatchAlerts (5) down to the alert source
// — the projection invariant depends on the cap being enforced
// at the adapter layer, but the tool also asks for the right
// limit so the adapter has the right hint.
func TestQueryWatchContext_ExecutePassesMaxToAlertSource(t *testing.T) {
	t.Parallel()
	var gotMax int
	tool := &queryWatchContext{
		source: &fakeWatchContextSource{},
		alerts: &fakeAlertHistorySource{
			loadFn: func(ctx context.Context, max int) ([]WatchAlertEntry, error) {
				gotMax = max
				return []WatchAlertEntry{}, nil
			},
		},
	}
	_, err := tool.Execute(context.Background(), queryWatchContextInput{})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	if gotMax != maxWatchAlerts {
		t.Errorf("Execute passed max=%d to AlertHistorySource, want %d", gotMax, maxWatchAlerts)
	}
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

func TestRegisterWatchFaceNLResponseTools_RegistersOneTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeWatchContextSource{}
	alerts := &fakeAlertHistorySource{}
	RegisterWatchFaceNLResponseTools(r, WatchFaceNLResponseSources{Source: src, Alerts: alerts})
	want := "query_watch_context"
	if _, ok := r.Get(want); !ok {
		t.Errorf("Registry missing %q after RegisterWatchFaceNLResponseTools", want)
	}
}

func TestRegisterWatchFaceNLResponseTools_PanicsOnDuplicate(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	src := &fakeWatchContextSource{}
	alerts := &fakeAlertHistorySource{}
	RegisterWatchFaceNLResponseTools(r, WatchFaceNLResponseSources{Source: src, Alerts: alerts})
	defer func() {
		if recover() == nil {
			t.Error("RegisterWatchFaceNLResponseTools second call did not panic")
		}
	}()
	RegisterWatchFaceNLResponseTools(r, WatchFaceNLResponseSources{Source: src, Alerts: alerts})
}
