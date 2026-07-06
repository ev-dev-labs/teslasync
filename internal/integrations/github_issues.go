// Package integrations holds outbound third-party clients that are
// optional at runtime — the server should boot fine when none of them
// are configured, and individual clients should be no-ops (or absent
// entirely) when their env vars are unset.
//
// The GitHub Issues client backs the admin feedback queue's "Forward to
// GitHub" action. Configure it with TESLASYNC_GITHUB_REPO and
// TESLASYNC_GITHUB_TOKEN; when either is absent, the admin handler gets a
// nil client and the SPA hides the action.
package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"
)

// GitHubIssuesClient posts issues to the GitHub REST API on behalf of
// the admin feedback queue. The struct only holds inert config and a
// shared *http.Client — construction is cheap and the caller may keep
// a single instance for the process lifetime.
type GitHubIssuesClient struct {
	repo       string // "owner/name"
	token      string
	httpClient *http.Client
	apiBase    string // override-able for tests; defaults to https://api.github.com
}

// GitHubIssuesConfig collects the inputs needed by NewGitHubIssuesClient.
type GitHubIssuesConfig struct {
	Repo    string
	Token   string
	Timeout time.Duration
	APIBase string // optional; primarily for tests
}

// ErrGitHubNotConfigured is returned by CreateIssue when the client
// was constructed without a repo or token (the production code path
// guards on NewGitHubIssuesClient returning nil so this is a defensive
// extra check rather than the primary contract).
var ErrGitHubNotConfigured = errors.New("github issues bridge is not configured")

// NewGitHubIssuesClient returns a configured client, or nil when the
// repo or token is missing. Returning nil rather than an error keeps
// the caller branch trivial (`if client == nil { /* disable bridge */ }`)
// and matches the rest of the codebase's optional-integration style.
func NewGitHubIssuesClient(cfg GitHubIssuesConfig) *GitHubIssuesClient {
	repo := strings.TrimSpace(cfg.Repo)
	token := strings.TrimSpace(cfg.Token)
	if repo == "" || token == "" {
		return nil
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	apiBase := strings.TrimRight(strings.TrimSpace(cfg.APIBase), "/")
	if apiBase == "" {
		apiBase = "https://api.github.com"
	}
	return &GitHubIssuesClient{
		repo:  repo,
		token: token,
		httpClient: &http.Client{
			Timeout:   timeout,
			Transport: otelhttp.NewTransport(http.DefaultTransport),
		},
		apiBase: apiBase,
	}
}

// issueRequest is the wire shape for the POST /repos/{owner}/{repo}/issues body.
type issueRequest struct {
	Title  string   `json:"title"`
	Body   string   `json:"body"`
	Labels []string `json:"labels,omitempty"`
}

type issueResponse struct {
	HTMLURL string `json:"html_url"`
	Number  int    `json:"number"`
}

// CreateIssue posts a new issue to the configured repo and returns the
// canonical html_url on success. Any non-2xx response is wrapped with
// the response body so the operator (who triggered the action from the
// admin queue UI) sees the failure reason inline.
func (c *GitHubIssuesClient) CreateIssue(ctx context.Context, title, body string, labels []string) (string, error) {
	if c == nil {
		return "", ErrGitHubNotConfigured
	}
	if strings.TrimSpace(title) == "" || strings.TrimSpace(body) == "" {
		return "", errors.New("github issue title and body are required")
	}
	payload, err := json.Marshal(issueRequest{Title: title, Body: body, Labels: labels})
	if err != nil {
		return "", fmt.Errorf("marshal issue: %w", err)
	}
	url := fmt.Sprintf("%s/repos/%s/issues", c.apiBase, c.repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "TeslaSync/feedback-bridge")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("github request: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet := truncateForError(strings.TrimSpace(string(respBody)), 200)
		return "", fmt.Errorf("github responded %d: %s", resp.StatusCode, snippet)
	}

	var parsed issueResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("decode github response: %w", err)
	}
	if parsed.HTMLURL == "" {
		return "", errors.New("github response missing html_url")
	}
	return parsed.HTMLURL, nil
}

// truncateForError caps an operator-facing error snippet at max runes,
// appending an ellipsis when truncated. It slices on rune boundaries so a
// multi-byte UTF-8 sequence in an upstream error body is never split into
// invalid UTF-8 (a raw byte slice like s[:200] could).
func truncateForError(s string, max int) string {
	if max < 0 {
		max = 0
	}
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + "…"
}
