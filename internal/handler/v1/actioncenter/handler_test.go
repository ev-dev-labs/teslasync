package actioncenter

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
)

type fakeActionCenterService struct {
	subject string
	filter  actioncentersvc.ListFilter
	action  actioncentersvc.ActionRequest
}

func (f *fakeActionCenterService) List(
	_ context.Context, subject string, filter actioncentersvc.ListFilter,
) (*domain.Response, error) {
	f.subject = subject
	f.filter = filter
	return &domain.Response{Items: []domain.Recommendation{}, Limit: filter.Limit}, nil
}

func (f *fakeActionCenterService) ApplyAction(
	_ context.Context, _ string, request actioncentersvc.ActionRequest,
) (*domain.ActionResult, error) {
	f.action = request
	return &domain.ActionResult{}, nil
}

func (f *fakeActionCenterService) History(
	context.Context, string, string, int, int,
) (*domain.HistoryPage, error) {
	return &domain.HistoryPage{Items: []domain.ActionEvent{}}, nil
}

func TestActionCenterListParsesSnakeCaseFilters(t *testing.T) {
	service := &fakeActionCenterService{}
	handler := NewHandler(service, "X-Auth-Subject")
	request := httptest.NewRequest(
		http.MethodGet,
		"/action-center?vehicle_id=42&source_feature=active_alerts&priority=high&state=open&limit=10&offset=2",
		nil,
	)
	request.Header.Set("X-Auth-Subject", "user-1")
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if service.filter.VehicleID == nil || *service.filter.VehicleID != 42 ||
		service.filter.Limit != 10 || service.filter.Offset != 2 {
		t.Fatalf("parsed filter = %+v", service.filter)
	}
	if service.filter.SourceFeature == nil ||
		*service.filter.SourceFeature != domain.SourceActiveAlerts {
		t.Fatalf("source filter = %+v", service.filter.SourceFeature)
	}
}

func TestActionCenterListRejectsInvalidVehicle(t *testing.T) {
	handler := NewHandler(&fakeActionCenterService{}, "X-Auth-Subject")
	request := httptest.NewRequest(http.MethodGet, "/action-center?vehicle_id=0", nil)
	request.Header.Set("X-Auth-Subject", "user-1")
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}

func TestActionCenterUsesStableSubjectInOpenMode(t *testing.T) {
	service := &fakeActionCenterService{}
	handler := NewHandler(service, "")
	request := httptest.NewRequest(http.MethodGet, "/action-center", nil)
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.Code)
	}
	if service.subject != openModeSubject {
		t.Fatalf("subject = %q, want %q", service.subject, openModeSubject)
	}
}

func TestActionCenterRejectsMissingConfiguredSubject(t *testing.T) {
	handler := NewHandler(&fakeActionCenterService{}, "X-Auth-Subject")
	request := httptest.NewRequest(http.MethodGet, "/action-center", nil)
	response := httptest.NewRecorder()

	handler.List(response, request)

	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.Code)
	}
	var body map[string]string
	_ = json.NewDecoder(response.Body).Decode(&body)
	if body["code"] != "MISSING_IDENTITY" {
		t.Fatalf("body = %+v", body)
	}
}

func TestActionCenterActionDecodesConfirmationContract(t *testing.T) {
	service := &fakeActionCenterService{}
	handler := NewHandler(service, "X-Auth-Subject")
	router := chi.NewRouter()
	router.Post("/action-center/{recommendationID}/actions", handler.ApplyAction)
	body := `{"fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",` +
		`"action":"dismiss","expected_version":3,"confirmed":true}`
	request := httptest.NewRequest(
		http.MethodPost,
		"/action-center/ac_0123456789abcdef01234567/actions",
		strings.NewReader(body),
	)
	request.Header.Set("X-Auth-Subject", "user-1")
	response := httptest.NewRecorder()

	router.ServeHTTP(response, request)

	if response.Code != http.StatusOK {
		t.Fatalf("status = %d body=%s", response.Code, response.Body.String())
	}
	if service.action.RecommendationID != "ac_0123456789abcdef01234567" ||
		service.action.Action != domain.ActionDismiss ||
		service.action.ExpectedVersion != 3 ||
		!service.action.Confirmed {
		t.Fatalf("decoded action = %+v", service.action)
	}
}

func TestActionCenterActionRejectsUnknownFields(t *testing.T) {
	handler := NewHandler(&fakeActionCenterService{}, "X-Auth-Subject")
	request := httptest.NewRequest(
		http.MethodPost,
		"/action-center/id/actions",
		strings.NewReader(`{"confirmed":true,"unsafe_command":"unlock"}`),
	)
	request.Header.Set("X-Auth-Subject", "user-1")
	response := httptest.NewRecorder()

	handler.ApplyAction(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
