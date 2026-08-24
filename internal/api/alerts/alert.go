package alerts

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"

	"github.com/ev-dev-labs/teslasync/internal/database"
	dbalert "github.com/ev-dev-labs/teslasync/internal/database/alert"
	dbnotif "github.com/ev-dev-labs/teslasync/internal/database/notification"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// AlertHandler handles alert rule CRUD and test-notification HTTP requests.
// Alert firing/listing moved to the notifications subsystem (ADR-010).
type AlertHandler struct {
	db                *database.DB
	alertRuleRepo     alertRuleRepository
	bulkRuleRepo      alertRuleBulkRepository
	notifRepo         notificationRepository
	eventHub          EventBroadcaster
	mqttClient        pahomqtt.Client
	liveSignals       signal.LiveSignalStore
	computedEval      *ComputedMetricEvaluator
	forwardAuthHeader string
}

type alertRuleRepository interface {
	GetAll(context.Context) ([]*alertmodel.AlertRule, error)
	Update(context.Context, int64, *alertmodel.AlertRule) error
	GetByID(context.Context, int64) (*alertmodel.AlertRule, error)
	Create(context.Context, *alertmodel.AlertRule) error
	Delete(context.Context, int64) error
	SetSnooze(context.Context, int64, *time.Time) error
}

// alertRuleBulkRepository carries optional bulk operations. Kept as a
// separate interface so existing alertRuleRepository implementers (including
// the test fakes) don't need to opt in unless they provide bulk semantics.
type alertRuleBulkRepository interface {
	FilterExistingIDs(context.Context, []int64) ([]int64, error)
	BulkSetEnabled(context.Context, []int64, bool) (int64, error)
}

type notificationRepository interface {
	GetLogsFiltered(context.Context, dbnotif.NotificationLogFilters) ([]*notificationmodel.NotificationLog, error)
	BulkSetRead(context.Context, []int64, bool) (int64, error)
	CreateLog(context.Context, *notificationmodel.NotificationLog) error
	GetChannel(context.Context, int64) (*notificationmodel.NotificationChannel, error)
	GetAllChannels(context.Context) ([]*notificationmodel.NotificationChannel, error)

	// Alert acknowledgement and audit timeline operations.
	GetLog(context.Context, int64) (*notificationmodel.NotificationLog, error)
	AcknowledgeLog(context.Context, int64, string, string) (*notificationmodel.NotificationLog, bool, error)
	ReopenLog(context.Context, int64, string) (*notificationmodel.NotificationLog, bool, error)
	CommentOnLog(context.Context, int64, string, string) (*alertmodel.NotificationLogEvent, error)
	ListLogEvents(context.Context, int64) ([]*alertmodel.NotificationLogEvent, error)
}

func NewAlertHandler(db *database.DB, hub EventBroadcaster, mc pahomqtt.Client, store signal.LiveSignalStore) *AlertHandler {
	repo := dbalert.NewAlertRuleRepo(db)
	return &AlertHandler{
		db:            db,
		alertRuleRepo: repo,
		bulkRuleRepo:  repo,
		notifRepo:     dbnotif.NewNotificationRepo(db),
		eventHub:      hub,
		mqttClient:    mc,
		liveSignals:   store,
		computedEval:  NewComputedMetricEvaluator(db),
	}
}

// WithForwardAuthHeader wires the auth header used to attribute audit log
// entries written by the bulk endpoints. When unset, audit rows still record
// IP/User-Agent but Actor is empty (dev mode behaviour).
func (h *AlertHandler) WithForwardAuthHeader(name string) *AlertHandler {
	h.forwardAuthHeader = name
	return h
}

// List returns recent notification logs adapted to the frontend Alert shape.
// Alert rows migrated to notifications (ADR-010 Option B); this endpoint is
// kept for backward compatibility with the frontend /alerts route, which
// expects {id, vehicle_id, type, severity, title, message, is_read, created_at}.
func (h *AlertHandler) List(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.list")
	defer span.End()

	filters, err := parseAlertListFilters(r)
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	logs, err := h.notifRepo.GetLogsFiltered(ctx, filters)
	if err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to list notification logs")
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	if logs == nil {
		logs = []*notificationmodel.NotificationLog{}
	}
	out, err := h.adaptNotificationLogsToAlerts(ctx, logs)
	if err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to adapt notification logs to alert DTOs")
		writeError(w, http.StatusInternalServerError, "failed to list alerts")
		return
	}
	writeJSON(w, http.StatusOK, out)
}

func parseAlertListFilters(r *http.Request) (dbnotif.NotificationLogFilters, error) {
	limit, offset := pagination(r)
	filters := dbnotif.NotificationLogFilters{
		Limit:                      limit,
		Offset:                     offset,
		IncludeFailedInfoAsWarning: true,
	}
	query := r.URL.Query()

	seenSeverities := make(map[string]struct{})
	for _, value := range query["severity"] {
		for _, severity := range strings.Split(value, ",") {
			severity = strings.ToLower(strings.TrimSpace(severity))
			if severity == "" {
				continue
			}
			if severity == "warning" {
				severity = "warn"
			}
			switch severity {
			case "info", "warn", "critical":
			default:
				return filters, fmt.Errorf("invalid severity %q", severity)
			}
			if _, exists := seenSeverities[severity]; exists {
				continue
			}
			seenSeverities[severity] = struct{}{}
			filters.Severities = append(filters.Severities, severity)
		}
	}

	parseOptionalBool := func(name string) (*bool, error) {
		raw := strings.TrimSpace(query.Get(name))
		if raw == "" {
			return nil, nil
		}
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return nil, fmt.Errorf("invalid %s: must be true or false", name)
		}
		return &value, nil
	}

	var err error
	filters.Read, err = parseOptionalBool("read")
	if err != nil {
		return filters, err
	}
	filters.Archived, err = parseOptionalBool("archived")
	if err != nil {
		return filters, err
	}
	return filters, nil
}

// AlertResponse is the wire shape returned by GET /alerts. Mirrors the
// frontend `Alert` interface in web/src/api/types.ts. Built from
// notification_logs joined to alert_rules per ADR-010 Option B.
//
// RuleID, RuleSignal, and RuleSeverity carry the owning alert rule's
// identity through to the frontend so it can build a
// "drill-through" URL — e.g. an alert on `BatteryLevel` deep-links to
// `/battery?vehicle_id=N&t=...&signal=BatteryLevel`. They are nil when the
// notification log has no `alert_id` (e.g. a one-off test notification) or
// when the originating rule has been deleted.
type AlertResponse struct {
	ID        int64     `json:"id"`
	VehicleID int64     `json:"vehicle_id"`
	Type      string    `json:"type"`
	Severity  string    `json:"severity"` // "info" | "warning" | "critical"
	Title     string    `json:"title"`
	Message   string    `json:"message"`
	IsRead    bool      `json:"is_read"`
	CreatedAt time.Time `json:"created_at"`

	// Drill-through metadata populated when the notification log links to a
	// still-existing alert rule.
	RuleID       *int64  `json:"rule_id,omitempty"`
	RuleSignal   *string `json:"rule_signal,omitempty"`   // e.g., "BatteryLevel"
	RuleSeverity *string `json:"rule_severity,omitempty"` // raw rule severity: "info" | "warn" | "critical"
}

// alertRuleSeverityToWire maps the backend severity literal ("warn") to the
// frontend literal ("warning"). All other values pass through unchanged.
// AlertRule.Severity is constrained to {info, warn, critical} at the API
// boundary (see internal/models/alert.go:28); the frontend uses
// {info, warning, critical}.
func alertRuleSeverityToWire(s string) string {
	if s == "warn" {
		return "warning"
	}
	if s == "" {
		return "info"
	}
	return s
}

// slugifyRuleName turns "Battery low (Model Y)" into "battery_low_model_y"
// so it round-trips through the frontend's `alert.type.replace(/_/g, ' ')`
// display logic. Falls back to "notification" if the rule name is empty.
func slugifyRuleName(name string) string {
	if name == "" {
		return "notification"
	}
	var b strings.Builder
	prevUnderscore := true
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevUnderscore = false
		default:
			if !prevUnderscore {
				b.WriteByte('_')
				prevUnderscore = true
			}
		}
	}
	out := strings.Trim(b.String(), "_")
	if out == "" {
		return "notification"
	}
	return out
}

// adaptNotificationLogsToAlerts joins logs to their owning alert rules and
// returns AlertResponse objects in the same order. Logs whose alert_id is
// nil or whose rule was deleted get sensible "notification" defaults.
func (h *AlertHandler) adaptNotificationLogsToAlerts(ctx context.Context, logs []*notificationmodel.NotificationLog) ([]*AlertResponse, error) {
	if len(logs) == 0 {
		return []*AlertResponse{}, nil
	}

	// Batch-fetch all distinct rule IDs referenced by these logs.
	ruleIDs := make(map[int64]struct{}, len(logs))
	for _, l := range logs {
		if l.AlertID != nil && *l.AlertID > 0 {
			ruleIDs[*l.AlertID] = struct{}{}
		}
	}
	rules := make(map[int64]*alertmodel.AlertRule, len(ruleIDs))
	for id := range ruleIDs {
		rule, err := h.alertRuleRepo.GetByID(ctx, id)
		if err != nil {
			// A missing rule should not break the whole response.
			log.Warn().Err(err).Int64("rule_id", id).Msg("alert rule lookup failed; using defaults")
			continue
		}
		if rule != nil {
			rules[id] = rule
		}
	}

	out := make([]*AlertResponse, len(logs))
	for i, l := range logs {
		resp := &AlertResponse{
			ID:        l.ID,
			Title:     l.Title,
			Message:   l.Message,
			IsRead:    l.ReadAt != nil,
			CreatedAt: l.CreatedAt,
			Type:      "notification",
			Severity:  "info",
		}
		if l.AlertID != nil {
			if rule, ok := rules[*l.AlertID]; ok {
				resp.Type = slugifyRuleName(rule.Name)
				resp.Severity = alertRuleSeverityToWire(rule.Severity)
				if rule.VehicleID != nil {
					resp.VehicleID = *rule.VehicleID
				}
				// Carry the owning rule's identity so the frontend can deep-link from
				// the alert to the relevant context page (e.g. /battery,
				// /charging) with the alert's signal + timestamp preselected.
				ruleID := rule.ID
				resp.RuleID = &ruleID
				if rule.SignalName != "" {
					sig := rule.SignalName
					resp.RuleSignal = &sig
				}
				if rule.Severity != "" {
					sev := rule.Severity
					resp.RuleSeverity = &sev
				}
			}
		}
		// If the delivery itself failed, surface that as a "warning" floor —
		// the user still wants visibility on undelivered alerts even if the
		// underlying rule was info-level.
		if l.Status == "failed" && resp.Severity == "info" {
			resp.Severity = "warning"
		}
		out[i] = resp
	}
	return out, nil
}

// MarkRead persists the legacy alert-route action against the canonical
// notification_logs read state.
func (h *AlertHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	ctx, span := otel.Tracer("api").Start(r.Context(), "api.alerts.mark_read")
	defer span.End()

	alertID, err := urlParamInt64(r, "alertID")
	if err != nil {
		span.RecordError(err)
		writeError(w, http.StatusBadRequest, "invalid alert ID")
		return
	}
	if _, err := h.notifRepo.BulkSetRead(ctx, []int64{alertID}, true); err != nil {
		span.RecordError(err)
		log.Error().
			Err(err).
			Int64("alert_id", alertID).
			Str("trace_id", span.SpanContext().TraceID().String()).
			Msg("failed to mark alert read")
		writeError(w, http.StatusInternalServerError, "failed to mark alert read")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
