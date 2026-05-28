// DLQ inspector HTTP handler.
//
// Phase-44 / observability-batch / Prompt F4.
//
// Endpoints (mounted under /api/v1):
//
//	GET    /system/dlq                       — list ring entries, newest first
//	GET    /system/dlq/{id}                  — fetch full payload + parsed envelope
//	POST   /system/dlq/{id}/replay           — re-publish to original source topic
//	GET    /system/dlq/audit                 — recent replay audit rows
//	GET    /system/dlq/{id}/audit            — recent replay audit rows for one dlq_id
//
// Authentication / authorization:
//   - Listing + audit reading: protected by the global forward-auth
//     middleware (no extra gating). Any authenticated operator can read.
//   - Replay: requires X-Sudo-Token (RequireSudo at router) AND the
//     DLQ_REPLAY_ENABLED env opt-in. ERR_DLQ_REPLAY_DISABLED surfaces
//     a clear "configuration disabled" response distinct from auth errors.
//
// Rate limits applied at the router via httprate. See router.go.
//
// Every replay code path (success / publish_failed / disabled /
// unparseable / not_found) writes a dlq_replay_audit row so a
// post-incident forensic trail survives the inspector ring rotation
// and the API server restart. Audit failures are swallowed (logged at
// the repo) — they MUST NOT replace the actual replay outcome.

package api

import (
	"context"
	"encoding/base64"
	"errors"
	"net/http"
	"net/netip"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.opentelemetry.io/otel/trace"

	auditdb "github.com/ev-dev-labs/teslasync/internal/database/audit"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
)

// DLQHandler bundles list / get / replay / audit endpoints for the DLQ
// inspector. ANY field nil → endpoints respond 503 with a structured
// code so a misconfigured deployment surfaces cleanly instead of 500.
type DLQHandler struct {
	inspector         *mqtt.DLQInspector
	audit             *auditdb.DLQReplayAuditRepo
	principalHeader   string
	replayEnabledFlag bool
}

// NewDLQHandler constructs a handler bound to inspector + auditRepo.
func NewDLQHandler(inspector *mqtt.DLQInspector, audit *auditdb.DLQReplayAuditRepo, principalHeader string, replayEnabled bool) *DLQHandler {
	return &DLQHandler{
		inspector:         inspector,
		audit:             audit,
		principalHeader:   principalHeader,
		replayEnabledFlag: replayEnabled,
	}
}

// DLQListResponse is the shape returned by GET /system/dlq.
type DLQListResponse struct {
	Count         int               `json:"count"`
	ReplayEnabled bool              `json:"replay_enabled"`
	Entries       []DLQEntrySummary `json:"entries"`
}

// DLQEntrySummary excludes the full raw payload so the list view is
// cheap to render. Use the per-id endpoint to fetch full bytes.
type DLQEntrySummary struct {
	ID                 string `json:"id"`
	ArrivedAt          string `json:"arrived_at"`
	DLQTopic           string `json:"dlq_topic"`
	ParsedReason       string `json:"parsed_reason,omitempty"`
	ParsedVehicleID    int64  `json:"parsed_vehicle_id,omitempty"`
	ParsedVIN          string `json:"parsed_vin,omitempty"`
	ParsedSourceTopic  string `json:"parsed_source_topic,omitempty"`
	ParsedRedeliveries int    `json:"parsed_redeliveries"`
	ParsedTimestamp    string `json:"parsed_timestamp,omitempty"`
	ParseError         string `json:"parse_error,omitempty"`
	Replayable         bool   `json:"replayable"`
	RawPayloadSize     int    `json:"raw_payload_size"`
	InnerPayloadSize   int    `json:"inner_payload_size"`
}

// DLQEntryFull adds full payload bytes (base64) to a summary for the
// per-id GET endpoint.
type DLQEntryFull struct {
	DLQEntrySummary
	RawPayloadB64   string `json:"raw_payload_b64"`
	InnerPayloadB64 string `json:"inner_payload_b64,omitempty"`
}

// DLQReplayResponse is returned by POST /system/dlq/{id}/replay.
type DLQReplayResponse struct {
	OK         bool   `json:"ok"`
	ReplayedID string `json:"replayed_id"`
	DstTopic   string `json:"dst_topic,omitempty"`
	Result     string `json:"result"`
	Error      string `json:"error,omitempty"`
	AuditID    int64  `json:"audit_id"`
}

// List serves GET /system/dlq.
func (h *DLQHandler) List(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "dlq inspector not configured")
		return
	}
	entries := h.inspector.Snapshot()
	out := DLQListResponse{
		Count:         len(entries),
		ReplayEnabled: h.replayEnabledFlag,
		Entries:       make([]DLQEntrySummary, 0, len(entries)),
	}
	for _, e := range entries {
		out.Entries = append(out.Entries, toEntrySummary(e))
	}
	writeJSON(w, http.StatusOK, out)
}

// Get serves GET /system/dlq/{id}.
func (h *DLQHandler) Get(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "dlq inspector not configured")
		return
	}
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}
	entry, err := h.inspector.Get(id)
	if errors.Is(err, mqtt.ErrDLQEntryNotFound) {
		writeError(w, http.StatusNotFound, "entry not in ring (may have rotated out)")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	full := DLQEntryFull{
		DLQEntrySummary: toEntrySummary(entry),
		RawPayloadB64:   encodeB64(entry.RawPayload),
	}
	if len(entry.ParsedInnerPayload) > 0 {
		full.InnerPayloadB64 = encodeB64(entry.ParsedInnerPayload)
	}
	writeJSON(w, http.StatusOK, full)
}

// Replay serves POST /system/dlq/{id}/replay. Writes an audit row in
// every code path (success, failure, disabled, unparseable, missing).
func (h *DLQHandler) Replay(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.inspector == nil {
		writeError(w, http.StatusServiceUnavailable, "dlq inspector not configured")
		return
	}
	id := chi.URLParam(r, "id")
	if strings.TrimSpace(id) == "" {
		writeError(w, http.StatusBadRequest, "id is required")
		return
	}

	actor := principalFrom(r, h.principalHeader)
	actorIP := remoteAddrParsed(r)
	traceID := traceIDFromContext(r.Context())

	entry, err := h.inspector.Replay(r.Context(), id)

	auditIn := auditdb.DLQReplayAuditInsert{
		Actor:    actor,
		ActorIP:  actorIP,
		DLQID:    id,
		SrcTopic: entry.DLQTopic,
		DstTopic: entry.ParsedSourceTopic,
		Payload:  entry.RawPayload,
		Reason:   entry.ParsedReason,
		TraceID:  traceID,
	}

	switch {
	case errors.Is(err, mqtt.ErrDLQReplayDisabled):
		auditIn.Result = auditdb.DLQReplayResultDisabled
		auditIn.Error = err.Error()
		auditIn.DstTopic = ""
		if auditIn.SrcTopic == "" {
			auditIn.SrcTopic = "unknown"
		}
		aid := tryAudit(r.Context(), h.audit, auditIn)
		writeJSON(w, http.StatusForbidden, DLQReplayResponse{OK: false, ReplayedID: id, Result: string(auditdb.DLQReplayResultDisabled), Error: err.Error(), AuditID: aid})
		return
	case errors.Is(err, mqtt.ErrDLQEntryNotFound):
		auditIn.Result = auditdb.DLQReplayResultNotFound
		auditIn.Error = err.Error()
		auditIn.DstTopic = ""
		auditIn.SrcTopic = "unknown"
		auditIn.Payload = nil
		aid := tryAudit(r.Context(), h.audit, auditIn)
		writeJSON(w, http.StatusNotFound, DLQReplayResponse{OK: false, ReplayedID: id, Result: string(auditdb.DLQReplayResultNotFound), Error: err.Error(), AuditID: aid})
		return
	case errors.Is(err, mqtt.ErrDLQEntryUnparseable):
		auditIn.Result = auditdb.DLQReplayResultUnparseable
		auditIn.Error = err.Error()
		auditIn.DstTopic = ""
		aid := tryAudit(r.Context(), h.audit, auditIn)
		writeJSON(w, http.StatusConflict, DLQReplayResponse{OK: false, ReplayedID: id, Result: string(auditdb.DLQReplayResultUnparseable), Error: err.Error(), AuditID: aid})
		return
	case err != nil:
		auditIn.Result = auditdb.DLQReplayResultPublishFailed
		auditIn.Error = err.Error()
		aid := tryAudit(r.Context(), h.audit, auditIn)
		writeJSON(w, http.StatusBadGateway, DLQReplayResponse{OK: false, ReplayedID: id, Result: string(auditdb.DLQReplayResultPublishFailed), Error: err.Error(), DstTopic: entry.ParsedSourceTopic, AuditID: aid})
		return
	}

	auditIn.Result = auditdb.DLQReplayResultOK
	aid := tryAudit(r.Context(), h.audit, auditIn)
	writeJSON(w, http.StatusOK, DLQReplayResponse{OK: true, ReplayedID: id, Result: string(auditdb.DLQReplayResultOK), DstTopic: entry.ParsedSourceTopic, AuditID: aid})
}

// Audit serves GET /system/dlq/audit + GET /system/dlq/{id}/audit.
func (h *DLQHandler) Audit(w http.ResponseWriter, r *http.Request) {
	if h == nil || h.audit == nil {
		writeError(w, http.StatusServiceUnavailable, "dlq audit repo not configured")
		return
	}
	id := chi.URLParam(r, "id") // may be empty for the global endpoint
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	rows, err := h.audit.Recent(r.Context(), id, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"count":  len(rows),
		"limit":  limit,
		"dlq_id": id,
		"rows":   rows,
	})
}

// --- helpers ---

func toEntrySummary(e mqtt.DLQInspectorEntry) DLQEntrySummary {
	s := DLQEntrySummary{
		ID:                 e.ID,
		ArrivedAt:          e.ArrivedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		DLQTopic:           e.DLQTopic,
		ParsedReason:       e.ParsedReason,
		ParsedVehicleID:    e.ParsedVehicleID,
		ParsedVIN:          e.ParsedVIN,
		ParsedSourceTopic:  e.ParsedSourceTopic,
		ParsedRedeliveries: e.ParsedRedeliveries,
		ParseError:         e.ParseError,
		Replayable:         e.Replayable(),
		RawPayloadSize:     len(e.RawPayload),
		InnerPayloadSize:   len(e.ParsedInnerPayload),
	}
	if !e.ParsedTimestamp.IsZero() {
		s.ParsedTimestamp = e.ParsedTimestamp.UTC().Format("2006-01-02T15:04:05.000Z")
	}
	return s
}

func tryAudit(ctx context.Context, repo *auditdb.DLQReplayAuditRepo, in auditdb.DLQReplayAuditInsert) int64 {
	if repo == nil {
		return 0
	}
	id, err := repo.Insert(ctx, in)
	if err != nil {
		// Audit failure MUST NOT replace the replay outcome — the
		// response is more useful than a 500. Surface via id=0; the
		// repo logs its own errors.
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
		// IPv6 with brackets: "[::1]:5678"
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

func encodeB64(b []byte) string {
	if len(b) == 0 {
		return ""
	}
	return base64.StdEncoding.EncodeToString(b)
}
