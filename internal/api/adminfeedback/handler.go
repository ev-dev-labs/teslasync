package adminfeedback

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
	"github.com/ev-dev-labs/teslasync/internal/integrations"
)

// Admin feedback queue handler.
//
// GET  /api/v1/admin/feedback        list (status/category filters, paged)
// GET  /api/v1/admin/feedback/{id}   single row
// PATCH /api/v1/admin/feedback/{id}  update status / github_issue_url /
//                                    forward to GitHub Issues
//
// AUTHZ NOTE: TeslaSync is provider-agnostic — there is no "admin role"
// concept beyond ForwardAuth presence. Any authenticated caller can
// hit these endpoints; the audit_logs row is the accountability
// surface. A future RBAC layer can wrap the route without
// changing the response shape. The existing /admin/maintenance and
// /admin/web-errors handlers follow the same convention.

const adminFeedbackBodyLimit = 8 * 1024

// FeedbackQueueStore is the narrow read/write interface the admin
// handler depends on. Mocked in handler_test.go.
type FeedbackQueueStore interface {
	List(ctx context.Context, p dbuser.FeedbackListParams) ([]dbuser.UserFeedback, int64, error)
	Get(ctx context.Context, id int64) (dbuser.UserFeedback, error)
	Update(ctx context.Context, id int64, upd dbuser.FeedbackUpdate) (dbuser.UserFeedback, error)
}

// GitHubIssuesPoster is the narrow interface used to mirror a feedback
// row into a GitHub Issue when the optional bridge is configured.
// Implemented by *integrations.GitHubIssuesClient in production; nil
// when the env vars are unset (the admin endpoint surfaces this state
// in its response so the SPA can disable the Forward button).
type GitHubIssuesPoster interface {
	CreateIssue(ctx context.Context, title, body string, labels []string) (string, error)
}

// AdminFeedbackHandler serves the admin queue endpoints.
type AdminFeedbackHandler struct {
	store    FeedbackQueueStore
	cfg      *config.Config
	db       *database.DB
	authHdr  string
	github   GitHubIssuesPoster
	repoSlug string
}

// NewAdminFeedbackHandler wires the handler against the shared repo
// and (optionally) the GitHub Issues bridge. github may be nil when
// the bridge is disabled — the response shape is unchanged but the
// `github_bridge_enabled` field flips to false so the SPA can hide
// the "Forward to GitHub" button instead of rendering a broken action.
func NewAdminFeedbackHandler(store FeedbackQueueStore, cfg *config.Config, db *database.DB, github GitHubIssuesPoster) *AdminFeedbackHandler {
	h := &AdminFeedbackHandler{
		store:  store,
		cfg:    cfg,
		db:     db,
		github: github,
	}
	if cfg != nil {
		h.authHdr = cfg.Auth.ForwardAuthHeader
		h.repoSlug = strings.TrimSpace(cfg.GitHub.Repo)
	}
	return h
}

// adminFeedbackListResponse is the JSON shape returned by GET /admin/feedback.
type adminFeedbackListResponse struct {
	Items               []dbuser.UserFeedback `json:"items"`
	Total               int64                 `json:"total"`
	Limit               int                   `json:"limit"`
	Offset              int                   `json:"offset"`
	GitHubBridgeEnabled bool                  `json:"github_bridge_enabled"`
	GitHubRepo          string                `json:"github_repo,omitempty"`
}

// adminFeedbackPatchRequest is the partial-update body shape consumed
// by PATCH /admin/feedback/{id}. All fields are optional. When
// `forward_to_github` is true, the handler creates a GitHub Issue from
// the row, persists the URL to github_issue_url, and returns the
// updated row — even if the caller did not pass status/url
// explicitly.
type adminFeedbackPatchRequest struct {
	Status          *string `json:"status,omitempty"`
	GitHubIssueURL  *string `json:"github_issue_url,omitempty"`
	ForwardToGitHub bool    `json:"forward_to_github,omitempty"`
}

// List handles GET /api/v1/admin/feedback.
func (h *AdminFeedbackHandler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "feedback store unavailable")
		return
	}

	params := dbuser.FeedbackListParams{
		Status:   strings.TrimSpace(r.URL.Query().Get("status")),
		Category: strings.TrimSpace(r.URL.Query().Get("category")),
	}
	limit, offset := apiparams.Pagination(r)
	params.Limit = limit
	params.Offset = offset

	items, total, err := h.store.List(r.Context(), params)
	if err != nil {
		switch {
		case errors.Is(err, dbuser.ErrFeedbackInvalidStatus):
			httpx.WriteError(w, http.StatusBadRequest, "invalid status filter (expected new|triaged|closed)")
		case errors.Is(err, dbuser.ErrFeedbackInvalidCategory):
			httpx.WriteError(w, http.StatusBadRequest, "invalid category filter (expected bug|feature|other)")
		default:
			log.Error().Err(err).Msg("admin feedback: list failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to list feedback")
		}
		return
	}

	httpx.WriteJSON(w, http.StatusOK, adminFeedbackListResponse{
		Items:               items,
		Total:               total,
		Limit:               params.Limit,
		Offset:              params.Offset,
		GitHubBridgeEnabled: h.github != nil && h.repoSlug != "",
		GitHubRepo:          h.repoSlug,
	})
}

// Get handles GET /api/v1/admin/feedback/{id}.
func (h *AdminFeedbackHandler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "feedback store unavailable")
		return
	}
	id, ok := h.parseID(w, r)
	if !ok {
		return
	}
	row, err := h.store.Get(r.Context(), id)
	if errors.Is(err, dbuser.ErrFeedbackNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "feedback not found")
		return
	}
	if err != nil {
		log.Error().Err(err).Int64("feedback_id", id).Msg("admin feedback: get failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to load feedback")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, row)
}

// Patch handles PATCH /api/v1/admin/feedback/{id}.
func (h *AdminFeedbackHandler) Patch(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "feedback store unavailable")
		return
	}
	id, ok := h.parseID(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, adminFeedbackBodyLimit)

	var req adminFeedbackPatchRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	actor := actorFromRequest(r, h.authHdr)
	upd := dbuser.FeedbackUpdate{
		Status:         req.Status,
		GitHubIssueURL: req.GitHubIssueURL,
		TriagedBy:      actor,
	}

	// If the operator asked us to forward to GitHub, do that BEFORE the
	// repo update so the resulting URL gets baked into the row in a
	// single update. We never auto-fail when GitHub is unavailable —
	// the operator can paste the URL manually.
	if req.ForwardToGitHub {
		if h.github == nil {
			httpx.WriteError(w, http.StatusBadRequest, "github bridge is not configured on this server")
			return
		}
		row, err := h.store.Get(r.Context(), id)
		if errors.Is(err, dbuser.ErrFeedbackNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "feedback not found")
			return
		}
		if err != nil {
			log.Error().Err(err).Int64("feedback_id", id).Msg("admin feedback: pre-forward get failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to load feedback")
			return
		}
		issueTitle, issueBody := buildGitHubIssueContent(row)
		labels := []string{"feedback", row.Category}
		issueURL, err := h.github.CreateIssue(r.Context(), issueTitle, issueBody, labels)
		if err != nil {
			log.Warn().Err(err).Int64("feedback_id", id).Msg("admin feedback: GitHub issue create failed")
			httpx.WriteError(w, http.StatusBadGateway, "failed to create GitHub issue: "+err.Error())
			return
		}
		upd.GitHubIssueURL = &issueURL
		if upd.Status == nil {
			triaged := dbuser.FeedbackStatusTriaged
			upd.Status = &triaged
		}
	}

	updated, err := h.store.Update(r.Context(), id, upd)
	if errors.Is(err, dbuser.ErrFeedbackNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "feedback not found")
		return
	}
	if errors.Is(err, dbuser.ErrFeedbackInvalidStatus) {
		httpx.WriteError(w, http.StatusBadRequest, "invalid status (expected new|triaged|closed)")
		return
	}
	if err != nil {
		log.Error().Err(err).Int64("feedback_id", id).Msg("admin feedback: update failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update feedback")
		return
	}

	if h.db != nil {
		detail := fmt.Sprintf("status=%s", updated.Status)
		if updated.GitHubIssueURL != "" {
			detail += "; github=" + updated.GitHubIssueURL
		}
		idCopy := updated.ID
		logAuditFromRequest(h.db, r, h.authHdr, "feedback.update", "user_feedback", &idCopy, detail)
	}

	httpx.WriteJSON(w, http.StatusOK, updated)
}

func (h *AdminFeedbackHandler) parseID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid feedback id")
		return 0, false
	}
	return id, true
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
}

func logAuditFromRequest(db *database.DB, r *http.Request, headerName, action, resource string, entityID *int64, detail string) {
	if db == nil || r == nil {
		return
	}
	const query = `
		INSERT INTO audit_logs (ts, actor, action, entity_type, entity_id, detail, ip, user_agent)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`
	_, err := db.Pool.Exec(r.Context(), query,
		time.Now().UTC(),
		actorFromRequest(r, headerName),
		action,
		resource,
		entityID,
		detail,
		nullableStr(clientIP(r)),
		nullableStr(r.UserAgent()),
	)
	if err != nil {
		log.Warn().Err(err).Str("action", action).Str("entity_type", resource).Msg("failed to write audit log")
	}
}

func nullableStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			xff = xff[:i]
		}
		if ip := strings.TrimSpace(xff); ip != "" {
			return ip
		}
	}
	if r.RemoteAddr == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}

// buildGitHubIssueContent renders the title + body the bridge submits
// to GitHub. Pulled out so the unit test can assert formatting without
// firing real HTTP traffic. Renders snake_case keys so the issue is
// greppable against the original payload.
func buildGitHubIssueContent(row dbuser.UserFeedback) (string, string) {
	title := fmt.Sprintf("[%s] %s", strings.Title(row.Category), row.Title) //nolint:staticcheck // Title is fine for ASCII category labels
	var b strings.Builder
	b.WriteString(row.Body)
	b.WriteString("\n\n---\n\n")
	b.WriteString("**Reported via TeslaSync in-app feedback** (feedback id: ")
	b.WriteString(strconv.FormatInt(row.ID, 10))
	b.WriteString(")\n\n")
	if row.PageRoute != "" {
		b.WriteString("- **Page:** `")
		b.WriteString(row.PageRoute)
		b.WriteString("`\n")
	}
	if row.AppVersion != "" {
		b.WriteString("- **App version:** `")
		b.WriteString(row.AppVersion)
		b.WriteString("`\n")
	}
	if row.UserAgent != "" {
		b.WriteString("- **User agent:** `")
		b.WriteString(row.UserAgent)
		b.WriteString("`\n")
	}
	if row.SubmitterSubject != "" {
		b.WriteString("- **Submitter:** `")
		b.WriteString(row.SubmitterSubject)
		b.WriteString("`\n")
	}
	if !row.CreatedAt.IsZero() {
		b.WriteString("- **Submitted at:** `")
		b.WriteString(row.CreatedAt.UTC().Format(time.RFC3339))
		b.WriteString("`\n")
	}
	if len(row.RecentErrors) > 0 {
		b.WriteString("\n<details><summary>Recent frontend errors</summary>\n\n```json\n")
		b.Write(row.RecentErrors)
		b.WriteString("\n```\n</details>\n")
	}
	if row.ConsoleTail != "" {
		b.WriteString("\n<details><summary>Console tail</summary>\n\n```\n")
		b.WriteString(row.ConsoleTail)
		b.WriteString("\n```\n</details>\n")
	}
	return title, b.String()
}

// Compile-time assertion that the production GitHub client satisfies
// the narrow interface the admin handler depends on. Lives here (not
// in the integrations package) because that package must not import
// internal/api.
var _ GitHubIssuesPoster = (*integrations.GitHubIssuesClient)(nil)
