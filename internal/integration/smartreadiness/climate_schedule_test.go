package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"golang.org/x/sync/errgroup"

	apiautomation "github.com/ev-dev-labs/teslasync/internal/api/automation"
	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	"github.com/ev-dev-labs/teslasync/internal/database"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	automationdb "github.com/ev-dev-labs/teslasync/internal/database/automation"
	readinessdb "github.com/ev-dev-labs/teslasync/internal/database/smartreadiness"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	automationmodel "github.com/ev-dev-labs/teslasync/internal/models/automation"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
)

const climateScheduleEndpoint = "/api/v1/climate/scheduled-review?vehicle_id=7"
const climateScheduleInbox = "/api/v1/action-center?vehicle_id=7&source_feature=climate_schedule"
const climateScheduleOwner = "synthetic-climate-schedule-owner"

type climateScheduleJourney struct {
	t        *testing.T
	repo     *readinessdb.Repository
	db       *database.DB
	reviews  *smartreadinesssvc.ClimateScheduleReviews
	router   http.Handler
	now      time.Time
	monday   time.Time
	revision time.Time
}

func newClimateScheduleJourney(t *testing.T) *climateScheduleJourney {
	t.Helper()
	repo, db := testRepository(t)
	seedCabinEvidence(t, db, nil)
	for _, file := range []string{"000109_add_automations.up", "000223_action_center_state.up", "000284_smart_climate_schedule.up", "000315_automation_history_revision.up"} {
		applyWarrantyFixtureMigration(t, db, file)
	}
	loc, err := time.LoadLocation("America/New_York")
	if err != nil {
		t.Fatal(err)
	}
	j := &climateScheduleJourney{t: t, repo: repo, db: db, monday: time.Date(2026, 11, 9, 8, 0, 0, 0, loc)}
	j.now = j.monday.AddDate(0, 0, -15)
	j.revision = j.now.Add(-time.Hour)
	installAutomationStepFixture(t, db)
	j.exec(`INSERT INTO automations(id,name,vehicle_id,trigger_type,updated_at) VALUES
		(51,'Synthetic Monday cabin',7,'cron',$1),(52,'Foreign cabin',8,'cron',$1)`, j.revision)
	j.exec(`INSERT INTO automation_steps(id,automation_id,step_order,kind) VALUES
		(901,51,0,'trigger_schedule'),(902,51,1,'action_command'),(903,52,0,'trigger_schedule'),(904,52,1,'action_command');
		INSERT INTO automation_step_trigger_schedule (step_id,cron_expr,timezone) VALUES
		(901,'0 8 * * MON','America/New_York'),(903,'0 8 * * MON','America/New_York');
		INSERT INTO automation_actions(step_id,command_name) VALUES (902,'hvac_on'),(904,'climate_on')`)
	j.reviews = smartreadinesssvc.NewClimateScheduleReviews(repo, signal.NewLogStateReader(db.Pool, zerolog.Nop()), func() time.Time { return j.now })
	j.router = j.mount("X-Test-Subject")
	return j
}

func (j *climateScheduleJourney) mount(header string) http.Handler {
	clock := func() time.Time { return j.now }
	actions := actionhandler.NewHandler(actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(j.db),
		actioncentersvc.WithClimateScheduleReviews(j.reviews), actioncentersvc.WithClock(clock)), header)
	svc := smartreadinesssvc.New(j.repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	automations := apiautomation.NewAutomationHandler(j.db)
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		readinesshandler.NewHandler(svc, header, readinesshandler.WithClimateScheduleReviews(j.reviews)).MountRoutes(r)
		r.Get("/action-center", actions.List)
		r.Post("/action-center/{recommendationID}/actions", actions.ApplyAction)
		r.Get("/automations", automations.List)
		r.Get("/automations/{id}/history", automations.ListAutomationHistory)
	})
	return router
}

func (j *climateScheduleJourney) exec(query string, args ...any) {
	j.t.Helper()
	if _, err := j.db.Pool.Exec(j.t.Context(), query, args...); err != nil {
		j.t.Fatal(err)
	}
}

func (j *climateScheduleJourney) run(at time.Time, status string, receipt *automationmodel.ScheduledClimateReceipt) {
	j.t.Helper()
	var vehicle int64 = 7
	store := automationdb.NewAutomationHistoryRepo(j.db)
	history := automationmodel.AutomationHistory{AutomationID: 51, AutomationName: "Synthetic Monday cabin", VehicleID: &vehicle,
		TriggeredAt: at.Add(time.Second), TriggerType: "trigger_schedule", TriggerSnapshot: json.RawMessage(`{}`),
		ConditionsMet: true, ConditionsSnapshot: json.RawMessage(`[]`), ActionsExecuted: json.RawMessage(`[]`), Status: "running"}
	if err := store.Create(j.t.Context(), &history); err != nil {
		j.t.Fatal(err)
	}
	duration, completed := 19000, at.Add(20*time.Second)
	history.Status, history.DurationMs, history.CompletedAt = status, &duration, &completed
	if err := store.Complete(j.t.Context(), &history, receipt); err != nil {
		j.t.Fatal(err)
	}
}

func (j *climateScheduleJourney) parkedWindow(at time.Time) {
	j.t.Helper()
	before := at.Add(-6 * time.Minute)
	j.exec(`INSERT INTO signal_log (ts,vehicle_id,field,value_kind,str_value,source_emitted_at) VALUES
		($1,7,'Gear',$2,'P',$1),($1,7,'CabinOverheatProtectionMode',$2,'Off',$1)`, before, protomodel.ValueKindString)
	j.exec(`INSERT INTO signal_log (ts,vehicle_id,field,value_kind,bool_value,source_emitted_at) VALUES
		($1,7,'HvacPower',$3,false,$1),($2,7,'HvacPower',$3,true,$2)`, before, at.Add(time.Minute), protomodel.ValueKindBool)
	j.exec(`INSERT INTO signal_log (ts,vehicle_id,field,value_kind,float_value,source_emitted_at) VALUES
		($1,7,'Odometer',$2,52000,$1)`, before, protomodel.ValueKindDouble)
	for _, minute := range []int{-1, 10, 20, 30, 40, 50, 60, 70, 80, 89} {
		j.exec(`INSERT INTO signal_log (ts,vehicle_id,field,value_kind,float_value,source_emitted_at) VALUES ($1,7,'InsideTemp',$2,$3,$1)`,
			at.Add(time.Duration(minute)*time.Minute), protomodel.ValueKindDouble, 12+float64(minute)/20)
	}
}

func (j *climateScheduleJourney) call(router http.Handler, method, path, subject string, body any, status int) string {
	j.t.Helper()
	data, err := json.Marshal(body)
	if err != nil {
		j.t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Test-Subject", subject)
	principal := "open"
	if subject != "" {
		principal = "subject:" + subject
	}
	req.Header.Set("X-TeslaSync-Expected-Principal", principal)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	if w.Code != status || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
		j.t.Fatalf("%s %s: %d want %d no-store, %s", method, path, w.Code, status, w.Body)
	}
	return w.Body.String()
}

func (j *climateScheduleJourney) receipt(at time.Time) *automationmodel.ScheduledClimateReceipt {
	return &automationmodel.ScheduledClimateReceipt{VehicleID: 7, Revision: j.revision, FiredAt: at}
}

func TestScheduledClimateReviewUsesOnlyConsentedAttributableParkedRuns(t *testing.T) {
	j := newClimateScheduleJourney(t)
	tick := func() smartreadinesssvc.ClimateScheduleBatch {
		t.Helper()
		result, err := j.reviews.ProcessDue(t.Context(), 5)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	assertInbox := func(subject string, contains bool) string {
		t.Helper()
		body := j.call(j.router, http.MethodGet, climateScheduleInbox, subject, nil, http.StatusOK)
		if strings.Contains(body, `"title":"Review a recurring climate schedule"`) != contains {
			t.Fatalf("unexpected climate schedule card: %s", body)
		}
		return body
	}
	submission := func(id int64, confirmed bool) map[string]any {
		return map[string]any{"expected_plan_id": 0, "automation_id": id, "schedule_revision": j.revision, "local_review_confirmed": confirmed}
	}
	disabledRun := j.monday.AddDate(0, 0, -21)
	j.run(disabledRun, "success", j.receipt(disabledRun))
	if got := tick(); got.Checked != 0 {
		t.Fatalf("review ran while off: %+v", got)
	}
	j.call(j.mount(""), http.MethodGet, climateScheduleEndpoint, "", nil, http.StatusForbidden)
	j.call(j.router, http.MethodPut, climateScheduleEndpoint, climateScheduleOwner, submission(51, false), http.StatusBadRequest)
	j.call(j.router, http.MethodPut, climateScheduleEndpoint, climateScheduleOwner, submission(52, true), http.StatusConflict)
	j.call(j.router, http.MethodPut, climateScheduleEndpoint, climateScheduleOwner, submission(51, true), http.StatusNoContent)
	j.call(j.router, http.MethodPut, climateScheduleEndpoint, climateScheduleOwner, submission(51, true), http.StatusConflict)
	reading := j.call(j.router, http.MethodGet, climateScheduleEndpoint, climateScheduleOwner, nil, http.StatusOK)
	var settings struct {
		Data domain.ClimateScheduleSettings
	}
	if err := json.Unmarshal([]byte(reading), &settings); err != nil || settings.Data.Plan == nil || !settings.Data.Plan.Current ||
		len(settings.Data.Options) != 1 || settings.Data.Options[0].ID != 51 {
		t.Fatalf("invalid consent state: %s (%v)", reading, err)
	}
	earliest := j.monday.AddDate(0, 0, -14)
	prior := j.monday.AddDate(0, 0, -7)
	for _, run := range []time.Time{earliest, prior, j.monday} {
		j.run(run, "success", j.receipt(run))
	}
	manual := j.monday.Add(-2 * time.Hour)
	j.run(manual, "success", nil)
	failed := manual.Add(time.Minute)
	j.run(failed, "failed", j.receipt(failed))
	wrongTarget := j.receipt(manual.Add(2 * time.Minute))
	wrongTarget.VehicleID = 8
	j.run(wrongTarget.FiredAt, "success", wrongTarget)
	staleRevision := j.receipt(manual.Add(3 * time.Minute))
	staleRevision.Revision = j.revision.Add(-time.Minute)
	j.run(staleRevision.FiredAt, "success", staleRevision)
	var receiptCount int
	if err := j.db.Pool.QueryRow(t.Context(), "SELECT count(*) FROM smart_climate_schedule_receipts").Scan(&receiptCount); err != nil || receiptCount != 3 {
		t.Fatalf("expected exactly three eligible receipts, got %d: %v", receiptCount, err)
	}
	j.parkedWindow(earliest)
	j.parkedWindow(prior)
	j.now = j.monday.Add(2 * time.Hour)
	if got := tick(); got.Quiet != 1 {
		t.Fatalf("missing current telemetry must be silent: %+v", got)
	}
	assertInbox(climateScheduleOwner, false)
	j.parkedWindow(j.monday)
	j.exec(`UPDATE signal_log SET source_emitted_at=NULL WHERE field='HvacPower' AND ts=$1`, j.monday.Add(time.Minute))
	j.now = j.now.Add(6 * time.Hour)
	if got := tick(); got.Quiet != 1 {
		t.Fatalf("receipt-only HVAC must not qualify a scheduled run: %+v", got)
	}
	assertInbox(climateScheduleOwner, false)
	j.exec(`UPDATE signal_log SET source_emitted_at=ts WHERE field='HvacPower' AND ts=$1`, j.monday.Add(time.Minute))
	j.now = j.now.Add(6 * time.Hour)
	if got := tick(); got.Matched != 1 || got.Published != 1 {
		t.Fatalf("expected current weekly comparison: %+v", got)
	}
	body := assertInbox(climateScheduleOwner, true)
	if !strings.Contains(body, "3 matching scheduled runs") || !strings.Contains(body, "climate_review_vehicle_id=7") {
		t.Fatalf("card missing evidence or correctly scoped link: %s", body)
	}
	assertInbox("synthetic-climate-schedule-peer", false)
	if got := tick(); got.Checked != 0 {
		t.Fatalf("duplicate tick bypassed schedule: %+v", got)
	}
	j.now = j.now.Add(6 * time.Hour)
	var workers errgroup.Group
	restarted := smartreadinesssvc.NewClimateScheduleReviews(j.repo, signal.NewLogStateReader(j.db.Pool, zerolog.Nop()), func() time.Time { return j.now })
	var refreshes [2]smartreadinesssvc.ClimateScheduleBatch
	for i, worker := range []*smartreadinesssvc.ClimateScheduleReviews{j.reviews, restarted} {
		workers.Go(func() error {
			batch, err := worker.ProcessDue(t.Context(), 5)
			refreshes[i] = batch
			return err
		})
	}
	if err := workers.Wait(); err != nil {
		t.Fatal(err)
	}
	a, b := refreshes[0], refreshes[1]
	if a.Checked+b.Checked != 1 || a.Matched+b.Matched != 1 || a.Published+b.Published != 0 {
		t.Fatalf("concurrent/restarted refresh must preserve the one weekly publication: %+v", refreshes)
	}
	j.exec("INSERT INTO drives(vehicle_id,started_at,ended_at) VALUES (7,$1,$2)", j.monday.Add(60*time.Minute), j.monday.Add(75*time.Minute))
	assertInbox(climateScheduleOwner, false)
	j.exec("DELETE FROM drives")
	assertInbox(climateScheduleOwner, true)
	j.now = j.now.Add(6 * time.Hour)
	job, err := j.repo.ClaimClimateSchedule(t.Context(), j.now, j.now.Add(time.Minute))
	if err != nil || job == nil {
		t.Fatalf("claim scheduled review before revision change: %+v (%v)", job, err)
	}
	j.exec("UPDATE automations SET updated_at=$1 WHERE id=51", j.now)
	completion, err := j.repo.FinishClimateSchedule(t.Context(), *job, j.now, j.now.Add(time.Hour), nil)
	if err != nil || completion.Applied {
		t.Fatalf("changed schedule must invalidate in-flight claim: %+v (%v)", completion, err)
	}
	assertInbox(climateScheduleOwner, false)
	j.call(j.router, http.MethodDelete, climateScheduleEndpoint+"&plan_id="+strconv.FormatInt(settings.Data.Plan.ID, 10),
		"synthetic-climate-schedule-peer", nil, http.StatusConflict)
	j.call(j.router, http.MethodDelete, climateScheduleEndpoint+"&plan_id="+strconv.FormatInt(settings.Data.Plan.ID, 10),
		climateScheduleOwner, nil, http.StatusNoContent)
	var retained int
	if err := j.db.Pool.QueryRow(t.Context(), "SELECT count(*) FROM automation_history").Scan(&retained); err != nil || retained != 8 {
		t.Fatalf("review changed original automation history: %d (%v)", retained, err)
	}
	for _, file := range []string{"000284_smart_climate_schedule.down", "000284_smart_climate_schedule.up"} {
		applyWarrantyFixtureMigration(t, j.db, file)
	}
}
