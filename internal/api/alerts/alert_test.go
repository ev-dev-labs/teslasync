package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/go-chi/chi/v5"
)

func TestAlertRuleContractRejectsForbiddenFields(t *testing.T) {
	// msg_template was restored as a typed TEXT column on alert_rules,
	// so it is no longer in this rejection list. The remaining entries
	// are the other legacy CEP fields retired by ADR-001.
	forbiddenFields := []struct {
		name  string
		value string
	}{
		{"conditions", "[]"},
		{"expression", `"VehicleSpeed > 70"`},
		{"for_duration_s", "60"},
		{"notify_channels", "[1,2]"},
		{"type", `"signal"`},
		{"threshold", "70"},
		{"rule_def", `{"legacy":true}`},
	}

	for _, tt := range forbiddenFields {
		t.Run("create_"+tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			body := typedAlertRuleBody(`"severity":"warn","` + tt.name + `":` + tt.value)
			rec := httptest.NewRecorder()

			handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(body)))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})

		t.Run("update_"+tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			body := `{"severity":"warn","` + tt.name + `":` + tt.value + `}`
			rec := httptest.NewRecorder()

			handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42", body))

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestAlertRuleValidationRejectsUnknownFields(t *testing.T) {
	tests := []struct {
		name   string
		method string
		body   string
		call   func(*AlertHandler, *httptest.ResponseRecorder, string)
	}{
		{
			name:   "create",
			method: http.MethodPost,
			body:   typedAlertRuleBody(`"severity":"warn","drift":true`),
			call: func(h *AlertHandler, rec *httptest.ResponseRecorder, body string) {
				h.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(body)))
			},
		},
		{
			name:   "update",
			method: http.MethodPut,
			body:   `{"severity":"warn","drift":true}`,
			call: func(h *AlertHandler, rec *httptest.ResponseRecorder, body string) {
				h.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42", body))
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			tt.call(handler, rec, tt.body)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestAlertRuleValidationSeverity(t *testing.T) {
	t.Run("create defaults omitted severity to warn", func(t *testing.T) {
		repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
		handler := newAlertHandlerForTestWithRepo(repo)
		rec := httptest.NewRecorder()

		handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(typedAlertRuleBody(""))))

		if rec.Code != http.StatusCreated {
			t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
		}
		if len(repo.created) != 1 {
			t.Fatalf("created rules = %d, want 1", len(repo.created))
		}
		if repo.created[0].Severity != "warn" {
			t.Fatalf("severity = %q, want warn", repo.created[0].Severity)
		}
	})

	for _, severity := range []string{"info", "warn", "critical"} {
		t.Run("create accepts "+severity, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(typedAlertRuleBody(`"severity":"`+severity+`"`))))

			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
			}
		})

		t.Run("update accepts "+severity, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42", `{"severity":"`+severity+`"}`))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
			}
		})
	}

	for _, tt := range []struct {
		name string
		call func(*AlertHandler, *httptest.ResponseRecorder)
	}{
		{
			name: "create rejects explicit warning",
			call: func(h *AlertHandler, rec *httptest.ResponseRecorder) {
				h.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(typedAlertRuleBody(`"severity":"warning"`))))
			},
		},
		{
			name: "update rejects explicit warning",
			call: func(h *AlertHandler, rec *httptest.ResponseRecorder) {
				h.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42", `{"severity":"warning"}`))
			},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			tt.call(handler, rec)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestAlertRuleValidationOpsAndOperands(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{
			name:       "rejects unknown op",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":"contains","value_text":"drive"`),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "numeric comparison requires value_num",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":">"`),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "numeric comparison rejects non numeric operands",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":">","value_num":70,"value_text":"fast"`),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "equality requires exactly one operand",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":"=","value_num":1,"value_bool":true`),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "between requires min and max",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":"between","value_min":10`),
			wantStatus: http.StatusBadRequest,
		},
		{
			name:       "outside accepts min and max",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":"outside","value_min":10,"value_max":20`),
			wantStatus: http.StatusCreated,
		},
		{
			name:       "changed accepts bare operand shape",
			body:       typedAlertRuleOperandBody(`"severity":"warn","op":"changed"`),
			wantStatus: http.StatusCreated,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules", strings.NewReader(tt.body)))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestAlertTestContract(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		wantStatus int
	}{
		{
			name:       "accepts message",
			body:       `{"message":"Test alert message"}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "accepts all_channels target",
			body:       `{"message":"Test alert message","target":{"all_channels":true}}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "accepts channel_ids target",
			body:       `{"message":"Test alert message","target":{"channel_ids":[1,2]}}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "accepts msg_template (Phase-50 / ADR-005)",
			body:       `{"message":"Test alert message","msg_template":"{{VehicleName}} hit {{Value}}","include_title":false}`,
			wantStatus: http.StatusOK,
		},
		{
			name:       "rejects notify_channels",
			body:       `{"message":"Test alert message","notify_channels":[1,2]}`,
			wantStatus: http.StatusBadRequest,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			handler := newAlertHandlerForTest()
			rec := httptest.NewRecorder()

			handler.TestRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/test", strings.NewReader(tt.body)))

			if rec.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, tt.wantStatus, rec.Body.String())
			}
		})
	}
}

// ─── trigger_mode + snooze contract tests ──────────────────────────────────

func TestCreateRule_DefaultTriggerMode(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(""))))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("created rules = %d, want 1", len(repo.created))
	}
	if got, want := repo.created[0].TriggerMode, "repeat"; got != want {
		t.Fatalf("trigger_mode = %q, want %q (omitted should default)", got, want)
	}
}

func TestCreateRule_AcceptsOnceTriggerMode(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(`"trigger_mode":"once"`))))

	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusCreated, rec.Body.String())
	}
	if len(repo.created) != 1 {
		t.Fatalf("created rules = %d, want 1", len(repo.created))
	}
	if got, want := repo.created[0].TriggerMode, "once"; got != want {
		t.Fatalf("trigger_mode = %q, want %q", got, want)
	}
}

func TestCreateRule_InvalidTriggerMode_400(t *testing.T) {
	handler := newAlertHandlerForTest()
	rec := httptest.NewRecorder()

	handler.CreateRule(rec, httptest.NewRequest(http.MethodPost, "/alerts/rules",
		strings.NewReader(typedAlertRuleBody(`"trigger_mode":"sometimes"`))))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestUpdateRule_TriggerModeRoundTrip(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.UpdateRule(rec, newAlertRuleRequest(http.MethodPut, "/alerts/rules/42",
		`{"trigger_mode":"once"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.updated) != 1 {
		t.Fatalf("updated rules = %d, want 1", len(repo.updated))
	}
	if got, want := repo.updated[0].TriggerMode, "once"; got != want {
		t.Fatalf("trigger_mode = %q, want %q", got, want)
	}
}

func TestSnoozeRule_Minutes_OK(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	before := time.Now().UTC()
	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", `{"minutes":60}`))
	after := time.Now().UTC()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.snoozed) != 1 {
		t.Fatalf("snoozed records = %d, want 1", len(repo.snoozed))
	}
	rec0 := repo.snoozed[0]
	if rec0.id != 42 {
		t.Fatalf("snoozed rule id = %d, want 42", rec0.id)
	}
	if rec0.until == nil {
		t.Fatal("snoozed.until = nil, want non-nil for positive minutes")
	}
	expectedMin := before.Add(60 * time.Minute)
	expectedMax := after.Add(60 * time.Minute)
	if rec0.until.Before(expectedMin.Add(-time.Second)) || rec0.until.After(expectedMax.Add(time.Second)) {
		t.Fatalf("snoozed.until = %v, want roughly [%v, %v]", *rec0.until, expectedMin, expectedMax)
	}
}

func TestSnoozeRule_Until_OK(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	until := time.Now().UTC().Add(2 * time.Hour).Truncate(time.Second)
	body := `{"until":"` + until.Format(time.RFC3339) + `"}`

	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.snoozed) != 1 || repo.snoozed[0].until == nil {
		t.Fatalf("expected one snooze record with non-nil until, got %+v", repo.snoozed)
	}
	if !repo.snoozed[0].until.Equal(until) {
		t.Fatalf("snoozed.until = %v, want %v", *repo.snoozed[0].until, until)
	}
}

func TestSnoozeRule_NegativeMinutes_Clears(t *testing.T) {
	until := time.Now().UTC().Add(time.Hour)
	rule := validAlertRuleForTest()
	rule.SnoozedUntil = &until
	repo := &fakeAlertRuleRepo{existing: rule}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", `{"minutes":0}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.snoozed) != 1 {
		t.Fatalf("snoozed records = %d, want 1", len(repo.snoozed))
	}
	if repo.snoozed[0].until != nil {
		t.Fatalf("snoozed.until = %v, want nil (cleared)", *repo.snoozed[0].until)
	}
}

func TestSnoozeRule_PastUntil_Clears(t *testing.T) {
	repo := &fakeAlertRuleRepo{existing: validAlertRuleForTest()}
	handler := newAlertHandlerForTestWithRepo(repo)
	rec := httptest.NewRecorder()

	past := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339)
	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", `{"until":"`+past+`"}`))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(repo.snoozed) != 1 || repo.snoozed[0].until != nil {
		t.Fatalf("expected past timestamp to clear snooze, got %+v", repo.snoozed)
	}
}

func TestSnoozeRule_BothMinutesAndUntil_400(t *testing.T) {
	handler := newAlertHandlerForTest()
	rec := httptest.NewRecorder()

	until := time.Now().UTC().Add(time.Hour).Format(time.RFC3339)
	body := `{"minutes":60,"until":"` + until + `"}`
	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", body))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestSnoozeRule_EmptyBody_400(t *testing.T) {
	handler := newAlertHandlerForTest()
	rec := httptest.NewRecorder()

	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", `{}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestSnoozeRule_Over30Days_400(t *testing.T) {
	handler := newAlertHandlerForTest()
	rec := httptest.NewRecorder()

	handler.SnoozeRule(rec, newAlertRuleRequest(http.MethodPost,
		"/alerts/rules/42/snooze", `{"minutes":43201}`))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestSnoozeRule_InvalidRuleID_400(t *testing.T) {
	handler := newAlertHandlerForTest()
	rec := httptest.NewRecorder()

	req := httptest.NewRequest(http.MethodPost, "/alerts/rules/abc/snooze",
		strings.NewReader(`{"minutes":60}`))
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("ruleID", "abc")
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	handler.SnoozeRule(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func typedAlertRuleBody(extra string) string {
	body := `{"name":"Speed warning","enabled":true,"signal_name":"VehicleSpeed","op":">","value_num":70`
	if extra != "" {
		body += "," + strings.TrimSuffix(extra, ",")
	}
	return body + "}"
}

func typedAlertRuleOperandBody(extra string) string {
	body := `{"name":"Speed warning","enabled":true,"signal_name":"VehicleSpeed"`
	if extra != "" {
		body += "," + strings.TrimSuffix(extra, ",")
	}
	return body + "}"
}

func newAlertRuleRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, strings.NewReader(body))
	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("ruleID", "42")
	return req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
}

func newAlertHandlerForTest() *AlertHandler {
	return newAlertHandlerForTestWithRepo(&fakeAlertRuleRepo{existing: validAlertRuleForTest()})
}

func newAlertHandlerForTestWithRepo(repo *fakeAlertRuleRepo) *AlertHandler {
	return &AlertHandler{
		alertRuleRepo: repo,
		notifRepo:     &fakeNotificationRepo{},
	}
}

func validAlertRuleForTest() *alertmodel.AlertRule {
	valueNum := 70.0
	return &alertmodel.AlertRule{
		ID:          42,
		Name:        "Speed warning",
		Enabled:     true,
		SignalName:  "VehicleSpeed",
		Op:          ">",
		ValueNum:    &valueNum,
		Severity:    "warn",
		CooldownMin: 15,
		TriggerMode: "repeat",
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
}

type fakeAlertRuleRepo struct {
	existing  *alertmodel.AlertRule
	byID      map[int64]*alertmodel.AlertRule
	created   []*alertmodel.AlertRule
	updated   []*alertmodel.AlertRule
	snoozed   []snoozeRecord
	snoozeErr error
	notFound  bool
}

type snoozeRecord struct {
	id    int64
	until *time.Time
}

func (f *fakeAlertRuleRepo) GetAll(context.Context) ([]*alertmodel.AlertRule, error) {
	if f.existing == nil {
		return []*alertmodel.AlertRule{}, nil
	}
	return []*alertmodel.AlertRule{f.existing}, nil
}

func (f *fakeAlertRuleRepo) Update(_ context.Context, _ int64, rule *alertmodel.AlertRule) error {
	f.updated = append(f.updated, cloneAlertRuleForTest(rule))
	return nil
}

func (f *fakeAlertRuleRepo) GetByID(_ context.Context, id int64) (*alertmodel.AlertRule, error) {
	if f.notFound {
		return nil, nil
	}
	if f.byID != nil {
		if r, ok := f.byID[id]; ok {
			return cloneAlertRuleForTest(r), nil
		}
		return nil, nil
	}
	if f.existing == nil {
		return nil, nil
	}
	return cloneAlertRuleForTest(f.existing), nil
}

func (f *fakeAlertRuleRepo) Create(_ context.Context, rule *alertmodel.AlertRule) error {
	rule.ID = 100 + int64(len(f.created))
	rule.CreatedAt = time.Now().UTC()
	rule.UpdatedAt = rule.CreatedAt
	f.created = append(f.created, cloneAlertRuleForTest(rule))
	return nil
}

func (f *fakeAlertRuleRepo) Delete(context.Context, int64) error {
	return nil
}

func (f *fakeAlertRuleRepo) SetSnooze(_ context.Context, id int64, until *time.Time) error {
	if f.snoozeErr != nil {
		return f.snoozeErr
	}
	f.snoozed = append(f.snoozed, snoozeRecord{id: id, until: until})
	if f.existing != nil && f.existing.ID == id {
		f.existing.SnoozedUntil = until
	}
	if f.byID != nil {
		if r, ok := f.byID[id]; ok {
			r.SnoozedUntil = until
		}
	}
	return nil
}

func cloneAlertRuleForTest(rule *alertmodel.AlertRule) *alertmodel.AlertRule {
	if rule == nil {
		return nil
	}
	data, err := json.Marshal(rule)
	if err != nil {
		panic(err)
	}
	var cloned alertmodel.AlertRule
	if err := json.Unmarshal(data, &cloned); err != nil {
		panic(err)
	}
	return &cloned
}

type fakeNotificationRepo struct {
	logs            []*notificationmodel.NotificationLog
	lastListFilters *dbnotif.NotificationLogFilters

	// Alert ack and audit timeline state.
	logsByID    map[int64]*notificationmodel.NotificationLog
	eventsByID  map[int64][]*alertmodel.NotificationLogEvent
	nextEventID int64

	getLogErr        error
	ackErr           error
	reopenErr        error
	commentErr       error
	listLogEventsErr error
	bulkSetReadErr   error

	ackCalls     []ackCall
	reopenCalls  []reopenCall
	commentCalls []commentCall
	readCalls    []readCall
}

type ackCall struct {
	id    int64
	actor string
	note  string
}

type reopenCall struct {
	id    int64
	actor string
}

type commentCall struct {
	id    int64
	actor string
	note  string
}

type readCall struct {
	ids  []int64
	read bool
}

func (f *fakeNotificationRepo) GetLogs(context.Context, int, int) ([]*notificationmodel.NotificationLog, error) {
	if f.logs == nil {
		return []*notificationmodel.NotificationLog{}, nil
	}
	return f.logs, nil
}

func (f *fakeNotificationRepo) GetLogsFiltered(_ context.Context, filters dbnotif.NotificationLogFilters) ([]*notificationmodel.NotificationLog, error) {
	f.lastListFilters = &filters
	if f.logs == nil {
		return []*notificationmodel.NotificationLog{}, nil
	}
	return f.logs, nil
}

func (f *fakeNotificationRepo) BulkSetRead(_ context.Context, ids []int64, read bool) (int64, error) {
	if f.bulkSetReadErr != nil {
		return 0, f.bulkSetReadErr
	}
	f.readCalls = append(f.readCalls, readCall{ids: append([]int64(nil), ids...), read: read})
	return int64(len(ids)), nil
}

func (f *fakeNotificationRepo) CreateLog(_ context.Context, log *notificationmodel.NotificationLog) error {
	if log == nil {
		return errors.New("notification log is nil")
	}
	log.ID = 1
	log.CreatedAt = time.Now().UTC()
	return nil
}

func (f *fakeNotificationRepo) GetChannel(context.Context, int64) (*notificationmodel.NotificationChannel, error) {
	return nil, nil
}

func (f *fakeNotificationRepo) GetAllChannels(context.Context) ([]*notificationmodel.NotificationChannel, error) {
	return []*notificationmodel.NotificationChannel{}, nil
}

func (f *fakeNotificationRepo) GetLog(_ context.Context, id int64) (*notificationmodel.NotificationLog, error) {
	if f.getLogErr != nil {
		return nil, f.getLogErr
	}
	if f.logsByID == nil {
		return nil, nil
	}
	return f.logsByID[id], nil
}

func (f *fakeNotificationRepo) AcknowledgeLog(_ context.Context, id int64, actor, note string) (*notificationmodel.NotificationLog, bool, error) {
	if f.ackErr != nil {
		return nil, false, f.ackErr
	}
	f.ackCalls = append(f.ackCalls, ackCall{id: id, actor: actor, note: note})
	if f.logsByID == nil {
		return nil, false, nil
	}
	row, ok := f.logsByID[id]
	if !ok || row == nil {
		return nil, false, nil
	}
	if row.AcknowledgedAt != nil {
		return row, false, nil
	}
	now := time.Now().UTC()
	row.AcknowledgedAt = &now
	if actor != "" {
		a := actor
		row.AcknowledgedBy = &a
	}
	if note != "" {
		n := note
		row.AcknowledgementNote = &n
	}
	f.appendEvent(id, &alertmodel.NotificationLogEvent{
		Actor: nilOrPtrString(actor),
		Kind:  alertmodel.NotificationLogEventKindAcknowledged,
		Note:  nilOrPtrString(note),
	})
	return row, true, nil
}

func (f *fakeNotificationRepo) ReopenLog(_ context.Context, id int64, actor string) (*notificationmodel.NotificationLog, bool, error) {
	if f.reopenErr != nil {
		return nil, false, f.reopenErr
	}
	f.reopenCalls = append(f.reopenCalls, reopenCall{id: id, actor: actor})
	if f.logsByID == nil {
		return nil, false, nil
	}
	row, ok := f.logsByID[id]
	if !ok || row == nil {
		return nil, false, nil
	}
	if row.AcknowledgedAt == nil {
		return row, false, nil
	}
	row.AcknowledgedAt = nil
	row.AcknowledgedBy = nil
	row.AcknowledgementNote = nil
	f.appendEvent(id, &alertmodel.NotificationLogEvent{
		Actor: nilOrPtrString(actor),
		Kind:  alertmodel.NotificationLogEventKindReopened,
	})
	return row, true, nil
}

func (f *fakeNotificationRepo) CommentOnLog(_ context.Context, id int64, actor, note string) (*alertmodel.NotificationLogEvent, error) {
	if f.commentErr != nil {
		return nil, f.commentErr
	}
	f.commentCalls = append(f.commentCalls, commentCall{id: id, actor: actor, note: note})
	if f.logsByID == nil {
		return nil, nil
	}
	if _, ok := f.logsByID[id]; !ok {
		return nil, nil
	}
	ev := &alertmodel.NotificationLogEvent{
		Actor: nilOrPtrString(actor),
		Kind:  alertmodel.NotificationLogEventKindCommented,
		Note:  nilOrPtrString(note),
	}
	f.appendEvent(id, ev)
	return ev, nil
}

func (f *fakeNotificationRepo) ListLogEvents(_ context.Context, logID int64) ([]*alertmodel.NotificationLogEvent, error) {
	if f.listLogEventsErr != nil {
		return nil, f.listLogEventsErr
	}
	if f.eventsByID == nil {
		return nil, nil
	}
	out := make([]*alertmodel.NotificationLogEvent, len(f.eventsByID[logID]))
	copy(out, f.eventsByID[logID])
	return out, nil
}

func (f *fakeNotificationRepo) appendEvent(logID int64, ev *alertmodel.NotificationLogEvent) {
	if f.eventsByID == nil {
		f.eventsByID = make(map[int64][]*alertmodel.NotificationLogEvent)
	}
	f.nextEventID++
	ev.ID = f.nextEventID
	ev.NotificationLogID = logID
	if ev.OccurredAt.IsZero() {
		ev.OccurredAt = time.Now().UTC()
	}
	f.eventsByID[logID] = append(f.eventsByID[logID], ev)
}

func nilOrPtrString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// ─── Adapter tests ──────────────────────────────────────────────────────────

func TestAlertHandler_List_AdaptsNotificationLogsToAlertShape(t *testing.T) {
	ruleCritID := int64(11)
	ruleInfoID := int64(22)
	vehicleID := int64(7)

	criticalRule := &alertmodel.AlertRule{
		ID:         ruleCritID,
		Name:       "Battery low (Model Y)",
		Severity:   "critical",
		SignalName: "BatteryLevel",
		VehicleID:  &vehicleID,
		VehicleIDs: []int64{vehicleID},
	}
	infoRule := &alertmodel.AlertRule{
		ID:          ruleInfoID,
		Name:        "Door unlocked",
		Severity:    "info",
		SignalName:  "Locked",
		AllVehicles: true,
		VehicleIDs:  []int64{},
	}

	now := time.Now().UTC()
	readAt := now.Add(time.Second)
	acknowledgedAt := now.Add(2 * time.Second)
	acknowledgedBy := "fleet.operator"
	acknowledgementNote := "Charging scheduled"
	logs := []*notificationmodel.NotificationLog{
		{
			ID:                  1001,
			AlertID:             &ruleCritID,
			Title:               "Battery is low",
			Message:             "5%",
			Status:              "sent",
			CreatedAt:           now,
			AcknowledgedAt:      &acknowledgedAt,
			AcknowledgedBy:      &acknowledgedBy,
			AcknowledgementNote: &acknowledgementNote,
		},
		{ID: 1002, AlertID: &ruleInfoID, Title: "Door unlocked", Message: "front-left", Status: "failed", CreatedAt: now, ReadAt: &readAt},
		{ID: 1003, AlertID: nil, Title: "Test notification", Message: "hello", Status: "sent", CreatedAt: now},
	}

	repo := &fakeAlertRuleRepo{
		byID: map[int64]*alertmodel.AlertRule{
			ruleCritID: criticalRule,
			ruleInfoID: infoRule,
		},
	}
	handler := &AlertHandler{
		alertRuleRepo: repo,
		notifRepo:     &fakeNotificationRepo{logs: logs},
	}

	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/alerts", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}

	var resp []AlertResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v body=%s", err, rec.Body.String())
	}
	if len(resp) != 3 {
		t.Fatalf("len(resp) = %d, want 3", len(resp))
	}

	// Row 0: critical rule with vehicle.
	if got, want := resp[0].Severity, "critical"; got != want {
		t.Errorf("resp[0].Severity = %q, want %q", got, want)
	}
	if got, want := resp[0].Type, "battery_low_model_y"; got != want {
		t.Errorf("resp[0].Type = %q, want %q", got, want)
	}
	if got, want := resp[0].VehicleID, vehicleID; got != want {
		t.Errorf("resp[0].VehicleID = %d, want %d", got, want)
	}
	if resp[0].IsRead {
		t.Errorf("resp[0].IsRead = true, want false")
	}
	if resp[0].AcknowledgedAt == nil || !resp[0].AcknowledgedAt.Equal(acknowledgedAt) {
		t.Errorf("resp[0].AcknowledgedAt = %v, want %v", resp[0].AcknowledgedAt, acknowledgedAt)
	}
	if resp[0].AcknowledgedBy == nil || *resp[0].AcknowledgedBy != acknowledgedBy {
		t.Errorf("resp[0].AcknowledgedBy = %v, want %q", resp[0].AcknowledgedBy, acknowledgedBy)
	}
	if resp[0].AcknowledgementNote == nil || *resp[0].AcknowledgementNote != acknowledgementNote {
		t.Errorf("resp[0].AcknowledgementNote = %v, want %q", resp[0].AcknowledgementNote, acknowledgementNote)
	}
	if resp[0].AllVehicles == nil || *resp[0].AllVehicles {
		t.Errorf("resp[0].AllVehicles = %v, want false", resp[0].AllVehicles)
	}
	if len(resp[0].VehicleIDs) != 1 || resp[0].VehicleIDs[0] != vehicleID {
		t.Errorf("resp[0].VehicleIDs = %v, want [%d]", resp[0].VehicleIDs, vehicleID)
	}
	// Drill-through metadata.
	if resp[0].RuleID == nil || *resp[0].RuleID != ruleCritID {
		t.Errorf("resp[0].RuleID = %v, want pointer to %d", resp[0].RuleID, ruleCritID)
	}
	if resp[0].RuleSignal == nil || *resp[0].RuleSignal != "BatteryLevel" {
		t.Errorf("resp[0].RuleSignal = %v, want pointer to %q", resp[0].RuleSignal, "BatteryLevel")
	}
	if resp[0].RuleSeverity == nil || *resp[0].RuleSeverity != "critical" {
		t.Errorf("resp[0].RuleSeverity = %v, want pointer to %q", resp[0].RuleSeverity, "critical")
	}

	// Row 1: info rule but delivery failed → upgraded to "warning".
	if got, want := resp[1].Severity, "warning"; got != want {
		t.Errorf("resp[1].Severity = %q, want %q (failed delivery floor)", got, want)
	}
	if got, want := resp[1].Type, "door_unlocked"; got != want {
		t.Errorf("resp[1].Type = %q, want %q", got, want)
	}
	if resp[1].VehicleID != 0 {
		t.Errorf("resp[1].VehicleID = %d, want 0 (rule had no vehicle)", resp[1].VehicleID)
	}
	if resp[1].AllVehicles == nil || !*resp[1].AllVehicles {
		t.Errorf("resp[1].AllVehicles = %v, want true", resp[1].AllVehicles)
	}
	if resp[1].VehicleIDs == nil || len(resp[1].VehicleIDs) != 0 {
		t.Errorf("resp[1].VehicleIDs = %v, want an empty canonical scope", resp[1].VehicleIDs)
	}
	if !resp[1].IsRead {
		t.Errorf("resp[1].IsRead = false, want true")
	}
	// Drill-through metadata still propagates even when vehicle is nil.
	if resp[1].RuleID == nil || *resp[1].RuleID != ruleInfoID {
		t.Errorf("resp[1].RuleID = %v, want pointer to %d", resp[1].RuleID, ruleInfoID)
	}
	if resp[1].RuleSignal == nil || *resp[1].RuleSignal != "Locked" {
		t.Errorf("resp[1].RuleSignal = %v, want pointer to %q", resp[1].RuleSignal, "Locked")
	}
	if resp[1].RuleSeverity == nil || *resp[1].RuleSeverity != "info" {
		t.Errorf("resp[1].RuleSeverity = %v, want pointer to %q", resp[1].RuleSeverity, "info")
	}

	// Row 2: alert_id = nil → defaults.
	if got, want := resp[2].Severity, "info"; got != want {
		t.Errorf("resp[2].Severity = %q, want %q", got, want)
	}
	if got, want := resp[2].Type, "notification"; got != want {
		t.Errorf("resp[2].Type = %q, want %q", got, want)
	}
	if resp[2].VehicleID != 0 {
		t.Errorf("resp[2].VehicleID = %d, want 0", resp[2].VehicleID)
	}
	// alert_id was nil, so no rule was joined → drill-through metadata is omitted.
	if resp[2].RuleID != nil {
		t.Errorf("resp[2].RuleID = %v, want nil (no joined rule)", resp[2].RuleID)
	}
	if resp[2].RuleSignal != nil {
		t.Errorf("resp[2].RuleSignal = %v, want nil", resp[2].RuleSignal)
	}
	if resp[2].RuleSeverity != nil {
		t.Errorf("resp[2].RuleSeverity = %v, want nil", resp[2].RuleSeverity)
	}
	if resp[2].AllVehicles != nil || resp[2].VehicleIDs != nil {
		t.Errorf(
			"resp[2] scope = all:%v vehicles:%v, want nil system scope",
			resp[2].AllVehicles,
			resp[2].VehicleIDs,
		)
	}
}

func TestAlertHandler_List_EmptyReturnsEmptyArray(t *testing.T) {
	handler := &AlertHandler{
		alertRuleRepo: &fakeAlertRuleRepo{},
		notifRepo:     &fakeNotificationRepo{},
	}

	rec := httptest.NewRecorder()
	handler.List(rec, httptest.NewRequest(http.MethodGet, "/alerts", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	body := strings.TrimSpace(rec.Body.String())
	if body != "[]" {
		t.Fatalf("body = %q, want %q (must be empty array, not null)", body, "[]")
	}
}

func TestAlertHandler_List_AppliesPriorityFilters(t *testing.T) {
	notifRepo := &fakeNotificationRepo{}
	handler := &AlertHandler{
		alertRuleRepo: &fakeAlertRuleRepo{},
		notifRepo:     notifRepo,
	}

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(
		http.MethodGet,
		"/alerts?severity=warning,critical&vehicle_id=7,9&vehicle_id=7&from=2025-01-02&to=2025-01-03&before_created_at=2025-01-02T12:30:00Z&before_id=123&read=false&archived=false&limit=51&offset=3",
		nil,
	)
	handler.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if notifRepo.lastListFilters == nil {
		t.Fatal("filtered repository was not called")
	}
	got := notifRepo.lastListFilters
	if strings.Join(got.Severities, ",") != "warn,critical" {
		t.Fatalf("severities = %v, want [warn critical]", got.Severities)
	}
	if !got.IncludeFailedInfoAsWarning {
		t.Fatal("effective failed-info warning promotion was not requested")
	}
	if got.Read == nil || *got.Read {
		t.Fatalf("read = %v, want false", got.Read)
	}
	if got.Archived == nil || *got.Archived {
		t.Fatalf("archived = %v, want false", got.Archived)
	}
	if got.Limit != 51 || got.Offset != 3 {
		t.Fatalf("pagination = (%d, %d), want (51, 3)", got.Limit, got.Offset)
	}
	if len(got.VehicleIDs) != 2 || got.VehicleIDs[0] != 7 || got.VehicleIDs[1] != 9 {
		t.Fatalf("vehicle IDs = %v, want [7 9]", got.VehicleIDs)
	}
	wantFrom := time.Date(2025, time.January, 2, 0, 0, 0, 0, time.UTC)
	wantTo := time.Date(2025, time.January, 3, 23, 59, 59, int(time.Second-time.Nanosecond), time.UTC)
	if !got.From.Equal(wantFrom) || !got.To.Equal(wantTo) {
		t.Fatalf("date range = (%v, %v), want (%v, %v)", got.From, got.To, wantFrom, wantTo)
	}
	wantBefore := time.Date(2025, time.January, 2, 12, 30, 0, 0, time.UTC)
	if !got.BeforeCreatedAt.Equal(wantBefore) || got.BeforeID != 123 {
		t.Fatalf(
			"pagination cursor = (%v, %d), want (%v, 123)",
			got.BeforeCreatedAt,
			got.BeforeID,
			wantBefore,
		)
	}
}

func TestAlertHandler_List_RejectsInvalidFilters(t *testing.T) {
	handler := &AlertHandler{
		alertRuleRepo: &fakeAlertRuleRepo{},
		notifRepo:     &fakeNotificationRepo{},
	}

	for _, rawQuery := range []string{
		"severity=emergency",
		"vehicle_id=invalid",
		"vehicle_id=0",
		"from=tomorrow",
		"to=eventually",
		"from=2025-01-03&to=2025-01-02",
		"before_created_at=2025-01-02T12:30:00Z",
		"before_id=123",
		"before_created_at=tomorrow&before_id=123",
		"before_created_at=2025-01-02T12:30:00Z&before_id=0",
		"read=sometimes",
		"archived=perhaps",
	} {
		t.Run(rawQuery, func(t *testing.T) {
			rec := httptest.NewRecorder()
			handler.List(
				rec,
				httptest.NewRequest(http.MethodGet, "/alerts?"+rawQuery, nil),
			)
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestAlertHandler_MarkReadPersistsCanonicalReadState(t *testing.T) {
	notifRepo := &fakeNotificationRepo{}
	handler := &AlertHandler{notifRepo: notifRepo}
	request := httptest.NewRequest(http.MethodPost, "/alerts/42/read", nil)
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("alertID", "42")
	request = request.WithContext(
		context.WithValue(request.Context(), chi.RouteCtxKey, routeContext),
	)
	rec := httptest.NewRecorder()

	handler.MarkRead(rec, request)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notifRepo.readCalls) != 1 {
		t.Fatalf("read calls = %d, want 1", len(notifRepo.readCalls))
	}
	call := notifRepo.readCalls[0]
	if len(call.ids) != 1 || call.ids[0] != 42 || !call.read {
		t.Fatalf("read call = %+v, want ids [42] and read=true", call)
	}
}

func TestAlertRuleSeverityToWire(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"warn", "warning"},
		{"info", "info"},
		{"critical", "critical"},
		{"", "info"},
		{"unknown", "unknown"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := alertRuleSeverityToWire(tt.in); got != tt.want {
				t.Fatalf("alertRuleSeverityToWire(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestSlugifyRuleName(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"Battery low (Model Y)", "battery_low_model_y"},
		{"", "notification"},
		{"   ", "notification"},
		{"Already_underscored", "already_underscored"},
		{"---", "notification"},
		{"Mixed-Case Name 42!", "mixed_case_name_42"},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := slugifyRuleName(tt.in); got != tt.want {
				t.Fatalf("slugifyRuleName(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
