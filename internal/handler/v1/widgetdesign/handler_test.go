package widgetdesign

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/app/widgetdesignsvc"
	domain "github.com/ev-dev-labs/teslasync/internal/domain/widgetdesign"
	"github.com/ev-dev-labs/teslasync/internal/handler/dto"
)

type memoryRepo struct {
	values map[string]domain.Preference
	err    error
	calls  int
	ctx    context.Context
}

func (m *memoryRepo) Get(ctx context.Context, scope string) (*domain.Preference, error) {
	m.calls++
	m.ctx = ctx
	id, ok := m.values[scope]
	if !ok {
		return nil, m.err
	}
	return &id, m.err
}

func (m *memoryRepo) Put(ctx context.Context, scope, id string, appWide *bool) (domain.Preference, error) {
	m.calls++
	m.ctx = ctx
	if m.err != nil {
		return domain.Preference{}, m.err
	}
	value := m.values[scope]
	value.PackID = id
	if appWide != nil {
		value.AppWide = *appWide
	}
	m.values[scope] = value
	return value, nil
}

func call(h *Handler, method, subject, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/settings/widget-design-pack", strings.NewReader(body))
	if subject != "" {
		r.Header.Set("X-External-Subject", subject)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func preference(t *testing.T, w *httptest.ResponseRecorder) dto.WidgetDesignPreference {
	t.Helper()
	if w.Code != 200 {
		t.Fatalf("status %d: %s", w.Code, w.Body)
	}
	var result dto.WidgetDesignPreference
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestDurableSubjectSelection(t *testing.T) {
	repo := &memoryRepo{values: map[string]domain.Preference{}}
	// Independent handlers stand in for API processes using the same store.
	a := NewHandler(widgetdesignsvc.New(repo), "X-External-Subject")
	b := NewHandler(widgetdesignsvc.New(repo), "X-External-Subject")
	open := NewHandler(widgetdesignsvc.New(repo), "")
	subject := "Opaque/CaseSensitive:NOT-an-email"
	first := preference(t, call(a, "GET", subject, ""))
	if first.PackID != "classic" || first.AppWide || first.Scope != domain.Scope(subject, false) {
		t.Fatalf("unexpected default %+v", first)
	}
	for _, id := range strings.Split("classic,v1,v2,v3,v4,v5,v6,v7,motorsport,blueprint,editorial,ambient,terminal,atlas,analog,observatory,bauhaus,quiet,warm,swiss,material,glass,deco,kinetic,brutal,cyber,memphis", ",") {
		saved := preference(t, call(a, "PUT", subject, `{"pack_id":"`+id+`"}`))
		if got := preference(t, call(b, "GET", subject, "")); got != saved || got.PackID != id {
			t.Fatalf("read-after-write %s: %+v != %+v", id, got, saved)
		}
	}
	for _, other := range []string{"opaque/CaseSensitive:NOT-an-email", subject + " ", "different"} {
		got := preference(t, call(b, "GET", other, ""))
		if got.PackID != "classic" || got.Scope == first.Scope {
			t.Fatalf("identity collision: %+v", got)
		}
	}
	shared := preference(t, call(open, "PUT", "", `{"pack_id":"v4"}`))
	if shared.Scope != domain.Scope("", true) || shared.Scope == first.Scope {
		t.Fatal("open scope not separate")
	}
	if got := preference(t, call(open, "GET", subject, "")); got != shared {
		t.Fatal("open mode must ignore supplied identity headers")
	}
	repo.values[first.Scope] = domain.Preference{PackID: "future-unknown", AppWide: true}
	if got := preference(t, call(b, "GET", subject, "")); got.PackID != "classic" || got.AppWide {
		t.Fatal("unknown stored ID not safely resolved")
	}
}

func TestFailClosedValidationAndFailures(t *testing.T) {
	repo := &memoryRepo{values: map[string]domain.Preference{}}
	h := NewHandler(widgetdesignsvc.New(repo), "X-External-Subject")
	for _, method := range []string{"GET", "PUT"} {
		for _, subject := range []string{"", "   "} {
			w := call(h, method, subject, `{"pack_id":"v1"}`)
			if w.Code != 401 || repo.calls != 0 {
				t.Fatalf("missing identity admitted: %d calls %d", w.Code, repo.calls)
			}
			if w.Header().Get("Cache-Control") != "private, no-store" ||
				!strings.Contains(strings.Join(w.Header().Values("Vary"), ","), "X-External-Subject") {
				t.Fatal("identity responses must not be cached")
			}
		}
	}
	for _, body := range []string{
		`{}`, `null`, `{"pack_id":null}`, `{"pack_id":"CLASSIC"}`, `{"pack_id":" v1"}`,
		`{"pack_id":"unknown"}`, `{"pack_id":"v1","scope":"open"}`,
		`{"pack_id":"v1","subject":"other"}`, `{"pack_id":"v1"} {}`, `{"pack_id":4}`,
		`{"pack_id":"v1","app_wide":"true"}`, `{"pack_id":"v1","appWide":true}`,
		`{"pack_id":"` + strings.Repeat("x", 2048) + `"}`,
	} {
		if w := call(h, "PUT", "subject", body); w.Code != 400 {
			t.Errorf("body %q: %d", body, w.Code)
		}

	}
	if repo.calls != 0 {
		t.Fatal("invalid requests reached persistence")
	}
	repo.err = errors.New("private database failure")
	for _, method := range []string{"GET", "PUT"} {
		w := call(h, method, "subject", `{"pack_id":"v1"}`)
		if w.Code != 500 || strings.Contains(w.Body.String(), "private database") {
			t.Fatalf("error handling: %d %s", w.Code, w.Body)
		}
		if repo.ctx == nil {
			t.Fatal("request context not propagated")
		}
	}
}

func TestAppWideOptInAcrossProcesses(t *testing.T) {
	repo := &memoryRepo{values: map[string]domain.Preference{}}
	a := NewHandler(widgetdesignsvc.New(repo), "X-External-Subject")
	b := NewHandler(widgetdesignsvc.New(repo), "X-External-Subject")
	subject := "app-viewer"
	if got := preference(t, call(a, "PUT", subject, `{"pack_id":"quiet"}`)); got.AppWide {
		t.Fatal("existing pack saves must remain widget-only")
	}
	enabled := preference(t, call(a, "PUT", subject, `{"pack_id":"material","app_wide":true}`))
	if !enabled.AppWide || enabled.PackID != "material" {
		t.Fatalf("opt-in not saved: %+v", enabled)
	}
	if got := preference(t, call(b, "GET", subject, "")); got != enabled {
		t.Fatalf("independent process lost opt-in: %+v", got)
	}
	if got := preference(t, call(b, "GET", "another-viewer", "")); got.AppWide {
		t.Fatal("opt-in leaked to another identity")
	}
	if got := preference(t, call(b, "PUT", subject, `{"pack_id":"brutal"}`)); !got.AppWide || got.PackID != "brutal" {
		t.Fatal("older client pack-only write must preserve app scope")
	}
	if got := preference(t, call(a, "PUT", subject, `{"pack_id":"brutal","app_wide":false}`)); got.AppWide || got.PackID != "brutal" {
		t.Fatal("returning to widgets must preserve selected design")
	}
}
