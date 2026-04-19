package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock Engine ─────────────────────────────────────────

type mockEngine struct {
	mu          sync.Mutex
	calls       []engineCall
	returnErr   error
	onEvaluate  func(automationID int64, snapshot json.RawMessage)
}

type engineCall struct {
	AutomationID int64
	Snapshot     json.RawMessage
}

func (m *mockEngine) Evaluate(_ context.Context, automationID int64, snapshot json.RawMessage) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls = append(m.calls, engineCall{automationID, snapshot})
	if m.onEvaluate != nil {
		m.onEvaluate(automationID, snapshot)
	}
	return m.returnErr
}

func (m *mockEngine) callCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.calls)
}

func (m *mockEngine) lastCall() *engineCall {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.calls) == 0 {
		return nil
	}
	c := m.calls[len(m.calls)-1]
	return &c
}

// ─── Mock Repo ───────────────────────────────────────────

type mockRepo struct {
	mu          sync.Mutex
	automations []*models.Automation
	disabled    map[int64]string // id → reason
	returnErr   error
}

func newMockRepo() *mockRepo {
	return &mockRepo{disabled: make(map[int64]string)}
}

func (r *mockRepo) GetByTriggerType(_ context.Context, triggerType string) ([]*models.Automation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	var result []*models.Automation
	for _, a := range r.automations {
		if a.TriggerType == triggerType {
			result = append(result, a)
		}
	}
	return result, nil
}

func (r *mockRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.disabled[id] = reason
	return nil
}

func (r *mockRepo) isDisabled(id int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.disabled[id]
	return ok
}

func (r *mockRepo) disabledReason(id int64) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.disabled[id]
}

// ─── Helpers ─────────────────────────────────────────────

func makeAutomation(id int64, name, cronExpr, tz string) *models.Automation {
	cfg := CronConfig{CronExpr: cronExpr, Timezone: tz}
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "cron",
		TriggerConfig: raw,
	}
}

func makeOneTimeAutomation(id int64, name, cronExpr, tz, date string) *models.Automation {
	cfg := CronConfig{CronExpr: cronExpr, Timezone: tz, OneTime: true, OneTimeDate: date}
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "cron",
		TriggerConfig: raw,
	}
}

// ─── CronConfig Parsing ─────────────────────────────────

func TestParseCronConfig_Valid(t *testing.T) {
	raw := json.RawMessage(`{"cron_expr":"15 7 * * 1-5","timezone":"America/Los_Angeles","one_time":false}`)
	cfg, err := parseCronConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CronExpr != "15 7 * * 1-5" {
		t.Fatalf("expected cron_expr '15 7 * * 1-5', got %q", cfg.CronExpr)
	}
	if cfg.Timezone != "America/Los_Angeles" {
		t.Fatalf("expected timezone 'America/Los_Angeles', got %q", cfg.Timezone)
	}
	if cfg.OneTime {
		t.Fatal("expected one_time false")
	}
}

func TestParseCronConfig_Empty(t *testing.T) {
	_, err := parseCronConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseCronConfig_InvalidJSON(t *testing.T) {
	_, err := parseCronConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseCronConfig_OneTime(t *testing.T) {
	raw := json.RawMessage(`{"cron_expr":"0 8 * * *","one_time":true,"one_time_date":"2026-05-01"}`)
	cfg, err := parseCronConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !cfg.OneTime {
		t.Fatal("expected one_time true")
	}
	if cfg.OneTimeDate != "2026-05-01" {
		t.Fatalf("expected one_time_date '2026-05-01', got %q", cfg.OneTimeDate)
	}
}

// ─── Timezone Loading ────────────────────────────────────

func TestLoadTimezone_Empty_DefaultsUTC(t *testing.T) {
	loc, err := loadTimezone("")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if loc != time.UTC {
		t.Fatalf("expected UTC, got %v", loc)
	}
}

func TestLoadTimezone_Valid(t *testing.T) {
	loc, err := loadTimezone("America/New_York")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if loc.String() != "America/New_York" {
		t.Fatalf("expected America/New_York, got %v", loc)
	}
}

func TestLoadTimezone_Invalid(t *testing.T) {
	_, err := loadTimezone("Mars/Olympus_Mons")
	if err == nil {
		t.Fatal("expected error for invalid timezone")
	}
}

// ─── OneTimeDate Validation ──────────────────────────────

func TestIsOneTimeDatePast_FutureDate(t *testing.T) {
	future := time.Now().Add(48 * time.Hour).Format("2006-01-02")
	past, _ := isOneTimeDatePast(future, time.UTC)
	if past {
		t.Fatalf("future date %s should not be past", future)
	}
}

func TestIsOneTimeDatePast_PastDate(t *testing.T) {
	pastDate := time.Now().Add(-48 * time.Hour).Format("2006-01-02")
	past, reason := isOneTimeDatePast(pastDate, time.UTC)
	if !past {
		t.Fatalf("past date %s should be expired", pastDate)
	}
	if reason == "" {
		t.Fatal("expected reason for expired date")
	}
}

func TestIsOneTimeDatePast_Today(t *testing.T) {
	today := time.Now().Format("2006-01-02")
	past, _ := isOneTimeDatePast(today, time.UTC)
	if past {
		t.Fatal("today's date should not be considered past")
	}
}

func TestIsOneTimeDatePast_InvalidFormat(t *testing.T) {
	past, reason := isOneTimeDatePast("not-a-date", time.UTC)
	if !past {
		t.Fatal("invalid date should be considered expired")
	}
	if reason == "" {
		t.Fatal("expected reason for invalid format")
	}
}

// ─── Register / Unregister ───────────────────────────────

func TestRegister_ValidAutomation(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "morning-charge", "15 7 * * 1-5", "America/Los_Angeles")

	if err := ct.Register(a); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ct.IsRegistered(1) {
		t.Fatal("expected automation 1 to be registered")
	}
	if ct.RegisteredCount() != 1 {
		t.Fatalf("expected 1 registered, got %d", ct.RegisteredCount())
	}
}

func TestRegister_InvalidCronExpr(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "bad-cron", "invalid cron expression", "")
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for invalid cron expression")
	}
	if ct.IsRegistered(1) {
		t.Fatal("invalid automation should not be registered")
	}
}

func TestRegister_EmptyCronExpr(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "empty-cron", "", "")
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for empty cron expression")
	}
}

func TestRegister_InvalidTimezone(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "bad-tz", "0 8 * * *", "Invalid/Timezone")
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for invalid timezone")
	}
}

func TestRegister_PredefinedSchedule(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "hourly", "@hourly", "")
	if err := ct.Register(a); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ct.IsRegistered(1) {
		t.Fatal("expected hourly schedule to be registered")
	}
}

func TestRegister_ReplacesExisting(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "test", "0 8 * * *", "")
	ct.Register(a)

	// Re-register with different expression
	a2 := makeAutomation(1, "test", "0 9 * * *", "")
	if err := ct.Register(a2); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ct.RegisteredCount() != 1 {
		t.Fatalf("expected 1 registered after replace, got %d", ct.RegisteredCount())
	}
}

func TestUnregister(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "test", "0 8 * * *", "")
	ct.Register(a)
	if !ct.IsRegistered(1) {
		t.Fatal("should be registered")
	}

	ct.Unregister(1)
	if ct.IsRegistered(1) {
		t.Fatal("should be unregistered")
	}
	if ct.RegisteredCount() != 0 {
		t.Fatalf("expected 0 registered, got %d", ct.RegisteredCount())
	}
}

func TestUnregister_NonExistent(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	// Should not panic.
	ct.Unregister(999)
}

// ─── Register OneTime ────────────────────────────────────

func TestRegister_OneTime_PastDate_Rejected(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	pastDate := time.Now().Add(-48 * time.Hour).Format("2006-01-02")
	a := makeOneTimeAutomation(1, "past-one-time", "0 8 * * *", "", pastDate)
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for past one-time date")
	}
}

func TestRegister_OneTime_FutureDate_Accepted(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	futureDate := time.Now().Add(48 * time.Hour).Format("2006-01-02")
	a := makeOneTimeAutomation(1, "future-one-time", "0 8 * * *", "", futureDate)
	if err := ct.Register(a); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !ct.IsRegistered(1) {
		t.Fatal("expected one-time automation to be registered")
	}
}

func TestRegister_OneTime_NoDate(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	// one_time without a date should still register (fires on next cron match).
	cfg := CronConfig{CronExpr: "0 8 * * *", OneTime: true}
	raw, _ := json.Marshal(cfg)
	a := &models.Automation{
		ID: 1, Name: "no-date-one-time", Enabled: true,
		TriggerType: "cron", TriggerConfig: raw,
	}
	if err := ct.Register(a); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ─── Start ───────────────────────────────────────────────

func TestStart_LoadsFromDB(t *testing.T) {
	repo := newMockRepo()
	repo.automations = []*models.Automation{
		makeAutomation(1, "auto-1", "0 8 * * *", ""),
		makeAutomation(2, "auto-2", "@daily", "America/New_York"),
	}
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	if err := ct.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ct.RegisteredCount() != 2 {
		t.Fatalf("expected 2 registered, got %d", ct.RegisteredCount())
	}
}

func TestStart_SkipsInvalid_DisablesInDB(t *testing.T) {
	repo := newMockRepo()
	repo.automations = []*models.Automation{
		makeAutomation(1, "valid", "0 8 * * *", ""),
		makeAutomation(2, "invalid-cron", "not valid", ""),
		makeAutomation(3, "valid-2", "@hourly", ""),
	}
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	if err := ct.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 2 valid, 1 invalid
	if ct.RegisteredCount() != 2 {
		t.Fatalf("expected 2 registered, got %d", ct.RegisteredCount())
	}
	if !repo.isDisabled(2) {
		t.Fatal("expected invalid automation 2 to be auto-disabled")
	}
	if repo.isDisabled(1) || repo.isDisabled(3) {
		t.Fatal("valid automations should not be disabled")
	}
}

func TestStart_DBError(t *testing.T) {
	repo := newMockRepo()
	repo.returnErr = fmt.Errorf("db connection failed")
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	err := ct.Start(context.Background())
	if err == nil {
		t.Fatal("expected error when DB fails")
	}
}

// ─── Reload ──────────────────────────────────────────────

func TestReload_ReplacesSchedule(t *testing.T) {
	repo := newMockRepo()
	repo.automations = []*models.Automation{
		makeAutomation(1, "auto-1", "0 8 * * *", ""),
	}
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()
	ct.Start(context.Background())

	if ct.RegisteredCount() != 1 {
		t.Fatalf("expected 1 registered, got %d", ct.RegisteredCount())
	}

	// Change the set of automations.
	repo.mu.Lock()
	repo.automations = []*models.Automation{
		makeAutomation(10, "new-auto", "@hourly", ""),
		makeAutomation(11, "new-auto-2", "0 9 * * *", "Europe/London"),
	}
	repo.mu.Unlock()

	if err := ct.Reload(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ct.RegisteredCount() != 2 {
		t.Fatalf("expected 2 registered after reload, got %d", ct.RegisteredCount())
	}
	if ct.IsRegistered(1) {
		t.Fatal("old automation 1 should not be registered after reload")
	}
	if !ct.IsRegistered(10) || !ct.IsRegistered(11) {
		t.Fatal("new automations should be registered")
	}
}

func TestReload_DBError(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()
	ct.Start(context.Background())

	repo.mu.Lock()
	repo.returnErr = fmt.Errorf("db connection lost")
	repo.mu.Unlock()

	err := ct.Reload(context.Background())
	if err == nil {
		t.Fatal("expected error on reload when DB fails")
	}
}

// ─── Fire Callback (Direct) ─────────────────────────────

func TestFire_CallsEngine(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	ct.fire(42, "test-auto", "0 8 * * *", false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", engine.callCount())
	}

	call := engine.lastCall()
	if call.AutomationID != 42 {
		t.Fatalf("expected automation ID 42, got %d", call.AutomationID)
	}

	// Verify snapshot content.
	var snap cronSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.CronExpr != "0 8 * * *" {
		t.Fatalf("expected cron_expr '0 8 * * *', got %q", snap.CronExpr)
	}
	if snap.FiredAt == "" {
		t.Fatal("expected fired_at to be set")
	}
	// Verify fired_at is valid RFC3339.
	if _, err := time.Parse(time.RFC3339, snap.FiredAt); err != nil {
		t.Fatalf("fired_at is not valid RFC3339: %v", err)
	}
}

func TestFire_OneTime_AutoDisables(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	// Register a one-time automation first.
	a := makeAutomation(7, "one-shot", "0 8 * * *", "")
	ct.Register(a)

	// Fire as one-time.
	ct.fire(7, "one-shot", "0 8 * * *", true)

	// Should have been unregistered.
	if ct.IsRegistered(7) {
		t.Fatal("one-time automation should be unregistered after fire")
	}

	// Should have been auto-disabled in repo.
	if !repo.isDisabled(7) {
		t.Fatal("one-time automation should be auto-disabled in DB")
	}

	// Engine should still have been called.
	if engine.callCount() != 1 {
		t.Fatalf("expected 1 engine call, got %d", engine.callCount())
	}
}

func TestFire_OneTime_DisablesEvenOnEngineError(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("evaluation failed")}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(7, "one-shot", "0 8 * * *", "")
	ct.Register(a)

	ct.fire(7, "one-shot", "0 8 * * *", true)

	// Should be disabled even though engine returned an error.
	if !repo.isDisabled(7) {
		t.Fatal("one-time should be auto-disabled even when evaluation fails")
	}
	if ct.IsRegistered(7) {
		t.Fatal("one-time should be unregistered even when evaluation fails")
	}
}

func TestFire_Recurring_DoesNotDisable(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(5, "recurring", "0 8 * * *", "")
	ct.Register(a)

	ct.fire(5, "recurring", "0 8 * * *", false)

	if repo.isDisabled(5) {
		t.Fatal("recurring automation should not be auto-disabled")
	}
	if !ct.IsRegistered(5) {
		t.Fatal("recurring automation should remain registered")
	}
}

// ─── Timezone Handling ───────────────────────────────────

func TestRegister_MultipleTimezones(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	timezones := []string{
		"America/Los_Angeles",
		"America/New_York",
		"Europe/London",
		"Asia/Tokyo",
		"Australia/Sydney",
	}

	for i, tz := range timezones {
		a := makeAutomation(int64(i+1), fmt.Sprintf("tz-%s", tz), "0 8 * * *", tz)
		if err := ct.Register(a); err != nil {
			t.Fatalf("failed to register with timezone %s: %v", tz, err)
		}
	}

	if ct.RegisteredCount() != len(timezones) {
		t.Fatalf("expected %d registered, got %d", len(timezones), ct.RegisteredCount())
	}
}

func TestRegister_UTCDefault(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := makeAutomation(1, "utc-default", "0 8 * * *", "")
	if err := ct.Register(a); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// ─── Concurrent Safety ──────────────────────────────────

func TestConcurrentRegisterUnregister(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()
	ct.scheduler.Start()

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			a := makeAutomation(id, fmt.Sprintf("concurrent-%d", id), "0 8 * * *", "")
			ct.Register(a)
			ct.IsRegistered(id)
			ct.RegisteredCount()
		}(int64(i))
	}

	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func(id int64) {
			defer wg.Done()
			ct.Unregister(id)
		}(int64(i))
	}

	wg.Wait()

	// Should be in a valid state.
	count := ct.RegisteredCount()
	if count < 0 {
		t.Fatalf("invalid registered count: %d", count)
	}
}

// ─── Empty Trigger Config ────────────────────────────────

func TestRegister_EmptyTriggerConfig(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := &models.Automation{
		ID: 1, Name: "empty-config", Enabled: true,
		TriggerType: "cron", TriggerConfig: nil,
	}
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for nil trigger config")
	}
}

func TestRegister_MalformedJSON(t *testing.T) {
	repo := newMockRepo()
	engine := &mockEngine{}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	a := &models.Automation{
		ID: 1, Name: "bad-json", Enabled: true,
		TriggerType: "cron", TriggerConfig: json.RawMessage(`{bad`),
	}
	if err := ct.Register(a); err == nil {
		t.Fatal("expected error for malformed JSON")
	}
}

// ─── Live Scheduler Integration ─────────────────────────

func TestLiveScheduler_FiresWithinWindow(t *testing.T) {
	if testing.Short() {
		t.Skip("skipping live scheduler test in short mode")
	}

	repo := newMockRepo()
	fired := make(chan struct{}, 1)
	engine := &mockEngine{
		onEvaluate: func(_ int64, _ json.RawMessage) {
			select {
			case fired <- struct{}{}:
			default:
			}
		},
	}
	ct := NewCronTrigger(repo, engine)
	defer ct.Stop()

	// Schedule to fire every minute — we'll wait up to 70 seconds.
	// To avoid waiting that long, we compute a cron that fires in ~2 seconds.
	now := time.Now().UTC()
	targetSec := now.Add(2 * time.Second)
	cronExpr := fmt.Sprintf("%d %d * * *", targetSec.Minute(), targetSec.Hour())

	// If minute is about to roll, adjust.
	if now.Second() > 57 {
		targetSec = now.Add(5 * time.Second)
		cronExpr = fmt.Sprintf("%d %d * * *", targetSec.Minute(), targetSec.Hour())
	}

	a := makeAutomation(1, "live-test", cronExpr, "UTC")
	ct.Register(a)
	ct.scheduler.Start()

	select {
	case <-fired:
		// Success: engine was called.
	case <-time.After(90 * time.Second):
		t.Fatal("timed out waiting for cron to fire")
	}
}
