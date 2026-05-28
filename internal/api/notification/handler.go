package notification

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/platform/httputil"
)

// SinkProvider is the function the outbound notification adapters use to
// look up the most-recent httputil.APICallSink. The composition root sets
// this at boot (typically to the parent api package's currentOutboundSink
// lookup) so api_call_logs continues to track every Discord/Slack/Telegram/
// Webhook/Ntfy/Pushover request. Default is nil — adapters fall back to
// httputil's no-op sink, which is what unit tests expect.
var SinkProvider func() httputil.APICallSink

// currentSink returns the active outbound sink via SinkProvider, or nil
// when no provider is wired (unit tests, early boot).
func currentSink() httputil.APICallSink {
	if SinkProvider == nil {
		return nil
	}
	return SinkProvider()
}

// notifyOutboundClient builds a fresh *http.Client for the named
// notification adapter (notify-discord/notify-slack/notify-webhook). The
// sink is read on every call so the most recent SetOutboundSink wins;
// LoggedTransport tags every entry with service=name in api_call_logs.
func notifyOutboundClient(name string) *http.Client {
	return httputil.NewClient(httputil.ClientConfig{
		Name:          name,
		Timeout:       config.HTTPClientTimeout,
		Sink:          currentSink(),
		EnableLogging: true,
	})
}

// Handler handles notification channel CRUD and test delivery.
type Handler struct {
	repo  *dbnotif.NotificationRepo
	inbox notificationInboxStore
}

// notificationInboxStore is the slice of NotificationRepo used by the inbox
// handlers (filter, bulk, unread-count). Extracted so tests can stub the DB.
type notificationInboxStore interface {
	GetLogsFiltered(ctx context.Context, f dbnotif.NotificationLogFilters) ([]*notificationmodel.NotificationLog, error)
	ListGrouped(ctx context.Context, f dbnotif.NotificationLogFilters) ([]*notificationmodel.NotificationLogGroup, error)
	GetUnreadCount(ctx context.Context) (int64, error)
	BulkSetRead(ctx context.Context, ids []int64, read bool) (int64, error)
	BulkSetReadAll(ctx context.Context) (int64, error)
	BulkSetReadByGroupKey(ctx context.Context, groupKey string) (int64, error)
	BulkSetArchived(ctx context.Context, ids []int64, archived bool) (int64, error)
	BulkDelete(ctx context.Context, ids []int64) (int64, error)
}

func NewHandler(db *database.DB) *Handler {
	repo := dbnotif.NewNotificationRepo(db)
	return &Handler{repo: repo, inbox: repo}
}

func (h *Handler) ListChannels(w http.ResponseWriter, r *http.Request) {
	channels, err := h.repo.GetAllChannels(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list notification channels")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to list channels")
		return
	}
	resp := make([]map[string]interface{}, 0, len(channels))
	for _, ch := range channels {
		resp = append(resp, normalizeChannelResponse(ch))
	}
	httpx.WriteJSON(w, http.StatusOK, resp)
}

func (h *Handler) GetChannel(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	ch, err := h.repo.GetChannel(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "channel not found")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, normalizeChannelResponse(ch))
}

func (h *Handler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	ch, errMsg := decodeChannelBody(r)
	if errMsg != "" {
		httpx.WriteError(w, http.StatusBadRequest, errMsg)
		return
	}

	validTypes := map[string]bool{"discord": true, "email": true, "slack": true, "telegram": true, "webhook": true, "ntfy": true, "pushover": true}
	if !validTypes[ch.Type] {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel type")
		return
	}
	if strings.TrimSpace(ch.Name) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "name is required")
		return
	}
	ch.Name = strings.TrimSpace(ch.Name)

	if err := h.repo.CreateChannel(r.Context(), ch); err != nil {
		log.Error().Err(err).Msg("failed to create notification channel")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to create channel")
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, normalizeChannelResponse(ch))
}

func (h *Handler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	ch, errMsg := decodeChannelBody(r)
	if errMsg != "" {
		httpx.WriteError(w, http.StatusBadRequest, errMsg)
		return
	}
	ch.ID = id

	if err := h.repo.UpdateChannel(r.Context(), ch); err != nil {
		log.Error().Err(err).Msg("failed to update notification channel")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to update channel")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, normalizeChannelResponse(ch))
}

// decodeChannelBody decodes a channel create/update request, accepting both
// the old shape (type + nested config map) and the new frontend shape
// (kind + flat channel-specific fields). Returns the canonical model or an
// error message string.
func decodeChannelBody(r *http.Request) (*notificationmodel.NotificationChannel, string) {
	var raw map[string]interface{}
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		return nil, "invalid request body"
	}

	// Accept both "type" and "kind" for backward compatibility.
	channelType, _ := raw["type"].(string)
	if channelType == "" {
		channelType, _ = raw["kind"].(string)
	}

	name, _ := raw["name"].(string)
	enabled, _ := raw["enabled"].(bool)

	// Build config map: prefer nested "config" if present, then merge
	// any top-level channel-specific fields.
	config := make(map[string]string)
	if nested, ok := raw["config"].(map[string]interface{}); ok {
		for k, v := range nested {
			if s, ok := v.(string); ok {
				config[k] = s
			} else if v != nil {
				config[k] = fmt.Sprintf("%v", v)
			}
		}
	}

	// Metadata keys that are NOT channel-specific config fields.
	metaKeys := map[string]bool{
		"id": true, "name": true, "type": true, "kind": true,
		"enabled": true, "config": true, "created_at": true, "updated_at": true,
	}
	for k, v := range raw {
		if metaKeys[k] {
			continue
		}
		if _, exists := config[k]; exists {
			continue // nested config takes precedence
		}
		switch val := v.(type) {
		case string:
			config[k] = val
		case float64:
			// JSON numbers — emit as int when whole, otherwise float.
			if val == float64(int64(val)) {
				config[k] = fmt.Sprintf("%d", int64(val))
			} else {
				config[k] = fmt.Sprintf("%g", val)
			}
		case bool:
			config[k] = fmt.Sprintf("%t", val)
		case nil:
			// skip null values
		default:
			config[k] = fmt.Sprintf("%v", val)
		}
	}

	return &notificationmodel.NotificationChannel{
		Name:    name,
		Type:    channelType,
		Config:  config,
		Enabled: enabled,
	}, ""
}

// normalizeChannelResponse converts a canonical NotificationChannel (type +
// config map) into the shape the frontend expects (kind + flat fields).
func normalizeChannelResponse(ch *notificationmodel.NotificationChannel) map[string]interface{} {
	resp := map[string]interface{}{
		"id":         ch.ID,
		"kind":       ch.Type,
		"name":       ch.Name,
		"enabled":    ch.Enabled,
		"created_at": ch.CreatedAt,
		"updated_at": ch.UpdatedAt,
	}
	for k, v := range ch.Config {
		resp[k] = v
	}
	return resp
}

func (h *Handler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}
	if err := h.repo.DeleteChannel(r.Context(), id); err != nil {
		log.Error().Err(err).Msg("failed to delete notification channel")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete channel")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

func (h *Handler) ToggleChannel(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.repo.ToggleChannel(r.Context(), id, body.Enabled); err != nil {
		log.Error().Err(err).Msg("failed to toggle channel")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to toggle channel")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"id": id, "enabled": body.Enabled})
}

// TestChannel sends a test notification through the specified channel.
func (h *Handler) TestChannel(w http.ResponseWriter, r *http.Request) {
	id, err := apiparams.URLParamInt64(r, "channelID")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid channel ID")
		return
	}

	ch, err := h.repo.GetChannel(r.Context(), id)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "channel not found")
		return
	}

	testMsg := "TeslaSync test notification — your channel is configured correctly!"
	sendErr := sendNotification(ch, "TeslaSync Test", testMsg)

	status := "sent"
	errStr := ""
	if sendErr != nil {
		status = "failed"
		errStr = sendErr.Error()
	}

	now := time.Now().UTC()
	logEntry := &notificationmodel.NotificationLog{
		ChannelID: ch.ID,
		Title:     "TeslaSync Test",
		Message:   testMsg,
		Status:    status,
		Error:     errStr,
	}
	if status == "sent" {
		logEntry.SentAt = &now
	}
	_ = h.repo.CreateLog(r.Context(), logEntry)

	if sendErr != nil {
		httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"success": false, "error": sendErr.Error()})
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]interface{}{"success": true, "message": "Test notification sent"})
}

func (h *Handler) GetLogs(w http.ResponseWriter, r *http.Request) {
	filters, err := parseNotificationLogFilters(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	// Phase-46 / Prompt 27 — ?grouped=true switches the response shape
	// from a flat NotificationLog list to a list of NotificationLogGroup
	// (latest member + count + unread + vehicle ids). Mutually exclusive
	// with ?group_key=... because asking for the members of a single
	// group AND requesting them grouped is a contradiction (and would
	// return at most one bucket on success).
	groupedRequested := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("grouped")), "true")
	if groupedRequested && filters.GroupKey != "" {
		httpx.WriteError(w, http.StatusBadRequest, "grouped=true and group_key are mutually exclusive")
		return
	}
	if groupedRequested {
		groups, gErr := h.inbox.ListGrouped(r.Context(), filters)
		if gErr != nil {
			log.Error().Err(gErr).Msg("failed to list notification log groups")
			httpx.WriteError(w, http.StatusInternalServerError, "failed to get logs")
			return
		}
		if groups == nil {
			groups = []*notificationmodel.NotificationLogGroup{}
		}
		httpx.WriteJSON(w, http.StatusOK, groups)
		return
	}
	logs, err := h.inbox.GetLogsFiltered(r.Context(), filters)
	if err != nil {
		log.Error().Err(err).Msg("failed to get notification logs")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get logs")
		return
	}
	if logs == nil {
		logs = []*notificationmodel.NotificationLog{}
	}
	httpx.WriteJSON(w, http.StatusOK, logs)
}

// parseNotificationLogFilters turns query params into a NotificationLogFilters.
// All params are optional. Multi-value filters (severity, vehicle_id, rule_id)
// accept either repeated params (?severity=info&severity=warn) or a single
// CSV (?severity=info,warn). Snake_case per project conventions.
func parseNotificationLogFilters(r *http.Request) (dbnotif.NotificationLogFilters, error) {
	q := r.URL.Query()
	limit, offset := apiparams.Pagination(r)
	f := dbnotif.NotificationLogFilters{Limit: limit, Offset: offset}

	if vs := csvOrRepeated(q, "severity"); len(vs) > 0 {
		allowed := map[string]bool{"info": true, "warn": true, "critical": true}
		for _, s := range vs {
			s = strings.ToLower(strings.TrimSpace(s))
			if !allowed[s] {
				return f, fmt.Errorf("invalid severity %q", s)
			}
			f.Severities = append(f.Severities, s)
		}
	}
	if vs := csvOrRepeated(q, "vehicle_id"); len(vs) > 0 {
		ids, err := parseInt64List(vs)
		if err != nil {
			return f, fmt.Errorf("invalid vehicle_id: %w", err)
		}
		f.VehicleIDs = ids
	}
	if vs := csvOrRepeated(q, "rule_id"); len(vs) > 0 {
		ids, err := parseInt64List(vs)
		if err != nil {
			return f, fmt.Errorf("invalid rule_id: %w", err)
		}
		f.RuleIDs = ids
	}
	if s := q.Get("from"); s != "" {
		t, err := parseFlexibleTime(s)
		if err != nil {
			return f, fmt.Errorf("invalid from: %w", err)
		}
		f.From = t
	}
	if s := q.Get("to"); s != "" {
		t, err := parseFlexibleTime(s)
		if err != nil {
			return f, fmt.Errorf("invalid to: %w", err)
		}
		f.To = t
	}
	if s := q.Get("read"); s != "" {
		v, err := parseBoolish(s)
		if err != nil {
			return f, fmt.Errorf("invalid read: %w", err)
		}
		f.Read = &v
	}
	// Default the inbox view to non-archived. Callers must opt into
	// archived=true to switch to the Archived tab.
	f.Archived = boolPtr(false)
	if s := q.Get("archived"); s != "" {
		v, err := parseBoolish(s)
		if err != nil {
			return f, fmt.Errorf("invalid archived: %w", err)
		}
		f.Archived = &v
	}
	if s := strings.TrimSpace(q.Get("q")); s != "" {
		f.Query = s
	}
	if s := strings.TrimSpace(q.Get("group_key")); s != "" {
		// Phase-46 / Prompt 27 — accept the lower-hex sha256 derived
		// in the repo. We validate strictly (length + alphabet) so a
		// stray garbage value can't trigger an unbounded scan; the
		// caller just gets a 400.
		if !dbnotif.IsValidNotificationGroupKey(s) {
			return f, fmt.Errorf("invalid group_key: must be 64-char lower-hex")
		}
		f.GroupKey = s
	}
	return f, nil
}

func csvOrRepeated(q url.Values, key string) []string {
	if vs, ok := q[key]; ok && len(vs) > 0 {
		var out []string
		for _, v := range vs {
			for _, p := range strings.Split(v, ",") {
				if p = strings.TrimSpace(p); p != "" {
					out = append(out, p)
				}
			}
		}
		return out
	}
	return nil
}

func parseInt64List(in []string) ([]int64, error) {
	out := make([]int64, 0, len(in))
	for _, s := range in {
		n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil {
			return nil, fmt.Errorf("not an int64: %q", s)
		}
		out = append(out, n)
	}
	return out, nil
}

func parseFlexibleTime(s string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, time.RFC3339Nano, "2006-01-02"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("not a recognised time: %q", s)
}

func parseBoolish(s string) (bool, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "t", "true", "yes", "y":
		return true, nil
	case "0", "f", "false", "no", "n":
		return false, nil
	}
	return false, fmt.Errorf("not a boolean: %q", s)
}

// bulkIDsRequest is the shared body shape for bulk mutation endpoints.
//
// `All` is honoured only by the mark-read endpoint (see decodeMarkReadBody).
// When set to `true`, the handler delegates to the repo's whole-inbox path
// instead of requiring an id list.
//
// `GroupKey` (Phase-46 / Prompt 27) is also honoured only by mark-read and
// is mutually exclusive with both `IDs` and `All`. When supplied, the
// handler delegates to BulkSetReadByGroupKey to mark every member of a
// thread as read in one round-trip.
type bulkIDsRequest struct {
	IDs      []int64 `json:"ids"`
	All      bool    `json:"all"`
	GroupKey string  `json:"group_key,omitempty"`
}

func decodeBulkIDs(r *http.Request) ([]int64, error) {
	var body bulkIDsRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("invalid request body: %w", err)
	}
	if len(body.IDs) == 0 {
		return nil, fmt.Errorf("ids must be non-empty")
	}
	if len(body.IDs) > 1000 {
		return nil, fmt.Errorf("ids exceeds 1000 cap")
	}
	return body.IDs, nil
}

// decodeMarkReadBody is the relaxed decoder used by MarkRead. The body must
// supply exactly one of: a non-empty `ids` array, `all: true`, or a
// `group_key` string. Supplying more than one is rejected so the caller
// can't accidentally mask one path with another.
//
// Returns:
//   - ids (non-nil, ≤1000): mark exactly those rows as read
//   - all=true: mark every non-archived, currently-unread row as read
//   - groupKey != "": mark every member of that thread as read
func decodeMarkReadBody(r *http.Request) (ids []int64, all bool, groupKey string, err error) {
	var body bulkIDsRequest
	if decErr := json.NewDecoder(r.Body).Decode(&body); decErr != nil {
		return nil, false, "", fmt.Errorf("invalid request body: %w", decErr)
	}
	gk := strings.TrimSpace(body.GroupKey)
	// Count selectors to enforce mutual exclusion. Exactly one must be set.
	selectors := 0
	if len(body.IDs) > 0 {
		selectors++
	}
	if body.All {
		selectors++
	}
	if gk != "" {
		selectors++
	}
	if selectors > 1 {
		return nil, false, "", fmt.Errorf("ids, all, and group_key are mutually exclusive")
	}
	if selectors == 0 {
		return nil, false, "", fmt.Errorf("ids must be non-empty (or pass all=true or group_key)")
	}
	if gk != "" {
		if !dbnotif.IsValidNotificationGroupKey(gk) {
			return nil, false, "", fmt.Errorf("invalid group_key: must be 64-char lower-hex")
		}
		return nil, false, gk, nil
	}
	if body.All {
		return nil, true, "", nil
	}
	if len(body.IDs) > 1000 {
		return nil, false, "", fmt.Errorf("ids exceeds 1000 cap")
	}
	return body.IDs, false, "", nil
}

// MarkRead flips read_at to NOW() for each id in the request body.
//
// Body shapes accepted:
//
//	{"ids":[1,2,3]}               → mark exactly those rows as read.
//	{"all":true}                  → mark every non-archived, currently-unread row as read.
//	{"group_key":"<sha256-hex>"}  → mark every member of that thread as read.
//
// Phase-45 / 28 added the all-flag to power the "Mark all read" header
// action without forcing the client to enumerate every visible id (which
// could exceed the 1000-id cap on busy inboxes). Phase-46 / 27 added the
// group_key path so the threaded inbox's "Mark group read" action can
// flip an entire thread without expanding it client-side.
func (h *Handler) MarkRead(w http.ResponseWriter, r *http.Request) {
	ids, all, groupKey, err := decodeMarkReadBody(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var (
		updated int64
		opErr   error
	)
	switch {
	case groupKey != "":
		updated, opErr = h.inbox.BulkSetReadByGroupKey(r.Context(), groupKey)
	case all:
		updated, opErr = h.inbox.BulkSetReadAll(r.Context())
	default:
		updated, opErr = h.inbox.BulkSetRead(r.Context(), ids, true)
	}
	if opErr != nil {
		log.Error().Err(opErr).
			Bool("all", all).
			Bool("by_group", groupKey != "").
			Msg("bulk mark read")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to mark notifications read")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"updated": updated})
}

// MarkUnread clears read_at for each id in the request body.
func (h *Handler) MarkUnread(w http.ResponseWriter, r *http.Request) {
	ids, err := decodeBulkIDs(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := h.inbox.BulkSetRead(r.Context(), ids, false)
	if err != nil {
		log.Error().Err(err).Msg("bulk mark unread")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to mark notifications unread")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"updated": updated})
}

// Archive flips archived_at to NOW() for each id, also marking the row read
// so it stops counting toward the unread badge.
func (h *Handler) Archive(w http.ResponseWriter, r *http.Request) {
	ids, err := decodeBulkIDs(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := h.inbox.BulkSetArchived(r.Context(), ids, true)
	if err != nil {
		log.Error().Err(err).Msg("bulk archive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to archive notifications")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"updated": updated})
}

// Unarchive clears archived_at for each id.
func (h *Handler) Unarchive(w http.ResponseWriter, r *http.Request) {
	ids, err := decodeBulkIDs(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	updated, err := h.inbox.BulkSetArchived(r.Context(), ids, false)
	if err != nil {
		log.Error().Err(err).Msg("bulk unarchive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to unarchive notifications")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"updated": updated})
}

// DeleteBulk hard-deletes notification log rows. Kept rare/admin-only —
// archive is preferred for the inbox UX.
func (h *Handler) DeleteBulk(w http.ResponseWriter, r *http.Request) {
	ids, err := decodeBulkIDs(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	deleted, err := h.inbox.BulkDelete(r.Context(), ids)
	if err != nil {
		log.Error().Err(err).Msg("bulk delete logs")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to delete notifications")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"deleted": deleted})
}

// UnreadCount returns the number of non-archived, non-read notification rows.
// Powers the header bell badge and the favicon badge (Prompt 32 hand-off).
func (h *Handler) UnreadCount(w http.ResponseWriter, r *http.Request) {
	n, err := h.inbox.GetUnreadCount(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("unread count")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to count unread notifications")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]int64{"count": n})
}

func (h *Handler) GetStats(w http.ResponseWriter, r *http.Request) {
	stats, err := h.repo.GetStats(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to get notification stats")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get stats")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, stats)
}

// sendNotification dispatches a message to the configured channel.
func sendNotification(ch *notificationmodel.NotificationChannel, title, message string) error {
	switch ch.Type {
	case "discord":
		return sendDiscord(ch.Config["webhook_url"], title, message)
	case "slack":
		return sendSlack(ch.Config["webhook_url"], title, message)
	case "telegram":
		return sendTelegram(ch.Config["bot_token"], ch.Config["chat_id"], title, message)
	case "webhook":
		return sendWebhook(ch.Config["url"], ch.Config["method"], title, message)
	case "ntfy":
		return sendNtfy(ch.Config["server_url"], ch.Config["topic"], title, message)
	case "email":
		// Email requires SMTP config — log placeholder for now
		log.Info().Str("to", ch.Config["to"]).Str("title", title).Msg("email notification (SMTP not configured)")
		return nil
	case "pushover":
		return sendPushover(ch.Config["app_token"], ch.Config["user_key"], title, message)
	default:
		return fmt.Errorf("unsupported channel type: %s", ch.Type)
	}
}

func sendDiscord(webhookURL, title, message string) error {
	if webhookURL == "" {
		return fmt.Errorf("discord webhook_url not configured")
	}
	payload := map[string]interface{}{
		"embeds": []map[string]interface{}{
			{"title": title, "description": message, "color": 0xE82127},
		},
	}
	return postJSON("notify-discord", webhookURL, payload)
}

func sendSlack(webhookURL, title, message string) error {
	if webhookURL == "" {
		return fmt.Errorf("slack webhook_url not configured")
	}
	payload := map[string]interface{}{
		"text": fmt.Sprintf("*%s*\n%s", title, message),
	}
	return postJSON("notify-slack", webhookURL, payload)
}

func sendTelegram(botToken, chatID, title, message string) error {
	if botToken == "" || chatID == "" {
		return fmt.Errorf("telegram bot_token and chat_id required")
	}
	url := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", botToken)
	payload := map[string]interface{}{
		"chat_id":    chatID,
		"text":       fmt.Sprintf("*%s*\n%s", title, message),
		"parse_mode": "Markdown",
	}
	return postJSON("notify-webhook", url, payload)
}

func sendWebhook(url, method, title, message string) error {
	if url == "" {
		return fmt.Errorf("webhook url not configured")
	}
	if method == "" {
		method = "POST"
	}
	payload := map[string]string{"title": title, "message": message, "source": "teslasync"}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequest(method, url, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := notifyOutboundClient("notify-webhook").Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("webhook returned %d: %s", resp.StatusCode, string(b))
	}
	return nil
}

func sendNtfy(serverURL, topic, title, message string) error {
	if topic == "" {
		return fmt.Errorf("ntfy topic not configured")
	}
	if serverURL == "" {
		serverURL = "https://ntfy.sh"
	}
	url := fmt.Sprintf("%s/%s", strings.TrimRight(serverURL, "/"), topic)
	req, err := http.NewRequest("POST", url, strings.NewReader(message))
	if err != nil {
		return err
	}
	req.Header.Set("Title", title)
	req.Header.Set("Priority", "default")
	req.Header.Set("Tags", "electric_plug")
	resp, err := notifyOutboundClient("notify-webhook").Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("ntfy returned %d", resp.StatusCode)
	}
	return nil
}

func sendPushover(appToken, userKey, title, message string) error {
	if appToken == "" || userKey == "" {
		return fmt.Errorf("pushover app_token and user_key required")
	}
	payload := map[string]string{
		"token":   appToken,
		"user":    userKey,
		"title":   title,
		"message": message,
	}
	return postJSON("notify-webhook", "https://api.pushover.net/1/messages.json", payload)
}

// postJSON dispatches a JSON payload to the supplied URL using the named
// outbound client. clientName flows through LoggedTransport as the
// api_call_logs.service tag so Discord/Slack/generic webhook calls are
// distinguishable in the hypertable.
func postJSON(clientName, url string, payload interface{}) error {
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	resp, err := notifyOutboundClient(clientName).Post(url, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(b))
	}
	return nil
}
