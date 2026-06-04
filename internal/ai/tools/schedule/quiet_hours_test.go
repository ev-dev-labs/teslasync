// Unit tests for the draft_quiet_hours_window and
// validate_quiet_hours_window tools. The draft tool wraps a
// QuietHoursSuggestionSource port (production adapter wraps
// notification_logs + quiet_hours readers); the validator is a
// pure-Go mirror of the canonical
// internal/database/quiet_hours_repo.go validateQuietHours
// rules. Both unit-test surfaces stay hermetic by construction
// (a fake QuietHoursSuggestionSource for the draft tool, no
// fakes needed for the validator).
//
// The tools also enforce per-request scope binding, which defends
// against prompt-injection exfiltration via the LLM-supplied user_id
// argument. The scope-binding tests pin the contract:
// missing scope ⇒ refuse; mismatched scope ⇒ refuse; matched
// scope ⇒ delegate. A future edit that bypasses any of these
// gates would surface here.

package schedule

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/ai/tools"
)

// ---------------------------------------------------------------------------
// Fake source
// ---------------------------------------------------------------------------

// fakeQuietHoursSource is a hermetic stand-in for the
// production adapter (NotificationRepo + QuietHoursRepo). The
// per-test cases install canned responses; the tool never sees
// a database.
type fakeQuietHoursSource struct {
	loadHistoryFn  func(ctx context.Context, userID, timezone string, windowDays int) (*QuietHoursHistorySummary, error)
	countWindowsFn func(ctx context.Context, userID string) (int, error)
}

func (f *fakeQuietHoursSource) LoadHistory(ctx context.Context, userID, timezone string, windowDays int) (*QuietHoursHistorySummary, error) {
	if f.loadHistoryFn == nil {
		return &QuietHoursHistorySummary{
			Timezone:         timezone,
			WindowDays:       windowDays,
			HasEnoughHistory: true,
			SampleSize:       100,
			PerHourCounts:    [24]int{},
		}, nil
	}
	return f.loadHistoryFn(ctx, userID, timezone, windowDays)
}

func (f *fakeQuietHoursSource) CountExistingWindows(ctx context.Context, userID string) (int, error) {
	if f.countWindowsFn == nil {
		return 0, nil
	}
	return f.countWindowsFn(ctx, userID)
}

// ---------------------------------------------------------------------------
// draft_quiet_hours_window
// ---------------------------------------------------------------------------

func TestDraftQuietHoursWindow_Name(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{}
	if got := tool.Name(); got != "draft_quiet_hours_window" {
		t.Errorf("Name() = %q, want draft_quiet_hours_window", got)
	}
}

func TestDraftQuietHoursWindow_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"per-hour", "READ-only", "candidate"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestDraftQuietHoursWindow_Validate(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{}
	v, err := tool.Validate(json.RawMessage(`{"user_id":"alice@example.com"}`))
	if err != nil {
		t.Fatalf("Validate(valid) err = %v, want nil", err)
	}
	in, ok := v.(draftQuietHoursWindowInput)
	if !ok {
		t.Fatalf("Validate returned %T, want draftQuietHoursWindowInput", v)
	}
	if in.UserID != "alice@example.com" {
		t.Errorf("Validate.UserID = %q, want alice@example.com", in.UserID)
	}

	if _, err := tool.Validate(json.RawMessage(`{}`)); err == nil {
		t.Error("Validate({}) returned nil err, want missing-required-field err")
	}
}

func TestDraftQuietHoursWindow_Execute_RefusesWithoutScope(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{}}
	_, err := tool.Execute(context.Background(), draftQuietHoursWindowInput{UserID: "alice"})
	if err == nil {
		t.Fatal("Execute(no scope) returned nil err, want scope-binding refusal")
	}
	if !strings.Contains(err.Error(), "in-scope") {
		t.Errorf("Execute(no scope) err = %v, want scope-binding refusal", err)
	}
}

func TestDraftQuietHoursWindow_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	_, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "bob"})
	if err == nil {
		t.Fatal("Execute(mismatched scope) returned nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "does not match in-scope") {
		t.Errorf("Execute(mismatched scope) err = %v, want scope mismatch refusal", err)
	}
}

func TestDraftQuietHoursWindow_Execute_RefusesNilSource(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: nil}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	_, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err == nil {
		t.Fatal("Execute(nil source) returned nil err, want refusal")
	}
}

func TestDraftQuietHoursWindow_Execute_RefusesUnsetWindowDays(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 0, // unset
	})
	_, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err == nil {
		t.Fatal("Execute(unset window_days) returned nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "window_days") {
		t.Errorf("Execute err = %v, want window_days refusal", err)
	}
}

func TestDraftQuietHoursWindow_Execute_RefusesUnsetTimezone(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "", WindowDays: 30, // unset
	})
	_, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err == nil {
		t.Fatal("Execute(unset timezone) returned nil err, want refusal")
	}
	if !strings.Contains(err.Error(), "timezone") {
		t.Errorf("Execute err = %v, want timezone refusal", err)
	}
}

func TestDraftQuietHoursWindow_Execute_PropagatesSourceError(t *testing.T) {
	t.Parallel()
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{
		loadHistoryFn: func(_ context.Context, _, _ string, _ int) (*QuietHoursHistorySummary, error) {
			return nil, errors.New("notification_logs query failed: connection refused")
		},
	}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	_, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err == nil {
		t.Fatal("Execute returned nil err when source returned err")
	}
}

func TestDraftQuietHoursWindow_Execute_AcceptsMatchedScope(t *testing.T) {
	t.Parallel()
	// Construct a per-hour traffic profile where 22:00-07:00
	// is quiet (counts of 0) and other hours have traffic.
	// The candidate-finder should pick a window inside that
	// quiet zone.
	hist := &QuietHoursHistorySummary{
		Timezone:         "UTC",
		WindowDays:       30,
		HasEnoughHistory: true,
		SampleSize:       240,
	}
	for h := 0; h < 24; h++ {
		if h >= 7 && h < 22 {
			hist.PerHourCounts[h] = 10
		} else {
			hist.PerHourCounts[h] = 0
		}
	}
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{
		loadHistoryFn:  func(_ context.Context, _, _ string, _ int) (*QuietHoursHistorySummary, error) { return hist, nil },
		countWindowsFn: func(_ context.Context, _ string) (int, error) { return 2, nil },
	}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	out, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	envelope, ok := out.(*QuietHoursWindowProposal)
	if !ok {
		t.Fatalf("Execute returned %T, want *QuietHoursWindowProposal", out)
	}
	if envelope.UserID != "alice" {
		t.Errorf("envelope.UserID = %q, want alice", envelope.UserID)
	}
	if envelope.Timezone != "UTC" {
		t.Errorf("envelope.Timezone = %q, want UTC", envelope.Timezone)
	}
	if envelope.Status != "ok" {
		t.Errorf("envelope.Status = %q, want ok", envelope.Status)
	}
	if envelope.ExistingWindowsCount != 2 {
		t.Errorf("envelope.ExistingWindowsCount = %d, want 2", envelope.ExistingWindowsCount)
	}
	// critical MUST always be present in bypass.
	hasCritical := false
	for _, s := range envelope.BypassSeverities {
		if s == "critical" {
			hasCritical = true
		}
	}
	if !hasCritical {
		t.Errorf("envelope.BypassSeverities = %v, missing critical", envelope.BypassSeverities)
	}
	// Source disclosure pin: the narrator's "based on your
	// notification history" disclosure depends on this.
	if !strings.Contains(envelope.Source, "notification_repo.go") {
		t.Errorf("envelope.Source missing reader disclosure: %q", envelope.Source)
	}
}

func TestDraftQuietHoursWindow_Execute_InsufficientHistoryFlagsConservativeDefault(t *testing.T) {
	t.Parallel()
	hist := &QuietHoursHistorySummary{
		Timezone:         "UTC",
		WindowDays:       30,
		HasEnoughHistory: false, // not enough
		SampleSize:       3,
	}
	tool := &draftQuietHoursWindow{source: &fakeQuietHoursSource{
		loadHistoryFn: func(_ context.Context, _, _ string, _ int) (*QuietHoursHistorySummary, error) { return hist, nil },
	}}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	out, err := tool.Execute(ctx, draftQuietHoursWindowInput{UserID: "alice"})
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	envelope := out.(*QuietHoursWindowProposal)
	if envelope.Status != "insufficient_history" {
		t.Errorf("envelope.Status = %q, want insufficient_history", envelope.Status)
	}
	if envelope.StartLocal != "22:00" || envelope.EndLocal != "07:00" {
		t.Errorf("envelope window = %q-%q, want conservative default 22:00-07:00",
			envelope.StartLocal, envelope.EndLocal)
	}
}

// TestPickQuietHoursWindow_AllZeroFallsBackToDefault pins the
// pathological all-quiet case: rather than propose a 24-hour
// silence, the picker returns the conservative 22:00-07:00
// default.
func TestPickQuietHoursWindow_AllZeroFallsBackToDefault(t *testing.T) {
	t.Parallel()
	hist := &QuietHoursHistorySummary{
		HasEnoughHistory: true,
		SampleSize:       100,
	}
	for h := 0; h < 24; h++ {
		hist.PerHourCounts[h] = 0
	}
	start, end, status := pickQuietHoursWindow(hist)
	if start != "22:00" || end != "07:00" {
		t.Errorf("pickQuietHoursWindow(all zero) = %q-%q, want 22:00-07:00", start, end)
	}
	if status != "insufficient_history" {
		t.Errorf("pickQuietHoursWindow(all zero) status = %q, want insufficient_history", status)
	}
}

// TestPickQuietHoursWindow_NilSummaryFallsBackToDefault pins
// the nil-pointer guard for callers that hand a nil summary.
func TestPickQuietHoursWindow_NilSummaryFallsBackToDefault(t *testing.T) {
	t.Parallel()
	start, end, status := pickQuietHoursWindow(nil)
	if start != "22:00" || end != "07:00" {
		t.Errorf("pickQuietHoursWindow(nil) = %q-%q, want 22:00-07:00", start, end)
	}
	if status != "insufficient_history" {
		t.Errorf("pickQuietHoursWindow(nil) status = %q, want insufficient_history", status)
	}
}

// ---------------------------------------------------------------------------
// validate_quiet_hours_window
// ---------------------------------------------------------------------------

func TestValidateQuietHoursWindow_Name(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	if got := tool.Name(); got != "validate_quiet_hours_window" {
		t.Errorf("Name() = %q, want validate_quiet_hours_window", got)
	}
}

func TestValidateQuietHoursWindow_PropOnlyContract(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	if tool.Mutates() {
		t.Errorf("Mutates() = true, want false (read-only)")
	}
	if tool.RequiredScope() != "" {
		t.Errorf("RequiredScope() = %q, want empty", tool.RequiredScope())
	}
	desc := tool.Description()
	for _, must := range []string{"READ-only", "errors", "warnings", "narrator MUST REFUSE"} {
		if !strings.Contains(desc, must) {
			t.Errorf("Description() missing %q: %q", must, desc)
		}
	}
}

func TestValidateQuietHoursWindow_Execute_RefusesWithoutScope(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	_, err := tool.Execute(context.Background(), validateQuietHoursWindowInput{
		UserID: "alice", StartLocal: "22:00", EndLocal: "07:00",
		Timezone: "UTC", Weekdays: 127, BypassSeverities: []string{"critical"},
	})
	if err == nil {
		t.Fatal("Execute(no scope) returned nil err, want scope-binding refusal")
	}
}

func TestValidateQuietHoursWindow_Execute_RefusesMismatchedScope(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	ctx := WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
	_, err := tool.Execute(ctx, validateQuietHoursWindowInput{
		UserID: "bob", StartLocal: "22:00", EndLocal: "07:00",
		Timezone: "UTC", Weekdays: 127, BypassSeverities: []string{"critical"},
	})
	if err == nil {
		t.Fatal("Execute(mismatched scope) returned nil err, want refusal")
	}
}

// completeQuietHoursPlan returns a fully-valid candidate window
// used as the baseline for ok=true assertions.
func completeQuietHoursPlan() validateQuietHoursWindowInput {
	return validateQuietHoursWindowInput{
		UserID:           "alice",
		StartLocal:       "22:00",
		EndLocal:         "07:00",
		Timezone:         "America/Los_Angeles",
		Weekdays:         127,
		BypassSeverities: []string{"critical"},
	}
}

func aliceScopedCtx() context.Context {
	return WithScopedQuietHoursWindow(context.Background(), ScopedQuietHoursWindow{
		UserID: "alice", Timezone: "UTC", WindowDays: 30,
	})
}

func TestValidateQuietHoursWindow_Execute_OKForCompletePlan(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	out, err := tool.Execute(aliceScopedCtx(), completeQuietHoursPlan())
	if err != nil {
		t.Fatalf("Execute(complete plan) err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if !res.OK {
		t.Errorf("complete plan: OK = false, errors=%v", res.Errors)
	}
	if len(res.Errors) != 0 {
		t.Errorf("complete plan: errors = %v, want empty", res.Errors)
	}
}

func TestValidateQuietHoursWindow_Execute_RejectsMalformedHHMM(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.StartLocal = "25:00" // invalid hour
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if res.OK {
		t.Errorf("malformed HH:MM: OK = true, want false")
	}
	if len(res.Errors) == 0 {
		t.Error("malformed HH:MM: errors = empty, want HH:MM err")
	}
}

func TestValidateQuietHoursWindow_Execute_RejectsZeroDuration(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.EndLocal = plan.StartLocal // start == end
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if res.OK {
		t.Errorf("zero duration: OK = true, want false")
	}
	foundDur := false
	for _, e := range res.Errors {
		if strings.Contains(e, "must differ") || strings.Contains(e, "zero-duration") {
			foundDur = true
			break
		}
	}
	if !foundDur {
		t.Errorf("zero duration: missing zero-duration err in %v", res.Errors)
	}
}

func TestValidateQuietHoursWindow_Execute_RejectsInvalidTimezone(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.Timezone = "Mars/Jezero"
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if res.OK {
		t.Errorf("invalid TZ: OK = true, want false")
	}
}

func TestValidateQuietHoursWindow_Execute_RejectsBadSeverity(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.BypassSeverities = []string{"critical", "panic"} // panic not in allow-set
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if res.OK {
		t.Errorf("bad severity: OK = true, want false")
	}
}

func TestValidateQuietHoursWindow_Execute_WarnsCriticalMissing(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.BypassSeverities = []string{"warn"} // critical missing
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if !res.OK {
		t.Errorf("critical missing: OK = false, errors=%v (warning, not error)", res.Errors)
	}
	foundWarn := false
	for _, w := range res.Warnings {
		if strings.Contains(w, "critical") {
			foundWarn = true
			break
		}
	}
	if !foundWarn {
		t.Errorf("critical missing: missing warning in %v", res.Warnings)
	}
}

func TestValidateQuietHoursWindow_Execute_WarnsZeroWeekdays(t *testing.T) {
	t.Parallel()
	tool := &validateQuietHoursWindow{}
	plan := completeQuietHoursPlan()
	plan.Weekdays = 0
	out, err := tool.Execute(aliceScopedCtx(), plan)
	if err != nil {
		t.Fatalf("Execute err = %v, want nil", err)
	}
	res := out.(validateQuietHoursWindowResult)
	if !res.OK {
		t.Errorf("zero weekdays: OK = false, errors=%v (warning, not error)", res.Errors)
	}
	foundWarn := false
	for _, w := range res.Warnings {
		if strings.Contains(w, "weekdays") {
			foundWarn = true
			break
		}
	}
	if !foundWarn {
		t.Errorf("zero weekdays: missing warning in %v", res.Warnings)
	}
}

// ---------------------------------------------------------------------------
// validQuietHoursHHMM
// ---------------------------------------------------------------------------

func TestValidQuietHoursHHMM(t *testing.T) {
	t.Parallel()
	cases := []struct {
		in   string
		want bool
	}{
		{"00:00", true},
		{"22:00", true},
		{"23:59", true},
		{"07:30", true},
		{"24:00", false}, // hour out of range
		{"23:60", false}, // minute out of range
		{"7:30", false},  // missing leading zero
		{"22:0", false},  // missing leading minute zero
		{"22-00", false}, // wrong separator
		{"22:00:00", false},
		{"", false},
		{"abc", false},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			if got := validQuietHoursHHMM(c.in); got != c.want {
				t.Errorf("validQuietHoursHHMM(%q) = %v, want %v", c.in, got, c.want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Scope helpers
// ---------------------------------------------------------------------------

func TestScopedQuietHoursWindow_RoundTrip(t *testing.T) {
	t.Parallel()
	in := ScopedQuietHoursWindow{UserID: "alice", Timezone: "UTC", WindowDays: 30}
	ctx := WithScopedQuietHoursWindow(context.Background(), in)
	out, ok := ScopedQuietHoursWindowFromContext(ctx)
	if !ok {
		t.Fatal("ScopedQuietHoursWindowFromContext returned ok=false after install")
	}
	if out != in {
		t.Errorf("round-trip: got %+v, want %+v", out, in)
	}
}

func TestScopedQuietHoursWindow_NoScopeInBareContext(t *testing.T) {
	t.Parallel()
	_, ok := ScopedQuietHoursWindowFromContext(context.Background())
	if ok {
		t.Error("ScopedQuietHoursWindowFromContext returned ok=true on bare context")
	}
}

// ---------------------------------------------------------------------------
// Registry wiring
// ---------------------------------------------------------------------------

func TestRegisterQuietHoursSuggestionTools(t *testing.T) {
	t.Parallel()
	r := tools.NewRegistry()
	RegisterQuietHoursSuggestionTools(r, QuietHoursSuggestionSources{Source: &fakeQuietHoursSource{}})
	for _, name := range []string{"draft_quiet_hours_window", "validate_quiet_hours_window"} {
		if _, ok := r.Get(name); !ok {
			t.Errorf("registry missing %q after RegisterQuietHoursSuggestionTools", name)
		}
	}
}
