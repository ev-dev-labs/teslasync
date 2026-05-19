package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestNewGitHubIssuesClient(t *testing.T) {
	tests := []struct {
		name     string
		cfg      GitHubIssuesConfig
		wantNil  bool
		wantBase string
		wantTO   time.Duration
	}{
		{"missing repo returns nil", GitHubIssuesConfig{Token: "x"}, true, "", 0},
		{"missing token returns nil", GitHubIssuesConfig{Repo: "o/r"}, true, "", 0},
		{"blank repo/token returns nil", GitHubIssuesConfig{Repo: "  ", Token: "  "}, true, "", 0},
		{
			"defaults when configured",
			GitHubIssuesConfig{Repo: "o/r", Token: "t"},
			false, "https://api.github.com", 30 * time.Second,
		},
		{
			"custom api base + timeout",
			GitHubIssuesConfig{Repo: "o/r", Token: "t", Timeout: 5 * time.Second, APIBase: "https://example.test/api/"},
			false, "https://example.test/api", 5 * time.Second,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewGitHubIssuesClient(tt.cfg)
			if tt.wantNil {
				if c != nil {
					t.Fatalf("expected nil client for %+v, got %+v", tt.cfg, c)
				}
				return
			}
			if c == nil {
				t.Fatalf("expected non-nil client for %+v", tt.cfg)
			}
			if c.apiBase != tt.wantBase {
				t.Fatalf("apiBase = %q, want %q", c.apiBase, tt.wantBase)
			}
			if c.httpClient.Timeout != tt.wantTO {
				t.Fatalf("timeout = %v, want %v", c.httpClient.Timeout, tt.wantTO)
			}
		})
	}
}

func TestCreateIssue_NilClient(t *testing.T) {
	var c *GitHubIssuesClient
	_, err := c.CreateIssue(context.Background(), "t", "b", nil)
	if !errors.Is(err, ErrGitHubNotConfigured) {
		t.Fatalf("nil receiver: err = %v, want ErrGitHubNotConfigured", err)
	}
}

func TestCreateIssue_ValidationErrors(t *testing.T) {
	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t"})
	if c == nil {
		t.Fatal("NewGitHubIssuesClient returned nil unexpectedly")
	}
	tests := []struct {
		name, title, body string
	}{
		{"empty title", "", "body"},
		{"blank title", "   ", "body"},
		{"empty body", "title", ""},
		{"blank body", "title", "   "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := c.CreateIssue(context.Background(), tt.title, tt.body, nil); err == nil {
				t.Fatal("expected validation error, got nil")
			}
		})
	}
}

func TestCreateIssue_HappyPath(t *testing.T) {
	var (
		gotMethod, gotPath, gotAuth, gotCT, gotAccept, gotAPIVer, gotUA string
		gotBody                                                          []byte
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		gotAccept = r.Header.Get("Accept")
		gotAPIVer = r.Header.Get("X-GitHub-Api-Version")
		gotUA = r.Header.Get("User-Agent")
		gotBody, _ = io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"html_url":"https://github.com/o/r/issues/42","number":42}`)
	}))
	defer srv.Close()

	c := NewGitHubIssuesClient(GitHubIssuesConfig{
		Repo: "o/r", Token: "tok", APIBase: srv.URL,
	})
	url, err := c.CreateIssue(context.Background(), "Title", "Body", []string{"bug", "p1"})
	if err != nil {
		t.Fatalf("CreateIssue: %v", err)
	}
	if url != "https://github.com/o/r/issues/42" {
		t.Fatalf("html_url = %q", url)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/repos/o/r/issues" {
		t.Errorf("path = %q, want /repos/o/r/issues", gotPath)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("auth = %q, want Bearer tok", gotAuth)
	}
	if gotCT != "application/json" {
		t.Errorf("content-type = %q", gotCT)
	}
	if gotAccept != "application/vnd.github+json" {
		t.Errorf("accept = %q", gotAccept)
	}
	if gotAPIVer != "2022-11-28" {
		t.Errorf("X-GitHub-Api-Version = %q", gotAPIVer)
	}
	if !strings.Contains(gotUA, "TeslaSync") {
		t.Errorf("user-agent missing TeslaSync: %q", gotUA)
	}

	var parsed issueRequest
	if err := json.Unmarshal(gotBody, &parsed); err != nil {
		t.Fatalf("decode request: %v", err)
	}
	if parsed.Title != "Title" || parsed.Body != "Body" {
		t.Errorf("body parsed = %+v", parsed)
	}
	if len(parsed.Labels) != 2 || parsed.Labels[0] != "bug" || parsed.Labels[1] != "p1" {
		t.Errorf("labels = %+v", parsed.Labels)
	}
}

func TestCreateIssue_HTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = io.WriteString(w, `{"message":"Validation Failed","errors":[{"resource":"Issue","code":"missing"}]}`)
	}))
	defer srv.Close()

	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t", APIBase: srv.URL})
	_, err := c.CreateIssue(context.Background(), "T", "B", nil)
	if err == nil {
		t.Fatal("expected error on 422 response")
	}
	if !strings.Contains(err.Error(), "422") {
		t.Errorf("error %q does not include status code", err)
	}
	if !strings.Contains(err.Error(), "Validation Failed") {
		t.Errorf("error %q does not include response body snippet", err)
	}
}

func TestCreateIssue_TruncatesLongErrorBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
		_, _ = io.WriteString(w, strings.Repeat("a", 1000))
	}))
	defer srv.Close()
	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t", APIBase: srv.URL})
	_, err := c.CreateIssue(context.Background(), "T", "B", nil)
	if err == nil {
		t.Fatal("expected error")
	}
	// 200-char prefix + ellipsis sentinel
	if !strings.Contains(err.Error(), "…") {
		t.Errorf("expected truncation ellipsis in: %q", err)
	}
}

func TestCreateIssue_MissingHTMLURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"number":7}`)
	}))
	defer srv.Close()
	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t", APIBase: srv.URL})
	_, err := c.CreateIssue(context.Background(), "T", "B", nil)
	if err == nil || !strings.Contains(err.Error(), "html_url") {
		t.Fatalf("expected missing html_url error, got %v", err)
	}
}

func TestCreateIssue_MalformedJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = io.WriteString(w, `{"html_url": not-quoted}`)
	}))
	defer srv.Close()
	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t", APIBase: srv.URL})
	_, err := c.CreateIssue(context.Background(), "T", "B", nil)
	if err == nil || !strings.Contains(err.Error(), "decode") {
		t.Fatalf("expected decode error, got %v", err)
	}
}

func TestCreateIssue_ContextCancelled(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Slow handler so the cancellation wins the race.
		time.Sleep(200 * time.Millisecond)
		w.WriteHeader(http.StatusCreated)
	}))
	defer srv.Close()
	c := NewGitHubIssuesClient(GitHubIssuesConfig{Repo: "o/r", Token: "t", APIBase: srv.URL})
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // immediately cancelled
	if _, err := c.CreateIssue(ctx, "T", "B", nil); err == nil {
		t.Fatal("expected error from cancelled context")
	}
}
