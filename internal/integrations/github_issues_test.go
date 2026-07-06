package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// ─── NewGitHubIssuesClient ──────────────────────────────────────────────────

func TestNewGitHubIssuesClient(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name        string
		cfg         GitHubIssuesConfig
		wantNil     bool
		wantRepo    string
		wantToken   string
		wantAPIBase string
		wantTimeout time.Duration
	}{
		{
			name:        "valid minimal uses defaults",
			cfg:         GitHubIssuesConfig{Repo: "ev-dev-labs/teslasync", Token: "ghp_abc"},
			wantRepo:    "ev-dev-labs/teslasync",
			wantToken:   "ghp_abc",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 30 * time.Second,
		},
		{
			name:    "empty repo returns nil",
			cfg:     GitHubIssuesConfig{Repo: "", Token: "ghp_abc"},
			wantNil: true,
		},
		{
			name:    "empty token returns nil",
			cfg:     GitHubIssuesConfig{Repo: "owner/name", Token: ""},
			wantNil: true,
		},
		{
			name:    "whitespace-only repo returns nil",
			cfg:     GitHubIssuesConfig{Repo: "   \t ", Token: "ghp_abc"},
			wantNil: true,
		},
		{
			name:    "whitespace-only token returns nil",
			cfg:     GitHubIssuesConfig{Repo: "owner/name", Token: "  \n "},
			wantNil: true,
		},
		{
			name:    "both empty returns nil",
			cfg:     GitHubIssuesConfig{},
			wantNil: true,
		},
		{
			name:        "trims surrounding whitespace on repo and token",
			cfg:         GitHubIssuesConfig{Repo: "  owner/name  ", Token: "  tok  "},
			wantRepo:    "owner/name",
			wantToken:   "tok",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 30 * time.Second,
		},
		{
			name:        "custom timeout is preserved",
			cfg:         GitHubIssuesConfig{Repo: "o/n", Token: "t", Timeout: 5 * time.Second},
			wantRepo:    "o/n",
			wantToken:   "t",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 5 * time.Second,
		},
		{
			name:        "zero timeout falls back to 30s",
			cfg:         GitHubIssuesConfig{Repo: "o/n", Token: "t", Timeout: 0},
			wantRepo:    "o/n",
			wantToken:   "t",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 30 * time.Second,
		},
		{
			name:        "negative timeout falls back to 30s",
			cfg:         GitHubIssuesConfig{Repo: "o/n", Token: "t", Timeout: -3 * time.Second},
			wantRepo:    "o/n",
			wantToken:   "t",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 30 * time.Second,
		},
		{
			name:        "custom apiBase has trailing slash trimmed",
			cfg:         GitHubIssuesConfig{Repo: "o/n", Token: "t", APIBase: "https://ghe.example.com/api/v3/"},
			wantRepo:    "o/n",
			wantToken:   "t",
			wantAPIBase: "https://ghe.example.com/api/v3",
			wantTimeout: 30 * time.Second,
		},
		{
			name:        "whitespace apiBase falls back to public api",
			cfg:         GitHubIssuesConfig{Repo: "o/n", Token: "t", APIBase: "   "},
			wantRepo:    "o/n",
			wantToken:   "t",
			wantAPIBase: "https://api.github.com",
			wantTimeout: 30 * time.Second,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			c := NewGitHubIssuesClient(tt.cfg)
			if tt.wantNil {
				if c != nil {
					t.Fatalf("expected nil client, got %+v", c)
				}
				return
			}
			if c == nil {
				t.Fatal("expected non-nil client, got nil")
			}
			if c.repo != tt.wantRepo {
				t.Errorf("repo = %q, want %q", c.repo, tt.wantRepo)
			}
			if c.token != tt.wantToken {
				t.Errorf("token = %q, want %q", c.token, tt.wantToken)
			}
			if c.apiBase != tt.wantAPIBase {
				t.Errorf("apiBase = %q, want %q", c.apiBase, tt.wantAPIBase)
			}
			if c.httpClient == nil {
				t.Fatal("httpClient must not be nil")
			}
			if c.httpClient.Timeout != tt.wantTimeout {
				t.Errorf("timeout = %v, want %v", c.httpClient.Timeout, tt.wantTimeout)
			}
			if c.httpClient.Transport == nil {
				t.Error("expected an otelhttp transport, got nil")
			}
		})
	}
}

// ─── CreateIssue: guard clauses (no HTTP) ───────────────────────────────────

func TestCreateIssue_GuardClauses(t *testing.T) {
	t.Parallel()
	configured := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/n", Token: "t"})

	tests := []struct {
		name       string
		client     *GitHubIssuesClient
		title      string
		body       string
		wantErrIs  error
		wantErrSub string
	}{
		{
			name:      "nil receiver returns ErrGitHubNotConfigured",
			client:    nil,
			title:     "title",
			body:      "body",
			wantErrIs: ErrGitHubNotConfigured,
		},
		{
			name:       "empty title rejected",
			client:     configured,
			title:      "",
			body:       "body",
			wantErrSub: "title and body are required",
		},
		{
			name:       "empty body rejected",
			client:     configured,
			title:      "title",
			body:       "",
			wantErrSub: "title and body are required",
		},
		{
			name:       "whitespace-only title rejected",
			client:     configured,
			title:      "   \n\t",
			body:       "body",
			wantErrSub: "title and body are required",
		},
		{
			name:       "whitespace-only body rejected",
			client:     configured,
			title:      "title",
			body:       "  ",
			wantErrSub: "title and body are required",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			url, err := tt.client.CreateIssue(context.Background(), tt.title, tt.body, nil)
			if err == nil {
				t.Fatalf("expected error, got url=%q", url)
			}
			if url != "" {
				t.Errorf("expected empty url on error, got %q", url)
			}
			if tt.wantErrIs != nil && !errors.Is(err, tt.wantErrIs) {
				t.Errorf("error = %v, want errors.Is(%v)", err, tt.wantErrIs)
			}
			if tt.wantErrSub != "" && !strings.Contains(err.Error(), tt.wantErrSub) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantErrSub)
			}
		})
	}
}

// ─── CreateIssue: happy path + request shape ────────────────────────────────

func TestCreateIssue_SuccessSendsWellFormedRequest(t *testing.T) {
	t.Parallel()
	srv, cap := newGitHubStub(t, http.StatusCreated,
		`{"html_url":"https://github.com/ev-dev-labs/teslasync/issues/42","number":42}`)
	c := newStubClient(t, srv)

	url, err := c.CreateIssue(context.Background(),
		"Bug: thing broke", "It broke badly.", []string{"feedback", "bug"})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if want := "https://github.com/ev-dev-labs/teslasync/issues/42"; url != want {
		t.Fatalf("url = %q, want %q", url, want)
	}

	method, path, headers, body := cap.snapshot()
	if method != http.MethodPost {
		t.Errorf("method = %s, want POST", method)
	}
	if path != "/repos/ev-dev-labs/teslasync/issues" {
		t.Errorf("path = %q, want /repos/ev-dev-labs/teslasync/issues", path)
	}
	wantHeaders := map[string]string{
		"Authorization":        "Bearer ghp_secret",
		"Accept":               "application/vnd.github+json",
		"Content-Type":         "application/json",
		"X-Github-Api-Version": "2022-11-28",
		"User-Agent":           "TeslaSync/feedback-bridge",
	}
	for k, want := range wantHeaders {
		if got := headers.Get(k); got != want {
			t.Errorf("header %s = %q, want %q", k, got, want)
		}
	}

	var sent issueRequest
	if err := json.Unmarshal(body, &sent); err != nil {
		t.Fatalf("request body not valid JSON: %v (%s)", err, body)
	}
	if sent.Title != "Bug: thing broke" {
		t.Errorf("sent title = %q", sent.Title)
	}
	if sent.Body != "It broke badly." {
		t.Errorf("sent body = %q", sent.Body)
	}
	if len(sent.Labels) != 2 || sent.Labels[0] != "feedback" || sent.Labels[1] != "bug" {
		t.Errorf("sent labels = %v", sent.Labels)
	}
}

func TestCreateIssue_OmitsLabelsWhenNilOrEmpty(t *testing.T) {
	t.Parallel()
	for _, labels := range [][]string{nil, {}} {
		labels := labels
		srv, cap := newGitHubStub(t, http.StatusCreated, `{"html_url":"https://x/1"}`)
		c := newStubClient(t, srv)
		if _, err := c.CreateIssue(context.Background(), "t", "b", labels); err != nil {
			t.Fatalf("CreateIssue: %v", err)
		}
		_, _, _, body := cap.snapshot()
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(body, &raw); err != nil {
			t.Fatalf("body not JSON: %v (%s)", err, body)
		}
		if _, ok := raw["labels"]; ok {
			t.Errorf("labels key should be omitted for %#v, body=%s", labels, body)
		}
	}
}

// ─── CreateIssue: response handling ─────────────────────────────────────────

func TestCreateIssue_ResponseHandling(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name       string
		status     int
		respBody   string
		wantURL    string
		wantErr    bool
		wantErrSub string
	}{
		{
			name:     "201 created returns html_url",
			status:   http.StatusCreated,
			respBody: `{"html_url":"https://x/1","number":1}`,
			wantURL:  "https://x/1",
		},
		{
			name:     "200 lower 2xx boundary accepted",
			status:   http.StatusOK,
			respBody: `{"html_url":"https://x/2"}`,
			wantURL:  "https://x/2",
		},
		{
			name:     "299 upper 2xx boundary accepted",
			status:   299,
			respBody: `{"html_url":"https://x/3"}`,
			wantURL:  "https://x/3",
		},
		{
			name:       "300 is treated as error boundary",
			status:     http.StatusMultipleChoices,
			respBody:   "not a success",
			wantErr:    true,
			wantErrSub: "github responded 300",
		},
		{
			name:       "401 unauthorized surfaces status",
			status:     http.StatusUnauthorized,
			respBody:   `{"message":"Bad credentials"}`,
			wantErr:    true,
			wantErrSub: "github responded 401",
		},
		{
			name:       "422 validation error surfaces body snippet",
			status:     http.StatusUnprocessableEntity,
			respBody:   `{"message":"Validation Failed"}`,
			wantErr:    true,
			wantErrSub: "Validation Failed",
		},
		{
			name:       "500 server error",
			status:     http.StatusInternalServerError,
			respBody:   "boom",
			wantErr:    true,
			wantErrSub: "github responded 500",
		},
		{
			name:       "2xx missing html_url is an error",
			status:     http.StatusCreated,
			respBody:   `{"number":7}`,
			wantErr:    true,
			wantErrSub: "missing html_url",
		},
		{
			name:       "2xx invalid JSON is a decode error",
			status:     http.StatusCreated,
			respBody:   `not json at all`,
			wantErr:    true,
			wantErrSub: "decode github response",
		},
		{
			name:       "2xx empty body is a decode error",
			status:     http.StatusCreated,
			respBody:   ``,
			wantErr:    true,
			wantErrSub: "decode github response",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv, _ := newGitHubStub(t, tt.status, tt.respBody)
			c := newStubClient(t, srv)
			url, err := c.CreateIssue(context.Background(), "title", "body", nil)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got url=%q", url)
				}
				if url != "" {
					t.Errorf("expected empty url on error, got %q", url)
				}
				if tt.wantErrSub != "" && !strings.Contains(err.Error(), tt.wantErrSub) {
					t.Errorf("error %q does not contain %q", err.Error(), tt.wantErrSub)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if url != tt.wantURL {
				t.Errorf("url = %q, want %q", url, tt.wantURL)
			}
		})
	}
}

func TestCreateIssue_TruncatesLongErrorBody(t *testing.T) {
	t.Parallel()
	long := strings.Repeat("z", 500)
	srv, _ := newGitHubStub(t, http.StatusUnprocessableEntity, long)
	c := newStubClient(t, srv)

	_, err := c.CreateIssue(context.Background(), "t", "b", nil)
	if err == nil {
		t.Fatal("expected error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "…") {
		t.Fatalf("expected ellipsis marking truncation, got %q", msg)
	}
	if strings.Contains(msg, long) {
		t.Fatal("error message must not contain the full 500-char body")
	}
}

// ─── CreateIssue: transport + context ───────────────────────────────────────

func TestCreateIssue_WrapsTransportError(t *testing.T) {
	t.Parallel()
	// Stand a server up then tear it down so the address refuses connections.
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	addr := srv.URL
	srv.Close()

	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/n", Token: "t", APIBase: addr})
	url, err := c.CreateIssue(context.Background(), "t", "b", nil)
	if err == nil {
		t.Fatalf("expected transport error, got url=%q", url)
	}
	if url != "" {
		t.Errorf("expected empty url, got %q", url)
	}
	if !strings.Contains(err.Error(), "github request") {
		t.Errorf("expected wrapped 'github request' error, got %v", err)
	}
}

func TestCreateIssue_RespectsContextDeadline(t *testing.T) {
	t.Parallel()
	// Handler blocks until the client's own context is cancelled (or the
	// test releases it during cleanup) — no fixed sleep, so the only timing
	// element is the intentional 50ms deadline below.
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-release:
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() {
		close(release)
		srv.Close()
	})

	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/n", Token: "t", APIBase: srv.URL})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	url, err := c.CreateIssue(ctx, "t", "b", nil)
	if err == nil {
		t.Fatalf("expected deadline error, got url=%q", url)
	}
	if url != "" {
		t.Errorf("expected empty url, got %q", url)
	}
}

func TestCreateIssue_ReturnsPreCancelledContextError(t *testing.T) {
	t.Parallel()
	srv, _ := newGitHubStub(t, http.StatusCreated, `{"html_url":"https://x/1"}`)
	c := newStubClient(t, srv)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // cancelled before the call

	url, err := c.CreateIssue(ctx, "t", "b", nil)
	if err == nil {
		t.Fatalf("expected error for cancelled context, got url=%q", url)
	}
	if !errors.Is(err, context.Canceled) {
		t.Errorf("expected context.Canceled in chain, got %v", err)
	}
}

// ─── truncateForError ───────────────────────────────────────────────────────

func TestTruncateForError(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   string
		max  int
		want string
	}{
		{"short string unchanged", "hello", 200, "hello"},
		{"empty string unchanged", "", 200, ""},
		{"exact length unchanged", strings.Repeat("a", 200), 200, strings.Repeat("a", 200)},
		{"one over is truncated", strings.Repeat("a", 201), 200, strings.Repeat("a", 200) + "…"},
		{"multibyte runes not split", strings.Repeat("é", 5), 3, "ééé…"},
		{"zero max yields ellipsis only", "abc", 0, "…"},
		{"negative max treated as zero", "abc", -5, "…"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := truncateForError(tt.in, tt.max)
			if got != tt.want {
				t.Errorf("truncateForError(%q, %d) = %q, want %q", tt.in, tt.max, got, tt.want)
			}
		})
	}
}

// ─── test doubles ───────────────────────────────────────────────────────────

// capturedReq records what the stub GitHub server received. Access is
// mutex-guarded so assertions in the test goroutine synchronise cleanly with
// the server handler goroutine under -race.
type capturedReq struct {
	mu      sync.Mutex
	method  string
	path    string
	headers http.Header
	body    []byte
}

func (c *capturedReq) snapshot() (method, path string, headers http.Header, body []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.method, c.path, c.headers, c.body
}

// newGitHubStub returns an httptest server that captures the inbound request
// and replies with the given status + body.
func newGitHubStub(t *testing.T, status int, respBody string) (*httptest.Server, *capturedReq) {
	t.Helper()
	cr := &capturedReq{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		cr.mu.Lock()
		cr.method = r.Method
		cr.path = r.URL.Path
		cr.headers = r.Header.Clone()
		cr.body = b
		cr.mu.Unlock()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return srv, cr
}

// newStubClient builds a client pointed at the stub server. httptest.NewServer
// speaks plain HTTP, which the default (otel-wrapped) transport handles, so no
// TLS wiring is needed.
func newStubClient(t *testing.T, srv *httptest.Server) *GitHubIssuesClient {
	t.Helper()
	c := NewGitHubIssuesClient(GitHubIssuesConfig{
		Repo:    "ev-dev-labs/teslasync",
		Token:   "ghp_secret",
		APIBase: srv.URL,
	})
	if c == nil {
		t.Fatal("stub client must not be nil")
	}
	return c
}
