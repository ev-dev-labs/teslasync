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

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// fakeFeedbackQueueStore implements FeedbackQueueStore for unit tests.
type fakeFeedbackQueueStore struct {
	listResult []database.UserFeedback
	listTotal  int64
	listErr    error
	listParams database.FeedbackListParams

	getResult database.UserFeedback
	getErr    error
	lastGetID int64

	updateResult database.UserFeedback
	updateErr    error
	lastUpdate   database.FeedbackUpdate
	lastUpdateID int64
	updateCalls  int
}

func (f *fakeFeedbackQueueStore) List(_ context.Context, p database.FeedbackListParams) ([]database.UserFeedback, int64, error) {
	f.listParams = p
	return f.listResult, f.listTotal, f.listErr
}

func (f *fakeFeedbackQueueStore) Get(_ context.Context, id int64) (database.UserFeedback, error) {
	f.lastGetID = id
	return f.getResult, f.getErr
}

func (f *fakeFeedbackQueueStore) Update(_ context.Context, id int64, upd database.FeedbackUpdate) (database.UserFeedback, error) {
	f.updateCalls++
	f.lastUpdate = upd
	f.lastUpdateID = id
	if f.updateErr != nil {
		return database.UserFeedback{}, f.updateErr
	}
	row := f.updateResult
	if row.ID == 0 {
		row.ID = id
	}
	if upd.Status != nil {
		row.Status = *upd.Status
	}
	if upd.GitHubIssueURL != nil {
		row.GitHubIssueURL = *upd.GitHubIssueURL
	}
	return row, nil
}

// fakeGitHubIssuesPoster captures the last CreateIssue call so the
// "forward to GitHub" branch can be asserted without real HTTP traffic.
type fakeGitHubIssuesPoster struct {
	url        string
	err        error
	calls      int
	lastTitle  string
	lastBody   string
	lastLabels []string
}

func (g *fakeGitHubIssuesPoster) CreateIssue(_ context.Context, title, body string, labels []string) (string, error) {
	g.calls++
	g.lastTitle = title
	g.lastBody = body
	g.lastLabels = labels
	return g.url, g.err
}

func adminFeedbackTestCfg(repo string) *config.Config {
	return &config.Config{
		Auth:   config.AuthConfig{ForwardAuthHeader: "X-User"},
		GitHub: config.GitHubConfig{Repo: repo},
	}
}

func TestAdminFeedbackList(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		listResult: []database.UserFeedback{
			{ID: 1, Category: "bug", Title: "broken thing", Status: "new", CreatedAt: time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)},
			{ID: 2, Category: "feature", Title: "want a thing", Status: "triaged"},
		},
		listTotal: 2,
	}
	bridge := &fakeGitHubIssuesPoster{}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg("ev-dev-labs/teslasync"), nil, bridge)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/feedback?limit=10&offset=0", nil)
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp adminFeedbackListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(resp.Items) != 2 || resp.Total != 2 {
		t.Fatalf("unexpected list response: %+v", resp)
	}
	if !resp.GitHubBridgeEnabled || resp.GitHubRepo != "ev-dev-labs/teslasync" {
		t.Fatalf("github bridge state wrong: %+v", resp)
	}
}

func TestAdminFeedbackListBridgeHiddenWhenUnconfigured(t *testing.T) {
	store := &fakeFeedbackQueueStore{listResult: []database.UserFeedback{}, listTotal: 0}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/feedback", nil)
	h.List(rec, req)

	var resp adminFeedbackListResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.GitHubBridgeEnabled {
		t.Fatalf("bridge should be disabled when cfg.GitHub.Repo is empty")
	}
}

func TestAdminFeedbackListInvalidStatus(t *testing.T) {
	store := &fakeFeedbackQueueStore{listErr: database.ErrFeedbackInvalidStatus}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/admin/feedback?status=garbage", nil)
	h.List(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

// helper to build a chi-routed request so chi.URLParam(r, "id") works.
func adminFeedbackRouted(method, target string, body string, h *AdminFeedbackHandler, route string, fn func(http.ResponseWriter, *http.Request)) (*httptest.ResponseRecorder, *http.Request) {
	r := chi.NewRouter()
	switch method {
	case http.MethodGet:
		r.Get(route, fn)
	case http.MethodPatch:
		r.Patch(route, fn)
	case http.MethodPost:
		r.Post(route, fn)
	}
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, target, nil)
	} else {
		req = httptest.NewRequest(method, target, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("X-User", "alice@example.com")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	return rec, req
}

func TestAdminFeedbackGet(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		getResult: database.UserFeedback{ID: 7, Category: "bug", Title: "x", Status: "new"},
	}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	rec, _ := adminFeedbackRouted(http.MethodGet, "/admin/feedback/7", "", h, "/admin/feedback/{id}", h.Get)
	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.lastGetID != 7 {
		t.Fatalf("id not parsed: got %d", store.lastGetID)
	}
}

func TestAdminFeedbackGetNotFound(t *testing.T) {
	store := &fakeFeedbackQueueStore{getErr: database.ErrFeedbackNotFound}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	rec, _ := adminFeedbackRouted(http.MethodGet, "/admin/feedback/99", "", h, "/admin/feedback/{id}", h.Get)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: got %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminFeedbackPatchStatus(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		updateResult: database.UserFeedback{ID: 5, Category: "bug", Title: "x", Status: "triaged"},
	}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	body := `{"status":"triaged"}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if store.updateCalls != 1 {
		t.Fatalf("update not called")
	}
	if store.lastUpdate.Status == nil || *store.lastUpdate.Status != "triaged" {
		t.Fatalf("status not threaded into update: %+v", store.lastUpdate)
	}
	if store.lastUpdate.TriagedBy != "alice@example.com" {
		t.Fatalf("triaged_by not set: %q", store.lastUpdate.TriagedBy)
	}
}

func TestAdminFeedbackPatchInvalidStatus(t *testing.T) {
	store := &fakeFeedbackQueueStore{updateErr: database.ErrFeedbackInvalidStatus}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	body := `{"status":"weird"}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminFeedbackPatchForwardWithoutBridgeReturns400(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		getResult: database.UserFeedback{ID: 5, Category: "bug", Title: "x", Body: "y", Status: "new"},
	}
	// Bridge intentionally nil — operator left GITHUB_REPO unset.
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	body := `{"forward_to_github":true}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if store.updateCalls != 0 {
		t.Fatalf("update should not be called when bridge is unconfigured")
	}
}

func TestAdminFeedbackPatchForwardSuccess(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		getResult: database.UserFeedback{
			ID:        5,
			Category:  "bug",
			Title:     "Battery widget glitch",
			Body:      "shows NaN after sleep",
			Status:    "new",
			CreatedAt: time.Date(2025, 1, 2, 3, 4, 5, 0, time.UTC),
			PageRoute: "/dashboard",
		},
	}
	bridge := &fakeGitHubIssuesPoster{url: "https://github.com/ev-dev-labs/teslasync/issues/42"}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg("ev-dev-labs/teslasync"), nil, bridge)

	body := `{"forward_to_github":true}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusOK {
		t.Fatalf("status: got %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if bridge.calls != 1 {
		t.Fatalf("bridge not invoked: calls=%d", bridge.calls)
	}
	if !strings.Contains(bridge.lastTitle, "Battery widget glitch") {
		t.Fatalf("issue title missing source title: %q", bridge.lastTitle)
	}
	if !strings.Contains(bridge.lastBody, "/dashboard") {
		t.Fatalf("issue body missing page_route: %q", bridge.lastBody)
	}
	if store.updateCalls != 1 {
		t.Fatalf("update not called: %d", store.updateCalls)
	}
	if store.lastUpdate.GitHubIssueURL == nil || *store.lastUpdate.GitHubIssueURL != bridge.url {
		t.Fatalf("github_issue_url not threaded: %+v", store.lastUpdate)
	}
	// Default status flip when caller did not specify one.
	if store.lastUpdate.Status == nil || *store.lastUpdate.Status != database.FeedbackStatusTriaged {
		t.Fatalf("status not auto-set to triaged: %+v", store.lastUpdate)
	}
}

func TestAdminFeedbackPatchForwardBridgeFailureReturns502(t *testing.T) {
	store := &fakeFeedbackQueueStore{
		getResult: database.UserFeedback{ID: 5, Category: "bug", Title: "x", Body: "y", Status: "new"},
	}
	bridge := &fakeGitHubIssuesPoster{err: errors.New("github 401")}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg("ev-dev-labs/teslasync"), nil, bridge)

	body := `{"forward_to_github":true}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: got %d, want 502; body=%s", rec.Code, rec.Body.String())
	}
	if store.updateCalls != 0 {
		t.Fatalf("update should not be called when bridge fails")
	}
}

func TestAdminFeedbackPatchInvalidJSON(t *testing.T) {
	store := &fakeFeedbackQueueStore{}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	body := `{not json`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/5", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAdminFeedbackPatchInvalidID(t *testing.T) {
	store := &fakeFeedbackQueueStore{}
	h := NewAdminFeedbackHandler(store, adminFeedbackTestCfg(""), nil, nil)

	body := `{"status":"triaged"}`
	rec, _ := adminFeedbackRouted(http.MethodPatch, "/admin/feedback/abc", body, h, "/admin/feedback/{id}", h.Patch)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status: got %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestBuildGitHubIssueContentIncludesContext(t *testing.T) {
	row := database.UserFeedback{
		ID:               42,
		Category:         "bug",
		Title:            "Sample title",
		Body:             "Sample body",
		PageRoute:        "/charging",
		AppVersion:       "1.2.3",
		UserAgent:        "Mozilla/5.0",
		SubmitterSubject: "alice@example.com",
		CreatedAt:        time.Date(2025, 6, 1, 12, 0, 0, 0, time.UTC),
		RecentErrors:     []byte(`[{"name":"X"}]`),
		ConsoleTail:      "log line one\nlog line two",
	}
	title, body := buildGitHubIssueContent(row)
	if !strings.Contains(title, "Bug") {
		t.Fatalf("title missing category: %q", title)
	}
	if !strings.Contains(title, "Sample title") {
		t.Fatalf("title missing source title: %q", title)
	}
	if !strings.Contains(body, "feedback id: 42") {
		t.Fatalf("body missing feedback id: %q", body)
	}
	for _, want := range []string{"/charging", "1.2.3", "Mozilla/5.0", "alice@example.com", "Recent frontend errors", "Console tail"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q; got=\n%s", want, body)
		}
	}
}
