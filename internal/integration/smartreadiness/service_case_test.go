package smartreadiness_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/app/actioncentersvc"
	"github.com/ev-dev-labs/teslasync/internal/app/smartreadinesssvc"
	actiondb "github.com/ev-dev-labs/teslasync/internal/database/actioncenter"
	actiondomain "github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	actionhandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/actioncenter"
	readinesshandler "github.com/ev-dev-labs/teslasync/internal/handler/v1/smartreadiness"
	port "github.com/ev-dev-labs/teslasync/internal/port/smartreadiness"
)

const serviceCaseBase = "/api/v1/service-intelligence/service-case"
const serviceCaseOwner = "synthetic-service-owner"
const serviceCasePeer = "synthetic-service-peer"

func serviceCaseRouters(t *testing.T, clock func() time.Time) (http.Handler, http.Handler) {
	t.Helper()
	repo, db := testRepository(t)
	applyWarrantyFixtureMigration(t, db, "000223_action_center_state.up")
	for _, direction := range []string{"up", "down", "up"} {
		applyWarrantyFixtureMigration(t, db, "000282_smart_service_cases."+direction)
	}
	if _, err := db.Pool.Exec(t.Context(), `INSERT INTO vehicles (id,display_name) VALUES (8,'Other synthetic vehicle')`); err != nil {
		t.Fatal(err)
	}
	readiness := smartreadinesssvc.New(repo, &controlledLive{}, controlledSite{}, smartreadinesssvc.WithClock(clock))
	cases := smartreadinesssvc.NewServiceCases(repo, clock)
	recommendations := actioncentersvc.New(emptySources{}, actiondb.NewStateRepository(db),
		actioncentersvc.WithServiceCases(cases, nil), actioncentersvc.WithClock(clock))
	router := func(header string) http.Handler {
		actions := actionhandler.NewHandler(recommendations, header)
		r := chi.NewRouter()
		r.Route("/api/v1", func(r chi.Router) {
			readinesshandler.NewHandler(readiness, header, readinesshandler.WithServiceCases(cases)).MountRoutes(r)
			r.Get("/action-center", actions.List)
			r.Post("/action-center/{recommendationID}/actions", actions.ApplyAction)
		})
		return r
	}
	return router("X-Test-Subject"), router("")
}

func TestPrivateServiceCaseSelectsAndExportsOnlyReviewedFields(t *testing.T) {
	now := time.Date(2026, 11, 20, 10, 0, 0, 0, time.UTC)
	router, open := serviceCaseRouters(t, func() time.Time { return now })
	call := func(handler http.Handler, method, path, subject string, submission any, status int) *httptest.ResponseRecorder {
		t.Helper()
		b, err := json.Marshal(submission)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest(method, path, bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-Test-Subject", subject)
		if subject != "" {
			r.Header.Set("X-TeslaSync-Expected-Principal", "subject:"+subject)
		}
		resp := httptest.NewRecorder()
		handler.ServeHTTP(resp, r)
		if resp.Code != status || resp.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("%s %s: got %d (%s), want %d no-store: %s", method, path, resp.Code, resp.Header().Get("Cache-Control"), status, resp.Body)
		}
		return resp
	}
	const vehicle = "?vehicle_id=7"
	const base = serviceCaseBase + vehicle
	read := func(subject, path string) domain.ServiceCase {
		t.Helper()
		var response struct{ Data domain.ServiceCase }
		if err := json.Unmarshal(call(router, http.MethodGet, path, subject, nil, 200).Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		return response.Data
	}
	inbox := func(subject string, count int) {
		t.Helper()
		body := call(router, http.MethodGet, "/api/v1/action-center"+vehicle+"&source_feature=service_case", subject, nil, 200).Body
		var response actiondomain.Response
		if err := json.Unmarshal(body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		if len(response.Items) != count || strings.Contains(body.String(), "PRIVATE DRAFT") || strings.Contains(body.String(), "PRIVATE WORK") {
			t.Fatalf("unexpected private card response: %s", body)
		}
		if count == 1 && !strings.Contains(body.String(), "/diagnostics/service-evidence?vehicle_id=7#private-service-case") {
			t.Fatalf("card links to wrong workspace: %s", body)
		}
	}

	if record := read(serviceCaseOwner, base); record.ID != 0 || len(record.Evidence) != 0 {
		t.Fatalf("new installation already contains a case: %+v", record)
	}
	call(open, http.MethodGet, base, "", nil, 403)
	inbox(serviceCaseOwner, 0)
	call(router, http.MethodPut, base, serviceCaseOwner, map[string]any{"title": "PRIVATE DRAFT", "expected_case_id": 0, "expected_version": 0}, 204)
	inbox(serviceCaseOwner, 0)
	add := func(kind domain.ServiceCaseKind, at time.Time, detail string, status int) {
		t.Helper()
		record := read(serviceCaseOwner, base)
		call(router, http.MethodPost, serviceCaseBase+"/evidence"+vehicle, serviceCaseOwner, map[string]any{
			"kind": kind, "detail": detail, "observed_at": at, "expected_case_id": record.ID, "expected_version": record.Version,
		}, status)
	}
	add(domain.ServiceCaseWarning, now.Add(-15*24*time.Hour), "Unrelated old warning", 400)
	add(domain.ServiceCaseWork, now.Add(-time.Hour), "PRIVATE WORK", 204)
	add(domain.ServiceCaseWarning, now.Add(-2*time.Hour), "Synthetic service warning", 204)
	inbox(serviceCaseOwner, 1)
	inbox(serviceCasePeer, 0)
	if read(serviceCasePeer, base).ID != 0 || read(serviceCaseOwner, serviceCaseBase+"?vehicle_id=8").ID != 0 {
		t.Fatal("foreign subject or vehicle can read private case")
	}
	record := read(serviceCaseOwner, base)
	if len(record.Evidence) != 2 || record.Evidence[0].Kind != domain.ServiceCaseWarning {
		t.Fatalf("unexpected case evidence: %+v", record)
	}
	type selection struct {
		port.ServiceCaseKey
		Rows   []domain.ServiceCaseSelection `json:"selection"`
		Digest string                        `json:"reviewed_digest"`
	}
	picks := selection{ServiceCaseKey: port.ServiceCaseKey{ID: record.ID, Version: record.Version},
		Rows: []domain.ServiceCaseSelection{{ID: record.Evidence[1].ID, IncludeTime: true}, {ID: record.Evidence[0].ID, IncludeDetail: true}}}
	previewPath, exportPath := serviceCaseBase+"/preview"+vehicle, serviceCaseBase+"/export"+vehicle
	call(router, http.MethodPost, exportPath, serviceCaseOwner, picks, 409)
	call(router, http.MethodPost, previewPath, serviceCasePeer, picks, 409)
	call(router, http.MethodPost, serviceCaseBase+"/preview?vehicle_id=8", serviceCaseOwner, picks, 409)
	type previewResponse struct {
		Data struct {
			Document domain.ServiceCasePreview
			Digest   string
		}
	}
	var review previewResponse
	if err := json.Unmarshal(call(router, http.MethodPost, previewPath, serviceCaseOwner, picks, 200).Body.Bytes(), &review); err != nil {
		t.Fatal(err)
	}
	picks.Digest = review.Data.Digest
	download := call(router, http.MethodPost, exportPath, serviceCaseOwner, picks, 200)
	expected, err := json.MarshalIndent(review.Data.Document, "", "  ")
	if err != nil || len(review.Data.Document.Evidence) != 2 || !bytes.Equal(download.Body.Bytes(), expected) ||
		!strings.Contains(download.Header().Get("Content-Disposition"), "attachment") ||
		strings.Contains(download.Body.String(), "PRIVATE") || strings.Contains(download.Body.String(), `"id"`) ||
		review.Data.Document.Evidence[0].ObservedAt != nil || review.Data.Document.Evidence[1].Detail != nil {
		t.Fatalf("export diverged from explicit review: %s (%v)", download.Body, err)
	}
	add(domain.ServiceCaseFirmware, now.Add(-5*time.Minute), "Synthetic firmware 1.2", 204)
	call(router, http.MethodPost, exportPath, serviceCaseOwner, picks, 409)
	latest := read(serviceCaseOwner, base)
	deletePath := fmt.Sprintf("%s&case_id=%d&version=%d", base, latest.ID, latest.Version)
	call(router, http.MethodDelete, deletePath, serviceCasePeer, nil, 409)
	call(router, http.MethodDelete, deletePath, serviceCaseOwner, nil, 204)
	call(router, http.MethodPost, previewPath, serviceCaseOwner, picks, 409)
	inbox(serviceCaseOwner, 0)
}

func TestPrivateServiceCaseBrowserJourney(t *testing.T) {
	if os.Getenv("TESLASYNC_SMART_SERVICE_CASE_BROWSER") != "1" {
		t.Skip("set TESLASYNC_SMART_SERVICE_CASE_BROWSER=1 to run the real-handler browser journey")
	}
	if os.Getenv("TESLASYNC_SMART_READINESS_TEST_DSN") == "" && os.Getenv("TESLASYNC_SMART_COMMUTE_TEST_DSN") == "" {
		t.Fatal("the browser journey requires a disposable PostgreSQL test database")
	}
	router, _ := serviceCaseRouters(t, time.Now)
	runPrivatePlanningBrowser(t, router, "", nil, "smart-service-case.smoke.spec.ts", "SMART_SERVICE_CASE_REAL_BACKEND=1", nil)
}
