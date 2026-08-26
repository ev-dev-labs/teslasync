package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/api/datarepair"
)

// dataRepairRouteFake records which handler a request reached so the mount can
// be asserted without a database.
type dataRepairRouteFake struct {
	operation string
}

func (f *dataRepairRouteFake) respond(operation string, w http.ResponseWriter) {
	f.operation = operation
	w.WriteHeader(http.StatusNoContent)
}

func (f *dataRepairRouteFake) GetStaleSessions(w http.ResponseWriter, _ *http.Request) {
	f.respond("stale_sessions", w)
}
func (f *dataRepairRouteFake) GetSuggestions(w http.ResponseWriter, _ *http.Request) {
	f.respond("suggestions", w)
}
func (f *dataRepairRouteFake) ListCases(w http.ResponseWriter, _ *http.Request) {
	f.respond("list_cases", w)
}
func (f *dataRepairRouteFake) GetCaseStats(w http.ResponseWriter, _ *http.Request) {
	f.respond("case_stats", w)
}
func (f *dataRepairRouteFake) GetCase(w http.ResponseWriter, _ *http.Request) {
	f.respond("get_case", w)
}
func (f *dataRepairRouteFake) ListQuarantines(w http.ResponseWriter, _ *http.Request) {
	f.respond("list_quarantines", w)
}
func (f *dataRepairRouteFake) TransitionCase(w http.ResponseWriter, _ *http.Request) {
	f.respond("transition_case", w)
}
func (f *dataRepairRouteFake) AssignCase(w http.ResponseWriter, _ *http.Request) {
	f.respond("assign_case", w)
}
func (f *dataRepairRouteFake) AddCaseComment(w http.ResponseWriter, _ *http.Request) {
	f.respond("add_case_comment", w)
}
func (f *dataRepairRouteFake) BulkTransitionCases(w http.ResponseWriter, _ *http.Request) {
	f.respond("bulk_transition_cases", w)
}
func (f *dataRepairRouteFake) ScanCases(w http.ResponseWriter, _ *http.Request) {
	f.respond("scan_cases", w)
}
func (f *dataRepairRouteFake) QuarantineCase(w http.ResponseWriter, _ *http.Request) {
	f.respond("quarantine_case", w)
}
func (f *dataRepairRouteFake) RestoreQuarantine(w http.ResponseWriter, _ *http.Request) {
	f.respond("restore_quarantine", w)
}
func (f *dataRepairRouteFake) UpdateCharging(w http.ResponseWriter, _ *http.Request) {
	f.respond("update_charging", w)
}
func (f *dataRepairRouteFake) PreviewCharging(w http.ResponseWriter, _ *http.Request) {
	f.respond("preview_charging", w)
}
func (f *dataRepairRouteFake) CloseCharging(w http.ResponseWriter, _ *http.Request) {
	f.respond("close_charging", w)
}
func (f *dataRepairRouteFake) DeleteCharging(w http.ResponseWriter, _ *http.Request) {
	f.respond("delete_charging", w)
}
func (f *dataRepairRouteFake) UpdateDrive(w http.ResponseWriter, _ *http.Request) {
	f.respond("update_drive", w)
}
func (f *dataRepairRouteFake) PreviewDrive(w http.ResponseWriter, _ *http.Request) {
	f.respond("preview_drive", w)
}
func (f *dataRepairRouteFake) CloseDrive(w http.ResponseWriter, _ *http.Request) {
	f.respond("close_drive", w)
}
func (f *dataRepairRouteFake) DeleteDrive(w http.ResponseWriter, _ *http.Request) {
	f.respond("delete_drive", w)
}

// Compile-time assertion that the production handler still satisfies the mount
// surface — a renamed handler method fails the build here, not in production.
var _ dataRepairRoutes = (*datarepair.DataRepairHandler)(nil)

// passthroughSudo stands in for RequireSudo so the routing assertions are not
// entangled with step-up auth; the guard itself is asserted separately below.
func passthroughSudo(next http.Handler) http.Handler { return next }

func newDataRepairTestRouter(h dataRepairRoutes, sudo func(http.Handler) http.Handler) chi.Router {
	router := chi.NewRouter()
	router.Route("/api/v1", func(r chi.Router) {
		mountDataRepairRoutes(r, h, sudo)
	})
	return router
}

func TestDataRepairRoutes(t *testing.T) {
	tests := []struct {
		name      string
		method    string
		path      string
		operation string
	}{
		{"stale inventory", http.MethodGet, "/api/v1/data-repair/stale-sessions", "stale_sessions"},
		{"evidence diagnosis", http.MethodGet, "/api/v1/data-repair/suggestions", "suggestions"},
		{"case list", http.MethodGet, "/api/v1/data-repair/cases", "list_cases"},
		{"case stats", http.MethodGet, "/api/v1/data-repair/cases/stats", "case_stats"},
		{"case detail", http.MethodGet, "/api/v1/data-repair/cases/17", "get_case"},
		{"quarantine ledger", http.MethodGet, "/api/v1/data-repair/quarantine", "list_quarantines"},
		{"case transition", http.MethodPost, "/api/v1/data-repair/cases/17/transition", "transition_case"},
		{"case assignment", http.MethodPut, "/api/v1/data-repair/cases/17/assignment", "assign_case"},
		{"case comment", http.MethodPost, "/api/v1/data-repair/cases/17/comments", "add_case_comment"},
		{"case quarantine", http.MethodPost, "/api/v1/data-repair/cases/17/quarantine", "quarantine_case"},
		{"case bulk transition", http.MethodPost, "/api/v1/data-repair/cases/bulk-transition", "bulk_transition_cases"},
		{"case scan", http.MethodPost, "/api/v1/data-repair/cases/scan", "scan_cases"},
		{"quarantine restore", http.MethodPost, "/api/v1/data-repair/quarantine/21/restore", "restore_quarantine"},
		{"charging partial update", http.MethodPut, "/api/v1/data-repair/charging/3", "update_charging"},
		{"charging impact preview", http.MethodPost, "/api/v1/data-repair/charging/3/preview", "preview_charging"},
		{"charging apply", http.MethodPost, "/api/v1/data-repair/charging/3/close", "close_charging"},
		{"charging quarantine", http.MethodDelete, "/api/v1/data-repair/charging/3", "delete_charging"},
		// The drive routes are SINGULAR. The pre-refactor frontend used
		// `/drives/`, which 404'd every drive mutation.
		{"drive partial update", http.MethodPut, "/api/v1/data-repair/drive/42", "update_drive"},
		{"drive impact preview", http.MethodPost, "/api/v1/data-repair/drive/42/preview", "preview_drive"},
		{"drive apply", http.MethodPost, "/api/v1/data-repair/drive/42/close", "close_drive"},
		{"drive quarantine", http.MethodDelete, "/api/v1/data-repair/drive/42", "delete_drive"},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			handler := &dataRepairRouteFake{}
			router := newDataRepairTestRouter(handler, passthroughSudo)

			req := httptest.NewRequest(tt.method, tt.path, nil)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)

			if rec.Code != http.StatusNoContent {
				t.Fatalf("status = %d, want 204. body=%s", rec.Code, rec.Body.String())
			}
			if handler.operation != tt.operation {
				t.Fatalf("operation = %q, want %q", handler.operation, tt.operation)
			}
		})
	}
}

func TestDataRepairRoutes_ReadsAreUnguardedAndWritesAreSudoGated(t *testing.T) {
	// A sudo middleware that refuses everything. All GETs and the two
	// read-only previews must still be reachable while every mutation is
	// intercepted before it reaches its handler.
	denyAll := func(http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusForbidden)
		})
	}

	reads := []struct {
		method string
		path   string
		want   string
	}{
		{http.MethodGet, "/api/v1/data-repair/stale-sessions", "stale_sessions"},
		{http.MethodGet, "/api/v1/data-repair/suggestions", "suggestions"},
		{http.MethodGet, "/api/v1/data-repair/cases", "list_cases"},
		{http.MethodGet, "/api/v1/data-repair/cases/stats", "case_stats"},
		{http.MethodGet, "/api/v1/data-repair/cases/17", "get_case"},
		{http.MethodGet, "/api/v1/data-repair/quarantine", "list_quarantines"},
		{http.MethodPost, "/api/v1/data-repair/charging/3/preview", "preview_charging"},
		{http.MethodPost, "/api/v1/data-repair/drive/42/preview", "preview_drive"},
	}
	for _, r := range reads {
		handler := &dataRepairRouteFake{}
		router := newDataRepairTestRouter(handler, denyAll)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(r.method, r.path, nil))

		if rec.Code != http.StatusNoContent {
			t.Errorf("%s %s: status = %d, want 204 (read-only diagnosis must not be sudo-gated)",
				r.method, r.path, rec.Code)
		}
		if handler.operation != r.want {
			t.Errorf("%s %s: operation = %q, want %q", r.method, r.path, handler.operation, r.want)
		}
	}

	writes := []struct {
		method string
		path   string
	}{
		{http.MethodPut, "/api/v1/data-repair/charging/3"},
		{http.MethodPost, "/api/v1/data-repair/charging/3/close"},
		{http.MethodDelete, "/api/v1/data-repair/charging/3"},
		{http.MethodPost, "/api/v1/data-repair/cases/17/transition"},
		{http.MethodPut, "/api/v1/data-repair/cases/17/assignment"},
		{http.MethodPost, "/api/v1/data-repair/cases/17/comments"},
		{http.MethodPost, "/api/v1/data-repair/cases/17/quarantine"},
		{http.MethodPost, "/api/v1/data-repair/cases/bulk-transition"},
		{http.MethodPost, "/api/v1/data-repair/cases/scan"},
		{http.MethodPost, "/api/v1/data-repair/quarantine/21/restore"},
		{http.MethodPut, "/api/v1/data-repair/drive/42"},
		{http.MethodPost, "/api/v1/data-repair/drive/42/close"},
		{http.MethodDelete, "/api/v1/data-repair/drive/42"},
	}
	for _, wr := range writes {
		handler := &dataRepairRouteFake{}
		router := newDataRepairTestRouter(handler, denyAll)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(wr.method, wr.path, nil))

		if rec.Code != http.StatusForbidden {
			t.Errorf("%s %s: status = %d, want 403 (mutations must be sudo-gated)",
				wr.method, wr.path, rec.Code)
		}
		if handler.operation != "" {
			t.Errorf("%s %s: reached handler %q despite the sudo gate",
				wr.method, wr.path, handler.operation)
		}
	}
}

func TestDataRepairRoutes_RejectsIncorrectResourcePluralization(t *testing.T) {
	tests := []struct {
		method string
		path   string
	}{
		{http.MethodPut, "/api/v1/data-repair/drives/42"},
		{http.MethodPost, "/api/v1/data-repair/drives/42/preview"},
		{http.MethodPost, "/api/v1/data-repair/drives/42/close"},
		{http.MethodDelete, "/api/v1/data-repair/drives/42"},
		{http.MethodPut, "/api/v1/data-repair/chargings/3"},
		{http.MethodGet, "/api/v1/data-repair/case/17"},
		{http.MethodPost, "/api/v1/data-repair/case/17/quarantine"},
		{http.MethodGet, "/api/v1/data-repair/quarantines"},
		{http.MethodPost, "/api/v1/data-repair/quarantines/21/restore"},
	}
	for _, tt := range tests {
		handler := &dataRepairRouteFake{}
		router := newDataRepairTestRouter(handler, passthroughSudo)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(tt.method, tt.path, nil))

		if rec.Code != http.StatusNotFound {
			t.Errorf("%s %s: status = %d, want 404", tt.method, tt.path, rec.Code)
		}
		if handler.operation != "" {
			t.Errorf("%s %s: unexpectedly reached %q", tt.method, tt.path, handler.operation)
		}
	}
}
