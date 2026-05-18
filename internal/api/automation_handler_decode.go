package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

const maxAutomationRequestBodyBytes = 1 << 20

var legacyAutomationInputFieldNames = []string{
	automationField("trigger", "type"),
	automationField("trigger", "config"),
	automationField("notify", "channels"),
	automationField("cooldown", "minutes"),
	"max_executions_hour",
	"seasonal_start",
	"seasonal_end",
	"pri" + "ority",
	"tags",
	"preset_id",
}

var legacyAutomationInputFields = automationFieldSet(legacyAutomationInputFieldNames)

func automationField(parts ...string) string {
	return strings.Join(parts, "_")
}

func automationFieldSet(names []string) map[string]struct{} {
	fields := make(map[string]struct{}, len(names))
	for _, name := range names {
		fields[name] = struct{}{}
	}
	return fields
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
	if err := validateAutomationStepOrders(req); err != nil {
		return nil, err
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
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindTriggerGeofence:
		var step automationTriggerGeofenceDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerGeofence(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindTriggerSchedule:
		var step automationTriggerScheduleDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerSchedule(&step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindTriggerEvent:
		var step automationTriggerEventDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationTriggerEvent(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
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
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindConditionTimeWindow:
		var step automationConditionTimeWindowDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionTimeWindow(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindConditionGeofence:
		var step automationConditionGeofenceDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionGeofence(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindConditionOtherAutomation:
		var step automationConditionOtherAutomationDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if err := validateAutomationConditionOtherAutomation(step); err != nil {
			return automationTypedStep{}, err
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
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
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
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
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
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
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
	case models.AutomationStepKindActionCallAutomation:
		var step automationActionCallAutomationDTO
		if err := decodeStrictAutomationJSON(raw, &step); err != nil {
			return automationTypedStep{}, err
		}
		if step.TargetAutomationID <= 0 {
			return automationTypedStep{}, errors.New("target_automation_id is required")
		}
		return automationTypedStep{Kind: kind, StepOrder: step.StepOrder, Payload: step}, nil
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
	case "enter", "exit":
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

func validateAutomationStepOrders(req *createAutomationRequest) error {
	_, err := automationStepOrderValues(automationTypedStepsInPersistenceOrder(req))
	return err
}

func automationTypedStepsInPersistenceOrder(req *createAutomationRequest) []automationTypedStep {
	if req == nil {
		return nil
	}
	steps := make([]automationTypedStep, 0, len(req.Triggers)+len(req.Conditions)+len(req.Actions))
	steps = append(steps, req.Triggers...)
	steps = append(steps, req.Conditions...)
	steps = append(steps, req.Actions...)
	return steps
}

func automationStepOrderValues(steps []automationTypedStep) ([]int, error) {
	orders := make([]int, len(steps))
	used := make(map[int]struct{}, len(steps))
	for i, step := range steps {
		if step.StepOrder == nil {
			continue
		}
		order := *step.StepOrder
		if order <= 0 || order > len(steps) {
			return nil, fmt.Errorf("step_order for step %d must be between 1 and %d", i, len(steps))
		}
		if _, ok := used[order]; ok {
			return nil, fmt.Errorf("step_order %d is duplicated", order)
		}
		orders[i] = order
		used[order] = struct{}{}
	}

	next := 1
	for i := range orders {
		if orders[i] != 0 {
			continue
		}
		for {
			if _, ok := used[next]; !ok {
				break
			}
			next++
		}
		orders[i] = next
		used[next] = struct{}{}
	}
	return orders, nil
}

func decodeAutomationExportEnvelope(body io.Reader) (*automationExportEnvelope, error) {
	raw, err := readAutomationJSONBody(body)
	if err != nil {
		return nil, err
	}
	if err := rejectRetiredAutomationFieldsInEnvelope(raw); err != nil {
		return nil, err
	}
	var envelope automationExportEnvelope
	if err := decodeStrictAutomationJSON(raw, &envelope); err != nil {
		return nil, err
	}
	return &envelope, nil
}

func rejectRetiredAutomationFieldsInEnvelope(raw []byte) error {
	fields, err := automationJSONFields(raw)
	if err != nil {
		return err
	}
	rawAutomations, ok := fields["automations"]
	if !ok {
		return nil
	}
	var defs []map[string]json.RawMessage
	if err := json.Unmarshal(rawAutomations, &defs); err != nil {
		return nil
	}
	for i, def := range defs {
		if field, ok := firstRetiredAutomationField(def); ok {
			return fmt.Errorf("automations[%d]: field %q is not supported; use typed step arrays", i, field)
		}
	}
	return nil
}

func firstRetiredAutomationField(fields map[string]json.RawMessage) (string, bool) {
	for _, field := range legacyAutomationInputFieldNames {
		if _, ok := fields[field]; ok {
			return field, true
		}
	}
	return "", false
}

func validateAutomationPortable(def automationPortable) (*createAutomationRequest, error) {
	return validateAutomationInputWire(automationInputWire(def))
}
