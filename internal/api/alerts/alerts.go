package alerts

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

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/rs/zerolog/log"
)

// Alert acknowledgement with optional note.
//
// `{alertID}` in every route below is the `notification_logs.id` value
// surfaced as `Alert.id` by AlertHandler.List (see alert_handler.go), NOT
// the alert_rules.id. TeslaSync sources alerts from notification_logs via
// ADR-010 Option B; the underlying audit timeline lives in the
// notification_log_events table introduced by migration 000171.

const (
	maxAckNoteBytes      = 1000
	maxAckRequestBodyMax = 8 * 1024
)

// alertAckRequest is the body for POST /alerts/{id}/acknowledge.
// `note` is optional; when present it is trimmed and capped at maxAckNoteBytes.
type alertAckRequest struct {
	Note *string `json:"note"`
}

// alertCommentRequest is the body for POST /alerts/{id}/comment.
// `note` is required (1..maxAckNoteBytes characters after trimming).
type alertCommentRequest struct {
	Note *string `json:"note"`
}

// AlertEventResponse mirrors alertmodel.NotificationLogEvent for the wire.
//
// Field names are snake_case so the frontend's camelCaseKeys helper produces
// matching camelCase keys without needing manual remapping. The synthetic
// "created" event is reconstructed from notification_logs.created_at and is
// returned alongside persisted events ordered by occurred_at ASC.
type AlertEventResponse struct {
	ID         int64     `json:"id"`
	OccurredAt time.Time `json:"occurred_at"`
	Actor      *string   `json:"actor,omitempty"`
	Kind       string    `json:"kind"`
	Note       *string   `json:"note,omitempty"`
}

// AlertDetailResponse is the wire shape for GET /alerts/{id}: the standard
// AlertResponse fields plus the audit timeline.
type AlertDetailResponse struct {
	AlertResponse
	Events []AlertEventResponse `json:"events"`
}

// GetAlert returns a single alert with its full audit timeline.
//
// Responds 404 when the underlying notification_logs row is missing or has
// been deleted (CASCADE). The synthetic "created" event is always present in
// the timeline, sourced from notification_logs.created_at.
func (h *AlertHandler) GetAlert(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "alertID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	logRow, err := h.notifRepo.GetLog(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to load alert")
		writeError(w, http.StatusInternalServerError, "failed to load alert")
		return
	}
	if logRow == nil {
		writeError(w, http.StatusNotFound, "alert not found")
		return
	}
	resp, err := h.buildAlertDetailResponse(r.Context(), logRow)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to build alert detail response")
		writeError(w, http.StatusInternalServerError, "failed to load alert detail")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// AcknowledgeAlert flips the ack columns and appends an `acknowledged` audit
// event. Idempotent: if the alert is already acknowledged, the existing
// state is returned with no new event row written.
//
// Body: { "note"?: string ≤1000 chars }
func (h *AlertHandler) AcknowledgeAlert(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "alertID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	var body alertAckRequest
	if err := decodeAckBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	note, err := normalizeNote(body.Note, false /* required */)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	actor := actorFromRequest(r, h.forwardAuthHeader)

	updated, _, err := h.notifRepo.AcknowledgeLog(r.Context(), id, actor, note)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to acknowledge alert")
		writeError(w, http.StatusInternalServerError, "failed to acknowledge alert")
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "alert not found")
		return
	}
	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "acknowledge", "alert", &id,
			fmt.Sprintf("acknowledge alert id=%d note_len=%d", id, len(note)))
	}
	resp, err := h.buildAlertDetailResponse(r.Context(), updated)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to build alert detail response post-ack")
		writeError(w, http.StatusInternalServerError, "alert acknowledged but failed to load detail")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// CommentAlert appends a `commented` audit event without touching the ack
// state. Body's `note` is required (1..1000 chars after trimming).
func (h *AlertHandler) CommentAlert(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "alertID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	var body alertCommentRequest
	if err := decodeAckBody(r, &body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	note, err := normalizeNote(body.Note, true /* required */)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	actor := actorFromRequest(r, h.forwardAuthHeader)

	event, err := h.notifRepo.CommentOnLog(r.Context(), id, actor, note)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to comment on alert")
		writeError(w, http.StatusInternalServerError, "failed to comment on alert")
		return
	}
	if event == nil {
		writeError(w, http.StatusNotFound, "alert not found")
		return
	}
	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "comment", "alert", &id,
			fmt.Sprintf("comment on alert id=%d note_len=%d", id, len(note)))
	}
	logRow, err := h.notifRepo.GetLog(r.Context(), id)
	if err != nil || logRow == nil {
		// Fall back to event-only response if reload fails — the comment was persisted.
		writeJSON(w, http.StatusOK, map[string]any{
			"event": eventToWire(event),
		})
		return
	}
	resp, err := h.buildAlertDetailResponse(r.Context(), logRow)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to build alert detail response post-comment")
		writeError(w, http.StatusInternalServerError, "comment recorded but failed to load detail")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// ReopenAlert clears the ack columns and appends a `reopened` audit event.
// Idempotent: reopening an already-reopened alert is a no-op. Used by the
// "Undo" affordance on the Acknowledge toast.
func (h *AlertHandler) ReopenAlert(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "alertID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	actor := actorFromRequest(r, h.forwardAuthHeader)
	updated, _, err := h.notifRepo.ReopenLog(r.Context(), id, actor)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to reopen alert")
		writeError(w, http.StatusInternalServerError, "failed to reopen alert")
		return
	}
	if updated == nil {
		writeError(w, http.StatusNotFound, "alert not found")
		return
	}
	if h.db != nil {
		logAuditFromRequest(h.db, r, h.forwardAuthHeader, "reopen", "alert", &id,
			fmt.Sprintf("reopen alert id=%d", id))
	}
	resp, err := h.buildAlertDetailResponse(r.Context(), updated)
	if err != nil {
		log.Error().Err(err).Int64("alert_id", id).Msg("failed to build alert detail response post-reopen")
		writeError(w, http.StatusInternalServerError, "alert reopened but failed to load detail")
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// buildAlertDetailResponse adapts a notification_logs row + its persisted
// events into the AlertDetailResponse wire shape, prepending a synthetic
// "created" entry sourced from the row's created_at.
func (h *AlertHandler) buildAlertDetailResponse(ctx context.Context, logRow *notificationmodel.NotificationLog) (*AlertDetailResponse, error) {
	adapted, err := h.adaptNotificationLogsToAlerts(ctx, []*notificationmodel.NotificationLog{logRow})
	if err != nil {
		return nil, err
	}
	if len(adapted) == 0 {
		return nil, errors.New("alert adapter returned empty result")
	}
	events, err := h.notifRepo.ListLogEvents(ctx, logRow.ID)
	if err != nil {
		return nil, err
	}
	wire := buildAlertEventTimeline(logRow, events)
	return &AlertDetailResponse{
		AlertResponse: *adapted[0],
		Events:        wire,
	}, nil
}

// buildAlertEventTimeline returns the wire-shape event list with the
// synthetic "created" entry prepended (sourced from the parent row's
// created_at) and the persisted events stably ordered by occurred_at then id.
//
// Exported for unit tests as it is pure: it does not call into the database.
func buildAlertEventTimeline(logRow *notificationmodel.NotificationLog, events []*alertmodel.NotificationLogEvent) []AlertEventResponse {
	out := make([]AlertEventResponse, 0, len(events)+1)
	out = append(out, AlertEventResponse{
		ID:         0, // synthetic; not from notification_log_events
		OccurredAt: logRow.CreatedAt,
		Kind:       "created",
	})
	for _, ev := range events {
		out = append(out, eventToWire(ev))
	}
	return out
}

func eventToWire(ev *alertmodel.NotificationLogEvent) AlertEventResponse {
	return AlertEventResponse{
		ID:         ev.ID,
		OccurredAt: ev.OccurredAt,
		Actor:      ev.Actor,
		Kind:       ev.Kind,
		Note:       ev.Note,
	}
}

// decodeAckBody is a strict JSON decoder shared by the ack/comment handlers.
// Empty bodies are tolerated (treated as `{}`) so callers can ack with no
// note via `POST /alerts/{id}/acknowledge` carrying no body at all.
func decodeAckBody(r *http.Request, dst any) error {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxAckRequestBodyMax+1))
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if len(body) > maxAckRequestBodyMax {
		return errors.New("request body too large")
	}
	if len(bytes.TrimSpace(body)) == 0 {
		// No body at all → leave dst zero-valued (Note: nil).
		return nil
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

// normalizeNote trims and validates a note pointer. When required is true,
// a missing or empty note returns an error; otherwise an empty/whitespace
// note normalises to "" so the repo layer stores NULL.
func normalizeNote(note *string, required bool) (string, error) {
	if note == nil {
		if required {
			return "", errors.New("note is required")
		}
		return "", nil
	}
	trimmed := strings.TrimSpace(*note)
	if trimmed == "" {
		if required {
			return "", errors.New("note is required")
		}
		return "", nil
	}
	if len(trimmed) > maxAckNoteBytes {
		return "", fmt.Errorf("note must be %d characters or fewer", maxAckNoteBytes)
	}
	return trimmed, nil
}
