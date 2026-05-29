// Feature flags HTTP handler.
//
// Serves /system/flags read/write endpoints and their audit feed. Set/Delete
// attempts write feature_flag_changes rows, but audit failures never replace
// the store outcome; reads are intentionally not audited on the hot path.

package apiflagsh

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/netip"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	"github.com/ev-dev-labs/teslasync/internal/flags"
)

// Handler serves the dynamic feature-flag admin surface.
type Handler struct {
	store           *flags.Store
	audit           *auditdb.FeatureFlagChangesRepo
	principalHeader string
}

// NewHandler constructs a handler bound to store + audit.
func NewHandler(store *flags.Store, audit *auditdb.FeatureFlagChangesRepo, principalHeader string) *Handler {
	return &Handler{
		store:           store,
		audit:           audit,
		principalHeader: principalHeader,
	}
}

// FlagsListResponse is GET /system/flags.
type FlagsListResponse struct {
	Count int             `json:"count"`
	Flags []FlagListEntry `json:"flags"`
}

// FlagListEntry is one element of FlagsListResponse.
type FlagListEntry struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// FlagSetRequest is the PUT body.
type FlagSetRequest struct {
	Value  string `json:"value"`
	Reason string `json:"reason"`
}

// FlagWriteResponse is the PUT/DELETE response.
type FlagWriteResponse struct {
	Key      string `json:"key"`
	OldValue string `json:"old_value,omitempty"`
	NewValue string `json:"new_value,omitempty"`
	Deleted  bool   `json:"deleted,omitempty"`
	AuditID  int64  `json:"audit_id"`
}

// List serves GET /system/flags.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	values, err := h.store.All(r.Context())
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := FlagsListResponse{
		Count: len(values),
		Flags: make([]FlagListEntry, 0, len(values)),
	}
	for k, v := range values {
		out.Flags = append(out.Flags, FlagListEntry{Key: k, Value: v})
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// Get serves GET /system/flags/{key}.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "key is required")
		return
	}
	v, err := h.store.Get(r.Context(), key)
	if errors.Is(err, flags.ErrNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "flag not set")
		return
	}
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, FlagListEntry{Key: key, Value: v})
}

// Set serves PUT /system/flags/{key}.
func (h *Handler) Set(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "key is required")
		return
	}
	var body FlagSetRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	defer r.Body.Close()
	// Allow empty string as a valid value (some flags use "" as
	// "default behavior"). Reject only nil JSON (handled above).

	prev, _, err := h.store.Set(r.Context(), key, body.Value)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	auditID := h.tryAudit(r, auditdb.FeatureFlagChangeInsert{
		Actor:     principalFrom(r, h.principalHeader),
		ActorIP:   remoteAddrParsed(r),
		FlagKey:   key,
		Operation: auditdb.FeatureFlagOpSet,
		OldValue:  prev,
		NewValue:  body.Value,
		Reason:    body.Reason,
		TraceID:   traceIDFromContext(r.Context()),
	})
	httpx.WriteJSON(w, http.StatusOK, FlagWriteResponse{
		Key:      key,
		OldValue: prev,
		NewValue: body.Value,
		AuditID:  auditID,
	})
}

// Delete serves DELETE /system/flags/{key}.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "key is required")
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))

	prev, hadPrev, err := h.store.Delete(r.Context(), key)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	auditID := h.tryAudit(r, auditdb.FeatureFlagChangeInsert{
		Actor:     principalFrom(r, h.principalHeader),
		ActorIP:   remoteAddrParsed(r),
		FlagKey:   key,
		Operation: auditdb.FeatureFlagOpDelete,
		OldValue:  prev,
		Reason:    reason,
		TraceID:   traceIDFromContext(r.Context()),
	})

	status := http.StatusOK
	if !hadPrev {
		// Idempotent delete: 200 with Deleted=false lets the SPA show "nothing changed".
	}
	httpx.WriteJSON(w, status, FlagWriteResponse{
		Key:      key,
		OldValue: prev,
		Deleted:  hadPrev,
		AuditID:  auditID,
	})
}

// Changes serves both GET /system/flags/changes and
// GET /system/flags/{key}/changes.
func (h *Handler) Changes(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.audit == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "flag audit repo not configured")
		return
	}
	key := chi.URLParam(r, "key") // empty for global endpoint
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.audit.Recent(r.Context(), key, limit)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"count":    len(rows),
		"flag_key": key,
		"limit":    limit,
		"rows":     rows,
	})
}

func (h *Handler) tryAudit(r *http.Request, in auditdb.FeatureFlagChangeInsert) int64 {
	if h == nil || h.audit == nil {
		return 0
	}
	id, err := h.audit.Insert(r.Context(), in)
	if err != nil {
		// Audit failure does NOT replace the write outcome.
		return 0
	}
	return id
}

func principalFrom(r *http.Request, headerName string) string {
	if headerName == "" {
		return "system"
	}
	if v := strings.TrimSpace(r.Header.Get(headerName)); v != "" {
		return v
	}
	return "anonymous"
}

func remoteAddrParsed(r *http.Request) *netip.Addr {
	raw := r.RemoteAddr
	if raw == "" {
		return nil
	}
	if strings.HasPrefix(raw, "[") {
		if end := strings.Index(raw, "]"); end > 0 {
			raw = raw[1:end]
		}
	} else if i := strings.LastIndex(raw, ":"); i > 0 {
		raw = raw[:i]
	}
	addr, err := netip.ParseAddr(raw)
	if err != nil {
		return nil
	}
	return &addr
}

func traceIDFromContext(ctx context.Context) string {
	sc := trace.SpanContextFromContext(ctx)
	if !sc.IsValid() {
		return ""
	}
	return sc.TraceID().String()
}
