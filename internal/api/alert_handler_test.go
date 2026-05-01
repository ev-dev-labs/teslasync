package api

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestAlertRuleContractRejectsForbiddenFields(t *testing.T) {
	forbiddenFields := []struct {
		name  string
		value string
	}{
		{"conditions", "[]"},
		{"expression", `"VehicleSpeed > 70"`},
		{"for_duration_s", "60"},
		{"msg_template", `"legacy message"`},
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
			name:       "rejects msg_template",
			body:       `{"message":"Test alert message","msg_template":"legacy"}`,
			wantStatus: http.StatusBadRequest,
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

func validAlertRuleForTest() *models.AlertRule {
	valueNum := 70.0
	return &models.AlertRule{
		ID:          42,
		Name:        "Speed warning",
		Enabled:     true,
		SignalName:  "VehicleSpeed",
		Op:          ">",
		ValueNum:    &valueNum,
		Severity:    "warn",
		CooldownMin: 15,
		CreatedAt:   time.Now().UTC(),
		UpdatedAt:   time.Now().UTC(),
	}
}

type fakeAlertRuleRepo struct {
	existing *models.AlertRule
	byID     map[int64]*models.AlertRule
	created  []*models.AlertRule
	updated  []*models.AlertRule
}

func (f *fakeAlertRuleRepo) GetAll(context.Context) ([]*models.AlertRule, error) {
	if f.existing == nil {
		return []*models.AlertRule{}, nil
	}
	return []*models.AlertRule{f.existing}, nil
}

func (f *fakeAlertRuleRepo) Update(_ context.Context, _ int64, rule *models.AlertRule) error {
	f.updated = append(f.updated, cloneAlertRuleForTest(rule))
	return nil
}

func (f *fakeAlertRuleRepo) GetByID(_ context.Context, id int64) (*models.AlertRule, error) {
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

func (f *fakeAlertRuleRepo) Create(_ context.Context, rule *models.AlertRule) error {
	rule.ID = 100 + int64(len(f.created))
	rule.CreatedAt = time.Now().UTC()
	rule.UpdatedAt = rule.CreatedAt
	f.created = append(f.created, cloneAlertRuleForTest(rule))
	return nil
}

func (f *fakeAlertRuleRepo) Delete(context.Context, int64) error {
	return nil
}

func cloneAlertRuleForTest(rule *models.AlertRule) *models.AlertRule {
	if rule == nil {
		return nil
	}
	data, err := json.Marshal(rule)
	if err != nil {
		panic(err)
	}
	var cloned models.AlertRule
	if err := json.Unmarshal(data, &cloned); err != nil {
		panic(err)
	}
	return &cloned
}

type fakeNotificationRepo struct {
	logs []*models.NotificationLog
}

func (f *fakeNotificationRepo) GetLogs(context.Context, int, int) ([]*models.NotificationLog, error) {
	if f.logs == nil {
		return []*models.NotificationLog{}, nil
	}
	return f.logs, nil
}

func (f *fakeNotificationRepo) CreateLog(_ context.Context, log *models.NotificationLog) error {
	if log == nil {
		return errors.New("notification log is nil")
	}
	log.ID = 1
	log.CreatedAt = time.Now().UTC()
	return nil
}

func (f *fakeNotificationRepo) GetChannel(context.Context, int64) (*models.NotificationChannel, error) {
	return nil, nil
}

func (f *fakeNotificationRepo) GetAllChannels(context.Context) ([]*models.NotificationChannel, error) {
	return []*models.NotificationChannel{}, nil
}

// ─── Adapter tests (Phase 40 / Prompt 04) ───────────────────────────────────

func TestAlertHandler_List_AdaptsNotificationLogsToAlertShape(t *testing.T) {
	ruleCritID := int64(11)
	ruleInfoID := int64(22)
	vehicleID := int64(7)

	criticalRule := &models.AlertRule{
		ID:        ruleCritID,
		Name:      "Battery low (Model Y)",
		Severity:  "critical",
		VehicleID: &vehicleID,
	}
	infoRule := &models.AlertRule{
		ID:       ruleInfoID,
		Name:     "Door unlocked",
		Severity: "info",
	}

	now := time.Now().UTC()
	logs := []*models.NotificationLog{
		{ID: 1001, AlertID: &ruleCritID, Title: "Battery is low", Message: "5%", Status: "sent", CreatedAt: now},
		{ID: 1002, AlertID: &ruleInfoID, Title: "Door unlocked", Message: "front-left", Status: "failed", CreatedAt: now},
		{ID: 1003, AlertID: nil, Title: "Test notification", Message: "hello", Status: "sent", CreatedAt: now},
	}

	repo := &fakeAlertRuleRepo{
		byID: map[int64]*models.AlertRule{
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
