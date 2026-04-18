package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// MQTTRepo is the subset of database.AutomationRepo needed by MQTTTrigger.
type MQTTRepo interface {
	GetByTriggerType(ctx context.Context, triggerType string) ([]*models.Automation, error)
	SetAutoDisabled(ctx context.Context, id int64, reason string) error
}

// MQTTSubscriber abstracts MQTT subscribe/unsubscribe for testability.
type MQTTSubscriber interface {
	Subscribe(topic string, qos byte, callback pahomqtt.MessageHandler) pahomqtt.Token
	Unsubscribe(topics ...string) pahomqtt.Token
	AddRoute(topic string, callback pahomqtt.MessageHandler)
}

// MQTTConfig represents the parsed trigger_config for MQTT automations.
type MQTTConfig struct {
	Topic           string  `json:"topic"`
	PayloadMatch    *string `json:"payload_match"`      // simple string equality (mutually exclusive with json_path)
	PayloadJSONPath *string `json:"payload_json_path"`  // JSON path to extract value (e.g., "$.state")
	PayloadOperator string  `json:"payload_operator"`   // "eq", "neq", "contains", "gt", "lt"
	PayloadValue    *string `json:"payload_value"`      // value to compare against json_path result
	AllowRetained   bool    `json:"allow_retained"`     // if false (default), skip retained messages
}

// mqttSnapshot is the JSON payload passed to engine.Evaluate when an MQTT trigger fires.
type mqttSnapshot struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"`
	Matched bool   `json:"matched"`
}

// compiledMQTTAutomation pairs an automation with its pre-parsed config
// to avoid re-parsing on every incoming message.
type compiledMQTTAutomation struct {
	automation *models.Automation
	config     *MQTTConfig
}

// MQTTTrigger evaluates MQTT-topic-based automations when messages are published.
type MQTTTrigger struct {
	mu         sync.RWMutex
	repo       MQTTRepo
	engine     AutomationEngine
	subscriber MQTTSubscriber
	compiled   []compiledMQTTAutomation // pre-parsed automations
	topics     map[string]struct{}      // currently subscribed topic patterns
	ctx        context.Context
	cancel     context.CancelFunc
	logger     zerolog.Logger
}

// NewMQTTTrigger creates a new MQTT trigger manager.
func NewMQTTTrigger(repo MQTTRepo, engine AutomationEngine, subscriber MQTTSubscriber) *MQTTTrigger {
	ctx, cancel := context.WithCancel(context.Background())
	return &MQTTTrigger{
		repo:       repo,
		engine:     engine,
		subscriber: subscriber,
		topics:     make(map[string]struct{}),
		ctx:        ctx,
		cancel:     cancel,
		logger: log.With().
			Str("component", "mqtt_trigger").
			Logger(),
	}
}

// Start loads all enabled MQTT automations and subscribes to their topics.
func (t *MQTTTrigger) Start(ctx context.Context) error {
	automations, err := t.repo.GetByTriggerType(ctx, "mqtt")
	if err != nil {
		return fmt.Errorf("load mqtt automations: %w", err)
	}

	compiled, invalidIDs := t.compileAutomations(ctx, automations)

	t.mu.Lock()
	t.compiled = compiled
	t.mu.Unlock()

	for _, c := range compiled {
		if err := t.subscribeTopic(c.config.Topic); err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", c.automation.ID).
				Str("topic", c.config.Topic).
				Msg("failed to subscribe to topic")
		}
	}

	t.logger.Info().
		Int("registered", len(compiled)).
		Int("invalid", len(invalidIDs)).
		Int("total", len(automations)).
		Int("topics", len(t.topics)).
		Msg("mqtt trigger started")

	return nil
}

// Stop unsubscribes from all topics and cancels the lifecycle context.
func (t *MQTTTrigger) Stop() {
	t.cancel()

	t.mu.Lock()
	for topic := range t.topics {
		token := t.subscriber.Unsubscribe(topic)
		if !token.WaitTimeout(5 * time.Second) {
			t.logger.Warn().Str("topic", topic).Msg("mqtt unsubscribe timeout")
		}
	}
	t.topics = make(map[string]struct{})
	t.compiled = nil
	t.mu.Unlock()

	t.logger.Info().Msg("mqtt trigger stopped")
}

// Reload re-reads all enabled MQTT automations and updates subscriptions.
func (t *MQTTTrigger) Reload(ctx context.Context) error {
	automations, err := t.repo.GetByTriggerType(ctx, "mqtt")
	if err != nil {
		return fmt.Errorf("reload mqtt automations: %w", err)
	}

	compiled, _ := t.compileAutomations(ctx, automations)

	// Collect the new topic set.
	newTopics := make(map[string]struct{})
	for _, c := range compiled {
		newTopics[c.config.Topic] = struct{}{}
	}

	t.mu.Lock()
	oldTopics := t.topics

	// Unsubscribe from removed topics.
	for topic := range oldTopics {
		if _, exists := newTopics[topic]; !exists {
			token := t.subscriber.Unsubscribe(topic)
			if !token.WaitTimeout(5 * time.Second) {
				t.logger.Warn().Str("topic", topic).Msg("mqtt unsubscribe timeout on reload")
			}
		}
	}

	t.topics = make(map[string]struct{})
	t.compiled = compiled
	t.mu.Unlock()

	// Subscribe to new/changed topics.
	for topic := range newTopics {
		if err := t.subscribeTopic(topic); err != nil {
			t.logger.Warn().Err(err).
				Str("topic", topic).
				Msg("failed to subscribe on reload")
		}
	}

	t.logger.Info().
		Int("automations", len(compiled)).
		Int("topics", len(t.topics)).
		Msg("mqtt trigger reloaded")
	return nil
}

// SubscribedTopics returns the set of currently subscribed topic patterns.
func (t *MQTTTrigger) SubscribedTopics() []string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	topics := make([]string, 0, len(t.topics))
	for topic := range t.topics {
		topics = append(topics, topic)
	}
	return topics
}

// AutomationCount returns the number of compiled automations.
func (t *MQTTTrigger) AutomationCount() int {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return len(t.compiled)
}

// compileAutomations parses and validates automations, auto-disabling invalid ones.
// Returns the valid compiled list and a slice of invalid automation IDs.
func (t *MQTTTrigger) compileAutomations(ctx context.Context, automations []*models.Automation) ([]compiledMQTTAutomation, []int64) {
	var compiled []compiledMQTTAutomation
	var invalidIDs []int64

	for _, a := range automations {
		cfg, err := parseMQTTConfig(a.TriggerConfig)
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", a.ID).
				Str("automation", a.Name).
				Msg("invalid mqtt trigger config, auto-disabling")
			if disableErr := t.repo.SetAutoDisabled(ctx, a.ID, fmt.Sprintf("invalid mqtt config: %v", err)); disableErr != nil {
				t.logger.Error().Err(disableErr).
					Int64("automation_id", a.ID).
					Msg("failed to auto-disable invalid automation")
			}
			invalidIDs = append(invalidIDs, a.ID)
			continue
		}
		compiled = append(compiled, compiledMQTTAutomation{automation: a, config: cfg})
	}

	return compiled, invalidIDs
}

// subscribeTopic subscribes to a topic if not already subscribed.
// Uses both AddRoute (for client-side routing on reconnect) and Subscribe
// (for broker-side subscription), matching the existing Subscriber pattern.
func (t *MQTTTrigger) subscribeTopic(topic string) error {
	t.mu.Lock()
	if _, exists := t.topics[topic]; exists {
		t.mu.Unlock()
		return nil
	}
	t.topics[topic] = struct{}{}
	t.mu.Unlock()

	// AddRoute persists across reconnects for client-side routing.
	t.subscriber.AddRoute(topic, t.onMessage)

	token := t.subscriber.Subscribe(topic, 1, t.onMessage)
	if !token.WaitTimeout(10 * time.Second) {
		t.mu.Lock()
		delete(t.topics, topic)
		t.mu.Unlock()
		return fmt.Errorf("mqtt subscribe timeout for topic %s", topic)
	}
	if err := token.Error(); err != nil {
		t.mu.Lock()
		delete(t.topics, topic)
		t.mu.Unlock()
		return fmt.Errorf("mqtt subscribe to %s: %w", topic, err)
	}

	t.logger.Debug().Str("topic", topic).Msg("subscribed to mqtt topic")
	return nil
}

// onMessage handles incoming MQTT messages and evaluates matching automations.
func (t *MQTTTrigger) onMessage(_ pahomqtt.Client, msg pahomqtt.Message) {
	topic := msg.Topic()
	payload := string(msg.Payload())
	retained := msg.Retained()

	t.mu.RLock()
	compiled := t.compiled
	t.mu.RUnlock()

	for _, c := range compiled {
		// Skip retained messages unless explicitly allowed.
		if retained && !c.config.AllowRetained {
			continue
		}

		if !topicMatches(c.config.Topic, topic) {
			continue
		}

		matched, err := matchesPayload(payload, c.config)
		if err != nil {
			t.logger.Warn().Err(err).
				Int64("automation_id", c.automation.ID).
				Str("topic", topic).
				Msg("payload match error")
			continue
		}
		if !matched {
			continue
		}

		snapshot, err := json.Marshal(mqttSnapshot{
			Topic:   topic,
			Payload: payload,
			Matched: true,
		})
		if err != nil {
			t.logger.Error().Err(err).
				Int64("automation_id", c.automation.ID).
				Msg("failed to marshal mqtt trigger snapshot")
			continue
		}

		t.logger.Info().
			Int64("automation_id", c.automation.ID).
			Str("automation", c.automation.Name).
			Str("topic", topic).
			Msg("mqtt trigger fired")

		if evalErr := t.engine.Evaluate(t.ctx, c.automation.ID, snapshot); evalErr != nil {
			t.logger.Error().Err(evalErr).
				Int64("automation_id", c.automation.ID).
				Str("automation", c.automation.Name).
				Msg("automation evaluation failed")
		}
	}
}

// ─── Topic Matching ─────────────────────────────────────

// topicMatches checks if a concrete MQTT topic matches a pattern that may contain
// MQTT wildcards (+ for single level, # for multi-level).
func topicMatches(pattern, topic string) bool {
	patternParts := strings.Split(pattern, "/")
	topicParts := strings.Split(topic, "/")

	for i, pp := range patternParts {
		if pp == "#" {
			// # must be the last segment and matches everything from here.
			return true
		}
		if i >= len(topicParts) {
			return false
		}
		if pp != "+" && pp != topicParts[i] {
			return false
		}
	}

	return len(patternParts) == len(topicParts)
}

// ─── Payload Matching ───────────────────────────────────

// matchesPayload evaluates the payload matching rules in the config.
func matchesPayload(payload string, cfg *MQTTConfig) (bool, error) {
	// Mode 1: Simple string equality match.
	if cfg.PayloadMatch != nil {
		return payload == *cfg.PayloadMatch, nil
	}

	// Mode 2: No matching criteria — match all messages on this topic.
	if cfg.PayloadJSONPath == nil && cfg.PayloadValue == nil {
		return true, nil
	}

	// Mode 3: JSON path extraction + operator comparison.
	var value string
	if cfg.PayloadJSONPath != nil {
		extracted, err := extractJSONPath(payload, *cfg.PayloadJSONPath)
		if err != nil {
			return false, fmt.Errorf("extract json path %q: %w", *cfg.PayloadJSONPath, err)
		}
		value = extracted
	} else {
		value = payload
	}

	if cfg.PayloadValue == nil {
		// JSON path set but no value — presence check.
		return value != "", nil
	}

	return compareValues(value, cfg.PayloadOperator, *cfg.PayloadValue)
}

// extractJSONPath extracts a value from a JSON string using simple dot-notation.
// Supports paths like "$.state", "$.data.value", or just "state".
func extractJSONPath(payload, path string) (string, error) {
	path = strings.TrimPrefix(path, "$.")
	if path == "" || path == "$" {
		return payload, nil
	}

	var data interface{}
	if err := json.Unmarshal([]byte(payload), &data); err != nil {
		return "", fmt.Errorf("parse JSON payload: %w", err)
	}

	parts := strings.Split(path, ".")
	current := data
	for _, part := range parts {
		obj, ok := current.(map[string]interface{})
		if !ok {
			return "", fmt.Errorf("cannot navigate into non-object at %q", part)
		}
		val, exists := obj[part]
		if !exists {
			return "", fmt.Errorf("key %q not found", part)
		}
		current = val
	}

	switch v := current.(type) {
	case string:
		return v, nil
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10), nil
		}
		return strconv.FormatFloat(v, 'f', -1, 64), nil
	case bool:
		return strconv.FormatBool(v), nil
	case nil:
		return "", nil
	default:
		b, err := json.Marshal(v)
		if err != nil {
			return "", fmt.Errorf("marshal nested value: %w", err)
		}
		return string(b), nil
	}
}

// compareValues compares a value against an expected value using the given operator.
func compareValues(value, operator, expected string) (bool, error) {
	switch operator {
	case "eq", "":
		return value == expected, nil
	case "neq":
		return value != expected, nil
	case "contains":
		return strings.Contains(value, expected), nil
	case "gt":
		return numericCompare(value, expected, func(a, b float64) bool { return a > b })
	case "lt":
		return numericCompare(value, expected, func(a, b float64) bool { return a < b })
	default:
		return false, fmt.Errorf("unknown operator %q", operator)
	}
}

// numericCompare parses two values as floats and applies a comparison function.
func numericCompare(value, expected string, cmp func(a, b float64) bool) (bool, error) {
	a, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return false, fmt.Errorf("parse value %q as number: %w", value, err)
	}
	b, err := strconv.ParseFloat(expected, 64)
	if err != nil {
		return false, fmt.Errorf("parse expected %q as number: %w", expected, err)
	}
	return cmp(a, b), nil
}

// ─── Config Parsing ─────────────────────────────────────

// parseMQTTConfig unmarshals and validates the trigger_config JSON.
func parseMQTTConfig(raw json.RawMessage) (*MQTTConfig, error) {
	if len(raw) == 0 {
		return nil, fmt.Errorf("trigger_config is empty")
	}
	var cfg MQTTConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, fmt.Errorf("unmarshal trigger config: %w", err)
	}

	if cfg.Topic == "" {
		return nil, fmt.Errorf("topic is required")
	}

	if err := validateMQTTTopicFilter(cfg.Topic); err != nil {
		return nil, fmt.Errorf("invalid topic filter: %w", err)
	}

	// Validate operator.
	switch cfg.PayloadOperator {
	case "", "eq", "neq", "contains", "gt", "lt":
		// valid
	default:
		return nil, fmt.Errorf("invalid payload_operator %q, must be eq/neq/contains/gt/lt", cfg.PayloadOperator)
	}

	// payload_match and payload_json_path/payload_value are mutually exclusive.
	if cfg.PayloadMatch != nil && (cfg.PayloadJSONPath != nil || cfg.PayloadValue != nil) {
		return nil, fmt.Errorf("payload_match is mutually exclusive with payload_json_path/payload_value")
	}

	// Default operator to "eq" when json_path or value is set.
	if cfg.PayloadOperator == "" && (cfg.PayloadJSONPath != nil || cfg.PayloadValue != nil) {
		cfg.PayloadOperator = "eq"
	}

	return &cfg, nil
}

// validateMQTTTopicFilter validates MQTT topic filter syntax.
// Rules: + must be a standalone segment, # must be last standalone segment.
func validateMQTTTopicFilter(topic string) error {
	if topic == "" {
		return fmt.Errorf("topic filter cannot be empty")
	}

	parts := strings.Split(topic, "/")
	for i, part := range parts {
		if part == "#" {
			if i != len(parts)-1 {
				return fmt.Errorf("# wildcard must be the last segment")
			}
		} else if part == "+" {
			// + is valid as a standalone segment — OK.
		} else if strings.Contains(part, "+") || strings.Contains(part, "#") {
			return fmt.Errorf("wildcards + and # must occupy an entire segment, got %q", part)
		}
	}
	return nil
}
