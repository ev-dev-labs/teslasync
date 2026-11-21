package smartreadiness_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	apiautomation "github.com/ev-dev-labs/teslasync/internal/api/automation"
	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/auth"
	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	automationdb "github.com/ev-dev-labs/teslasync/internal/database/automation"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
)

const automationFailureOperator = "synthetic-automation-operator"

func mountAutomationFailureReview(db *database.DB, now time.Time, header, allowed string) http.Handler {
	router := chi.NewRouter()
	operators := auth.NewOperatorAccess(header, allowed)
	actions := actionhandler.NewHandler(actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithAutomationFailureGroups(automationdb.NewAutomationHistoryRepo(db), operators.Allows),
		actioncentersvc.WithClock(func() time.Time { return now })), header)
	automations := apiautomation.NewAutomationHandler(db)
	router.Get("/api/v1/action-center", actions.List)
	router.Get("/api/v1/automations", automations.List)
	router.Get("/api/v1/automations/{id}/history", automations.ListAutomationHistory)
	router.Get("/api/v1/automations/history/{historyId}", automations.GetHistoryDetail)
	return router
}

type outcomeStep struct{ fail bool }

func (s outcomeStep) Execute(_ context.Context, vehicle *int64, _ json.RawMessage) (json.RawMessage, error) {
	if vehicle == nil || *vehicle != 7 {
		return nil, errors.New("missing or incorrect automation vehicle scope")
	}
	if s.fail {
		return nil, errors.New("synthetic private step failure")
	}
	return json.RawMessage(`{"note":"synthetic private output"}`), nil
}

func automationOutcomeEngine(db *database.DB, partial bool) *automation.Engine {
	chain := action.NewChainExecutor(nil)
	chain.Register("command", outcomeStep{fail: !partial})
	chain.Register("wait", outcomeStep{fail: true})
	return automation.NewEngine(automationdb.NewAutomationRepo(db), automationdb.NewAutomationHistoryRepo(db), chain)
}

func runAutomationOutcome(t *testing.T, db *database.DB, partial bool) {
	t.Helper()
	if err := automationOutcomeEngine(db, partial).Evaluate(t.Context(), 51, nil); err != nil {
		t.Fatal(err)
	}
}

func installAutomationStepFixture(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `
		CREATE TABLE automation_steps (id bigint PRIMARY KEY, automation_id bigint REFERENCES automations(id), step_order integer NOT NULL, kind text);
		CREATE TABLE automation_step_trigger_schedule (step_id bigint PRIMARY KEY REFERENCES automation_steps(id), cron_expr text, timezone text);
		CREATE TABLE automation_actions (step_id bigint REFERENCES automation_steps(id), command_name text);
		CREATE TABLE automation_step_trigger_signal (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_trigger_geofence (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_trigger_event (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_condition_signal (step_id bigint PRIMARY KEY, signal text);
		CREATE TABLE automation_step_condition_time_window (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_condition_geofence (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_condition_other_automation (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_action_notify (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_action_set_setting (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_action_call_automation (step_id bigint PRIMARY KEY);
		CREATE TABLE automation_step_action_wait (step_id bigint PRIMARY KEY, duration_s integer)`); err != nil {
		t.Fatal(err)
	}
}

func installOutcomeSteps(t *testing.T, db *database.DB) {
	t.Helper()
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO automation_steps(id,automation_id,step_order,kind) VALUES
		  (90,51,0,'trigger_schedule'),(91,51,1,'action_command'),(92,51,2,'action_wait');
		INSERT INTO automation_step_trigger_schedule VALUES (90,'0 8 * * MON','UTC');
		INSERT INTO automation_actions VALUES (91,'lock');
		INSERT INTO automation_step_action_wait VALUES (92,2);
		SELECT setval(pg_get_serial_sequence('automation_history','id'), 601, false)`); err != nil {
		t.Fatal(err)
	}
}

func setupAutomationFailureFixture(t *testing.T) *database.DB {
	t.Helper()
	_, db := testRepository(t)
	for _, migration := range []string{"000109_add_automations.up", "000187_fsm_live.up", "000223_action_center_state.up", "000315_automation_history_revision.up"} {
		applyWarrantyFixtureMigration(t, db, migration)
	}
	installAutomationStepFixture(t, db)
	return db
}

func TestAutomationFailureReviewUsesOperatorAndExactLatestRun(t *testing.T) {
	db := setupAutomationFailureFixture(t)
	now := time.Now().UTC().Truncate(time.Microsecond).Add(time.Minute)
	revision := now.Add(-48 * time.Hour)
	revised := now.Add(-time.Hour)
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := db.Pool.Exec(t.Context(), statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO automations(id,name,trigger_type,enabled,updated_at,vehicle_id) VALUES
		(51,'Synthetic scheduled check','cron',true,$1,7),
		(52,'Separate rule','cron',true,$1,7),
		(53,'Disabled rule','cron',false,$1,7),
		(54,'Reconfigured rule','cron',true,$2,7)`, revision, revised)
	installOutcomeSteps(t, db)
	run := func(id, rule int64, status string, age, endAge time.Duration, rev *time.Time) {
		t.Helper()
		exec(`INSERT INTO automation_history
			(id,automation_id,automation_name,triggered_at,completed_at,trigger_type,status,actions_failed,automation_revision)
			SELECT $1,id,name,$4,$5,'cron',$3,4,$6 FROM automations WHERE id=$2`,
			id, rule, status, now.Add(-age), now.Add(-endAge), rev)
	}
	runAutomationOutcome(t, db, false)
	run(619, 51, "failed", 4*time.Hour, 3*time.Hour, nil)
	run(620, 52, "failed", 15*time.Minute, 14*time.Minute, &revision)
	run(630, 53, "failed", 30*time.Minute, 29*time.Minute, &revision)
	run(631, 53, "partial", 15*time.Minute, 14*time.Minute, &revision)
	run(640, 54, "failed", 40*time.Minute, 39*time.Minute, &revision)
	run(641, 54, "partial", 15*time.Minute, 14*time.Minute, &revised)

	const operator = automationFailureOperator
	mount := func(header, allowed string) http.Handler {
		return mountAutomationFailureReview(db, now, header, allowed)
	}
	const path = "/api/v1/action-center?source_feature=automation_failure"
	router := mount("X-Test-Subject", operator)
	items := func(handler http.Handler, ctx context.Context, subject, url string) []domain.Recommendation {
		t.Helper()
		req := httptest.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		req.Header.Set("X-Test-Subject", subject)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		var result domain.Response
		if response.Code != http.StatusOK || response.Header().Get("Cache-Control") != "no-store" ||
			json.Unmarshal(response.Body.Bytes(), &result) != nil || strings.Contains(response.Body.String(), "synthetic private") {
			t.Fatalf("unexpected private card response: %d %s", response.Code, response.Body)
		}
		return result.Items
	}
	ctx := t.Context()
	if got := items(router, ctx, operator, path); len(got) != 0 {
		t.Fatalf("action retries, a disabled rule or outcomes from separate revisions created cards: %+v", got)
	}
	runAutomationOutcome(t, db, true)
	run(610, 51, "test", 30*time.Second, 29*time.Second, &revision)
	run(611, 51, "running", 25*time.Second, 24*time.Second, &revision)
	got := items(router, ctx, operator, path)
	if len(got) != 1 || got[0].NavigationPath == nil ||
		*got[0].NavigationPath != "/automations/history?automation_id=51&history_id=602" ||
		len(got[0].Evidence) != 1 || got[0].Evidence[0].AutomationFailure == nil ||
		got[0].Evidence[0].AutomationFailure.FailureCount != 2 || got[0].Evidence[0].Provenance.RecordID != "602" {
		t.Fatalf("missing one aggregated card pointing at exact persisted run: %+v", got)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/automations/history/602", nil)
	req.Header.Set("X-Test-Subject", operator)
	response := httptest.NewRecorder()
	router.ServeHTTP(response, req)
	var detail struct {
		ID        int64                 `json:"id"`
		Status    string                `json:"status"`
		Succeeded int                   `json:"actions_succeeded"`
		Failed    int                   `json:"actions_failed"`
		Actions   []action.ActionResult `json:"actions_executed"`
	}
	if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &detail) != nil ||
		detail.ID != 602 || detail.Status != "partial" || detail.Succeeded != 1 || detail.Failed != 1 ||
		len(detail.Actions) != 2 || detail.Actions[0].ActionType != "command" || !detail.Actions[0].Success ||
		len(detail.Actions[0].Config) != 0 || detail.Actions[1].Success ||
		detail.Actions[1].ActionType != "wait" || strings.Contains(response.Body.String(), "synthetic private") {
		t.Fatalf("exact execution detail: %d %s", response.Code, response.Body)
	}
	undo := chi.NewRouter()
	undo.Post("/automations/{id}/undo", apiautomation.NewAutomationHandler(db,
		apiautomation.WithCommandExecutor(&action.CommandExecutor{})).UndoLast)
	undoResponse := httptest.NewRecorder()
	undo.ServeHTTP(undoResponse, httptest.NewRequest(http.MethodPost, "/automations/51/undo", nil))
	var undoRows int
	err := db.Pool.QueryRow(ctx, "SELECT count(*) FROM automation_history WHERE status='undo'").Scan(&undoRows)
	if undoResponse.Code != http.StatusConflict || undoRows != 0 || err != nil {
		t.Fatalf("redacted audit record was treated as a reversible action: %d %s, rows=%d, %v",
			undoResponse.Code, undoResponse.Body, undoRows, err)
	}
	for _, tc := range []struct {
		name, header, allowlist, subject string
		ctx                              context.Context
	}{
		{"not opted in", "X-Test-Subject", "", operator, ctx},
		{"foreign subject", "X-Test-Subject", operator, "synthetic-other", ctx},
		{"app token", "X-Test-Subject", operator, operator, auth.WithAppTokenSubject(ctx, operator)},
		{"impersonated", "X-Test-Subject", operator, operator, auth.WithImpersonationForTests(ctx, auth.ImpersonationClaim{})},
		{"shared open", "", operator, operator, ctx},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := items(mount(tc.header, tc.allowlist), tc.ctx, tc.subject, path); len(got) != 0 {
				t.Fatalf("operator-only evidence returned: %+v", got)
			}
		})
	}
	run(605, 51, "success", 23*time.Minute, 15*time.Second, &revision)
	if got := items(router, ctx, operator, path); len(got) != 0 {
		t.Fatalf("an earlier-started run completing successfully did not clear the streak: %+v", got)
	}
	run(606, 51, "failed", 10*time.Second, 9*time.Second, &revision)
	if got := items(router, ctx, operator, path); len(got) != 0 {
		t.Fatalf("a successful run did not end the prior failure streak: %+v", got)
	}
	exec(`INSERT INTO automation_steps VALUES (93,51,3,'condition_signal');
		INSERT INTO automation_step_condition_signal VALUES (93,'BatteryLevel')`)
	if err := automationOutcomeEngine(db, true).Evaluate(ctx, 51, nil); err != nil {
		t.Fatal(err)
	}
	history, err := automationdb.NewAutomationHistoryRepo(db).GetByID(ctx, 603)
	if err != nil || history == nil || history.Status != "skipped" || history.CompletedAt == nil ||
		history.DurationMs == nil || history.ActionsTotal != 0 || !strings.Contains(string(history.ConditionsSnapshot), `"unknown"`) {
		t.Fatalf("incomplete skipped receipt: %+v, %v", history, err)
	}

	applyWarrantyFixtureMigration(t, db, "000315_automation_history_revision.down")
	history, err = automationdb.NewAutomationHistoryRepo(db).GetByID(ctx, 602)
	if err != nil || history == nil || history.Status != "partial" || history.ActionsSucceeded != 1 {
		t.Fatalf("rollback removed the original outcome: %+v, %v", history, err)
	}
}

func TestAutomationFailureBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_AUTOMATION_FAILURE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_AUTOMATION_FAILURE_BROWSER=1 to run the real-handler browser journey")
	}
	db := setupAutomationFailureFixture(t)
	revision := time.Now().UTC().Truncate(time.Microsecond).Add(-48 * time.Hour)
	if _, err := db.Pool.Exec(t.Context(), `
		INSERT INTO automations(id,name,trigger_type,enabled,updated_at,vehicle_id)
		VALUES (51,'Synthetic scheduled check','cron',true,$1,7)`, revision); err != nil {
		t.Fatal(err)
	}
	installOutcomeSteps(t, db)
	runAutomationOutcome(t, db, false)
	runAutomationOutcome(t, db, true)
	now := time.Now().UTC().Add(time.Minute).Truncate(time.Second)
	t.Setenv("SMART_AUTOMATION_NOW", now.Format(time.RFC3339))
	router := mountAutomationFailureReview(db, now, "X-Test-Subject", automationFailureOperator)
	runPrivatePlanningBrowser(t, router, "", nil, "automation-failure.real.smoke.spec.ts",
		"SMART_AUTOMATION_FAILURE_REAL_BACKEND=1", nil)
}
