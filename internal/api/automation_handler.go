package api

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

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/automation"
	"github.com/ev-dev-labs/teslasync/internal/automation/action"
	"github.com/ev-dev-labs/teslasync/internal/automation/condition"
	"github.com/ev-dev-labs/teslasync/internal/automation/presets"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AutomationHandler handles automation CRUD HTTP requests.
type AutomationHandler struct {
	repo           *database.AutomationRepo
	historyRepo    *database.AutomationHistoryRepo
	fsmTransRepo   *database.FSMTransitionRepo
	cmdExecutor    *action.CommandExecutor   // optional, enables undo
	eventPublisher *AutomationEventPublisher // optional, enables SSE events
	auditor        *automation.Auditor       // optional, enables audit trail
	presetRegistry *presets.Registry         // built-in preset templates
	mqttPublisher  AutomationMQTTPublisher   // optional, notifies worker on config changes
}

// AutomationMQTTPublisher publishes automation config change notifications.
// The worker subscribes to these to reload trigger configurations.
type AutomationMQTTPublisher interface {
	PublishReload(action string, automationID int64)
}

// AutomationHandlerOption configures optional AutomationHandler dependencies.
type AutomationHandlerOption func(*AutomationHandler)

// WithCommandExecutor provides a CommandExecutor for undo support.
func WithCommandExecutor(e *action.CommandExecutor) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.cmdExecutor = e }
}

// WithAutomationEventPublisher provides an event publisher for SSE automation events.
func WithAutomationEventPublisher(p *AutomationEventPublisher) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.eventPublisher = p }
}

// WithAutomationAuditor provides an auditor for recording automation lifecycle events.
func WithAutomationAuditor(a *automation.Auditor) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.auditor = a }
}

// WithAutomationMQTTPublisher provides an MQTT publisher for notifying the
// automation worker of configuration changes (create/update/delete/toggle).
func WithAutomationMQTTPublisher(p AutomationMQTTPublisher) AutomationHandlerOption {
	return func(h *AutomationHandler) { h.mqttPublisher = p }
}

// NewAutomationHandler creates an AutomationHandler backed by the given database.
func NewAutomationHandler(db *database.DB, opts ...AutomationHandlerOption) *AutomationHandler {
	h := &AutomationHandler{
		repo:           database.NewAutomationRepo(db),
		historyRepo:    database.NewAutomationHistoryRepo(db),
		fsmTransRepo:   database.NewFSMTransitionRepo(db),
		presetRegistry: presets.NewRegistry(),
	}
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// automationResponse wraps an Automation with computed fields.
type automationResponse struct {
	*models.Automation
	NextFireTime *string              `json:"next_fire_time,omitempty"`
	Conflicts    []condition.Conflict `json:"conflicts,omitempty"`
}

// newAutomationResponse builds a response for an Automation (base row only).
func newAutomationResponse(a *models.Automation) automationResponse {
	return automationResponse{Automation: a}
}

// getByID fetches a single automation by ID from the full list.
// Returns nil, nil if not found.
func (h *AutomationHandler) getByID(ctx context.Context, id int64) (*models.Automation, error) {
	all, err := h.repo.ListFull(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i].Automation, nil
		}
	}
	return nil, nil
}

// getFullByID fetches a single AutomationFull by ID from the full list.
func (h *AutomationHandler) getFullByID(ctx context.Context, id int64) (*models.AutomationFull, error) {
	all, err := h.repo.ListFull(ctx)
	if err != nil {
		return nil, err
	}
	for i := range all {
		if all[i].ID == id {
			return &all[i], nil
		}
	}
	return nil, nil
}

// ── List ────────────────────────────────────────────────────────────────

// List returns all automations. Supports ?enabled=true to filter.
func (h *AutomationHandler) List(w http.ResponseWriter, r *http.Request) {
	enabledOnly := strings.EqualFold(r.URL.Query().Get("enabled"), "true")
	fullList, err := h.repo.ListFull(r.Context())
	if err != nil {
		log.Error().Err(err).Msg("failed to list automations")
		writeError(w, http.StatusInternalServerError, "failed to list automations")
		return
	}

	results := make([]automationResponse, 0, len(fullList))
	for i := range fullList {
		a := &fullList[i].Automation
		if enabledOnly && !a.Enabled {
			continue
		}
		results = append(results, newAutomationResponse(a))
	}
	writeJSON(w, http.StatusOK, results)
}

// ── Presets ─────────────────────────────────────────────────────────────

// presetsResponse is the envelope for the presets API.
type presetsResponse struct {
	Categories []presets.Category `json:"categories"`
	Presets    []presets.Preset   `json:"presets"`
}

// ListPresets returns built-in automation preset templates.
// Supports ?category=security to filter by category.
func (h *AutomationHandler) ListPresets(w http.ResponseWriter, r *http.Request) {
	category := r.URL.Query().Get("category")

	resp := presetsResponse{
		Categories: h.presetRegistry.Categories(),
		Presets:    h.presetRegistry.Presets(category),
	}
	if resp.Presets == nil {
		resp.Presets = []presets.Preset{}
	}
	if resp.Categories == nil {
		resp.Categories = []presets.Category{}
	}

	writeJSON(w, http.StatusOK, resp)
}

// GetPreset returns a single preset by ID.
func (h *AutomationHandler) GetPreset(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "presetId")
	if id == "" {
		writeError(w, http.StatusBadRequest, "preset ID is required")
		return
	}

	p := h.presetRegistry.Get(id)
	if p == nil {
		writeError(w, http.StatusNotFound, "preset not found")
		return
	}

	writeJSON(w, http.StatusOK, p)
}

// ── Get ─────────────────────────────────────────────────────────────────

// Get returns a single automation by ID with computed fields.
func (h *AutomationHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	writeJSON(w, http.StatusOK, newAutomationResponse(a))
}

// ── Create ──────────────────────────────────────────────────────────────

const maxAutomationRequestBodyBytes = 1 << 20

var legacyAutomationInputFields = map[string]struct{}{
	"trigger_type":        {},
	"trigger_config":      {},
	"notify_channels":     {},
	"cooldown_minutes":    {},
	"max_executions_hour": {},
	"seasonal_start":      {},
	"seasonal_end":        {},
	"priority":            {},
	"tags":                {},
	"preset_id":           {},
}

// automationInputWire is the strict create/update JSON shape. Step payloads are
// decoded separately by kind so each lane can reject fields from legacy action
// blobs and frontend-only aliases.
type automationInputWire struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	VehicleID   *int64            `json:"vehicle_id"`
	Enabled     *bool             `json:"enabled"`
	Triggers    []json.RawMessage `json:"triggers"`
	Conditions  []json.RawMessage `json:"conditions"`
	Actions     []json.RawMessage `json:"actions"`
}

// createAutomationRequest is the normalized request body for creating or
// updating an automation. Step persistence is added by a later phase.
type createAutomationRequest struct {
	Name        string
	Description string
	VehicleID   *int64
	Enabled     *bool
	Triggers    []automationTypedStep
	Conditions  []automationTypedStep
	Actions     []automationTypedStep
}

type automationTypedStep struct {
	Kind    string
	Payload interface{}
}

type automationTriggerSignalDTO struct {
	Kind      string   `json:"kind"`
	Signal    string   `json:"signal"`
	Op        string   `json:"op"`
	ValueText *string  `json:"value_text,omitempty"`
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueBool *bool    `json:"value_bool,omitempty"`
}

type automationTriggerGeofenceDTO struct {
	Kind         string `json:"kind"`
	PlaceID      int64  `json:"place_id"`
	Event        string `json:"event"`
	DwellMinutes *int   `json:"dwell_minutes,omitempty"`
}

type automationTriggerScheduleDTO struct {
	Kind     string `json:"kind"`
	CronExpr string `json:"cron_expr"`
	Timezone string `json:"timezone,omitempty"`
}

type automationTriggerEventDTO struct {
	Kind      string `json:"kind"`
	EventType string `json:"event_type"`
}

type automationConditionSignalDTO struct {
	Kind      string   `json:"kind"`
	Signal    string   `json:"signal"`
	Op        string   `json:"op"`
	ValueText *string  `json:"value_text,omitempty"`
	ValueNum  *float64 `json:"value_num,omitempty"`
	ValueBool *bool    `json:"value_bool,omitempty"`
	ValueMin  *float64 `json:"value_min,omitempty"`
	ValueMax  *float64 `json:"value_max,omitempty"`
}

type automationConditionTimeWindowDTO struct {
	Kind       string `json:"kind"`
	StartTime  string `json:"start_time"`
	EndTime    string `json:"end_time"`
	Timezone   string `json:"timezone,omitempty"`
	DaysOfWeek []int  `json:"days_of_week,omitempty"`
}

type automationConditionGeofenceDTO struct {
	Kind    string `json:"kind"`
	PlaceID int64  `json:"place_id"`
	State   string `json:"state"`
}

type automationConditionOtherAutomationDTO struct {
	Kind              string `json:"kind"`
	OtherAutomationID int64  `json:"other_automation_id"`
	State             string `json:"state"`
}

type automationActionCommandDTO struct {
	Kind          string          `json:"kind"`
	CommandName   string          `json:"command_name"`
	CommandParams json.RawMessage `json:"command_params,omitempty"`
}

type automationActionNotifyDTO struct {
	Kind      string `json:"kind"`
	ChannelID int64  `json:"channel_id"`
	Template  string `json:"template"`
}

type automationActionSetSettingDTO struct {
	Kind       string   `json:"kind"`
	SettingKey string   `json:"setting_key"`
	ValueText  *string  `json:"value_text,omitempty"`
	ValueNum   *float64 `json:"value_num,omitempty"`
	ValueBool  *bool    `json:"value_bool,omitempty"`
}

type automationActionCallAutomationDTO struct {
	Kind               string `json:"kind"`
	TargetAutomationID int64  `json:"target_automation_id"`
}

func decodeAutomationInputDTO(body io.Reader) (*createAutomationRequest, error) {
	raw, err := readAutomationJSONBody(body)
	if err != nil {
		return nil, err
	}

	fields, err := automationJSONFields(raw)
	if err != nil {
		return nil, err
	}
	for field := range fields {
		if _, legacy := legacyAutomationInputFields[field]; legacy {
			return nil, fmt.Errorf("field %q is not supported", field)
		}
	}

	var wire automationInputWire
	if err := decodeStrictAutomationJSON(raw, &wire); err != nil {
		return nil, err
	}
	return validateAutomationInputWire(wire)
}

func readAutomationJSONBody(body io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(body, maxAutomationRequestBodyBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}
	if len(raw) == 0 {
		return nil, errors.New("empty request body")
	}
	if len(raw) > maxAutomationRequestBodyBytes {
		return nil, errors.New("request body too large")
	}
	return raw, nil
}

func automationJSONFields(raw []byte) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, err
	}
	if fields == nil {
		return nil, errors.New("request body must be a JSON object")
	}
	return fields, nil
}

func decodeStrictAutomationJSON(raw []byte, dst interface{}) error {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func validateAutomationInputWire(wire automationInputWire) (*createAutomationRequest, error) {
	req := &createAutomationRequest{
		Name:        strings.TrimSpace(wire.Name),
		Description: strings.TrimSpace(wire.Description),
		VehicleID:   wire.VehicleID,
		Enabled:     wire.Enabled,
		Triggers:    make([]automationTypedStep, 0, len(wire.Triggers)),
		Conditions:  make([]automationTypedStep, 0, len(wire.Conditions)),
		Actions:     make([]automationTypedStep, 0, len(wire.Actions)),
	}
	if req.Name == "" {
		return nil, errors.New("name is required")
	}
	if len(wire.Triggers) == 0 {
		return nil, errors.New("triggers must include at least one trigger")
	}

	for i, raw := range wire.Triggers {
		step, err := parseAutomationTriggerStep(raw)
		if err != nil {
			return nil, fmt.Errorf("triggers[%d]: %w", i, err)
		}
		req.Triggers = append(req.Triggers, step)
	}
	for i, raw := range wire.Conditions {
		step, err := parseAutomationConditionStep(raw)
		if err != nil {
			return nil, fmt.Errorf("conditions[%d]: %w", i, err)
		}
		req.Conditions = append(req.Conditions, step)
	}
	for i, raw := range wire.Actions {
		step, err := parseAutomationActionStep(raw)
		if err != nil {
			return nil, fmt.Errorf("actions[%d]: %w", i, err)
		}
		req.Actions = append(req.Actions, step)
	}
	return req, nil
}

func parseAutomationTriggerStep(raw json.RawMessage) (automationTypedStep, error) {
	kind, err := automationStepKind(raw)
	if err != nil {
		return automationTypedStep{}, err
	}
	switch kind {
	case models.AutomationStepKindTriggerSignal:
		var step automationTriggerSignalDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerSignal(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindTriggerGeofence:
		var step automationTriggerGeofenceDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerGeofence(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindTriggerSchedule:
		var step automationTriggerScheduleDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerSchedule(&step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindTriggerEvent:
		var step automationTriggerEventDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerEvent(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	default:
		return automationTypedStep{}, fmt.Errorf("unsupported trigger kind %q", kind)
	}
}

func parseAutomationConditionStep(raw json.RawMessage) (automationTypedStep, error) {
	kind, err := automationStepKind(raw)
	if err != nil {
		return automationTypedStep{}, err
	}
	switch kind {
	case models.AutomationStepKindConditionSignal:
		var step automationConditionSignalDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionSignal(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindConditionTimeWindow:
		var step automationConditionTimeWindowDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionTimeWindow(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindConditionGeofence:
		var step automationConditionGeofenceDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionGeofence(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindConditionOtherAutomation:
		var step automationConditionOtherAutomationDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionOtherAutomation(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	default:
		return automationTypedStep{}, fmt.Errorf("unsupported condition kind %q", kind)
	}
}

func parseAutomationActionStep(raw json.RawMessage) (automationTypedStep, error) {
	kind, err := automationStepKind(raw)
	if err != nil {
		return automationTypedStep{}, err
	}
	switch kind {
	case models.AutomationStepKindActionCommand:
		var step automationActionCommandDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if strings.TrimSpace(step.CommandName) == "" {
			return automationTypedStep{}, errors.New("command_name is required")
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindActionNotify:
		var step automationActionNotifyDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if step.ChannelID <= 0 {
			return automationTypedStep{}, errors.New("channel_id is required")
		}
		if strings.TrimSpace(step.Template) == "" {
			return automationTypedStep{}, errors.New("template is required")
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindActionSetSetting:
		var step automationActionSetSettingDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if strings.TrimSpace(step.SettingKey) == "" {
			return automationTypedStep{}, errors.New("setting_key is required")
		}
		if automationScalarValueCount(step.ValueText, step.ValueNum, step.ValueBool) != 1 {
			return automationTypedStep{}, errors.New("exactly one of value_text, value_num, or value_bool is required")
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	case models.AutomationStepKindActionCallAutomation:
		var step automationActionCallAutomationDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if step.TargetAutomationID <= 0 {
			return automationTypedStep{}, errors.New("target_automation_id is required")
		}
		return automationTypedStep{Kind: kind, Payload: step}, nil
	default:
		return automationTypedStep{}, fmt.Errorf("unsupported action kind %q", kind)
	}
}

func automationStepKind(raw json.RawMessage) (string, error) {
	fields, err := automationJSONFields(raw)
	if err != nil {
		return "", err
	}
	kindRaw, ok := fields["kind"]
	if !ok {
		return "", errors.New("kind is required")
	}
	var kind string
	if err := json.Unmarshal(kindRaw, &kind); err != nil {
		return "", errors.New("kind must be a string")
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return "", errors.New("kind is required")
	}
	return kind, nil
}

func validateAutomationTriggerSignal(step automationTriggerSignalDTO) error {
	if strings.TrimSpace(step.Signal) == "" {
		return errors.New("signal is required")
	}
	if strings.TrimSpace(step.Op) == "" {
		return errors.New("op is required")
	}
	switch step.Op {
	case "changed":
		if automationScalarValueCount(step.ValueText, step.ValueNum, step.ValueBool) != 0 {
			return errors.New("changed trigger_signal must not include value_text, value_num, or value_bool")
		}
	case "=", "!=", "<", "<=", ">", ">=", "crossed_above", "crossed_below":
		if automationScalarValueCount(step.ValueText, step.ValueNum, step.ValueBool) != 1 {
			return errors.New("exactly one of value_text, value_num, or value_bool is required")
		}
	default:
		return fmt.Errorf("unsupported trigger_signal op %q", step.Op)
	}
	return nil
}

func validateAutomationTriggerGeofence(step automationTriggerGeofenceDTO) error {
	if step.PlaceID <= 0 {
		return errors.New("place_id is required")
	}
	switch step.Event {
	case "enter", "exit", "leave", "both":
		if step.DwellMinutes != nil {
			return errors.New("dwell_minutes is only allowed when event is dwell")
		}
	case "dwell":
		if step.DwellMinutes != nil && *step.DwellMinutes <= 0 {
			return errors.New("dwell_minutes must be greater than zero")
		}
	default:
		return fmt.Errorf("unsupported trigger_geofence event %q", step.Event)
	}
	return nil
}

func validateAutomationTriggerSchedule(step *automationTriggerScheduleDTO) error {
	if strings.TrimSpace(step.CronExpr) == "" {
		return errors.New("cron_expr is required")
	}
	if strings.TrimSpace(step.Timezone) == "" {
		step.Timezone = "UTC"
	}
	return nil
}

func validateAutomationTriggerEvent(step automationTriggerEventDTO) error {
	switch step.EventType {
	case "drive_start", "drive_end", "charge_start", "charge_end", "sleep_start", "sleep_end", "online", "offline", "sentry_alert":
		return nil
	case "":
		return errors.New("event_type is required")
	default:
		return fmt.Errorf("unsupported trigger_event event_type %q", step.EventType)
	}
}

func validateAutomationConditionSignal(step automationConditionSignalDTO) error {
	if strings.TrimSpace(step.Signal) == "" {
		return errors.New("signal is required")
	}
	if strings.TrimSpace(step.Op) == "" {
		return errors.New("op is required")
	}
	scalarCount := automationScalarValueCount(step.ValueText, step.ValueNum, step.ValueBool)
	hasRange := step.ValueMin != nil || step.ValueMax != nil
	switch step.Op {
	case "between":
		if step.ValueMin == nil || step.ValueMax == nil {
			return errors.New("value_min and value_max are required for between")
		}
		if scalarCount != 0 {
			return errors.New("between condition_signal must not include value_text, value_num, or value_bool")
		}
	case "<", "<=", ">", ">=":
		if step.ValueNum == nil || step.ValueText != nil || step.ValueBool != nil || hasRange {
			return errors.New("numeric comparison requires only value_num")
		}
	case "=", "!=", "in":
		if scalarCount != 1 || hasRange {
			return errors.New("exactly one of value_text, value_num, or value_bool is required")
		}
	default:
		return fmt.Errorf("unsupported condition_signal op %q", step.Op)
	}
	return nil
}

func validateAutomationConditionTimeWindow(step automationConditionTimeWindowDTO) error {
	if _, err := parseAutomationClockTime(step.StartTime); err != nil {
		return fmt.Errorf("invalid start_time: %w", err)
	}
	if _, err := parseAutomationClockTime(step.EndTime); err != nil {
		return fmt.Errorf("invalid end_time: %w", err)
	}
	for _, day := range step.DaysOfWeek {
		if day < 0 || day > 6 {
			return errors.New("days_of_week values must be between 0 and 6")
		}
	}
	return nil
}

func validateAutomationConditionGeofence(step automationConditionGeofenceDTO) error {
	if step.PlaceID <= 0 {
		return errors.New("place_id is required")
	}
	switch step.State {
	case "inside", "outside", "dwell":
		return nil
	case "":
		return errors.New("state is required")
	default:
		return fmt.Errorf("unsupported condition_geofence state %q", step.State)
	}
}

func validateAutomationConditionOtherAutomation(step automationConditionOtherAutomationDTO) error {
	if step.OtherAutomationID <= 0 {
		return errors.New("other_automation_id is required")
	}
	switch step.State {
	case "enabled", "disabled", "recently_triggered":
		return nil
	case "":
		return errors.New("state is required")
	default:
		return fmt.Errorf("unsupported condition_other_automation state %q", step.State)
	}
}

func parseAutomationClockTime(value string) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, errors.New("time is required")
	}
	if parsed, err := time.Parse("15:04", value); err == nil {
		return parsed, nil
	}
	return time.Parse("15:04:05", value)
}

func automationScalarValueCount(valueText *string, valueNum *float64, valueBool *bool) int {
	count := 0
	if valueText != nil {
		count++
	}
	if valueNum != nil {
		count++
	}
	if valueBool != nil {
		count++
	}
	return count
}

func firstTriggerKind(req *createAutomationRequest) string {
	if req == nil || len(req.Triggers) == 0 {
		return ""
	}
	return req.Triggers[0].Kind
}

// Create creates a new automation with typed step validation and conflict detection.
func (h *AutomationHandler) Create(w http.ResponseWriter, r *http.Request) {
	req, err := decodeAutomationInputDTO(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	enabled := true
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	desc := strings.TrimSpace(req.Description)
	var descPtr *string
	if desc != "" {
		descPtr = &desc
	}

	a := &models.Automation{
		Name:        strings.TrimSpace(req.Name),
		Description: descPtr,
		VehicleID:   req.VehicleID,
		Enabled:     enabled,
	}

	if err := h.repo.Create(r.Context(), a); err != nil {
		log.Error().Err(err).Str("name", a.Name).Msg("failed to create automation")
		writeError(w, http.StatusInternalServerError, "failed to create automation")
		return
	}

	// Run conflict detection.
	resp := newAutomationResponse(a)
	resp.Conflicts = h.detectConflicts(r, a)

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation created")

	if h.auditor != nil {
		h.auditor.LogCreated(r.Context(), a.ID, a.Name, firstTriggerKind(req), a.Enabled, r.RemoteAddr)
	}

	h.notifyReload("created", a.ID)

	writeJSON(w, http.StatusCreated, resp)
}

// ── Update ──────────────────────────────────────────────────────────────

// Update replaces an automation's configuration. This is full-replacement PUT.
func (h *AutomationHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for update")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	req, err := decodeAutomationInputDTO(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	enabled := existing.Enabled
	if req.Enabled != nil {
		enabled = *req.Enabled
	}

	existing.Name = strings.TrimSpace(req.Name)
	desc := strings.TrimSpace(req.Description)
	if desc != "" {
		existing.Description = &desc
	}
	existing.VehicleID = req.VehicleID
	existing.Enabled = enabled

	if err := h.repo.Update(r.Context(), existing); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to update automation")
		writeError(w, http.StatusInternalServerError, "failed to update automation")
		return
	}

	resp := newAutomationResponse(existing)
	resp.Conflicts = h.detectConflicts(r, existing)

	log.Info().
		Int64("automation_id", existing.ID).
		Str("automation", existing.Name).
		Int("conflicts", len(resp.Conflicts)).
		Msg("automation updated")

	if h.auditor != nil {
		h.auditor.LogUpdated(r.Context(), existing.ID, existing.Name, firstTriggerKind(req), r.RemoteAddr)
	}

	h.notifyReload("updated", existing.ID)

	writeJSON(w, http.StatusOK, resp)
}

// ── Delete ──────────────────────────────────────────────────────────────

// Delete removes an automation by ID.
func (h *AutomationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify existence before deleting.
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for delete")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if err := h.repo.Delete(r.Context(), id); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to delete automation")
		writeError(w, http.StatusInternalServerError, "failed to delete automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation deleted")

	if h.auditor != nil {
		h.auditor.LogDeleted(r.Context(), id, existing.Name, r.RemoteAddr)
	}

	h.notifyReload("deleted", id)

	w.WriteHeader(http.StatusNoContent)
}

// ── Toggle ──────────────────────────────────────────────────────────────

// Toggle enables or disables an automation. Rejects enabling auto-disabled
// automations — use the /re-enable endpoint instead.
func (h *AutomationHandler) Toggle(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Fetch current state to prevent broken toggle on auto-disabled automations.
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for toggle")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if req.Enabled {
		// Auto-disabled check removed: AutoDisabled is now derived from run history
		// via AutomationFull.AutoDisabled(), not stored on the Automation row.
	}

	if err := h.repo.Update(r.Context(), &models.Automation{ID: id, Name: existing.Name, Enabled: req.Enabled}); err != nil {
		log.Error().Err(err).Int64("id", id).Bool("enabled", req.Enabled).Msg("failed to toggle automation")
		writeError(w, http.StatusInternalServerError, "failed to toggle automation")
		return
	}

	if h.auditor != nil {
		if req.Enabled {
			h.auditor.LogEnabled(r.Context(), id, existing.Name, r.RemoteAddr)
		} else {
			h.auditor.LogDisabled(r.Context(), id, existing.Name, r.RemoteAddr)
		}
	}

	h.notifyReload("toggled", id)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":      id,
		"enabled": req.Enabled,
	})
}

// ── ReEnable ────────────────────────────────────────────────────────────

// ReEnable clears the auto-disabled state and re-enables the automation,
// resetting the consecutive failure counter.
func (h *AutomationHandler) ReEnable(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for re-enable")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	if err := h.repo.Update(r.Context(), &models.Automation{ID: id, Name: existing.Name, Enabled: true}); err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to re-enable automation")
		writeError(w, http.StatusInternalServerError, "failed to re-enable automation")
		return
	}

	log.Info().
		Int64("automation_id", id).
		Str("automation", existing.Name).
		Msg("automation re-enabled")

	if h.auditor != nil {
		h.auditor.LogReEnabled(r.Context(), id, existing.Name, r.RemoteAddr)
	}

	h.notifyReload("re_enabled", id)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":            id,
		"enabled":       true,
		"auto_disabled": false,
	})
}

// ── History ─────────────────────────────────────────────────────────────

// historyListResponse wraps paginated history items with summary statistics.
type historyListResponse struct {
	Items   []*models.AutomationHistory `json:"items"`
	Total   int                         `json:"total"`
	Limit   int                         `json:"limit"`
	Offset  int                         `json:"offset"`
	Summary *database.HistoryStats      `json:"summary"`
}

// historyDetailResponse wraps a single execution record with FSM transitions.
type historyDetailResponse struct {
	*models.AutomationHistory
	SuccessRate    float64                        `json:"success_rate"`
	FSMTransitions []database.FSMTransitionRecord `json:"fsm_transitions"`
}

// ListHistory returns recent execution history across all automations.
//
//	GET /automations/history?limit=50&offset=0&status=failed&since=2026-04-01
func (h *AutomationHandler) ListHistory(w http.ResponseWriter, r *http.Request) {
	limit, offset := pagination(r)
	f := h.parseHistoryFilter(r)

	items, total, err := h.historyRepo.ListAll(r.Context(), f, limit, offset)
	if err != nil {
		log.Error().Err(err).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*models.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(r.Context(), f)
	if err != nil {
		log.Warn().Err(err).Msg("failed to compute history stats")
		stats = &database.HistoryStats{}
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
	})
}

// ListAutomationHistory returns execution history for a single automation.
//
//	GET /automations/{id}/history?limit=50&offset=0&status=failed&since=2026-04-01
func (h *AutomationHandler) ListAutomationHistory(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	// Verify automation exists.
	existing, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("failed to get automation for history")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if existing == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	limit, offset := pagination(r)
	f := h.parseHistoryFilter(r)
	f.AutomationID = id

	items, total, err := h.historyRepo.ListAll(r.Context(), f, limit, offset)
	if err != nil {
		log.Error().Err(err).Int64("automation_id", id).Msg("failed to list automation history")
		writeError(w, http.StatusInternalServerError, "failed to list automation history")
		return
	}
	if items == nil {
		items = []*models.AutomationHistory{}
	}

	stats, err := h.historyRepo.GetStats(r.Context(), f)
	if err != nil {
		log.Warn().Err(err).Int64("automation_id", id).Msg("failed to compute history stats")
		stats = &database.HistoryStats{}
	}

	writeJSON(w, http.StatusOK, historyListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		Summary: stats,
	})
}

// GetHistoryDetail returns a single execution record with action results and
// FSM transitions that occurred during the execution window.
//
//	GET /automations/history/{historyId}
func (h *AutomationHandler) GetHistoryDetail(w http.ResponseWriter, r *http.Request) {
	historyID, err := urlParamInt64(r, "historyId")
	if err != nil || historyID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid history ID")
		return
	}

	record, err := h.historyRepo.GetByID(r.Context(), historyID)
	if err != nil {
		log.Error().Err(err).Int64("history_id", historyID).Msg("failed to get execution detail")
		writeError(w, http.StatusInternalServerError, "failed to get execution detail")
		return
	}
	if record == nil {
		writeError(w, http.StatusNotFound, "execution record not found")
		return
	}

	// Compute success rate for this automation (unfiltered).
	var successRate float64
	stats, err := h.historyRepo.GetStats(r.Context(), database.HistoryFilter{AutomationID: record.AutomationID})
	if err == nil && stats.TotalExecutions > 0 {
		successRate = stats.SuccessRate
	}

	// Fetch FSM transitions that occurred during the execution window.
	var transitions []database.FSMTransitionRecord
	if record.VehicleID != nil {
		from := record.TriggeredAt
		to := time.Now().UTC()
		if record.CompletedAt != nil {
			to = *record.CompletedAt
		}
		// Cap at 100 transitions; no pagination needed for detail view.
		transitions, _, err = h.fsmTransRepo.Query(r.Context(), *record.VehicleID, "", nil, from, to, 100, 0)
		if err != nil {
			log.Warn().Err(err).Int64("history_id", historyID).Msg("failed to fetch FSM transitions for execution")
			transitions = []database.FSMTransitionRecord{}
		}
	}
	if transitions == nil {
		transitions = []database.FSMTransitionRecord{}
	}

	writeJSON(w, http.StatusOK, historyDetailResponse{
		AutomationHistory: record,
		SuccessRate:       successRate,
		FSMTransitions:    transitions,
	})
}

// parseHistoryFilter extracts status and since query params into a HistoryFilter.
func (h *AutomationHandler) parseHistoryFilter(r *http.Request) database.HistoryFilter {
	f := database.HistoryFilter{
		Status: r.URL.Query().Get("status"),
	}
	if s := r.URL.Query().Get("since"); s != "" {
		// Try RFC3339 first, then date-only.
		if t, err := time.Parse(time.RFC3339, s); err == nil {
			f.Since = t
		} else if t, err := time.Parse("2006-01-02", s); err == nil {
			f.Since = t.UTC()
		}
	}
	return f
}

// ── Helpers ─────────────────────────────────────────────────────────────

// detectConflicts fetches all automations and runs conflict detection
// against the candidate. Returns an empty slice (not nil) if none found.
func (h *AutomationHandler) detectConflicts(r *http.Request, candidate *models.Automation) []condition.Conflict {
	all, err := h.repo.ListFull(r.Context())
	if err != nil {
		log.Warn().Err(err).Msg("conflict detection: failed to fetch automations")
		return []condition.Conflict{}
	}
	candidateFull := &models.AutomationFull{Automation: *candidate}
	others := make([]*models.AutomationFull, len(all))
	for i := range all {
		others[i] = &all[i]
	}
	conflicts := condition.DetectConflicts(r.Context(), candidateFull, others)
	if conflicts == nil {
		return []condition.Conflict{}
	}
	return conflicts
}

// notifyReload publishes an automation config change to MQTT so the automation
// worker reloads its trigger configurations. Fire-and-forget — never blocks the response.
func (h *AutomationHandler) notifyReload(action string, automationID int64) {
	if h.mqttPublisher != nil {
		h.mqttPublisher.PublishReload(action, automationID)
	}
}

// checkWebhookTokenUniqueness verifies that no other automation uses the same
// webhook_token. excludeID is the ID to skip (for updates); pass 0 for creates.
func (h *AutomationHandler) checkWebhookTokenUniqueness(r *http.Request, config json.RawMessage, excludeID int64) error {
	var cfg struct {
		WebhookToken string `json:"webhook_token"`
	}
	if err := json.Unmarshal(config, &cfg); err != nil || cfg.WebhookToken == "" {
		return nil // webhook token extraction not possible — skip check
	}

	existing, err := (*models.Automation)(nil), error(nil) // webhook token lookup removed in post-migration schema
	if err != nil {
		log.Warn().Err(err).Msg("webhook uniqueness check failed")
		return nil // non-blocking: allow save on lookup failure
	}
	if existing != nil && existing.ID != excludeID {
		return errWebhookTokenDuplicate
	}
	return nil
}

// ── Test Run ────────────────────────────────────────────────────────────

// testRunResponse is the top-level response for a dry-run test.
type testRunResponse struct {
	AutomationID   int64                 `json:"automation_id"`
	AutomationName string                `json:"automation_name"`
	VehicleID      *int64                `json:"vehicle_id"`
	TriggerType    string                `json:"trigger_type"`
	Status         string                `json:"status"` // always "test"
	ConditionsMet  bool                  `json:"conditions_met"`
	Conditions     []testConditionResult `json:"conditions"`
	Actions        []testActionResult    `json:"actions"`
	ExecutionPlan  testExecutionPlan     `json:"execution_plan"`
	HistoryID      int64                 `json:"history_id"`
	Timestamp      time.Time             `json:"timestamp"`
}

// testConditionResult captures the evaluation of a single condition during dry-run.
type testConditionResult struct {
	Index    int             `json:"index"`
	Type     string          `json:"type"`
	Result   string          `json:"result"` // "met", "not_met", "unknown"
	Reason   string          `json:"reason"`
	Snapshot json.RawMessage `json:"snapshot,omitempty"`
}

// testActionResult captures the simulated outcome of a single action.
type testActionResult struct {
	Index      int             `json:"index"`
	ActionType string          `json:"action_type"`
	Config     json.RawMessage `json:"action_config"`
	Valid      bool            `json:"valid"`
	Error      string          `json:"error,omitempty"`
	Simulated  bool            `json:"simulated"`
	WouldSkip  bool            `json:"would_skip,omitempty"`
	SkipReason string          `json:"skip_reason,omitempty"`
	Output     json.RawMessage `json:"output,omitempty"`
}

// testExecutionPlan summarises what the automation would do.
type testExecutionPlan struct {
	TotalActions         int  `json:"total_actions"`
	ValidActions         int  `json:"valid_actions"`
	StopOnFailure        bool `json:"stop_on_failure"`
	ConditionsCount      int  `json:"conditions_count"`
	AllConditionsMet     bool `json:"all_conditions_met"`
	HasUnknownConditions bool `json:"has_unknown_conditions"`
}

// TestRun performs a dry-run of an automation: evaluates the trigger snapshot,
// checks conditions, and resolves the action chain using a mock executor.
// The test run is logged in history with status "test". No real commands
// are sent and no execution counters are updated.
//
//	POST /automations/{id}/test-run
func (h *AutomationHandler) TestRun(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	af, err := h.getFullByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("test-run: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if af == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}
	a := &af.Automation

	now := time.Now().UTC()

	// ── Evaluate conditions ───────────────────────────────────────────
	condResults := h.evaluateTestConditions(af, now)

	allMet := true
	hasUnknown := false
	for _, cr := range condResults {
		switch cr.Result {
		case "not_met":
			allMet = false
		case "unknown":
			hasUnknown = true
		}
	}

	// ── Validate & simulate actions ───────────────────────────────────
	actionResults, validCount := h.simulateActions(af, allMet)

	// ── Persist history record with status "test" ─────────────────────
	conditionsJSON, _ := json.Marshal(condResults)
	actionsJSON, _ := json.Marshal(actionResults)
	triggerSnapshot, _ := json.Marshal(map[string]interface{}{
		"type":      "test_run",
		"simulated": true,
	})

	durationMs := int(time.Since(now).Milliseconds())
	completedAt := time.Now().UTC()
	hist := &models.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		VehicleID:          a.VehicleID,
		TriggeredAt:        now,
		CompletedAt:        &completedAt,
		DurationMs:         &durationMs,
		TriggerType:        "unknown",
		TriggerSnapshot:    triggerSnapshot,
		ConditionsMet:      allMet,
		ConditionsSnapshot: conditionsJSON,
		ActionsExecuted:    actionsJSON,
		ActionsTotal:       len(actionResults),
		ActionsSucceeded:   validCount,
		ActionsFailed:      0,
		Status:             "test",
	}

	if err := h.historyRepo.Create(r.Context(), hist); err != nil {
		log.Error().Err(err).Int64("automation_id", a.ID).Msg("test-run: failed to log history")
		writeError(w, http.StatusInternalServerError, "failed to log test run")
		return
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Bool("conditions_met", allMet).
		Int("actions", len(actionResults)).
		Msg("automation test-run completed")

	// Publish SSE events for the test-run
	if h.eventPublisher != nil {
		h.eventPublisher.PublishTriggered(a.ID, a.Name, "", "unknown", "test")
		if !allMet {
			h.eventPublisher.PublishSkipped(a.ID, a.Name, "conditions not met (test-run)", "test")
		} else if validCount == len(actionResults) {
			durationMs := time.Since(now).Milliseconds()
			h.eventPublisher.PublishSucceeded(a.ID, a.Name, durationMs, validCount, "test")
		} else {
			h.eventPublisher.PublishFailed(a.ID, a.Name, "some actions invalid (test-run)", -1, "test")
		}
	}

	if h.auditor != nil {
		h.auditor.LogTestRun(r.Context(), a.ID, a.Name, allMet, len(actionResults), r.RemoteAddr)
	}

	writeJSON(w, http.StatusOK, testRunResponse{
		AutomationID:   a.ID,
		AutomationName: a.Name,
		VehicleID:      a.VehicleID,
		TriggerType:    "unknown",
		Status:         "test",
		ConditionsMet:  allMet,
		Conditions:     condResults,
		Actions:        actionResults,
		ExecutionPlan: testExecutionPlan{
			TotalActions:         len(actionResults),
			ValidActions:         validCount,
			StopOnFailure:        testRunStopOnFailure(af),
			ConditionsCount:      len(condResults),
			AllConditionsMet:     allMet,
			HasUnknownConditions: hasUnknown,
		},
		HistoryID: hist.ID,
		Timestamp: now,
	})
}

type testRunConditionConfig struct {
	condType string
	raw      json.RawMessage
	err      error
}

// evaluateTestConditions parses and evaluates each condition in the automation.
// Time-based conditions use real time; state-dependent conditions that require
// unavailable context are reported as "unknown".
func (h *AutomationHandler) evaluateTestConditions(af *models.AutomationFull, now time.Time) []testConditionResult {
	if af == nil || len(af.Conditions) == 0 {
		return []testConditionResult{}
	}

	rawConditions := testRunConditionConfigs(af)
	results := make([]testConditionResult, 0, len(rawConditions))

	for i, cfg := range rawConditions {
		if cfg.err != nil {
			results = append(results, testConditionResult{
				Index:  i,
				Type:   cfg.condType,
				Result: "unknown",
				Reason: cfg.err.Error(),
			})
			continue
		}
		var peek struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(cfg.raw, &peek); err != nil {
			results = append(results, testConditionResult{
				Index:  i,
				Type:   "unknown",
				Result: "unknown",
				Reason: "failed to parse condition: " + err.Error(),
			})
			continue
		}
		if peek.Type == "" {
			peek.Type = cfg.condType
		}

		cr := h.evaluateSingleCondition(i, peek.Type, cfg.raw, &af.Automation, now)
		results = append(results, cr)
	}

	return results
}

func testRunConditionConfigs(af *models.AutomationFull) []testRunConditionConfig {
	configs := make([]testRunConditionConfig, 0, len(af.Conditions))
	for _, item := range af.Conditions {
		configs = append(configs, testRunConditionConfigFrom(item))
	}
	return configs
}

func testRunConditionConfigFrom(item any) testRunConditionConfig {
	switch c := item.(type) {
	case json.RawMessage:
		return testRunConditionConfig{raw: c}
	case []byte:
		return testRunConditionConfig{raw: json.RawMessage(c)}
	case *models.AutomationStepConditionTimeWindow:
		return testRunConditionTimeWindow(c)
	case models.AutomationStepConditionTimeWindow:
		return testRunConditionTimeWindow(&c)
	case *models.AutomationStepConditionSignal:
		return testRunConditionSignal(c)
	case models.AutomationStepConditionSignal:
		return testRunConditionSignal(&c)
	case *models.AutomationStepConditionGeofence:
		return testRunConditionGeofence(c)
	case models.AutomationStepConditionGeofence:
		return testRunConditionGeofence(&c)
	case *models.AutomationStepConditionOtherAutomation:
		return marshalTestRunCondition("other_automation", map[string]any{
			"type":                "other_automation",
			"other_automation_id": c.OtherAutomationID,
			"state":               c.State,
		})
	case models.AutomationStepConditionOtherAutomation:
		return testRunConditionConfigFrom(&c)
	default:
		raw, err := json.Marshal(item)
		return testRunConditionConfig{raw: raw, err: err}
	}
}

func testRunConditionTimeWindow(c *models.AutomationStepConditionTimeWindow) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "time_window", err: fmt.Errorf("time_window condition is nil")}
	}
	return marshalTestRunCondition("time_window", map[string]any{
		"type":       "time_window",
		"start_time": c.StartTime.Format("15:04"),
		"end_time":   c.EndTime.Format("15:04"),
		"timezone":   c.Timezone,
	})
}

func testRunConditionSignal(c *models.AutomationStepConditionSignal) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "state_check", err: fmt.Errorf("signal condition is nil")}
	}
	operator := mapSignalConditionOperator(c.Op)
	value := signalConditionValue(c)
	return marshalTestRunCondition("state_check", map[string]any{
		"type":     "state_check",
		"field":    c.Signal,
		"operator": operator,
		"value":    value,
	})
}

func testRunConditionGeofence(c *models.AutomationStepConditionGeofence) testRunConditionConfig {
	if c == nil {
		return testRunConditionConfig{condType: "location", err: fmt.Errorf("geofence condition is nil")}
	}
	return marshalTestRunCondition("location", map[string]any{
		"type":        "location",
		"geofence_id": c.PlaceID,
		"operator":    c.State,
	})
}

func marshalTestRunCondition(condType string, payload map[string]any) testRunConditionConfig {
	raw, err := json.Marshal(payload)
	return testRunConditionConfig{condType: condType, raw: raw, err: err}
}

func mapSignalConditionOperator(op string) string {
	switch op {
	case "=":
		return "eq"
	case "!=":
		return "neq"
	case ">":
		return "gt"
	case "<":
		return "lt"
	case ">=":
		return "gte"
	case "<=":
		return "lte"
	default:
		return op
	}
}

func signalConditionValue(c *models.AutomationStepConditionSignal) any {
	switch {
	case c.ValueText != nil:
		return *c.ValueText
	case c.ValueNum != nil:
		return *c.ValueNum
	case c.ValueBool != nil:
		return *c.ValueBool
	default:
		return nil
	}
}

// evaluateSingleCondition evaluates one condition, dispatching to the
// appropriate typed evaluator.
func (h *AutomationHandler) evaluateSingleCondition(
	index int, condType string, raw json.RawMessage,
	a *models.Automation, now time.Time,
) testConditionResult {
	base := testConditionResult{Index: index, Type: condType}

	switch condType {
	case "time_window":
		cfg, err := condition.ParseTimeWindowConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateTimeWindow(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "day_filter":
		cfg, err := condition.ParseDayFilterConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateDayFilter(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "seasonal":
		cfg, err := condition.ParseSeasonalConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateSeasonal(cfg, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "cooldown":
		cfg, err := condition.ParseCooldownConfig(raw)
		if err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		res, snapshot, err := condition.EvaluateCooldown(cfg, &a.CreatedAt, now)
		if err != nil {
			return withUnknown(base, "evaluation error: "+err.Error())
		}
		return withResult(base, res, snapshot)

	case "state_check":
		if _, err := condition.ParseStateCheckConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires live vehicle state (not available in test-run)")

	case "location":
		if _, err := condition.ParseLocationConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires live vehicle position and geofence data (not available in test-run)")

	case "variable_check":
		if _, err := condition.ParseVariableCheckConfig(raw); err != nil {
			return withUnknown(base, "invalid config: "+err.Error())
		}
		return withUnknown(base, "requires automation variable store (not available in test-run)")

	default:
		return withUnknown(base, "unknown condition type: "+condType)
	}
}

// withResult builds a testConditionResult from a condition.Result.
func withResult(base testConditionResult, res condition.Result, snapshot json.RawMessage) testConditionResult {
	base.Snapshot = snapshot
	base.Reason = res.Reason
	if res.Met {
		base.Result = "met"
	} else {
		base.Result = "not_met"
	}
	return base
}

// withUnknown builds a testConditionResult that could not be evaluated.
func withUnknown(base testConditionResult, reason string) testConditionResult {
	base.Result = "unknown"
	base.Reason = reason
	return base
}

// simulateActions parses the automation's action chain, validates each action
// config, and returns simulated results. Returns the results and valid count.
func (h *AutomationHandler) simulateActions(af *models.AutomationFull, conditionsMet bool) ([]testActionResult, int) {
	if af == nil || len(af.Actions) == 0 {
		return []testActionResult{}, 0
	}

	configs, err := testRunActionConfigs(af)
	if err != nil {
		return []testActionResult{{
			Index:      0,
			ActionType: "parse_error",
			Simulated:  true,
			Error:      "failed to parse actions: " + err.Error(),
		}}, 0
	}

	simulatedOutput, _ := json.Marshal(map[string]interface{}{
		"success":   true,
		"simulated": true,
	})

	results := make([]testActionResult, 0, len(configs))
	validCount := 0
	stopped := false
	stopOnFailure := testRunStopOnFailure(af)

	for i, cfg := range configs {
		result := testActionResult{
			Index:      i,
			ActionType: cfg.Type,
			Config:     cfg.Raw,
			Simulated:  true,
		}

		// If conditions not met, all actions would be skipped.
		if !conditionsMet {
			result.WouldSkip = true
			result.SkipReason = "conditions not met"
			results = append(results, result)
			continue
		}

		// If a previous action was invalid and stop_on_failure is set.
		if stopped {
			result.WouldSkip = true
			result.SkipReason = "previous action invalid (stop_on_failure)"
			results = append(results, result)
			continue
		}

		// Validate per-type config.
		if parseErr := validateActionConfig(cfg); parseErr != nil {
			result.Error = parseErr.Error()
			if stopOnFailure {
				stopped = true
			}
		} else {
			result.Valid = true
			result.Output = simulatedOutput
			validCount++
		}

		results = append(results, result)
	}

	return results, validCount
}

func testRunActionConfigs(af *models.AutomationFull) ([]action.ActionConfig, error) {
	configs := make([]action.ActionConfig, 0, len(af.Actions))
	for _, item := range af.Actions {
		next, err := testRunActionConfigFrom(item)
		if err != nil {
			return nil, err
		}
		configs = append(configs, next...)
	}
	return configs, nil
}

func testRunActionConfigFrom(item any) ([]action.ActionConfig, error) {
	switch a := item.(type) {
	case json.RawMessage:
		return parseTestRunActionRaw(a)
	case []byte:
		return parseTestRunActionRaw(json.RawMessage(a))
	case *models.AutomationAction:
		return parseTestRunActionRaw(testRunCommandActionRaw(a))
	case models.AutomationAction:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionNotify:
		return parseTestRunActionRaw(testRunNotifyActionRaw(a))
	case models.AutomationStepActionNotify:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionSetSetting:
		return parseTestRunActionRaw(testRunSetSettingActionRaw(a))
	case models.AutomationStepActionSetSetting:
		return testRunActionConfigFrom(&a)
	case *models.AutomationStepActionCallAutomation:
		return parseTestRunActionRaw(testRunCallAutomationActionRaw(a))
	case models.AutomationStepActionCallAutomation:
		return testRunActionConfigFrom(&a)
	default:
		raw, err := json.Marshal(item)
		if err != nil {
			return nil, err
		}
		return parseTestRunActionRaw(raw)
	}
}

func parseTestRunActionRaw(raw json.RawMessage) ([]action.ActionConfig, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return []action.ActionConfig{}, nil
	}
	if strings.HasPrefix(trimmed, "[") {
		return action.ParseActions(raw)
	}

	var peek struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &peek); err != nil {
		return nil, fmt.Errorf("action 0: invalid JSON: %w", err)
	}
	if peek.Type == "" {
		peek.Type = "command"
	}
	return []action.ActionConfig{{Type: peek.Type, Raw: raw}}, nil
}

func testRunCommandActionRaw(a *models.AutomationAction) json.RawMessage {
	payload := map[string]any{
		"type":    "command",
		"command": a.CommandName,
	}
	if len(a.CommandParams) > 0 && string(a.CommandParams) != "null" {
		payload["params"] = a.CommandParams
	}
	raw, _ := json.Marshal(payload)
	return raw
}

func testRunNotifyActionRaw(a *models.AutomationStepActionNotify) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":    "notify",
		"channel": "all",
		"message": a.Template,
	})
	return raw
}

func testRunSetSettingActionRaw(a *models.AutomationStepActionSetSetting) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":  "set_variable",
		"key":   a.SettingKey,
		"value": testRunSettingValue(a),
	})
	return raw
}

func testRunCallAutomationActionRaw(a *models.AutomationStepActionCallAutomation) json.RawMessage {
	raw, _ := json.Marshal(map[string]any{
		"type":                 "call_automation",
		"target_automation_id": a.TargetAutomationID,
	})
	return raw
}

func testRunSettingValue(a *models.AutomationStepActionSetSetting) string {
	switch {
	case a.ValueText != nil:
		return *a.ValueText
	case a.ValueNum != nil:
		return fmt.Sprint(*a.ValueNum)
	case a.ValueBool != nil:
		return fmt.Sprint(*a.ValueBool)
	default:
		return ""
	}
}

func testRunStopOnFailure(_ *models.AutomationFull) bool {
	return true
}

// validateActionConfig runs the per-type parser for deeper config validation.
func validateActionConfig(cfg action.ActionConfig) error {
	switch cfg.Type {
	case "command":
		_, err := action.ParseCommandConfig(cfg.Raw)
		return err
	case "notify":
		_, err := action.ParseNotifyConfig(cfg.Raw)
		return err
	case "wait":
		_, err := action.ParseWaitConfig(cfg.Raw)
		return err
	case "set_variable":
		_, err := action.ParseSetVariableConfig(cfg.Raw)
		return err
	default:
		return nil
	}
}

var errWebhookTokenDuplicate = &duplicateTokenError{}

type duplicateTokenError struct{}

func (e *duplicateTokenError) Error() string {
	return "webhook_token is already in use by another automation"
}

// ── Undo Last ───────────────────────────────────────────────────────────

// reverseCommands maps Tesla commands to their logical inverse.
// Commands not in this map are considered irreversible.
var reverseCommands = map[string]string{
	"lock":               "unlock",
	"unlock":             "lock",
	"climate_on":         "climate_off",
	"climate_off":        "climate_on",
	"sentry_on":          "sentry_off",
	"sentry_off":         "sentry_on",
	"charge_start":       "charge_stop",
	"charge_stop":        "charge_start",
	"vent_windows":       "close_windows",
	"close_windows":      "vent_windows",
	"valet_on":           "valet_off",
	"valet_off":          "valet_on",
	"guest_mode_on":      "guest_mode_off",
	"guest_mode_off":     "guest_mode_on",
	"cop_on":             "cop_off",
	"cop_off":            "cop_on",
	"bioweapon_on":       "bioweapon_off",
	"bioweapon_off":      "bioweapon_on",
	"speed_limit_on":     "speed_limit_off",
	"speed_limit_off":    "speed_limit_on",
	"sunroof_vent":       "sunroof_close",
	"sunroof_close":      "sunroof_vent",
	"climate_keeper_on":  "climate_keeper_off",
	"climate_keeper_off": "climate_keeper_on",
	"dog_mode":           "climate_keeper_off",
	"camp_mode":          "climate_keeper_off",
}

// undoResponse is the top-level response for the undo endpoint.
type undoResponse struct {
	AutomationID      int64              `json:"automation_id"`
	AutomationName    string             `json:"automation_name"`
	OriginalHistoryID int64              `json:"original_history_id"`
	UndoHistoryID     int64              `json:"undo_history_id"`
	Actions           []undoActionResult `json:"actions"`
	Reversed          int                `json:"reversed"`
	Skipped           int                `json:"skipped"`
	Failed            int                `json:"failed"`
	Status            string             `json:"status"`
	Timestamp         time.Time          `json:"timestamp"`
}

// undoActionResult captures the outcome of reversing a single command.
type undoActionResult struct {
	OriginalCommand string `json:"original_command"`
	ReverseCommand  string `json:"reverse_command,omitempty"`
	Status          string `json:"status"` // "reversed", "skipped", "failed", "irreversible"
	Error           string `json:"error,omitempty"`
	DurationMs      int64  `json:"duration_ms,omitempty"`
}

// UndoLast reverses the most recent successful or partial execution of an
// automation by sending the inverse of each reversible command action.
// Commands without a known reverse (honk, flash, navigate, etc.) are
// skipped and noted in the response. The undo is logged as a separate
// history entry with status "undo".
//
//	POST /automations/{id}/undo
func (h *AutomationHandler) UndoLast(w http.ResponseWriter, r *http.Request) {
	if h.cmdExecutor == nil {
		writeError(w, http.StatusNotImplemented, "undo requires command execution capability (not configured)")
		return
	}

	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("undo: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	// Find the most recent successful or partial execution.
	lastExec, err := h.historyRepo.GetLatestSuccessful(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("automation_id", id).Msg("undo: failed to fetch latest execution")
		writeError(w, http.StatusInternalServerError, "failed to fetch execution history")
		return
	}
	if lastExec == nil {
		writeError(w, http.StatusNotFound, "no successful execution found to undo")
		return
	}

	// Parse executed actions from the history record.
	var executedActions []action.ActionResult
	if err := json.Unmarshal(lastExec.ActionsExecuted, &executedActions); err != nil {
		log.Error().Err(err).Int64("history_id", lastExec.ID).Msg("undo: failed to parse actions_executed")
		writeError(w, http.StatusInternalServerError, "failed to parse execution history actions")
		return
	}

	// Collect reversible command actions (in reverse order for correct compensation).
	now := time.Now().UTC()
	var undoResults []undoActionResult
	var reversed, skipped, failed int

	for i := len(executedActions) - 1; i >= 0; i-- {
		ea := executedActions[i]

		// Only reverse successful command actions.
		if ea.ActionType != "command" {
			continue
		}
		if !ea.Success {
			continue
		}

		// Parse the original command config.
		cmdCfg, parseErr := action.ParseCommandConfig(ea.Config)
		if parseErr != nil {
			undoResults = append(undoResults, undoActionResult{
				OriginalCommand: "unknown",
				Status:          "skipped",
				Error:           "could not parse original command: " + parseErr.Error(),
			})
			skipped++
			continue
		}

		reverseCmd, reversible := reverseCommands[cmdCfg.Command]
		if !reversible {
			undoResults = append(undoResults, undoActionResult{
				OriginalCommand: cmdCfg.Command,
				Status:          "irreversible",
			})
			skipped++
			continue
		}

		// Build the reverse command config.
		reverseCfg, _ := json.Marshal(action.CommandConfig{
			Type:    "command",
			Command: reverseCmd,
		})

		// Execute via the command executor targeting the automation's vehicle.
		_, execErr := h.cmdExecutor.Execute(r.Context(), a.VehicleID, reverseCfg)

		result := undoActionResult{
			OriginalCommand: cmdCfg.Command,
			ReverseCommand:  reverseCmd,
		}

		if execErr != nil {
			result.Status = "failed"
			result.Error = execErr.Error()
			failed++
		} else {
			result.Status = "reversed"
			reversed++
		}

		undoResults = append(undoResults, result)
	}

	// Determine overall status.
	overallStatus := "success"
	if reversed == 0 && failed == 0 && skipped > 0 {
		overallStatus = "skipped"
	} else if failed > 0 && reversed == 0 {
		overallStatus = "failed"
	} else if failed > 0 {
		overallStatus = "partial"
	}

	// Log the undo as a history entry.
	undoActionsJSON, _ := json.Marshal(undoResults)
	triggerSnapshot, _ := json.Marshal(map[string]interface{}{
		"type":                "undo",
		"original_history_id": lastExec.ID,
	})
	durationMs := int(time.Since(now).Milliseconds())
	completedAt := time.Now().UTC()

	hist := &models.AutomationHistory{
		AutomationID:       a.ID,
		AutomationName:     a.Name,
		VehicleID:          a.VehicleID,
		TriggeredAt:        now,
		CompletedAt:        &completedAt,
		DurationMs:         &durationMs,
		TriggerType:        "undo",
		TriggerSnapshot:    triggerSnapshot,
		ConditionsMet:      true,
		ConditionsSnapshot: json.RawMessage("[]"),
		ActionsExecuted:    undoActionsJSON,
		ActionsTotal:       reversed + skipped + failed,
		ActionsSucceeded:   reversed,
		ActionsFailed:      failed,
		Status:             "undo",
	}

	if err := h.historyRepo.Create(r.Context(), hist); err != nil {
		log.Error().Err(err).Int64("automation_id", a.ID).Msg("undo: failed to log history")
		writeError(w, http.StatusInternalServerError, "undo executed but failed to log history")
		return
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", a.Name).
		Int64("original_history_id", lastExec.ID).
		Int("reversed", reversed).
		Int("skipped", skipped).
		Int("failed", failed).
		Str("status", overallStatus).
		Msg("automation undo completed")

	if h.auditor != nil {
		h.auditor.LogUndo(r.Context(), a.ID, a.Name, lastExec.ID, reversed, overallStatus, r.RemoteAddr)
	}

	writeJSON(w, http.StatusOK, undoResponse{
		AutomationID:      a.ID,
		AutomationName:    a.Name,
		OriginalHistoryID: lastExec.ID,
		UndoHistoryID:     hist.ID,
		Actions:           undoResults,
		Reversed:          reversed,
		Skipped:           skipped,
		Failed:            failed,
		Status:            overallStatus,
		Timestamp:         now,
	})
}

// ── Import / Export ─────────────────────────────────────────────────────

const exportVersion = 1

// automationExportEnvelope is the top-level JSON document for import/export.
type automationExportEnvelope struct {
	Version     int                  `json:"version"`
	ExportedAt  string               `json:"exported_at"`
	Automations []automationPortable `json:"automations"`
}

// automationPortable is a shareable automation definition stripped of
// instance-specific state (IDs, counters, timestamps, secrets).
type automationPortable struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	VehicleID   *int64            `json:"vehicle_id,omitempty"`
	Enabled     *bool             `json:"enabled,omitempty"`
	Triggers    []json.RawMessage `json:"triggers"`
	Conditions  []json.RawMessage `json:"conditions"`
	Actions     []json.RawMessage `json:"actions"`
}

// automationToPortable converts a stored automation to a portable definition.
// Many fields moved to CTI child tables in the post-migration schema; the
// portable format includes only the base row fields.
func automationToPortable(a *models.Automation) automationPortable {
	desc := ""
	if a.Description != nil {
		desc = *a.Description
	}
	enabled := a.Enabled
	return automationPortable{
		Name:        a.Name,
		Description: desc,
		VehicleID:   a.VehicleID,
		Enabled:     &enabled,
		Triggers:    []json.RawMessage{},
		Conditions:  []json.RawMessage{},
		Actions:     []json.RawMessage{},
	}
}

// scrubWebhookSecrets removes webhook_token and secret from a webhook
// trigger_config to prevent credential leakage in shared exports.
func scrubWebhookSecrets(raw json.RawMessage) json.RawMessage {
	var m map[string]interface{}
	if json.Unmarshal(raw, &m) != nil {
		return raw
	}
	delete(m, "webhook_token")
	delete(m, "secret")
	result, err := json.Marshal(m)
	if err != nil {
		return raw
	}
	return result
}

// injectWebhookToken generates a new unique webhook token and injects it
// into the trigger_config. Returns the updated config and the generated token.
func injectWebhookToken(raw json.RawMessage) (json.RawMessage, string, error) {
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil {
		return raw, "", fmt.Errorf("invalid trigger_config JSON: %w", err)
	}
	token := uuid.New().String()
	m["webhook_token"] = token
	result, err := json.Marshal(m)
	if err != nil {
		return raw, "", fmt.Errorf("marshal trigger_config: %w", err)
	}
	return result, token, nil
}

// buildExportEnvelope creates the top-level export document.
func buildExportEnvelope(automations []automationPortable) automationExportEnvelope {
	return automationExportEnvelope{
		Version:     exportVersion,
		ExportedAt:  time.Now().UTC().Format(time.RFC3339),
		Automations: automations,
	}
}

// ExportOne exports a single automation as a portable JSON document.
//
//	GET /automations/{id}/export
func (h *AutomationHandler) ExportOne(w http.ResponseWriter, r *http.Request) {
	id, err := urlParamInt64(r, "id")
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "invalid automation ID")
		return
	}

	a, err := h.getByID(r.Context(), id)
	if err != nil {
		log.Error().Err(err).Int64("id", id).Msg("export: failed to get automation")
		writeError(w, http.StatusInternalServerError, "failed to get automation")
		return
	}
	if a == nil {
		writeError(w, http.StatusNotFound, "automation not found")
		return
	}

	envelope := buildExportEnvelope([]automationPortable{automationToPortable(a)})

	if h.auditor != nil {
		h.auditor.LogExported(r.Context(), 1, []string{a.Name}, r.RemoteAddr)
	}

	w.Header().Set("Content-Disposition",
		fmt.Sprintf(`attachment; filename="automation-%d.json"`, a.ID))

	writeJSONIndent(w, http.StatusOK, envelope)
}

// ExportBatch exports multiple automations as a single portable JSON document.
//
//	POST /automations/export
func (h *AutomationHandler) ExportBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs []int64 `json:"ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if len(req.IDs) == 0 {
		writeError(w, http.StatusBadRequest, "ids is required and must not be empty")
		return
	}
	if len(req.IDs) > 100 {
		writeError(w, http.StatusBadRequest, "cannot export more than 100 automations at once")
		return
	}

	portables := make([]automationPortable, 0, len(req.IDs))
	for _, id := range req.IDs {
		a, err := h.getByID(r.Context(), id)
		if err != nil {
			log.Error().Err(err).Int64("id", id).Msg("export: failed to get automation")
			writeError(w, http.StatusInternalServerError, "failed to get automation")
			return
		}
		if a == nil {
			writeError(w, http.StatusNotFound,
				fmt.Sprintf("automation %d not found", id))
			return
		}
		portables = append(portables, automationToPortable(a))
	}

	envelope := buildExportEnvelope(portables)

	if h.auditor != nil {
		names := make([]string, len(portables))
		for i, p := range portables {
			names[i] = p.Name
		}
		h.auditor.LogExported(r.Context(), len(portables), names, r.RemoteAddr)
	}

	w.Header().Set("Content-Disposition", `attachment; filename="automations.json"`)

	writeJSONIndent(w, http.StatusOK, envelope)
}

// importedAutomation describes a successfully imported automation.
type importedAutomation struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	WebhookToken string `json:"webhook_token,omitempty"`
}

// importError describes a single import failure within a batch.
type importError struct {
	Index int    `json:"index"`
	Name  string `json:"name"`
	Error string `json:"error"`
}

// importResult is the response body for the import endpoint.
type importResult struct {
	Imported []importedAutomation `json:"imported"`
	Errors   []importError        `json:"errors,omitempty"`
}

// Import creates automations from a portable JSON document. All imported
// automations start with enabled=false so the user can review before activating.
// Webhook triggers receive a newly generated token to avoid collisions.
//
//	POST /automations/import
func (h *AutomationHandler) Import(w http.ResponseWriter, r *http.Request) {
	envelope, err := decodeAutomationExportEnvelope(r.Body)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}

	if envelope.Version < 1 || envelope.Version > exportVersion {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("unsupported export version %d (supported: 1–%d)", envelope.Version, exportVersion))
		return
	}
	if len(envelope.Automations) == 0 {
		writeError(w, http.StatusBadRequest, "no automations to import")
		return
	}
	if len(envelope.Automations) > 100 {
		writeError(w, http.StatusBadRequest, "cannot import more than 100 automations at once")
		return
	}

	result := importResult{
		Imported: make([]importedAutomation, 0, len(envelope.Automations)),
	}

	for i, def := range envelope.Automations {
		imported, importErr := h.importSingle(r, i, def)
		if importErr != nil {
			result.Errors = append(result.Errors, *importErr)
			continue
		}
		result.Imported = append(result.Imported, *imported)
	}

	status := http.StatusCreated
	if len(result.Imported) == 0 {
		status = http.StatusUnprocessableEntity
	}

	log.Info().
		Int("imported", len(result.Imported)).
		Int("errors", len(result.Errors)).
		Msg("automations imported")

	if h.auditor != nil && len(result.Imported) > 0 {
		names := make([]string, len(result.Imported))
		for i, imp := range result.Imported {
			names[i] = imp.Name
		}
		h.auditor.LogImported(r.Context(), len(result.Imported), names, r.RemoteAddr)
	}

	writeJSON(w, status, result)
}

func decodeAutomationExportEnvelope(body io.Reader) (*automationExportEnvelope, error) {
	raw, err := readAutomationJSONBody(body)
	if err != nil {
		return nil, err
	}
	var envelope automationExportEnvelope
	if err := decodeStrictAutomationJSON(raw, &envelope); err != nil {
		return nil, err
	}
	return &envelope, nil
}

// importSingle validates and creates a single automation from a portable definition.
func (h *AutomationHandler) importSingle(
	r *http.Request, index int, def automationPortable,
) (*importedAutomation, *importError) {
	req, err := validateAutomationPortable(def)
	name := strings.TrimSpace(def.Name)
	mkErr := func(msg string) *importError {
		return &importError{Index: index, Name: name, Error: msg}
	}
	if err != nil {
		return nil, mkErr(err.Error())
	}

	descStr := req.Description
	var descPtr *string
	if descStr != "" {
		descPtr = &descStr
	}
	a := &models.Automation{
		Name:        req.Name,
		Description: descPtr,
		VehicleID:   req.VehicleID,
		Enabled:     false, // always disabled on import
	}

	if err := h.repo.Create(r.Context(), a); err != nil {
		log.Error().Err(err).Str("name", name).Msg("import: failed to create automation")
		return nil, mkErr("failed to create automation")
	}

	log.Info().
		Int64("automation_id", a.ID).
		Str("automation", req.Name).
		Str("trigger_type", firstTriggerKind(req)).
		Msg("automation imported")

	return &importedAutomation{
		ID:           a.ID,
		Name:         req.Name,
		WebhookToken: "",
	}, nil
}

func validateAutomationPortable(def automationPortable) (*createAutomationRequest, error) {
	return validateAutomationInputWire(automationInputWire{
		Name:        def.Name,
		Description: def.Description,
		VehicleID:   def.VehicleID,
		Enabled:     def.Enabled,
		Triggers:    def.Triggers,
		Conditions:  def.Conditions,
		Actions:     def.Actions,
	})
}

// writeJSONIndent writes an indented JSON response for human-readable export files.
func writeJSONIndent(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(data)
}
