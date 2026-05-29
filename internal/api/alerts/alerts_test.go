package alerts

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	"github.com/go-chi/chi/v5"
)

// Phase-46 / Prompt 20 — alert acknowledgement handler tests.

func newAckTestHandler(logs ...*notificationmodel.NotificationLog) (*AlertHandler, *fakeNotificationRepo, *fakeAlertRuleRepo) {
	ruleID := int64(11)
	rule := &alertmodel.AlertRule{
		ID:         ruleID,
		Name:       "Battery low",
		Severity:   "critical",
		SignalName: "BatteryLevel",
	}
	ruleRepo := &fakeAlertRuleRepo{
		byID: map[int64]*alertmodel.AlertRule{ruleID: rule},
	}
	notif := &fakeNotificationRepo{
		logs:     logs,
		logsByID: map[int64]*notificationmodel.NotificationLog{},
	}
	for _, l := range logs {
		if l.AlertID == nil {
			alertID := ruleID
			l.AlertID = &alertID
		}
		notif.logsByID[l.ID] = l
	}
	h := &AlertHandler{
		alertRuleRepo: ruleRepo,
		notifRepo:     notif,
	}
	return h, notif, ruleRepo
}

func newAckRequest(method, target, body string, alertID string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, target, nil)
	} else {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
		r.Header.Set("Content-Type", "application/json")
	}
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("alertID", alertID)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

func TestAckHandler_GetAlert_NotFound(t *testing.T) {
	h, _, _ := newAckTestHandler()
	rec := httptest.NewRecorder()
	h.GetAlert(rec, newAckRequest(http.MethodGet, "/alerts/999", "", "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestAckHandler_GetAlert_IncludesSyntheticCreatedEvent(t *testing.T) {
	created := time.Date(2025, 12, 8, 9, 14, 0, 0, time.UTC)
	h, _, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 100, Title: "Battery low", Status: "sent", CreatedAt: created,
	})
	rec := httptest.NewRecorder()
	h.GetAlert(rec, newAckRequest(http.MethodGet, "/alerts/100", "", "100"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	if len(resp.Events) != 1 {
		t.Fatalf("events len = %d, want 1 (synthetic created)", len(resp.Events))
	}
	if resp.Events[0].Kind != "created" {
		t.Errorf("event[0].Kind = %q, want %q", resp.Events[0].Kind, "created")
	}
	if !resp.Events[0].OccurredAt.Equal(created) {
		t.Errorf("event[0].OccurredAt = %v, want %v", resp.Events[0].OccurredAt, created)
	}
	if resp.Events[0].ID != 0 {
		t.Errorf("event[0].ID = %d, want 0 (synthetic)", resp.Events[0].ID)
	}
	if resp.AcknowledgedAt != nil {
		t.Errorf("AcknowledgedAt = %v, want nil", resp.AcknowledgedAt)
	}
}

func TestAckHandler_AcknowledgeAlert_WithNote_Persists(t *testing.T) {
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 100, Title: "Battery low", Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/100/acknowledge",
		`{"note":"  Investigating MQTT  "}`, "100"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.ackCalls) != 1 {
		t.Fatalf("ackCalls = %d, want 1", len(notif.ackCalls))
	}
	if got := notif.ackCalls[0].note; got != "Investigating MQTT" {
		t.Errorf("note arg = %q, want %q (trimmed)", got, "Investigating MQTT")
	}
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	if resp.AcknowledgedAt == nil {
		t.Errorf("AcknowledgedAt = nil, want non-nil")
	}
	if resp.AcknowledgementNote == nil || *resp.AcknowledgementNote != "Investigating MQTT" {
		t.Errorf("AcknowledgementNote = %v, want pointer to %q", resp.AcknowledgementNote, "Investigating MQTT")
	}
	hasAck := false
	for _, e := range resp.Events {
		if e.Kind == "acknowledged" {
			hasAck = true
			if e.Note == nil || *e.Note != "Investigating MQTT" {
				t.Errorf("ack event note = %v, want pointer to %q", e.Note, "Investigating MQTT")
			}
		}
	}
	if !hasAck {
		t.Errorf("events missing acknowledged entry: %+v", resp.Events)
	}
}

func TestAckHandler_AcknowledgeAlert_EmptyBodyAllowed(t *testing.T) {
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 101, Title: "Door unlocked", Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/101/acknowledge", "", "101"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.ackCalls) != 1 {
		t.Fatalf("ackCalls = %d, want 1", len(notif.ackCalls))
	}
	if notif.ackCalls[0].note != "" {
		t.Errorf("note arg = %q, want empty string", notif.ackCalls[0].note)
	}
}

func TestAckHandler_AcknowledgeAlert_EmptyJSONObjectAllowed(t *testing.T) {
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 102, Title: "x", Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/102/acknowledge", "{}", "102"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.ackCalls) != 1 {
		t.Fatalf("ackCalls = %d, want 1", len(notif.ackCalls))
	}
}

func TestAckHandler_AcknowledgeAlert_NoteTooLong(t *testing.T) {
	h, _, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 103, Status: "sent", CreatedAt: time.Now().UTC(),
	})
	long := strings.Repeat("a", maxAckNoteBytes+1)
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/103/acknowledge",
		`{"note":"`+long+`"}`, "103"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestAckHandler_AcknowledgeAlert_RejectsUnknownFields(t *testing.T) {
	h, _, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 104, Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/104/acknowledge",
		`{"note":"ok","extra":"reject"}`, "104"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
}

func TestAckHandler_AcknowledgeAlert_NotFound(t *testing.T) {
	h, _, _ := newAckTestHandler()
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/999/acknowledge", "", "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestAckHandler_AcknowledgeAlert_Idempotent(t *testing.T) {
	now := time.Now().UTC()
	preExisting := now.Add(-time.Hour)
	prev := "alice"
	prevNote := "first ack"
	h, _, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 105, Status: "sent", CreatedAt: now,
		AcknowledgedAt:      &preExisting,
		AcknowledgedBy:      &prev,
		AcknowledgementNote: &prevNote,
	})
	rec := httptest.NewRecorder()
	h.AcknowledgeAlert(rec, newAckRequest(http.MethodPost, "/alerts/105/acknowledge",
		`{"note":"second"}`, "105"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	// Original ack survives — second ack does NOT overwrite.
	if resp.AcknowledgementNote == nil || *resp.AcknowledgementNote != prevNote {
		t.Errorf("AcknowledgementNote = %v, want %q (idempotent)", resp.AcknowledgementNote, prevNote)
	}
}

func TestAckHandler_CommentAlert_RequiresNote(t *testing.T) {
	h, _, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 106, Status: "sent", CreatedAt: time.Now().UTC(),
	})
	cases := []struct {
		name string
		body string
	}{
		{"no body", ""},
		{"empty object", "{}"},
		{"null note", `{"note":null}`},
		{"empty string", `{"note":""}`},
		{"whitespace only", `{"note":"   "}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			h.CommentAlert(rec, newAckRequest(http.MethodPost, "/alerts/106/comment", tc.body, "106"))
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusBadRequest, rec.Body.String())
			}
		})
	}
}

func TestAckHandler_CommentAlert_Persists(t *testing.T) {
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 107, Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.CommentAlert(rec, newAckRequest(http.MethodPost, "/alerts/107/comment",
		`{"note":"MQTT recovered"}`, "107"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.commentCalls) != 1 || notif.commentCalls[0].note != "MQTT recovered" {
		t.Fatalf("commentCalls = %+v", notif.commentCalls)
	}
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	hasComment := false
	for _, e := range resp.Events {
		if e.Kind == "commented" {
			hasComment = true
			if e.Note == nil || *e.Note != "MQTT recovered" {
				t.Errorf("commented note = %v, want %q", e.Note, "MQTT recovered")
			}
		}
	}
	if !hasComment {
		t.Errorf("events missing commented entry: %+v", resp.Events)
	}
	// Ack state untouched.
	if resp.AcknowledgedAt != nil {
		t.Errorf("AcknowledgedAt = %v, want nil (comment must not change ack state)", resp.AcknowledgedAt)
	}
}

func TestAckHandler_CommentAlert_NotFound(t *testing.T) {
	h, _, _ := newAckTestHandler()
	rec := httptest.NewRecorder()
	h.CommentAlert(rec, newAckRequest(http.MethodPost, "/alerts/999/comment",
		`{"note":"nope"}`, "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestAckHandler_ReopenAlert_ClearsAck(t *testing.T) {
	now := time.Now().UTC()
	preExisting := now.Add(-time.Hour)
	prev := "alice"
	prevNote := "investigating"
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 108, Status: "sent", CreatedAt: now,
		AcknowledgedAt:      &preExisting,
		AcknowledgedBy:      &prev,
		AcknowledgementNote: &prevNote,
	})
	rec := httptest.NewRecorder()
	h.ReopenAlert(rec, newAckRequest(http.MethodPost, "/alerts/108/reopen", "", "108"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.reopenCalls) != 1 {
		t.Fatalf("reopenCalls = %d, want 1", len(notif.reopenCalls))
	}
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	if resp.AcknowledgedAt != nil {
		t.Errorf("AcknowledgedAt = %v, want nil after reopen", resp.AcknowledgedAt)
	}
	if resp.AcknowledgementNote != nil {
		t.Errorf("AcknowledgementNote = %v, want nil after reopen", resp.AcknowledgementNote)
	}
}

func TestAckHandler_ReopenAlert_Idempotent(t *testing.T) {
	h, notif, _ := newAckTestHandler(&notificationmodel.NotificationLog{
		ID: 109, Status: "sent", CreatedAt: time.Now().UTC(),
	})
	rec := httptest.NewRecorder()
	h.ReopenAlert(rec, newAckRequest(http.MethodPost, "/alerts/109/reopen", "", "109"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusOK, rec.Body.String())
	}
	if len(notif.reopenCalls) != 1 {
		t.Fatalf("reopenCalls = %d, want 1", len(notif.reopenCalls))
	}
	// No reopen event written when row was not acked.
	var resp AlertDetailResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v body=%s", err, rec.Body.String())
	}
	for _, e := range resp.Events {
		if e.Kind == "reopened" {
			t.Errorf("unexpected reopen event on idempotent reopen: %+v", e)
		}
	}
}

func TestAckHandler_ReopenAlert_NotFound(t *testing.T) {
	h, _, _ := newAckTestHandler()
	rec := httptest.NewRecorder()
	h.ReopenAlert(rec, newAckRequest(http.MethodPost, "/alerts/999/reopen", "", "999"))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d, body=%s", rec.Code, http.StatusNotFound, rec.Body.String())
	}
}

func TestNormalizeNote(t *testing.T) {
	mk := func(s string) *string { return &s }

	cases := []struct {
		name     string
		in       *string
		required bool
		want     string
		wantErr  bool
	}{
		{"nil + optional", nil, false, "", false},
		{"nil + required", nil, true, "", true},
		{"empty + optional", mk(""), false, "", false},
		{"empty + required", mk(""), true, "", true},
		{"whitespace + optional", mk("   "), false, "", false},
		{"whitespace + required", mk("   "), true, "", true},
		{"trims surrounding whitespace", mk("  ok  "), false, "ok", false},
		{"too long", mk(strings.Repeat("x", maxAckNoteBytes+1)), false, "", true},
		{"max length OK", mk(strings.Repeat("x", maxAckNoteBytes)), false, strings.Repeat("x", maxAckNoteBytes), false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeNote(tc.in, tc.required)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr = %v", err, tc.wantErr)
			}
			if got != tc.want {
				t.Errorf("got = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestBuildAlertEventTimeline(t *testing.T) {
	created := time.Date(2025, 12, 8, 9, 14, 0, 0, time.UTC)
	logRow := &notificationmodel.NotificationLog{ID: 200, CreatedAt: created}
	actor := "alice"
	note := "Restarting MQTT"
	events := []*alertmodel.NotificationLogEvent{
		{ID: 1, NotificationLogID: 200, OccurredAt: created.Add(7 * time.Minute),
			Actor: &actor, Kind: alertmodel.NotificationLogEventKindAcknowledged, Note: &note},
	}
	out := buildAlertEventTimeline(logRow, events)
	if len(out) != 2 {
		t.Fatalf("len = %d, want 2", len(out))
	}
	if out[0].Kind != "created" || !out[0].OccurredAt.Equal(created) {
		t.Errorf("synthetic created mismatch: %+v", out[0])
	}
	if out[1].Kind != "acknowledged" || out[1].ID != 1 {
		t.Errorf("acknowledged event mismatch: %+v", out[1])
	}
}
