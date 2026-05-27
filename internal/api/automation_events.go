package api

import (
	"context"
	"time"
)

// AutomationEventPublisher broadcasts automation lifecycle events to
// SSE clients connected to the /api/v1/automations/events stream.
type AutomationEventPublisher struct {
	hub *EventHub
}

// NewAutomationEventPublisher creates a publisher backed by the given SSE hub.
func NewAutomationEventPublisher(hub *EventHub) *AutomationEventPublisher {
	return &AutomationEventPublisher{hub: hub}
}

// automationTriggeredEvent is sent when an automation trigger fires.
type automationTriggeredEvent struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Vehicle      string `json:"vehicle,omitempty"`
	TriggerType  string `json:"trigger"`
	At           string `json:"at"`
	Mode         string `json:"mode"` // "live" or "test"
}

// automationSucceededEvent is sent when all actions complete successfully.
type automationSucceededEvent struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	DurationMs   int64  `json:"duration_ms"`
	Actions      int    `json:"actions"`
	Mode         string `json:"mode"`
}

// automationFailedEvent is sent when an action fails.
type automationFailedEvent struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Error        string `json:"error"`
	ActionIndex  int    `json:"action_index"`
	Mode         string `json:"mode"`
}

// automationSkippedEvent is sent when conditions are not met.
type automationSkippedEvent struct {
	AutomationID int64  `json:"automation_id"`
	Name         string `json:"name"`
	Reason       string `json:"reason"`
	Mode         string `json:"mode"`
}

// automationStateChangedEvent is the generic event for any FSM transition.
type automationStateChangedEvent struct {
	AutomationID        int64  `json:"automation_id"`
	Name                string `json:"name"`
	From                string `json:"from"`
	To                  string `json:"to"`
	Trigger             string `json:"trigger"`
	At                  string `json:"at"`
	RetryCount          int    `json:"retry_count,omitempty"`
	ConsecutiveFailures int    `json:"consecutive_failures,omitempty"`
	Mode                string `json:"mode"`
}

// PublishTriggered broadcasts that an automation trigger has fired.
// ctx threads through to the SSE span so the event nests under the caller's
// trace (typically an HTTP test-run handler or the automation engine eval span).
func (p *AutomationEventPublisher) PublishTriggered(ctx context.Context, automationID int64, name, vehicle, triggerType, mode string) {
	p.hub.BroadcastWithContext(ctx, "automation.triggered", automationTriggeredEvent{
		AutomationID: automationID,
		Name:         name,
		Vehicle:      vehicle,
		TriggerType:  triggerType,
		At:           time.Now().UTC().Format(time.RFC3339),
		Mode:         mode,
	})
}

// PublishSucceeded broadcasts that all actions completed successfully.
func (p *AutomationEventPublisher) PublishSucceeded(ctx context.Context, automationID int64, name string, durationMs int64, actions int, mode string) {
	p.hub.BroadcastWithContext(ctx, "automation.succeeded", automationSucceededEvent{
		AutomationID: automationID,
		Name:         name,
		DurationMs:   durationMs,
		Actions:      actions,
		Mode:         mode,
	})
}

// PublishFailed broadcasts that an action failed.
func (p *AutomationEventPublisher) PublishFailed(ctx context.Context, automationID int64, name, errMsg string, actionIndex int, mode string) {
	p.hub.BroadcastWithContext(ctx, "automation.failed", automationFailedEvent{
		AutomationID: automationID,
		Name:         name,
		Error:        errMsg,
		ActionIndex:  actionIndex,
		Mode:         mode,
	})
}

// PublishSkipped broadcasts that conditions were not met.
func (p *AutomationEventPublisher) PublishSkipped(ctx context.Context, automationID int64, name, reason, mode string) {
	p.hub.BroadcastWithContext(ctx, "automation.skipped", automationSkippedEvent{
		AutomationID: automationID,
		Name:         name,
		Reason:       reason,
		Mode:         mode,
	})
}

// PublishStateChanged broadcasts a generic FSM state transition.
func (p *AutomationEventPublisher) PublishStateChanged(ctx context.Context, automationID int64, name, from, to, trigger, mode string, retryCount, consecutiveFailures int) {
	p.hub.BroadcastWithContext(ctx, "automation.state_changed", automationStateChangedEvent{
		AutomationID:        automationID,
		Name:                name,
		From:                from,
		To:                  to,
		Trigger:             trigger,
		At:                  time.Now().UTC().Format(time.RFC3339),
		RetryCount:          retryCount,
		ConsecutiveFailures: consecutiveFailures,
		Mode:                mode,
	})
}
