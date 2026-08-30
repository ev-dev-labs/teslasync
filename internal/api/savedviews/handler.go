package savedviews

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strings"

	dashboardmodel "github.com/ev-dev-labs/teslasync/internal/models/dashboard"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbadmin "github.com/ev-dev-labs/teslasync/internal/database/admin"
)

// savedViewsRepo is the slice of *dbadmin.SavedViewsRepo the handler
// depends on. Keeping it as an interface lets the unit tests drop in an
// in-memory fake without standing up a real Postgres pool — same pattern
// as PinnedHandler (Phase 40 / Prompt 48).
type savedViewsRepo interface {
	List(ctx context.Context, f dbadmin.SavedViewListFilter) ([]*dashboardmodel.SavedView, error)
	GetByID(ctx context.Context, id int64) (*dashboardmodel.SavedView, error)
	Create(ctx context.Context, v *dashboardmodel.SavedView) error
	Update(ctx context.Context, id int64, patch dbadmin.SavedViewUpdate) (*dashboardmodel.SavedView, error)
	Delete(ctx context.Context, id int64) error
}

// Handler exposes per-user CRUD over named URL querystrings
// for list pages (Phase 40 / Prompt 50). The handler is intentionally
// agnostic about WHAT the querystring means — the owning surface
// (frontend) re-applies it verbatim to the URL via useSearchParams,
// which automatically rehydrates every URL-bound filter on the page.
type Handler struct {
	repo              savedViewsRepo
	forwardAuthHeader string
	auditFunc         AuditFunc
}

// AuditFunc is the audit-logging callback shape expected by Handler.
type AuditFunc func(r *http.Request, headerName, action, resource string, entityID *int64, detail string)

// Option mutates a Handler during construction.
type Option func(*Handler)

// WithAuditFunc installs the audit callback invoked after successful mutations.
func WithAuditFunc(f AuditFunc) Option { return func(h *Handler) { h.auditFunc = f } }

// NewHandler wires the production *dbadmin.SavedViewsRepo
// with audit-log support. forwardAuthHeader is the request header
// (e.g. X-Forwarded-User) injected by the reverse-proxy auth provider;
// when empty, audit rows record an empty actor (dev-mode behaviour).
func NewHandler(db *database.DB, forwardAuthHeader string, opts ...Option) *Handler {
	h := &Handler{
		repo:              dbadmin.NewSavedViewsRepo(db),
		forwardAuthHeader: forwardAuthHeader,
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// maxSavedViewBodyBytes caps each request body. A view's query column is
// already capped at 4096 chars by the DB CHECK; 8 KB leaves comfortable
// headroom for JSON envelope + name + flags.
const maxSavedViewBodyBytes = 8 << 10

// maxSavedViewNameLen mirrors the DB CHECK on `length(btrim(name))`.
const maxSavedViewNameLen = 80

// maxSavedViewQueryLen mirrors the DB CHECK on `length(query)`.
const maxSavedViewQueryLen = 4096

// maxSavedViewRouteLen mirrors the DB CHECK on `length(route)`.
const maxSavedViewRouteLen = 100

// routeAllowedRe restricts the route column to URL-safe path characters.
// The handler also requires routes to start with '/' so there's no
// confusion with relative URLs. The pattern is intentionally permissive
// enough to cover :param routes (e.g. /vehicles/:id) so the same view
// shape can extend to detail pages later, but tight enough to bounce
// hand-edited "javascript:" or fragment payloads.
var routeAllowedRe = regexp.MustCompile(`^/[A-Za-z0-9/_:.-]{0,99}$`)

// savedViewCreateRequest is the wire shape for POST.
type savedViewCreateRequest struct {
	Name      string `json:"name"`
	Route     string `json:"route"`
	Query     string `json:"query"`
	IsDefault bool   `json:"is_default"`
	IsPinned  bool   `json:"is_pinned"`
	SortOrder int    `json:"sort_order"`
}

// savedViewUpdateRequest is the wire shape for PUT/PATCH. Every field is
// a pointer so the caller can flip a single attribute (e.g. just
// `is_pinned`) without resending the rest of the row.
type savedViewUpdateRequest struct {
	Name      *string `json:"name,omitempty"`
	Query     *string `json:"query,omitempty"`
	IsDefault *bool   `json:"is_default,omitempty"`
	IsPinned  *bool   `json:"is_pinned,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

// List returns saved views for the requesting user. When `route` is supplied,
// results are scoped to that page; omitting it returns all routes for global
// discovery surfaces such as the command palette.
//
//	GET /api/v1/saved-views?route=/drives
//	GET /api/v1/saved-views
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.saved_views.list")
	defer span.End()

	filter := dbadmin.SavedViewListFilter{}
	if rawRoute := strings.TrimSpace(r.URL.Query().Get("route")); rawRoute != "" {
		route, ok := normalizeRoute(rawRoute)
		if !ok {
			httpx.WriteError(w, http.StatusBadRequest, "route must be a valid SPA path")
			return
		}
		filter.Route = route
	}

	rows, err := h.repo.List(ctx, filter)
	if err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Str("route", filter.Route).
			Msg("saved_views list failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list saved views")
		return
	}
	if rows == nil {
		rows = []*dashboardmodel.SavedView{}
	}
	httpx.WriteJSON(w, http.StatusOK, rows)
}

// Create inserts a new saved view. When the request marks the view as
// default, the prior default for the same (user, route) is flipped to
// false in the same transaction.
//
//	POST /api/v1/saved-views
//	body: {"name":"Last week SC","route":"/drives","query":"from=2025-04-24&sort=distance"}
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	body, readErr := readSavedViewBody(r)
	if readErr != nil {
		httpx.WriteError(w, readErr.status, readErr.msg)
		return
	}

	var req savedViewCreateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	name, validateErr := validateSavedViewName(req.Name)
	if validateErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, validateErr.Error())
		return
	}
	route, ok := normalizeRoute(req.Route)
	if !ok {
		httpx.WriteError(w, http.StatusBadRequest, "route is required and must be a valid SPA path")
		return
	}
	query, qErr := validateSavedViewQuery(req.Query)
	if qErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, qErr.Error())
		return
	}

	row := &dashboardmodel.SavedView{
		Name:      name,
		Route:     route,
		Query:     query,
		IsDefault: req.IsDefault,
		IsPinned:  req.IsPinned,
		SortOrder: req.SortOrder,
	}
	if err := h.repo.Create(r.Context(), row); err != nil {
		if errors.Is(err, dbadmin.ErrSavedViewAlreadyExists) {
			httpx.WriteError(w, http.StatusConflict, "a saved view with that name already exists for this route")
			return
		}
		log.Error().Err(err).Msg("saved_views create failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create saved view")
		return
	}

	h.audit(r, "saved_view.create", &row.ID, savedViewAuditDetail(row))
	httpx.WriteJSON(w, http.StatusCreated, row)
}

// Update applies a partial patch to an existing saved view.
//
//	PUT /api/v1/saved-views/{id}
//	body: {"is_default": true}
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid saved view id")
		return
	}

	body, readErr := readSavedViewBody(r)
	if readErr != nil {
		httpx.WriteError(w, readErr.status, readErr.msg)
		return
	}

	var req savedViewUpdateRequest
	if err := json.Unmarshal(body, &req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	patch := dbadmin.SavedViewUpdate{
		IsDefault: req.IsDefault,
		IsPinned:  req.IsPinned,
		SortOrder: req.SortOrder,
	}
	if req.Name != nil {
		name, validateErr := validateSavedViewName(*req.Name)
		if validateErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, validateErr.Error())
			return
		}
		patch.Name = &name
	}
	if req.Query != nil {
		query, qErr := validateSavedViewQuery(*req.Query)
		if qErr != nil {
			httpx.WriteError(w, http.StatusBadRequest, qErr.Error())
			return
		}
		patch.Query = &query
	}

	updated, updErr := h.repo.Update(r.Context(), id, patch)
	if updErr != nil {
		if errors.Is(updErr, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "saved view not found")
			return
		}
		if errors.Is(updErr, dbadmin.ErrSavedViewAlreadyExists) {
			httpx.WriteError(w, http.StatusConflict, "a saved view with that name already exists for this route")
			return
		}
		log.Error().Err(updErr).Int64("id", id).Msg("saved_views update failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update saved view")
		return
	}

	action := "saved_view.update"
	if patch.IsDefault != nil && *patch.IsDefault {
		action = "saved_view.set_default"
	}
	h.audit(r, action, &updated.ID, savedViewAuditDetail(updated))
	httpx.WriteJSON(w, http.StatusOK, updated)
}

// Delete removes a saved view by id.
//
//	DELETE /api/v1/saved-views/{id}
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil || id <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "invalid saved view id")
		return
	}

	if delErr := h.repo.Delete(r.Context(), id); delErr != nil {
		if errors.Is(delErr, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "saved view not found")
			return
		}
		log.Error().Err(delErr).Int64("id", id).Msg("saved_views delete failed")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete saved view")
		return
	}

	h.audit(r, "saved_view.delete", &id, "")
	w.WriteHeader(http.StatusNoContent)
}

// audit is a thin wrapper that swallows nil callback cases (used by the
// unit tests, which exercise validation paths without standing up a real
// pool). When production wires the callback, every mutation flows through
// logAuditFromRequest so /users/me/activity surfaces it.
func (h *Handler) audit(r *http.Request, action string, entityID *int64, detail string) {
	if h.auditFunc == nil {
		return
	}
	h.auditFunc(r, h.forwardAuthHeader, action, "saved_view", entityID, detail)
}

func savedViewAuditDetail(v *dashboardmodel.SavedView) string {
	if v == nil {
		return ""
	}
	parts := []string{"name=" + v.Name, "route=" + v.Route}
	if v.IsDefault {
		parts = append(parts, "default")
	}
	if v.IsPinned {
		parts = append(parts, "pinned")
	}
	return strings.Join(parts, " ")
}

// ── helpers ─────────────────────────────────────────────────────────────────

type savedViewBodyError struct {
	status int
	msg    string
}

func readSavedViewBody(r *http.Request) ([]byte, *savedViewBodyError) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSavedViewBodyBytes+1))
	if err != nil {
		return nil, &savedViewBodyError{http.StatusBadRequest, "failed to read request body"}
	}
	if len(body) > maxSavedViewBodyBytes {
		return nil, &savedViewBodyError{http.StatusRequestEntityTooLarge, "saved view payload exceeds 8 KB limit"}
	}
	return body, nil
}

// normalizeRoute trims, lowercases-the-prefix-check, and validates a
// route value. Returns the canonical form (no trailing slash unless it's
// the root) and a boolean ok flag.
func normalizeRoute(raw string) (string, bool) {
	r := strings.TrimSpace(raw)
	if r == "" {
		return "", false
	}
	if len(r) > maxSavedViewRouteLen {
		return "", false
	}
	if !routeAllowedRe.MatchString(r) {
		return "", false
	}
	if strings.Contains(r, "//") {
		return "", false
	}
	// Drop trailing slash so /drives and /drives/ don't fork the bucket.
	if len(r) > 1 && strings.HasSuffix(r, "/") {
		r = strings.TrimRight(r, "/")
	}
	return r, true
}

// validateSavedViewName trims whitespace, rejects empty / too-long /
// multiline names, and returns the canonical (trimmed) form.
func validateSavedViewName(raw string) (string, error) {
	name := strings.TrimSpace(raw)
	if name == "" {
		return "", errors.New("name is required")
	}
	if len(name) > maxSavedViewNameLen {
		return "", errors.New("name must be 80 characters or fewer")
	}
	if strings.ContainsAny(name, "\n\r") {
		return "", errors.New("name must not contain newlines")
	}
	return name, nil
}

// validateSavedViewQuery rejects oversized queries and queries that
// embed a fragment (#) — fragments are not part of the querystring and
// would silently truncate when re-applied via useSearchParams.
func validateSavedViewQuery(raw string) (string, error) {
	q := strings.TrimPrefix(raw, "?")
	if len(q) > maxSavedViewQueryLen {
		return "", errors.New("query must be 4096 characters or fewer")
	}
	if strings.Contains(q, "#") {
		return "", errors.New("query must not contain a URL fragment ('#')")
	}
	return q, nil
}
