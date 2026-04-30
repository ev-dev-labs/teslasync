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

func (f *fakeAlertRuleRepo) GetByID(context.Context, int64) (*models.AlertRule, error) {
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

type fakeNotificationRepo struct{}

func (f *fakeNotificationRepo) GetLogs(context.Context, int, int) ([]*models.NotificationLog, error) {
	return []*models.NotificationLog{}, nil
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
