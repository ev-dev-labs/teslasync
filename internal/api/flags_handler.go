// Feature flags HTTP handler.
//
// Phase-44 / observability-batch / Prompt F8.
//
// Endpoints (mounted under /api/v1):
//
//	GET    /system/flags                — list all flags + their current values
//	GET    /system/flags/{key}          — one flag (404 if absent)
//	PUT    /system/flags/{key}          — set value (sudo-gated, audited)
//	DELETE /system/flags/{key}          — delete (sudo-gated, audited)
//	GET    /system/flags/changes        — global audit feed
//	GET    /system/flags/{key}/changes  — audit feed for one key
//
// PUT body: {"value": "string", "reason": "optional rationale"}
//
// Audit:
//   - Every Set/Delete writes a feature_flag_changes row capturing
//     before AND after value. Audit failures do NOT replace the write
//     outcome (the store update has already happened); they surface
//     via audit_id=0 in the response + a repo-level log line.
//   - Reads are NOT audited (hot-path; forward-auth identity is the
//     accountability surface).

package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/flags"
)

// FlagsHandler serves the dynamic feature-flag admin surface.
type FlagsHandler struct {
	store           *flags.Store
	audit           *database.FeatureFlagChangesRepo
	principalHeader string
}

// NewFlagsHandler constructs a handler bound to store + audit.
func NewFlagsHandler(store *flags.Store, audit *database.FeatureFlagChangesRepo, principalHeader string) *FlagsHandler {
	return &FlagsHandler{
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
func (h *FlagsHandler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	values, err := h.store.All(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := FlagsListResponse{
		Count: len(values),
		Flags: make([]FlagListEntry, 0, len(values)),
	}
	for k, v := range values {
		out.Flags = append(out.Flags, FlagListEntry{Key: k, Value: v})
	}
	writeJSON(w, http.StatusOK, out)
}

// Get serves GET /system/flags/{key}.
func (h *FlagsHandler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	v, err := h.store.Get(r.Context(), key)
	if errors.Is(err, flags.ErrNotFound) {
		writeError(w, http.StatusNotFound, "flag not set")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, FlagListEntry{Key: key, Value: v})
}

// Set serves PUT /system/flags/{key}.
func (h *FlagsHandler) Set(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	var body FlagSetRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	defer r.Body.Close()
	// Allow empty string as a valid value (some flags use "" as
	// "default behavior"). Reject only nil JSON (handled above).

	prev, _, err := h.store.Set(r.Context(), key, body.Value)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	auditID := h.tryAudit(r, database.FeatureFlagChangeInsert{
		Actor:     principalFrom(r, h.principalHeader),
		ActorIP:   remoteAddrParsed(r),
		FlagKey:   key,
		Operation: database.FeatureFlagOpSet,
		OldValue:  prev,
		NewValue:  body.Value,
		Reason:    body.Reason,
		TraceID:   traceIDFromContext(r.Context()),
	})
	writeJSON(w, http.StatusOK, FlagWriteResponse{
		Key:      key,
		OldValue: prev,
		NewValue: body.Value,
		AuditID:  auditID,
	})
}

// Delete serves DELETE /system/flags/{key}.
func (h *FlagsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.store == nil {
		writeError(w, http.StatusServiceUnavailable, "flag store not configured")
		return
	}
	key := chi.URLParam(r, "key")
	if strings.TrimSpace(key) == "" {
		writeError(w, http.StatusBadRequest, "key is required")
		return
	}
	reason := strings.TrimSpace(r.URL.Query().Get("reason"))

	prev, hadPrev, err := h.store.Delete(r.Context(), key)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}

	auditID := h.tryAudit(r, database.FeatureFlagChangeInsert{
		Actor:     principalFrom(r, h.principalHeader),
		ActorIP:   remoteAddrParsed(r),
		FlagKey:   key,
		Operation: database.FeatureFlagOpDelete,
		OldValue:  prev,
		Reason:    reason,
		TraceID:   traceIDFromContext(r.Context()),
	})

	status := http.StatusOK
	if !hadPrev {
		// Deleting an absent key is allowed (idempotent) but we
		// signal it via 200 + Deleted=false so the SPA can show
		// "nothing changed".
	}
	writeJSON(w, status, FlagWriteResponse{
		Key:      key,
		OldValue: prev,
		Deleted:  hadPrev,
		AuditID:  auditID,
	})
}

// Changes serves both GET /system/flags/changes and
// GET /system/flags/{key}/changes.
func (h *FlagsHandler) Changes(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.audit == nil {
		writeError(w, http.StatusServiceUnavailable, "flag audit repo not configured")
		return
	}
	key := chi.URLParam(r, "key") // empty for global endpoint
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.audit.Recent(r.Context(), key, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"count":    len(rows),
		"flag_key": key,
		"limit":    limit,
		"rows":     rows,
	})
}

// --- helpers ---

func (h *FlagsHandler) tryAudit(r *http.Request, in database.FeatureFlagChangeInsert) int64 {
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
