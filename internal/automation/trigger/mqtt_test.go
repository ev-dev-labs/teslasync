package trigger

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"testing"
	"time"

	pahomqtt "github.com/eclipse/paho.mqtt.golang"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

// ─── Mock MQTT Subscriber ───────────────────────────────

type mockMQTTSubscriber struct {
	mu            sync.Mutex
	subscriptions map[string]pahomqtt.MessageHandler
	unsubscribed  []string
	subErr        error // if set, Subscribe returns this error via token
}

func newMockMQTTSubscriber() *mockMQTTSubscriber {
	return &mockMQTTSubscriber{
		subscriptions: make(map[string]pahomqtt.MessageHandler),
	}
}

func (s *mockMQTTSubscriber) Subscribe(topic string, _ byte, callback pahomqtt.MessageHandler) pahomqtt.Token {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.subscriptions[topic] = callback
	return &mockToken{err: s.subErr}
}

func (s *mockMQTTSubscriber) Unsubscribe(topics ...string) pahomqtt.Token {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, topic := range topics {
		delete(s.subscriptions, topic)
		s.unsubscribed = append(s.unsubscribed, topic)
	}
	return &mockToken{}
}

func (s *mockMQTTSubscriber) AddRoute(topic string, callback pahomqtt.MessageHandler) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// AddRoute just registers the handler for client-side routing.
	s.subscriptions[topic] = callback
}

func (s *mockMQTTSubscriber) isSubscribed(topic string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.subscriptions[topic]
	return ok
}

// simulateMessage invokes the handler for a matching subscription.
func (s *mockMQTTSubscriber) simulateMessage(topic, payload string, retained bool) {
	s.mu.Lock()
	var handlers []pahomqtt.MessageHandler
	for subTopic, handler := range s.subscriptions {
		if topicMatches(subTopic, topic) {
			handlers = append(handlers, handler)
		}
	}
	s.mu.Unlock()

	msg := &mockMessage{topic: topic, payload: []byte(payload), retained: retained}
	for _, h := range handlers {
		h(nil, msg)
	}
}

// ─── Mock Token ─────────────────────────────────────────

type mockToken struct {
	err error
}

func (t *mockToken) Wait() bool                       { return true }
func (t *mockToken) WaitTimeout(_ time.Duration) bool  { return t.err == nil }
func (t *mockToken) Done() <-chan struct{}             { ch := make(chan struct{}); close(ch); return ch }
func (t *mockToken) Error() error                     { return t.err }

// ─── Mock MQTT Message ──────────────────────────────────

type mockMessage struct {
	topic    string
	payload  []byte
	retained bool
}

func (m *mockMessage) Duplicate() bool    { return false }
func (m *mockMessage) Qos() byte          { return 0 }
func (m *mockMessage) Retained() bool     { return m.retained }
func (m *mockMessage) Topic() string      { return m.topic }
func (m *mockMessage) MessageID() uint16  { return 0 }
func (m *mockMessage) Payload() []byte    { return m.payload }
func (m *mockMessage) Ack()               {}

// ─── Mock MQTT Repo ─────────────────────────────────────

type mockMQTTRepo struct {
	mu          sync.Mutex
	automations []*models.Automation
	disabled    map[int64]string
	returnErr   error
}

func newMockMQTTRepo() *mockMQTTRepo {
	return &mockMQTTRepo{disabled: make(map[int64]string)}
}

func (r *mockMQTTRepo) GetByTriggerType(_ context.Context, triggerType string) ([]*models.Automation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.returnErr != nil {
		return nil, r.returnErr
	}
	var result []*models.Automation
	for _, a := range r.automations {
		if a.TriggerType == triggerType {
			result = append(result, a)
		}
	}
	return result, nil
}

func (r *mockMQTTRepo) SetAutoDisabled(_ context.Context, id int64, reason string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.disabled[id] = reason
	return nil
}

func (r *mockMQTTRepo) isDisabled(id int64) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.disabled[id]
	return ok
}

// ─── Helpers ────────────────────────────────────────────

func makeMQTTAutomation(id int64, name string, cfg MQTTConfig) *models.Automation {
	raw, _ := json.Marshal(cfg)
	return &models.Automation{
		ID:            id,
		Name:          name,
		Enabled:       true,
		TriggerType:   "mqtt",
		TriggerConfig: raw,
	}
}

func mqttStrPtr(s string) *string { return &s }

// ─── topicMatches Tests ─────────────────────────────────

func TestTopicMatches_ExactMatch(t *testing.T) {
	if !topicMatches("home/sensor/state", "home/sensor/state") {
		t.Fatal("expected exact match")
	}
}

func TestTopicMatches_ExactMismatch(t *testing.T) {
	if topicMatches("home/sensor/state", "home/sensor/command") {
		t.Fatal("should not match different topic")
	}
}

func TestTopicMatches_SingleLevelWildcard(t *testing.T) {
	if !topicMatches("home/+/state", "home/sensor/state") {
		t.Fatal("expected + wildcard to match single level")
	}
}

func TestTopicMatches_SingleLevelWildcard_MultipleSegments(t *testing.T) {
	if !topicMatches("+/+/state", "home/sensor/state") {
		t.Fatal("expected multiple + wildcards to match")
	}
}

func TestTopicMatches_SingleLevelWildcard_NoExtraLevels(t *testing.T) {
	if topicMatches("home/+/state", "home/sensor/sub/state") {
		t.Fatal("+ should only match one level")
	}
}

func TestTopicMatches_MultiLevelWildcard(t *testing.T) {
	if !topicMatches("home/#", "home/sensor/state") {
		t.Fatal("expected # to match multiple levels")
	}
}

func TestTopicMatches_MultiLevelWildcard_Root(t *testing.T) {
	if !topicMatches("#", "any/topic/at/all") {
		t.Fatal("expected # at root to match everything")
	}
}

func TestTopicMatches_MultiLevelWildcard_SingleLevel(t *testing.T) {
	if !topicMatches("home/#", "home/sensor") {
		t.Fatal("expected # to match single remaining level")
	}
}

func TestTopicMatches_DifferentLengths(t *testing.T) {
	if topicMatches("home/sensor", "home/sensor/state") {
		t.Fatal("shorter pattern should not match longer topic")
	}
	if topicMatches("home/sensor/state", "home/sensor") {
		t.Fatal("longer pattern should not match shorter topic")
	}
}

func TestTopicMatches_EmptySegments(t *testing.T) {
	// MQTT allows empty segments (consecutive /)
	if !topicMatches("home//state", "home//state") {
		t.Fatal("empty segments should match")
	}
}

// ─── matchesPayload Tests ───────────────────────────────

func TestMatchesPayload_NoRules(t *testing.T) {
	cfg := &MQTTConfig{Topic: "test"}
	matched, err := matchesPayload("anything", cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected match when no rules are set")
	}
}

func TestMatchesPayload_SimpleMatch(t *testing.T) {
	cfg := &MQTTConfig{Topic: "test", PayloadMatch: mqttStrPtr("on")}
	matched, err := matchesPayload("on", cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected payload match")
	}
}

func TestMatchesPayload_SimpleNoMatch(t *testing.T) {
	cfg := &MQTTConfig{Topic: "test", PayloadMatch: mqttStrPtr("on")}
	matched, err := matchesPayload("off", cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if matched {
		t.Fatal("should not match different payload")
	}
}

func TestMatchesPayload_JSONPath_Eq(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.state"),
		PayloadOperator: "eq",
		PayloadValue:    mqttStrPtr("on"),
	}
	matched, err := matchesPayload(`{"state":"on","brightness":80}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected JSON path match")
	}
}

func TestMatchesPayload_JSONPath_Neq(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.state"),
		PayloadOperator: "neq",
		PayloadValue:    mqttStrPtr("off"),
	}
	matched, err := matchesPayload(`{"state":"on"}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected neq match")
	}
}

func TestMatchesPayload_JSONPath_Contains(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.message"),
		PayloadOperator: "contains",
		PayloadValue:    mqttStrPtr("error"),
	}
	matched, err := matchesPayload(`{"message":"critical error occurred"}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected contains match")
	}
}

func TestMatchesPayload_JSONPath_Gt(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.temperature"),
		PayloadOperator: "gt",
		PayloadValue:    mqttStrPtr("30"),
	}
	matched, err := matchesPayload(`{"temperature":35.5}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected gt match")
	}
}

func TestMatchesPayload_JSONPath_Lt(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.temperature"),
		PayloadOperator: "lt",
		PayloadValue:    mqttStrPtr("30"),
	}
	matched, err := matchesPayload(`{"temperature":25}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected lt match")
	}
}

func TestMatchesPayload_JSONPath_Gt_NoMatch(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.temperature"),
		PayloadOperator: "gt",
		PayloadValue:    mqttStrPtr("30"),
	}
	matched, err := matchesPayload(`{"temperature":25}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if matched {
		t.Fatal("should not match: 25 is not > 30")
	}
}

func TestMatchesPayload_JSONPath_InvalidJSON(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.state"),
		PayloadOperator: "eq",
		PayloadValue:    mqttStrPtr("on"),
	}
	_, err := matchesPayload("not json", cfg)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestMatchesPayload_JSONPath_MissingKey(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.missing"),
		PayloadOperator: "eq",
		PayloadValue:    mqttStrPtr("value"),
	}
	_, err := matchesPayload(`{"state":"on"}`, cfg)
	if err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestMatchesPayload_JSONPath_NestedPath(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.data.value"),
		PayloadOperator: "eq",
		PayloadValue:    mqttStrPtr("42"),
	}
	matched, err := matchesPayload(`{"data":{"value":42}}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected nested path match")
	}
}

func TestMatchesPayload_JSONPath_PresenceCheck(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.state"),
		PayloadOperator: "eq",
	}
	matched, err := matchesPayload(`{"state":"on"}`, cfg)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !matched {
		t.Fatal("expected presence check to match when field exists")
	}
}

func TestMatchesPayload_NumericCompare_NonNumeric(t *testing.T) {
	cfg := &MQTTConfig{
		Topic:           "test",
		PayloadJSONPath: mqttStrPtr("$.state"),
		PayloadOperator: "gt",
		PayloadValue:    mqttStrPtr("30"),
	}
	_, err := matchesPayload(`{"state":"on"}`, cfg)
	if err == nil {
		t.Fatal("expected error for non-numeric gt comparison")
	}
}

// ─── extractJSONPath Tests ──────────────────────────────

func TestExtractJSONPath_TopLevel(t *testing.T) {
	val, err := extractJSONPath(`{"state":"on"}`, "$.state")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "on" {
		t.Fatalf("expected 'on', got %q", val)
	}
}

func TestExtractJSONPath_Nested(t *testing.T) {
	val, err := extractJSONPath(`{"a":{"b":{"c":"deep"}}}`, "$.a.b.c")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "deep" {
		t.Fatalf("expected 'deep', got %q", val)
	}
}

func TestExtractJSONPath_NumericValue(t *testing.T) {
	val, err := extractJSONPath(`{"temp":25}`, "$.temp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "25" {
		t.Fatalf("expected '25', got %q", val)
	}
}

func TestExtractJSONPath_FloatValue(t *testing.T) {
	val, err := extractJSONPath(`{"temp":25.7}`, "$.temp")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "25.7" {
		t.Fatalf("expected '25.7', got %q", val)
	}
}

func TestExtractJSONPath_BoolValue(t *testing.T) {
	val, err := extractJSONPath(`{"active":true}`, "$.active")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "true" {
		t.Fatalf("expected 'true', got %q", val)
	}
}

func TestExtractJSONPath_NullValue(t *testing.T) {
	val, err := extractJSONPath(`{"state":null}`, "$.state")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "" {
		t.Fatalf("expected empty string for null, got %q", val)
	}
}

func TestExtractJSONPath_NoDollarPrefix(t *testing.T) {
	val, err := extractJSONPath(`{"state":"on"}`, "state")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "on" {
		t.Fatalf("expected 'on', got %q", val)
	}
}

func TestExtractJSONPath_EmptyPath(t *testing.T) {
	val, err := extractJSONPath(`{"state":"on"}`, "$.")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// Should return the full payload.
	if val != `{"state":"on"}` {
		t.Fatalf("expected full payload, got %q", val)
	}
}

func TestExtractJSONPath_NavigateNonObject(t *testing.T) {
	_, err := extractJSONPath(`{"state":"on"}`, "$.state.sub")
	if err == nil {
		t.Fatal("expected error navigating into string")
	}
}

// ─── compareValues Tests ────────────────────────────────

func TestCompareValues_Eq(t *testing.T) {
	ok, _ := compareValues("hello", "eq", "hello")
	if !ok {
		t.Fatal("expected eq match")
	}
	ok, _ = compareValues("hello", "eq", "world")
	if ok {
		t.Fatal("should not match different values")
	}
}

func TestCompareValues_Neq(t *testing.T) {
	ok, _ := compareValues("hello", "neq", "world")
	if !ok {
		t.Fatal("expected neq match")
	}
	ok, _ = compareValues("hello", "neq", "hello")
	if ok {
		t.Fatal("should not match equal values")
	}
}

func TestCompareValues_Contains(t *testing.T) {
	ok, _ := compareValues("hello world", "contains", "world")
	if !ok {
		t.Fatal("expected contains match")
	}
	ok, _ = compareValues("hello", "contains", "world")
	if ok {
		t.Fatal("should not match missing substring")
	}
}

func TestCompareValues_Gt(t *testing.T) {
	ok, _ := compareValues("35", "gt", "30")
	if !ok {
		t.Fatal("expected 35 > 30")
	}
	ok, _ = compareValues("25", "gt", "30")
	if ok {
		t.Fatal("should not match: 25 > 30")
	}
}

func TestCompareValues_Lt(t *testing.T) {
	ok, _ := compareValues("25", "lt", "30")
	if !ok {
		t.Fatal("expected 25 < 30")
	}
	ok, _ = compareValues("35", "lt", "30")
	if ok {
		t.Fatal("should not match: 35 < 30")
	}
}

func TestCompareValues_UnknownOperator(t *testing.T) {
	_, err := compareValues("a", "unknown", "b")
	if err == nil {
		t.Fatal("expected error for unknown operator")
	}
}

func TestCompareValues_DefaultOperator(t *testing.T) {
	ok, _ := compareValues("hello", "", "hello")
	if !ok {
		t.Fatal("empty operator should default to eq")
	}
}

// ─── parseMQTTConfig Tests ──────────────────────────────

func TestParseMQTTConfig_Valid_SimpleMatch(t *testing.T) {
	raw := json.RawMessage(`{"topic":"home/sensor/state","payload_match":"on"}`)
	cfg, err := parseMQTTConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Topic != "home/sensor/state" {
		t.Fatalf("unexpected topic: %q", cfg.Topic)
	}
	if cfg.PayloadMatch == nil || *cfg.PayloadMatch != "on" {
		t.Fatal("expected payload_match 'on'")
	}
}

func TestParseMQTTConfig_Valid_JSONPath(t *testing.T) {
	raw := json.RawMessage(`{"topic":"sensors/#","payload_json_path":"$.state","payload_operator":"eq","payload_value":"on"}`)
	cfg, err := parseMQTTConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.PayloadJSONPath == nil || *cfg.PayloadJSONPath != "$.state" {
		t.Fatal("expected payload_json_path '$.state'")
	}
	if cfg.PayloadOperator != "eq" {
		t.Fatalf("expected operator 'eq', got %q", cfg.PayloadOperator)
	}
}

func TestParseMQTTConfig_Valid_TopicOnly(t *testing.T) {
	raw := json.RawMessage(`{"topic":"home/sensor/state"}`)
	cfg, err := parseMQTTConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Topic != "home/sensor/state" {
		t.Fatalf("unexpected topic: %q", cfg.Topic)
	}
}

func TestParseMQTTConfig_Empty(t *testing.T) {
	_, err := parseMQTTConfig(nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestParseMQTTConfig_InvalidJSON(t *testing.T) {
	_, err := parseMQTTConfig(json.RawMessage(`{invalid`))
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseMQTTConfig_MissingTopic(t *testing.T) {
	raw := json.RawMessage(`{"payload_match":"on"}`)
	_, err := parseMQTTConfig(raw)
	if err == nil {
		t.Fatal("expected error for missing topic")
	}
}

func TestParseMQTTConfig_InvalidOperator(t *testing.T) {
	raw := json.RawMessage(`{"topic":"test","payload_operator":"between"}`)
	_, err := parseMQTTConfig(raw)
	if err == nil {
		t.Fatal("expected error for invalid operator")
	}
}

func TestParseMQTTConfig_MutuallyExclusive(t *testing.T) {
	raw := json.RawMessage(`{"topic":"test","payload_match":"on","payload_json_path":"$.state"}`)
	_, err := parseMQTTConfig(raw)
	if err == nil {
		t.Fatal("expected error for mutually exclusive config")
	}
}

func TestParseMQTTConfig_MutuallyExclusive_PayloadValue(t *testing.T) {
	raw := json.RawMessage(`{"topic":"test","payload_match":"on","payload_value":"on"}`)
	_, err := parseMQTTConfig(raw)
	if err == nil {
		t.Fatal("expected error for payload_match with payload_value")
	}
}

func TestParseMQTTConfig_DefaultOperator(t *testing.T) {
	raw := json.RawMessage(`{"topic":"test","payload_json_path":"$.state","payload_value":"on"}`)
	cfg, err := parseMQTTConfig(raw)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.PayloadOperator != "eq" {
		t.Fatalf("expected default operator 'eq', got %q", cfg.PayloadOperator)
	}
}

// ─── validateMQTTTopicFilter Tests ──────────────────────

func TestValidateMQTTTopicFilter_ValidExact(t *testing.T) {
	if err := validateMQTTTopicFilter("home/sensor/state"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateMQTTTopicFilter_ValidSingleWildcard(t *testing.T) {
	if err := validateMQTTTopicFilter("home/+/state"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateMQTTTopicFilter_ValidMultiWildcard(t *testing.T) {
	if err := validateMQTTTopicFilter("home/#"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateMQTTTopicFilter_ValidRootMultiWildcard(t *testing.T) {
	if err := validateMQTTTopicFilter("#"); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateMQTTTopicFilter_InvalidMultiWildcardNotLast(t *testing.T) {
	err := validateMQTTTopicFilter("home/#/state")
	if err == nil {
		t.Fatal("expected error: # not in last position")
	}
}

func TestValidateMQTTTopicFilter_InvalidPartialWildcard(t *testing.T) {
	err := validateMQTTTopicFilter("home/sen+sor/state")
	if err == nil {
		t.Fatal("expected error: + not standalone segment")
	}
}

func TestValidateMQTTTopicFilter_InvalidPartialHash(t *testing.T) {
	err := validateMQTTTopicFilter("home/sensor#")
	if err == nil {
		t.Fatal("expected error: # not standalone segment")
	}
}

func TestValidateMQTTTopicFilter_Empty(t *testing.T) {
	err := validateMQTTTopicFilter("")
	if err == nil {
		t.Fatal("expected error for empty topic")
	}
}

// ─── MQTTTrigger Integration Tests ──────────────────────

func TestMQTTTrigger_Start_SubscribesToTopics(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
		makeMQTTAutomation(2, "temp-alert", MQTTConfig{Topic: "home/temp/value", PayloadJSONPath: mqttStrPtr("$.temperature"), PayloadOperator: "gt", PayloadValue: mqttStrPtr("30")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)

	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	if trigger.AutomationCount() != 2 {
		t.Fatalf("expected 2 automations, got %d", trigger.AutomationCount())
	}

	topics := trigger.SubscribedTopics()
	sort.Strings(topics)
	if len(topics) != 2 {
		t.Fatalf("expected 2 subscribed topics, got %d", len(topics))
	}
}

func TestMQTTTrigger_Start_DisablesInvalidConfig(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	bad := &models.Automation{
		ID:            99,
		Name:          "broken",
		Enabled:       true,
		TriggerType:   "mqtt",
		TriggerConfig: json.RawMessage(`{invalid`),
	}
	good := makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")})
	repo.automations = []*models.Automation{bad, good}

	trigger := NewMQTTTrigger(repo, engine, sub)

	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	if trigger.AutomationCount() != 1 {
		t.Fatalf("expected 1 valid automation, got %d", trigger.AutomationCount())
	}
	if !repo.isDisabled(99) {
		t.Fatal("expected automation 99 to be auto-disabled")
	}
}

func TestMQTTTrigger_SimplePayloadMatch_Fires(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	// Simulate a matching message.
	sub.simulateMessage("home/door/state", "on", false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}

	// Verify snapshot.
	call := engine.lastCall()
	var snap mqttSnapshot
	if err := json.Unmarshal(call.Snapshot, &snap); err != nil {
		t.Fatalf("failed to unmarshal snapshot: %v", err)
	}
	if snap.Topic != "home/door/state" {
		t.Fatalf("expected topic 'home/door/state', got %q", snap.Topic)
	}
	if snap.Payload != "on" {
		t.Fatalf("expected payload 'on', got %q", snap.Payload)
	}
	if !snap.Matched {
		t.Fatal("expected matched=true")
	}
}

func TestMQTTTrigger_SimplePayloadMismatch_NoFire(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/door/state", "off", false)

	if engine.callCount() != 0 {
		t.Fatal("should not fire on payload mismatch")
	}
}

func TestMQTTTrigger_JSONPath_NumericGt_Fires(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "temp-high", MQTTConfig{
			Topic:           "sensors/temp",
			PayloadJSONPath: mqttStrPtr("$.temperature"),
			PayloadOperator: "gt",
			PayloadValue:    mqttStrPtr("30"),
		}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("sensors/temp", `{"temperature":35.5}`, false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_JSONPath_NumericLt_NoFire(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "temp-low", MQTTConfig{
			Topic:           "sensors/temp",
			PayloadJSONPath: mqttStrPtr("$.temperature"),
			PayloadOperator: "lt",
			PayloadValue:    mqttStrPtr("10"),
		}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("sensors/temp", `{"temperature":25}`, false)

	if engine.callCount() != 0 {
		t.Fatal("should not fire: 25 is not < 10")
	}
}

func TestMQTTTrigger_WildcardTopic_Fires(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "any-sensor", MQTTConfig{Topic: "home/+/state", PayloadMatch: mqttStrPtr("on")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/door/state", "on", false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire with wildcard topic, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_RetainedMessage_SkippedByDefault(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	// Retained message should be skipped.
	sub.simulateMessage("home/door/state", "on", true)

	if engine.callCount() != 0 {
		t.Fatal("should not fire on retained message by default")
	}
}

func TestMQTTTrigger_RetainedMessage_AllowedWhenConfigured(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{
			Topic:         "home/door/state",
			PayloadMatch:  mqttStrPtr("on"),
			AllowRetained: true,
		}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/door/state", "on", true)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire with allow_retained, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_TopicMismatch_NoFire(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-open", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/window/state", "on", false)

	if engine.callCount() != 0 {
		t.Fatal("should not fire on different topic")
	}
}

func TestMQTTTrigger_MultipleAutomations_SameTopic(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-on", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
		makeMQTTAutomation(2, "door-any", MQTTConfig{Topic: "home/door/state"}), // match anything
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/door/state", "on", false)

	if engine.callCount() != 2 {
		t.Fatalf("expected 2 fires, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_DedupSubscriptions(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	// Two automations with the same topic — should only subscribe once.
	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "door-on", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("on")}),
		makeMQTTAutomation(2, "door-off", MQTTConfig{Topic: "home/door/state", PayloadMatch: mqttStrPtr("off")}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	topics := trigger.SubscribedTopics()
	if len(topics) != 1 {
		t.Fatalf("expected 1 subscribed topic (dedup), got %d", len(topics))
	}
}

func TestMQTTTrigger_Stop_UnsubscribesAll(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "test", MQTTConfig{Topic: "topic/a"}),
		makeMQTTAutomation(2, "test2", MQTTConfig{Topic: "topic/b"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	trigger.Stop()

	if trigger.AutomationCount() != 0 {
		t.Fatal("expected 0 automations after stop")
	}
	if len(trigger.SubscribedTopics()) != 0 {
		t.Fatal("expected 0 subscribed topics after stop")
	}
}

func TestMQTTTrigger_Reload_UpdatesSubscriptions(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	// Initial: subscribe to topic/a
	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "test-a", MQTTConfig{Topic: "topic/a"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	if !sub.isSubscribed("topic/a") {
		t.Fatal("expected subscription to topic/a")
	}

	// Reload: switch to topic/b
	repo.mu.Lock()
	repo.automations = []*models.Automation{
		makeMQTTAutomation(2, "test-b", MQTTConfig{Topic: "topic/b"}),
	}
	repo.mu.Unlock()

	if err := trigger.Reload(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if sub.isSubscribed("topic/a") {
		t.Fatal("expected topic/a to be unsubscribed after reload")
	}
	if !sub.isSubscribed("topic/b") {
		t.Fatal("expected subscription to topic/b after reload")
	}
}

func TestMQTTTrigger_Reload_RepoError(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "test", MQTTConfig{Topic: "topic/a"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	repo.mu.Lock()
	repo.returnErr = fmt.Errorf("db connection lost")
	repo.mu.Unlock()

	err := trigger.Reload(context.Background())
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestMQTTTrigger_StartRepoError(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.returnErr = fmt.Errorf("db down")

	trigger := NewMQTTTrigger(repo, engine, sub)
	err := trigger.Start(context.Background())
	if err == nil {
		t.Fatal("expected error from repo failure")
	}
}

func TestMQTTTrigger_EngineError_DoesNotStopProcessing(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{returnErr: fmt.Errorf("action failed")}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "test-1", MQTTConfig{Topic: "topic/a"}),
		makeMQTTAutomation(2, "test-2", MQTTConfig{Topic: "topic/a"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	// Both automations should be evaluated even if first engine call fails.
	sub.simulateMessage("topic/a", "test", false)

	if engine.callCount() != 2 {
		t.Fatalf("expected 2 evaluations despite errors, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_TopicOnly_NoPayloadRules_MatchesAll(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "any-payload", MQTTConfig{Topic: "sensors/motion"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("sensors/motion", "literally anything", false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire with no payload rules, got %d", engine.callCount())
	}
}

func TestMQTTTrigger_MultiLevelWildcard_Fires(t *testing.T) {
	repo := newMockMQTTRepo()
	engine := &mockEngine{}
	sub := newMockMQTTSubscriber()

	repo.automations = []*models.Automation{
		makeMQTTAutomation(1, "all-home", MQTTConfig{Topic: "home/#"}),
	}

	trigger := NewMQTTTrigger(repo, engine, sub)
	if err := trigger.Start(context.Background()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	defer trigger.Stop()

	sub.simulateMessage("home/bedroom/light/state", "on", false)

	if engine.callCount() != 1 {
		t.Fatalf("expected 1 fire with # wildcard, got %d", engine.callCount())
	}
}
