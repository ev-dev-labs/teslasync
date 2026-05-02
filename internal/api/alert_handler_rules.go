package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
	"github.com/ev-dev-labs/teslasync/internal/notification"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

const (
	maxAlertRequestBodyBytes = 1 << 20
	// maxSnoozeMinutes caps a single snooze at 30 days so a stuck client
	// can't accidentally mute a rule indefinitely.
	maxSnoozeMinutes = 60 * 24 * 30
)

var forbiddenAlertRuleFields = map[string]struct{}{
	"conditions":      {},
	"expression":      {},
	"for_duration_s":  {},
	"msg_template":    {},
	"notify_channels": {},
	"type":            {},
	"threshold":       {},
	"rule_def":        {},
}

var forbiddenAlertTestFields = map[string]struct{}{
	"msg_template":    {},
	"notify_channels": {},
}

func (h *AlertHandler) ListRules(w http.ResponseWriter, r *http.Request) {
	rules, err := h.alertRuleRepo.GetAll(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list alert rules")
		writeError(w, http.StatusInternalServerError, "failed to list alert rules")
		return
	}
	if rules == nil {
		rules = []*models.AlertRule{}
	}
	writeJSON(w, http.StatusOK, rules)
}

func (h *AlertHandler) UpdateRule(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "ruleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid rule ID")
		return
	}

	var body updateAlertRuleRequest
	fields, err := decodeStrictAlertRequest(r, &body, forbiddenAlertRuleFields)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Fetch existing rule so partial updates don't wipe fields.
	existing, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil || existing == nil {
		writeError(w, http.StatusNotFound, "rule not found")
		return
	}

	if fieldPresent(fields, "name") {
		if body.Name == nil {
			writeError(w, http.StatusBadRequest, "name is required")
			return
		}
		existing.Name = *body.Name
	}
	if fieldPresent(fields, "description") {
		existing.Description = body.Description
	}
	if fieldPresent(fields, "enabled") {
		if body.Enabled == nil {
			writeError(w, http.StatusBadRequest, "enabled must be a boolean")
			return
		}
		existing.Enabled = *body.Enabled
	}
	if fieldPresent(fields, "vehicle_id") {
		existing.VehicleID = body.VehicleID
	}
	if fieldPresent(fields, "signal_name") {
		if body.SignalName == nil {
			writeError(w, http.StatusBadRequest, "signal_name is required")
			return
		}
		existing.SignalName = *body.SignalName
	}
	if fieldPresent(fields, "op") {
		if body.Op == nil {
			writeError(w, http.StatusBadRequest, "op is required")
			return
		}
		existing.Op = *body.Op
	}
	if fieldPresent(fields, "value_num") {
		existing.ValueNum = body.ValueNum
	}
	if fieldPresent(fields, "value_text") {
		existing.ValueText = body.ValueText
	}
	if fieldPresent(fields, "value_bool") {
		existing.ValueBool = body.ValueBool
	}
	if fieldPresent(fields, "value_min") {
		existing.ValueMin = body.ValueMin
	}
	if fieldPresent(fields, "value_max") {
		existing.ValueMax = body.ValueMax
	}
	if fieldPresent(fields, "severity") {
		if body.Severity == nil {
			writeError(w, http.StatusBadRequest, "severity must be info, warn, or critical")
			return
		}
		severity, err := validateUpdateAlertSeverity(*body.Severity)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		existing.Severity = severity
	}
	if fieldPresent(fields, "cooldown_min") {
		if body.CooldownMin == nil {
			writeError(w, http.StatusBadRequest, "cooldown_min must be an integer")
			return
		}
		existing.CooldownMin = *body.CooldownMin
	}
	if fieldPresent(fields, "trigger_mode") {
		mode, err := validateTriggerMode(body.TriggerMode)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		existing.TriggerMode = mode
	}
	if fieldPresent(fields, "snoozed_until") {
		existing.SnoozedUntil = body.SnoozedUntil
	}

	// Computed-metric fields (kind switching is handled below).
	if fieldPresent(fields, "metric_id") {
		existing.MetricID = body.MetricID
	}
	if fieldPresent(fields, "metric_window") {
		existing.MetricWindow = body.MetricWindow
	}
	if fieldPresent(fields, "metric_threshold") {
		existing.MetricThreshold = body.MetricThreshold
	}
	if fieldPresent(fields, "metric_op") {
		existing.MetricOp = body.MetricOp
	}
	if fieldPresent(fields, "kind") {
		kind, err := validateAlertRuleKind(body.Kind)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		existing.Kind = kind
	}
	normalizeAlertRuleByKind(existing)
	if err := validateAlertRule(existing); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.alertRuleRepo.Update(r.Context(), id, existing); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update alert rule")
		writeError(w, http.StatusInternalServerError, "failed to update alert rule")
		return
	}

	updated, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to fetch updated alert rule")
		writeError(w, http.StatusInternalServerError, "rule updated but failed to retrieve")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *AlertHandler) CreateRule(w http.ResponseWriter, r *http.Request) {
	var body createAlertRuleRequest
	fields, err := decodeStrictAlertRequest(r, &body, forbiddenAlertRuleFields)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if fieldPresent(fields, "enabled") && body.Enabled == nil {
		writeError(w, http.StatusBadRequest, "enabled must be a boolean")
		return
	}
	if fieldPresent(fields, "severity") && body.Severity == nil {
		writeError(w, http.StatusBadRequest, "severity must be info, warn, or critical")
		return
	}
	if fieldPresent(fields, "cooldown_min") && body.CooldownMin == nil {
		writeError(w, http.StatusBadRequest, "cooldown_min must be an integer")
		return
	}

	name := ""
	if body.Name != nil {
		name = *body.Name
	}
	enabled := false
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	signalName := ""
	if body.SignalName != nil {
		signalName = *body.SignalName
	}
	op := ""
	if body.Op != nil {
		op = *body.Op
	}
	severity, err := validateCreateAlertSeverity(body.Severity)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	cooldownMin := 15
	if body.CooldownMin != nil {
		cooldownMin = *body.CooldownMin
	}
	triggerMode, err := validateTriggerMode(body.TriggerMode)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	rule := &models.AlertRule{
		Name:            name,
		Description:     body.Description,
		Enabled:         enabled,
		VehicleID:       body.VehicleID,
		SignalName:      signalName,
		Op:              op,
		ValueNum:        body.ValueNum,
		ValueText:       body.ValueText,
		ValueBool:       body.ValueBool,
		ValueMin:        body.ValueMin,
		ValueMax:        body.ValueMax,
		Severity:        severity,
		CooldownMin:     cooldownMin,
		TriggerMode:     triggerMode,
		SnoozedUntil:    body.SnoozedUntil,
		MetricID:        body.MetricID,
		MetricWindow:    body.MetricWindow,
		MetricThreshold: body.MetricThreshold,
		MetricOp:        body.MetricOp,
	}
	kind, err := validateAlertRuleKind(body.Kind)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	rule.Kind = kind
	normalizeAlertRuleByKind(rule)
	if err := validateAlertRule(rule); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.alertRuleRepo.Create(r.Context(), rule); err != nil {
		log.Error().Err(err).Msg("failed to create alert rule")
		writeError(w, http.StatusInternalServerError, "failed to create alert rule")
		return
	}

	writeJSON(w, http.StatusCreated, rule)
}

func (h *AlertHandler) DeleteRule(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "ruleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid rule ID")
		return
	}

	if err := h.alertRuleRepo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete alert rule")
		writeError(w, http.StatusInternalServerError, "failed to delete alert rule")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// SnoozeRule sets snoozed_until on a rule. Body accepts exactly one of:
//   {"minutes": <int>}  - snooze for N minutes from now (<= 0 clears).
//   {"until":   <ISO>}  - snooze until the given timestamp (past = clear).
//
// Snooze is layered on top of cooldown / trigger_mode: while a rule is
// snoozed, the engine suppresses all evaluations regardless of condition.
func (h *AlertHandler) SnoozeRule(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "ruleID")
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid rule ID")
		return
	}

	var body snoozeAlertRuleRequest
	if _, err := decodeStrictAlertRequest(r, &body, nil); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	until, err := resolveSnoozeUntil(body)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.alertRuleRepo.SetSnooze(r.Context(), id, until); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to set snooze")
		writeError(w, http.StatusInternalServerError, "failed to set snooze")
		return
	}

	updated, err := h.alertRuleRepo.GetByID(r.Context(), id)
	if err != nil || updated == nil {
		writeError(w, http.StatusNotFound, "rule not found after snooze")
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// resolveSnoozeUntil normalizes the snooze body into an effective timestamp.
// Returns nil when the snooze should be cleared (negative minutes or past
// timestamp), and an error when the input is ambiguous or out of range.
func resolveSnoozeUntil(body snoozeAlertRuleRequest) (*time.Time, error) {
	switch {
	case body.Minutes != nil && body.Until != nil:
		return nil, errors.New("specify minutes OR until, not both")
	case body.Minutes != nil:
		if *body.Minutes <= 0 {
			return nil, nil
		}
		if *body.Minutes > maxSnoozeMinutes {
			return nil, fmt.Errorf("minutes must be <= %d (30 days)", maxSnoozeMinutes)
		}
		t := time.Now().UTC().Add(time.Duration(*body.Minutes) * time.Minute)
		return &t, nil
	case body.Until != nil:
		if body.Until.Before(time.Now().UTC()) {
			return nil, nil
		}
		return body.Until, nil
	default:
		return nil, errors.New("specify minutes or until")
	}
}

// TestRule fires a test notification for a rule — creates a notification log
// entry and broadcasts via SSE. When the request body contains
// `kind:'computed_metric'` plus the metric_* fields, the handler instead
// previews the computed metric and returns the current value without sending
// any notifications (used by the rule builder UI's live preview).
func (h *AlertHandler) TestRule(w http.ResponseWriter, r *http.Request) {
	var body alertTestRequest
	if _, err := decodeStrictAlertRequest(r, &body, forbiddenAlertTestFields); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	// Computed-metric preview path: skips notification dispatch entirely.
	if body.Kind != nil && *body.Kind == models.AlertRuleKindComputedMetric {
		h.previewComputedMetric(w, r, body)
		return
	}

	message := body.Message
	if message == "" {
		message = "This is a test notification from Alert Studio"
	}
	channelIDs, allChannels, err := validateAlertTestTarget(body.Target)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Render template with current signal values from the live-state boundary.
	if h.liveSignals != nil {
		for _, vid := range h.liveSignals.LocalVehicleIDs() {
			values, err := h.liveSignals.GetAll(r.Context(), vid, signal.LiveSignalReadDistributed)
			if err != nil {
				log.Warn().Err(err).Int64("vehicle_id", vid).Msg("alert test: live signal read failed")
				continue
			}
			raw := liveSignalValuesToRaw(values)
			if len(raw) > 0 {
				message = renderTemplate(message, raw)
				break
			}
		}
	}

	const severity = "info"
	title := "[TEST] Test Rule"

	// Create a notification log entry
	nlog := &models.NotificationLog{
		Title:   title,
		Message: message,
		Status:  "sent",
	}
	if err := h.notifRepo.CreateLog(r.Context(), nlog); err != nil {
		log.Error().Err(err).Msg("failed to create test notification log")
		writeError(w, http.StatusInternalServerError, "failed to create test notification")
		return
	}

	// Broadcast via SSE
	if h.eventHub != nil {
		h.eventHub.Broadcast("alert", map[string]interface{}{
			"id":        nlog.ID,
			"type":      "test",
			"severity":  severity,
			"title":     title,
			"message":   message,
			"timestamp": nlog.CreatedAt,
			"is_test":   true,
		})
	}

	// Dispatch to the requested target. No target defaults to all enabled channels.
	dispatched := 0
	if !allChannels {
		for _, chID := range channelIDs {
			ch, err := h.notifRepo.GetChannel(r.Context(), chID)
			if err != nil || ch == nil {
				continue
			}
			req := &notification.Request{
				ChannelType: ch.Type,
				Config:      ch.Config,
				Title:       title,
				Message:     message,
				ChannelID:   ch.ID,
			}
			if pubErr := notification.Publish(h.mqttClient, req); pubErr == nil {
				dispatched++
			}
		}
	} else {
		channels, err := h.notifRepo.GetAllChannels(r.Context())
		if err == nil {
			for _, ch := range channels {
				if !ch.Enabled {
					continue
				}
				req := &notification.Request{
					ChannelType: ch.Type,
					Config:      ch.Config,
					Title:       title,
					Message:     message,
					ChannelID:   ch.ID,
				}
				if pubErr := notification.Publish(h.mqttClient, req); pubErr == nil {
					dispatched++
				}
			}
		}

		// Web Push fan-out — only the all-channels test path triggers it.
		// Targeted channel-id tests intentionally skip web push because the
		// operator picked a specific channel; sending it to every device too
		// would be surprising. The dispatcher is a no-op when VAPID is not
		// configured, so this stays safe in dev installs.
		pushReq := &notification.Request{
			ChannelType: notification.ChannelTypeWebPush,
			Config: map[string]string{
				"severity":  severity,
				"url":       "/notifications",
				"alert_tag": "alert-test",
			},
			Title:   title,
			Message: message,
		}
		if pubErr := notification.Publish(h.mqttClient, pushReq); pubErr == nil {
			dispatched++
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status":     "sent",
		"dispatched": dispatched,
		"message":    "Test notification sent — check your browser toast and notification channels",
	})
}

func decodeStrictAlertRequest(r *http.Request, dst interface{}, forbiddenFields map[string]struct{}) (map[string]json.RawMessage, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxAlertRequestBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if len(body) == 0 {
		return nil, errors.New("empty request body")
	}
	if len(body) > maxAlertRequestBodyBytes {
		return nil, errors.New("request body too large")
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(body, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, errors.New("request body must be a JSON object")
	}
	for field := range fields {
		if _, forbidden := forbiddenFields[field]; forbidden {
			return nil, fmt.Errorf("field %q is not supported", field)
		}
	}

	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return nil, err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("request body must contain a single JSON object")
	}
	return fields, nil
}

func fieldPresent(fields map[string]json.RawMessage, name string) bool {
	_, ok := fields[name]
	return ok
}

func validateCreateAlertSeverity(severity *string) (string, error) {
	if severity == nil || *severity == "" {
		return "warn", nil
	}
	return validateAlertSeverity(*severity)
}

func validateUpdateAlertSeverity(severity string) (string, error) {
	if severity == "" {
		return "", errors.New("severity must be info, warn, or critical")
	}
	return validateAlertSeverity(severity)
}

func validateAlertSeverity(severity string) (string, error) {
	switch severity {
	case "info", "warn", "critical":
		return severity, nil
	case "warning":
		return "", errors.New(`severity "warning" is not supported; use "warn"`)
	default:
		return "", errors.New("severity must be info, warn, or critical")
	}
}

func validateAlertRule(rule *models.AlertRule) error {
	if rule.Name == "" {
		return errors.New("name is required")
	}
	if len(rule.Name) > 200 {
		return errors.New("name must be 200 characters or less")
	}
	if _, err := validateAlertSeverity(rule.Severity); err != nil {
		return err
	}
	if rule.CooldownMin <= 0 {
		return errors.New("cooldown_min must be greater than 0")
	}
	if rule.TriggerMode != "once" && rule.TriggerMode != "repeat" {
		return errors.New(`trigger_mode must be "once" or "repeat"`)
	}
	switch rule.Kind {
	case "", models.AlertRuleKindSignal:
		if strings.TrimSpace(rule.SignalName) == "" {
			return errors.New("signal_name is required")
		}
		return validateAlertRuleOperand(rule)
	case models.AlertRuleKindComputedMetric:
		return validateComputedMetricRule(rule)
	default:
		return fmt.Errorf("kind must be %q or %q", models.AlertRuleKindSignal, models.AlertRuleKindComputedMetric)
	}
}

// validateComputedMetricRule enforces that all four metric_* fields are set
// and reference a known metric / window / operator combination.
func validateComputedMetricRule(rule *models.AlertRule) error {
	if rule.MetricID == nil || strings.TrimSpace(*rule.MetricID) == "" {
		return errors.New("metric_id is required for computed_metric rules")
	}
	if rule.MetricWindow == nil || strings.TrimSpace(*rule.MetricWindow) == "" {
		return errors.New("metric_window is required for computed_metric rules")
	}
	if rule.MetricOp == nil || strings.TrimSpace(*rule.MetricOp) == "" {
		return errors.New("metric_op is required for computed_metric rules")
	}
	if rule.MetricThreshold == nil {
		return errors.New("metric_threshold is required for computed_metric rules")
	}
	metric, ok := ComputedMetrics[*rule.MetricID]
	if !ok {
		return fmt.Errorf("unknown metric_id %q", *rule.MetricID)
	}
	if !metric.IsValidWindow(*rule.MetricWindow) {
		return fmt.Errorf("metric_window %q is not allowed for metric %q", *rule.MetricWindow, metric.ID)
	}
	if !IsValidComputedMetricOp(*rule.MetricOp) {
		return fmt.Errorf("metric_op %q is not supported", *rule.MetricOp)
	}
	return nil
}

// normalizeAlertRuleByKind clears the unused operand fields after a save so
// switching kinds doesn't leave stale data behind. For kind='signal' it nulls
// the metric_* fields; for kind='computed_metric' it clears signal_name, op,
// and the value_* operands.
func normalizeAlertRuleByKind(rule *models.AlertRule) {
	switch rule.Kind {
	case models.AlertRuleKindComputedMetric:
		rule.SignalName = ""
		rule.Op = ""
		rule.ValueNum = nil
		rule.ValueText = nil
		rule.ValueBool = nil
		rule.ValueMin = nil
		rule.ValueMax = nil
	default:
		rule.Kind = models.AlertRuleKindSignal
		rule.MetricID = nil
		rule.MetricWindow = nil
		rule.MetricThreshold = nil
		rule.MetricOp = nil
	}
}

// validateAlertRuleKind resolves an optional kind input to its canonical value.
// nil/empty defaults to "signal" (legacy behavior).
func validateAlertRuleKind(kind *string) (string, error) {
	if kind == nil || *kind == "" {
		return models.AlertRuleKindSignal, nil
	}
	switch *kind {
	case models.AlertRuleKindSignal, models.AlertRuleKindComputedMetric:
		return *kind, nil
	default:
		return "", fmt.Errorf("kind must be %q or %q", models.AlertRuleKindSignal, models.AlertRuleKindComputedMetric)
	}
}

// validateTriggerMode resolves an optional input to a canonical trigger mode.
// nil/empty defaults to "repeat" (today's behavior).
func validateTriggerMode(mode *string) (string, error) {
	if mode == nil || *mode == "" {
		return "repeat", nil
	}
	switch *mode {
	case "once", "repeat":
		return *mode, nil
	default:
		return "", errors.New(`trigger_mode must be "once" or "repeat"`)
	}
}

func validateAlertRuleOperand(rule *models.AlertRule) error {
	switch rule.Op {
	case "<", "<=", ">", ">=":
		if rule.ValueNum == nil {
			return fmt.Errorf("op %q requires value_num", rule.Op)
		}
		if rule.ValueText != nil || rule.ValueBool != nil || rule.ValueMin != nil || rule.ValueMax != nil {
			return fmt.Errorf("op %q only accepts value_num", rule.Op)
		}
	case "=", "!=":
		if rule.ValueMin != nil || rule.ValueMax != nil {
			return fmt.Errorf("op %q does not accept value_min or value_max", rule.Op)
		}
		if countAlertValueOperands(rule) != 1 {
			return fmt.Errorf("op %q requires exactly one of value_num, value_text, or value_bool", rule.Op)
		}
	case "between", "outside":
		if rule.ValueMin == nil || rule.ValueMax == nil {
			return fmt.Errorf("op %q requires value_min and value_max", rule.Op)
		}
		if *rule.ValueMin > *rule.ValueMax {
			return errors.New("value_min must be less than or equal to value_max")
		}
		if rule.ValueNum != nil || rule.ValueText != nil || rule.ValueBool != nil {
			return fmt.Errorf("op %q only accepts value_min and value_max", rule.Op)
		}
	case "changed":
		if rule.ValueMin != nil || rule.ValueMax != nil {
			return errors.New(`op "changed" does not accept value_min or value_max`)
		}
		if countAlertValueOperands(rule) > 1 {
			return errors.New(`op "changed" accepts at most one comparison value`)
		}
	default:
		return errors.New("op must be one of =, !=, <, <=, >, >=, changed, between, outside")
	}
	return nil
}

func countAlertValueOperands(rule *models.AlertRule) int {
	count := 0
	if rule.ValueNum != nil {
		count++
	}
	if rule.ValueText != nil {
		count++
	}
	if rule.ValueBool != nil {
		count++
	}
	return count
}

func validateAlertTestTarget(target *alertTestTargetRequest) ([]int64, bool, error) {
	if target == nil {
		return nil, true, nil
	}
	if target.AllChannels && len(target.ChannelIDs) > 0 {
		return nil, false, errors.New("target must specify either all_channels or channel_ids, not both")
	}
	if target.AllChannels {
		return nil, true, nil
	}
	if len(target.ChannelIDs) == 0 {
		return nil, false, errors.New("target must specify all_channels or channel_ids")
	}
	for _, id := range target.ChannelIDs {
		if id <= 0 {
			return nil, false, errors.New("target channel_ids must be positive")
		}
	}
	return target.ChannelIDs, false, nil
}

// ListMetrics returns the registry of computed-metric definitions for the
// rule builder UI. Stable, sorted by metric ID.
func (h *AlertHandler) ListMetrics(w http.ResponseWriter, r *http.Request) {
writeJSON(w, http.StatusOK, ListMetricSummaries())
}

// previewComputedMetric handles the "kind=computed_metric" branch of TestRule.
// It builds a synthetic AlertRule from the request fields, calls the evaluator
// in preview mode (bypasses cooldown/snooze), and returns the computed value
// plus whether the configured operator+threshold would have matched.
func (h *AlertHandler) previewComputedMetric(w http.ResponseWriter, r *http.Request, body alertTestRequest) {
if h.computedEval == nil {
writeError(w, http.StatusServiceUnavailable, "computed-metric evaluator unavailable")
return
}
rule := &models.AlertRule{
Kind:            models.AlertRuleKindComputedMetric,
MetricID:        body.MetricID,
MetricWindow:    body.MetricWindow,
MetricOp:        body.MetricOp,
MetricThreshold: body.MetricThreshold,
CooldownMin:     1,
Severity:        "info",
TriggerMode:     "repeat",
Name:            "preview",
}
if err := validateComputedMetricRule(rule); err != nil {
writeError(w, http.StatusBadRequest, err.Error())
return
}
var vehicleID int64
if body.VehicleID != nil {
vehicleID = *body.VehicleID
}
res, matched, err := h.computedEval.Preview(r.Context(), rule, vehicleID)
if err != nil {
log.Error().Err(err).Str("metric_id", *rule.MetricID).Msg("preview computed metric failed")
writeError(w, http.StatusInternalServerError, "failed to compute metric")
return
}
resp := map[string]interface{}{
"kind":          models.AlertRuleKindComputedMetric,
"metric_id":     *rule.MetricID,
"metric_window": *rule.MetricWindow,
"metric_op":     *rule.MetricOp,
"threshold":     *rule.MetricThreshold,
"value":         res.Value,
"would_trigger": matched,
}
if IsPercentChangeOp(*rule.MetricOp) {
resp["previous_value"] = res.PreviousValue
resp["percent_change"] = res.PercentChange
}
writeJSON(w, http.StatusOK, resp)
}
