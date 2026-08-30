package feedback

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/api/webvitals"
	"github.com/ev-dev-labs/teslasync/internal/config"
	dbuser "github.com/ev-dev-labs/teslasync/internal/database/user"
)

// Public in-app feedback ingest handler.
//
// POST /api/v1/feedback accepts a single FeedbackEntry payload from the
// SPA's <FeedbackModal> (sidebar button + Cmd+K command palette entry)
// and persists it via UserFeedbackRepo. The route is mounted INSIDE the
// /api/v1 ForwardAuth subrouter so anonymous spam is bounded — when a
// ForwardAuth header is configured, only authenticated callers can
// submit. In open mode (header empty) the per-IP route-level rate
// limit and the per-IP DB-row throttle below are the only abuse
// surfaces.
//
// Per-row throttle (3/hour by default) lives at the repo level so it
// composes with the SPA's own client-side disable-while-pending guard
// without depending on httprate's in-memory bucket (which is per-pod
// and resets on restart).

const (
	feedbackBodyLimit          = 64 * 1024 // 64 KiB — generous for body+console_tail
	feedbackPerSubmitterMax    = 3
	feedbackPerSubmitterWindow = 1 * time.Hour
)

// FeedbackStore is the narrow interface the handler depends on. Mocked
// in handler_test.go so the unit tests don't require a live database.
type FeedbackStore interface {
	Insert(ctx context.Context, in dbuser.FeedbackInsert) (dbuser.UserFeedback, error)
	CountSubmittedSince(ctx context.Context, subject, ip string, since time.Time) (int64, error)
}

// Handler serves the public POST /api/v1/feedback endpoint.
type Handler struct {
	store   FeedbackStore
	authHdr string
	now     func() time.Time
	maxPer  int
	window  time.Duration
}

// NewHandler constructs the public ingest handler.
func NewHandler(store FeedbackStore, cfg *config.Config) *Handler {
	h := &Handler{
		store:  store,
		now:    time.Now,
		maxPer: feedbackPerSubmitterMax,
		window: feedbackPerSubmitterWindow,
	}
	if cfg != nil {
		h.authHdr = cfg.Auth.ForwardAuthHeader
	}
	return h
}

// feedbackRequest is the wire shape accepted by Submit. snake_case keys
// match the JSON tags on the persisted UserFeedback row so the SPA can
// round-trip without a translation layer.
type feedbackRequest struct {
	Category     string          `json:"category"`
	Title        string          `json:"title"`
	Body         string          `json:"body"`
	PageRoute    string          `json:"page_route,omitempty"`
	UserAgent    string          `json:"user_agent,omitempty"`
	AppVersion   string          `json:"app_version,omitempty"`
	UserEmail    string          `json:"user_email,omitempty"`
	RecentErrors json.RawMessage `json:"recent_errors,omitempty"`
	ConsoleTail  string          `json:"console_tail,omitempty"`
}

// Submit handles POST /api/v1/feedback. Parses the body, enforces the
// per-submitter row throttle, persists the row, and returns the new
// UserFeedback (id + created_at populated).
func (h *Handler) Submit(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "feedback store unavailable")
		return
	}
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, feedbackBodyLimit)

	var req feedbackRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid payload")
		return
	}

	subject := actorFromRequest(r, h.authHdr)
	ip := clientIP(r)

	// Per-submitter throttle. We reach into the DB so the limit
	// survives pod restarts and is shared across replicas — the
	// route-level httprate is in-memory and per-pod.
	since := h.callNow().Add(-h.window)
	count, err := h.store.CountSubmittedSince(r.Context(), subject, ip, since)
	if err != nil {
		// Fail open so a transient DB hiccup doesn't block legitimate
		// reports — log loud so operators can spot the pattern.
		log.Warn().Err(err).Msg("feedback: rate-limit lookup failed; allowing submit")
	} else if count >= int64(h.maxPer) {
		httpx.WriteError(w, http.StatusTooManyRequests, "too many feedback submissions; please try again later")
		return
	}

	insert := dbuser.FeedbackInsert{
		Category: req.Category,
		Title:    req.Title,
		Body:     req.Body,
		// Route TEMPLATE, never the raw pathname the browser reported.
		//
		// A feedback row is durable, is read by every admin with queue access,
		// and can be forwarded verbatim to a GitHub issue. A raw pathname puts
		// `/s/<share-token>`, `/vehicles/<vin>` and `/drives/<id>` into all
		// three of those places. Normalising here — rather than trusting the
		// SPA — means an older client, a scripted POST, or a future caller
		// cannot bypass it. `NormalizeRoute` is the same function the RUM and
		// web-error ingest paths use, so the label is byte-identical across
		// every diagnostic surface.
		PageRoute:        normalizePageRoute(req.PageRoute),
		UserAgent:        firstNonEmpty(req.UserAgent, r.UserAgent()),
		AppVersion:       req.AppVersion,
		UserEmail:        req.UserEmail,
		RecentErrors:     req.RecentErrors,
		ConsoleTail:      req.ConsoleTail,
		SubmitterSubject: subject,
		SubmitterIP:      ip,
	}

	row, err := h.store.Insert(r.Context(), insert)
	if err != nil {
		switch {
		case errors.Is(err, dbuser.ErrFeedbackInvalidCategory):
			httpx.WriteError(w, http.StatusBadRequest, "invalid category (expected bug|feature|other)")
		case errors.Is(err, dbuser.ErrFeedbackTitleTooShort):
			httpx.WriteError(w, http.StatusBadRequest, "title too short (minimum 5 characters)")
		case errors.Is(err, dbuser.ErrFeedbackBodyTooShort):
			httpx.WriteError(w, http.StatusBadRequest, "body too short (minimum 20 characters)")
		default:
			log.Error().Err(err).Msg("feedback: insert failed")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to record feedback")
		}
		return
	}

	log.Info().
		Int64("feedback_id", row.ID).
		Str("category", row.Category).
		Str("page_route", row.PageRoute).
		Str("submitter", row.SubmitterSubject).
		Bool("has_recent_errors", len(row.RecentErrors) > 0).
		Bool("has_console_tail", row.ConsoleTail != "").
		Msg("feedback received")

	httpx.WriteJSON(w, http.StatusCreated, row)
}

func (h *Handler) callNow() time.Time {
	if h.now != nil {
		return h.now()
	}
	return time.Now()
}

// normalizePageRoute converts a browser-reported pathname into a bounded,
// privacy-safe route template.
//
// An empty value stays empty: `NormalizeRoute("")` would return "/", which
// would claim the report came from the dashboard when in fact the client did
// not say where it came from. "Unknown" and "the dashboard" are different
// facts, and a triager acts on them differently.
func normalizePageRoute(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	return webvitals.NormalizeRoute(raw)
}

func actorFromRequest(r *http.Request, headerName string) string {
	if r == nil || headerName == "" {
		return ""
	}
	return strings.TrimSpace(r.Header.Get(headerName))
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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
