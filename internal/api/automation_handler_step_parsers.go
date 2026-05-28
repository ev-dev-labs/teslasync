package api

import (
	"encoding/json"
	"fmt"
	"strings"

	dbauto "github.com/ev-dev-labs/teslasync/internal/database/automation"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

func automationStepWrites(req *createAutomationRequest) ([]dbauto.AutomationStepWrite, error) {
	steps := automationTypedStepsInPersistenceOrder(req)
	orders, err := automationStepOrderValues(steps)
	if err != nil {
		return nil, err
	}
	writes := make([]dbauto.AutomationStepWrite, 0, len(steps))
	for i, step := range steps {
		payload, err := automationStepPayloadModel(step)
		if err != nil {
			return nil, fmt.Errorf("step %d: %w", i, err)
		}
		writes = append(writes, dbauto.AutomationStepWrite{
			StepOrder: orders[i],
			Kind:      step.Kind,
			Payload:   payload,
		})
	}
	return writes, nil
}

func automationStepPayloadModel(step automationTypedStep) (any, error) {
	switch p := step.Payload.(type) {
	case automationTriggerSignalDTO:
		return &models.AutomationStepTriggerSignal{
			Signal:    strings.TrimSpace(p.Signal),
			Op:        strings.TrimSpace(p.Op),
			ValueText: p.ValueText,
			ValueNum:  p.ValueNum,
			ValueBool: p.ValueBool,
		}, nil
	case automationTriggerGeofenceDTO:
		return &models.AutomationStepTriggerGeofence{
			PlaceID: p.PlaceID,
			Event:   strings.TrimSpace(p.Event),
		}, nil
	case automationTriggerScheduleDTO:
		return &models.AutomationStepTriggerSchedule{
			CronExpr: strings.TrimSpace(p.CronExpr),
			Timezone: strings.TrimSpace(p.Timezone),
		}, nil
	case automationTriggerEventDTO:
		return &models.AutomationStepTriggerEvent{
			EventType: strings.TrimSpace(p.EventType),
		}, nil
	case automationConditionSignalDTO:
		return &models.AutomationStepConditionSignal{
			Signal:    strings.TrimSpace(p.Signal),
			Op:        strings.TrimSpace(p.Op),
			ValueText: p.ValueText,
			ValueNum:  p.ValueNum,
			ValueBool: p.ValueBool,
			ValueMin:  p.ValueMin,
			ValueMax:  p.ValueMax,
		}, nil
	case automationConditionTimeWindowDTO:
		startTime, err := parseAutomationClockTime(p.StartTime)
		if err != nil {
			return nil, fmt.Errorf("start_time: %w", err)
		}
		endTime, err := parseAutomationClockTime(p.EndTime)
		if err != nil {
			return nil, fmt.Errorf("end_time: %w", err)
		}
		timezone := strings.TrimSpace(p.Timezone)
		if timezone == "" {
			timezone = "UTC"
		}
		days := make([]int16, 0, len(p.DaysOfWeek))
		for _, day := range p.DaysOfWeek {
			days = append(days, int16(day))
		}
		return &models.AutomationStepConditionTimeWindow{
			StartTime:  startTime,
			EndTime:    endTime,
			Timezone:   timezone,
			DaysOfWeek: days,
		}, nil
	case automationConditionGeofenceDTO:
		return &models.AutomationStepConditionGeofence{
			PlaceID: p.PlaceID,
			State:   strings.TrimSpace(p.State),
		}, nil
	case automationConditionOtherAutomationDTO:
		return &models.AutomationStepConditionOtherAutomation{
			OtherAutomationID: p.OtherAutomationID,
			State:             strings.TrimSpace(p.State),
		}, nil
	case automationActionCommandDTO:
		params := p.CommandParams
		if len(params) == 0 {
			params = json.RawMessage(`{}`)
		}
		return &models.AutomationAction{
			CommandName:   strings.TrimSpace(p.CommandName),
			CommandParams: params,
		}, nil
	case automationActionNotifyDTO:
		return &models.AutomationStepActionNotify{
			ChannelID: p.ChannelID,
			Template:  p.Template,
		}, nil
	case automationActionSetSettingDTO:
		return &models.AutomationStepActionSetSetting{
			SettingKey: strings.TrimSpace(p.SettingKey),
			ValueText:  p.ValueText,
			ValueNum:   p.ValueNum,
			ValueBool:  p.ValueBool,
		}, nil
	case automationActionCallAutomationDTO:
		return &models.AutomationStepActionCallAutomation{
			TargetAutomationID: p.TargetAutomationID,
		}, nil
	default:
		return nil, fmt.Errorf("unsupported step payload type %T", step.Payload)
	}
}

func firstTriggerKind(req *createAutomationRequest) string {
	if req == nil || len(req.Triggers) == 0 {
		return ""
	}
	return req.Triggers[0].Kind
}
