package alerts

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/alertpacks"
	"github.com/go-chi/chi/v5"
)

type packFake struct {
	err       error
	calls     int
	templates []alertpacks.Template
	pack      alertpacks.Pack
}

func (f *packFake) ListPackInstallations(context.Context, int, int) ([]alertpacks.Installation, error) {
	return nil, f.err
}
func (f *packFake) InstallPack(_ context.Context, p alertpacks.Pack, scope string, rules []alertpacks.Template) (*alertpacks.Installation, error) {
	f.calls++
	f.templates, f.pack = rules, p
	return &alertpacks.Installation{ID: 1, PackID: p.ID, ScopeKey: scope, Members: []alertpacks.Member{}}, f.err
}
func (f *packFake) RemovePack(context.Context, int64, []int64) error { f.calls++; return f.err }

func packRouter(f *packFake) http.Handler {
	h := &AlertHandler{packRepo: f}
	r := chi.NewRouter()
	r.Get("/packs", h.ListPacks)
	r.Get("/installations", h.ListPackInstallations)
	r.Post("/packs/{packID}/install", h.InstallPack)
	r.Post("/installations/{installationID}/remove", h.RemovePack)
	return r
}

func TestPackEndpoints(t *testing.T) {
	valid := `{"version":1,"all_vehicles":true,"enabled":false,"rules":[{"template_id":"battery-low"}]}`
	for _, tt := range []struct {
		name, method, path, body string
		err                      error
		status, calls            int
	}{
		{"catalog", "GET", "/packs", "", nil, 200, 0},
		{"empty list", "GET", "/installations", "", nil, 200, 0},
		{"list failure", "GET", "/installations", "", errors.New("db down"), 500, 0},
		{"install", "POST", "/packs/everyday/install", valid, nil, 201, 1},
		{"unknown pack", "POST", "/packs/no/install", valid, nil, 404, 0},
		{"bad JSON", "POST", "/packs/everyday/install", "{", nil, 400, 0},
		{"unknown field", "POST", "/packs/everyday/install", `{"inject":true}`, nil, 400, 0},
		{"empty rules", "POST", "/packs/everyday/install", `{"version":1,"all_vehicles":true,"rules":[]}`, nil, 400, 0},
		{"already installed", "POST", "/packs/everyday/install", valid, alertpacks.ErrInstalled, 409, 1},
		{"install failure", "POST", "/packs/everyday/install", valid, errors.New("secret DB detail"), 500, 1},
		{"remove keep", "POST", "/installations/1/remove", `{"delete_rule_ids":[]}`, nil, 200, 1},
		{"remove missing", "POST", "/installations/1/remove", `{}`, alertpacks.ErrNotFound, 404, 1},
		{"remove foreign", "POST", "/installations/1/remove", `{"delete_rule_ids":[2]}`, alertpacks.ErrSelection, 409, 1},
		{"remove invalid", "POST", "/installations/0/remove", `{}`, nil, 400, 0},
		{"remove negative rule", "POST", "/installations/1/remove", `{"delete_rule_ids":[-1]}`, nil, 400, 0},
		{"custom no name", "POST", "/packs/custom/install", valid, nil, 400, 0},
		{"custom group", "POST", "/packs/custom/install", strings.Replace(valid, `"version":1`, `"version":1,"name":"My group"`, 1), nil, 201, 1},
	} {
		t.Run(tt.name, func(t *testing.T) {
			f := &packFake{err: tt.err}
			rec := httptest.NewRecorder()
			packRouter(f).ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body)))
			if rec.Code != tt.status || f.calls != tt.calls {
				t.Fatalf("status=%d calls=%d body=%s", rec.Code, f.calls, rec.Body.String())
			}
			if strings.Contains(rec.Body.String(), "secret DB detail") {
				t.Fatal("internal details leaked")
			}
			if tt.name == "empty list" && strings.TrimSpace(rec.Body.String()) != "[]" {
				t.Fatal("list not array")
			}
			if tt.name == "install" && (f.templates[0].Rule.Enabled || f.templates[0].Rule.TriggerMode != "once") {
				t.Fatal("defaults not preserved")
			}
			if tt.name == "custom group" && (!strings.HasPrefix(f.pack.ID, "custom-") || f.pack.Name != "My group") {
				t.Fatal("custom name not persisted")
			}
		})
	}
}

func TestEveryPackInstallsValidOrdinaryRules(t *testing.T) {
	for _, pack := range alertpacks.Catalog() {
		request := alertpacks.InstallRequest{Version: pack.Version, AllVehicles: true}
		for _, template := range pack.Rules {
			request.Rules = append(request.Rules, alertpacks.Selection{TemplateID: template.ID})
		}
		body, _ := json.Marshal(request)
		rec := httptest.NewRecorder()
		packRouter(&packFake{}).ServeHTTP(rec, httptest.NewRequest("POST", "/packs/"+pack.ID+"/install", strings.NewReader(string(body))))
		if rec.Code != 201 {
			t.Fatalf("%s: %d %s", pack.ID, rec.Code, rec.Body.String())
		}
	}
}
