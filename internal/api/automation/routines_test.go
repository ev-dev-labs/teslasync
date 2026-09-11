package automation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestRoutineTemplatesCatalogue(t *testing.T) {
	all := RoutineTemplates()
	if len(all) < 20 {
		t.Fatalf("templates = %d, want at least 20", len(all))
	}
	seen := map[string]bool{}
	for _, tmpl := range all {
		if tmpl.ID == "" || tmpl.Name == "" || len(tmpl.Actions) == 0 {
			t.Fatalf("incomplete template: %+v", tmpl)
		}
		if tmpl.Event != "enter" && tmpl.Event != "exit" {
			t.Fatalf("bad event %q in %s", tmpl.Event, tmpl.ID)
		}
		if seen[tmpl.ID] {
			t.Fatalf("duplicate template id %s", tmpl.ID)
		}
		seen[tmpl.ID] = true
		if _, err := routineSteps(tmpl, 9); err != nil {
			t.Fatalf("routineSteps(%s) error: %v", tmpl.ID, err)
		}
	}
}

func TestListRoutineTemplates(t *testing.T) {
	h := &AutomationHandler{}
	req := httptest.NewRequest(http.MethodGet, "/routine-templates", nil)
	rec := httptest.NewRecorder()
	h.ListRoutineTemplates(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out []RoutineTemplate
	if err := json.NewDecoder(rec.Body).Decode(&out); err != nil {
		t.Fatal(err)
	}
	if len(out) < 20 {
		t.Fatalf("templates = %d, want at least 20", len(out))
	}
}

func TestInstallRoutineCreatesAutomation(t *testing.T) {
	repo := &automationPersistenceFakeRepo{}
	h := &AutomationHandler{repo: repo}
	r := chi.NewRouter()
	r.Post("/routine-templates/{id}/install", h.InstallRoutine)

	body := `{"place_id":7,"name":"Arrive Home"}`
	req := httptest.NewRequest(http.MethodPost, "/routine-templates/arrive_home/install", strings.NewReader(body))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%s)", rec.Code, rec.Body.String())
	}
	if len(repo.committedSteps) != 3 { // 1 trigger + 2 actions
		t.Fatalf("steps = %d, want 3", len(repo.committedSteps))
	}
	if repo.committedParent == nil || repo.committedParent.Name != "Arrive Home" {
		t.Fatalf("parent = %+v", repo.committedParent)
	}
}

func TestInstallRoutineRejectsUnknownTemplate(t *testing.T) {
	h := &AutomationHandler{repo: &automationPersistenceFakeRepo{}}
	r := chi.NewRouter()
	r.Post("/routine-templates/{id}/install", h.InstallRoutine)
	req := httptest.NewRequest(http.MethodPost, "/routine-templates/nope/install", strings.NewReader(`{"place_id":7}`))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestInstallRoutineRejectsMissingPlace(t *testing.T) {
	repo := &automationPersistenceFakeRepo{}
	h := &AutomationHandler{repo: repo}
	r := chi.NewRouter()
	r.Post("/routine-templates/{id}/install", h.InstallRoutine)
	req := httptest.NewRequest(http.MethodPost, "/routine-templates/arrive_home/install", strings.NewReader(`{}`))
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
	if repo.committedParent != nil {
		t.Fatal("invalid install must not reach the repo")
	}
}
