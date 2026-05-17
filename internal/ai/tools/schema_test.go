package tools

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

// helpers ---------------------------------------------------------------

// schemaMap unmarshals the schema for inspection in tests.
func schemaMap(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal schema: %v\n%s", err, string(raw))
	}
	return m
}

// fieldSchema returns the property schema for the named field of an
// object schema. Fails the test when the field is absent.
func fieldSchema(t *testing.T, parent map[string]any, name string) map[string]any {
	t.Helper()
	props, ok := parent["properties"].(map[string]any)
	if !ok {
		t.Fatalf("schema has no properties: %v", parent)
	}
	f, ok := props[name].(map[string]any)
	if !ok {
		t.Fatalf("schema property %q missing", name)
	}
	return f
}

// schema generation tests ------------------------------------------------

func TestGenerate_PrimitiveTypes(t *testing.T) {
	t.Parallel()
	type In struct {
		A string  `json:"a"`
		B int     `json:"b"`
		C float64 `json:"c"`
		D bool    `json:"d"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	if got := fieldSchema(t, s, "a")["type"]; got != "string" {
		t.Errorf("a: type = %v, want string", got)
	}
	if got := fieldSchema(t, s, "b")["type"]; got != "integer" {
		t.Errorf("b: type = %v, want integer", got)
	}
	if got := fieldSchema(t, s, "c")["type"]; got != "number" {
		t.Errorf("c: type = %v, want number", got)
	}
	if got := fieldSchema(t, s, "d")["type"]; got != "boolean" {
		t.Errorf("d: type = %v, want boolean", got)
	}
}

func TestGenerate_RequiredAndGteLte(t *testing.T) {
	t.Parallel()
	type In struct {
		ID    int64 `json:"id"    validate:"required,gte=1"`
		Limit int   `json:"limit" validate:"gte=1,lte=100"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))

	req, ok := s["required"].([]any)
	if !ok {
		t.Fatalf("schema missing required: %v", s)
	}
	if len(req) != 1 || req[0].(string) != "id" {
		t.Errorf("required = %v, want [id]", req)
	}

	idF := fieldSchema(t, s, "id")
	if v, _ := idF["minimum"].(float64); v != 1 {
		t.Errorf("id.minimum = %v, want 1", idF["minimum"])
	}
	limitF := fieldSchema(t, s, "limit")
	if v, _ := limitF["minimum"].(float64); v != 1 {
		t.Errorf("limit.minimum = %v, want 1", limitF["minimum"])
	}
	if v, _ := limitF["maximum"].(float64); v != 100 {
		t.Errorf("limit.maximum = %v, want 100", limitF["maximum"])
	}
}

func TestGenerate_OneofEnum(t *testing.T) {
	t.Parallel()
	type In struct {
		Period string `json:"period" validate:"required,oneof=day week month year"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	period := fieldSchema(t, s, "period")
	enum, ok := period["enum"].([]any)
	if !ok {
		t.Fatalf("period.enum missing: %v", period)
	}
	want := []string{"day", "week", "month", "year"}
	if len(enum) != len(want) {
		t.Fatalf("enum len = %d, want %d", len(enum), len(want))
	}
	for i, w := range want {
		if enum[i].(string) != w {
			t.Errorf("enum[%d] = %v, want %s", i, enum[i], w)
		}
	}
}

func TestGenerate_LenString(t *testing.T) {
	t.Parallel()
	type In struct {
		Code string `json:"code" validate:"required,len=4"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	code := fieldSchema(t, s, "code")
	if v, _ := code["minLength"].(float64); v != 4 {
		t.Errorf("code.minLength = %v, want 4", code["minLength"])
	}
	if v, _ := code["maxLength"].(float64); v != 4 {
		t.Errorf("code.maxLength = %v, want 4", code["maxLength"])
	}
}

func TestGenerate_LenSlice(t *testing.T) {
	t.Parallel()
	type In struct {
		Tags []string `json:"tags" validate:"required,len=3"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	tags := fieldSchema(t, s, "tags")
	if v, _ := tags["minItems"].(float64); v != 3 {
		t.Errorf("tags.minItems = %v, want 3", tags["minItems"])
	}
	if v, _ := tags["maxItems"].(float64); v != 3 {
		t.Errorf("tags.maxItems = %v, want 3", tags["maxItems"])
	}
}

func TestGenerate_DiveAppliesRulesToElements(t *testing.T) {
	t.Parallel()
	type In struct {
		IDs []int64 `json:"ids" validate:"required,gte=1,dive,gte=1"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	ids := fieldSchema(t, s, "ids")
	// Top-level gte=1 applies to slice length.
	if v, _ := ids["minItems"].(float64); v != 1 {
		t.Errorf("ids.minItems = %v, want 1", ids["minItems"])
	}
	// Post-dive rule applies to items.
	items, ok := ids["items"].(map[string]any)
	if !ok {
		t.Fatalf("ids.items missing: %v", ids)
	}
	if v, _ := items["minimum"].(float64); v != 1 {
		t.Errorf("ids.items.minimum = %v, want 1", items["minimum"])
	}
}

func TestGenerate_AdditionalPropertiesFalse(t *testing.T) {
	t.Parallel()
	type In struct {
		A string `json:"a"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	v, ok := s["additionalProperties"].(bool)
	if !ok || v != false {
		t.Errorf("additionalProperties = %v, want false", s["additionalProperties"])
	}
}

func TestGenerate_NestedStruct(t *testing.T) {
	t.Parallel()
	type Inner struct {
		Code string `json:"code" validate:"required,len=4"`
	}
	type In struct {
		Filter Inner `json:"filter" validate:"required"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	filter := fieldSchema(t, s, "filter")
	if filter["type"] != "object" {
		t.Errorf("filter.type = %v, want object", filter["type"])
	}
	props, _ := filter["properties"].(map[string]any)
	if _, ok := props["code"]; !ok {
		t.Errorf("filter.properties.code missing")
	}
}

func TestGenerate_JSONNameTagOverride(t *testing.T) {
	t.Parallel()
	type In struct {
		VehicleID int64 `json:"vehicle_id"`
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	if _, ok := fieldSchema(t, s, "vehicle_id")["type"]; !ok {
		t.Errorf("expected vehicle_id property")
	}
}

func TestGenerate_FieldNameSnakeFallback(t *testing.T) {
	t.Parallel()
	type In struct {
		VehicleID int64 // no json tag → fallback
	}
	s := schemaMap(t, Generate(reflect.TypeOf(In{})))
	props, _ := s["properties"].(map[string]any)
	if _, ok := props["vehicle_id"]; !ok {
		t.Errorf("expected snake-cased property vehicle_id, got: %v", props)
	}
}

func TestGenerate_OutputIsDeterministic(t *testing.T) {
	t.Parallel()
	type In struct {
		B int `json:"b" validate:"required"`
		A int `json:"a"`
	}
	a := string(Generate(reflect.TypeOf(In{})))
	b := string(Generate(reflect.TypeOf(In{})))
	if a != b {
		t.Errorf("Generate is non-deterministic:\n%s\n--- vs ---\n%s", a, b)
	}
	// Required list is sorted lexicographically:
	if !strings.Contains(a, `"required": [
    "b"
  ]`) {
		t.Errorf("required not sorted as expected:\n%s", a)
	}
}

// ValidateStruct tests ----------------------------------------------------

func TestValidateStruct_MissingRequired(t *testing.T) {
	t.Parallel()
	type In struct {
		ID int64 `json:"id" validate:"required,gte=1"`
	}
	_, err := ValidateStruct[In](json.RawMessage(`{}`))
	ve, ok := AsValidationError(err)
	if !ok {
		t.Fatalf("want ValidationError, got %T %v", err, err)
	}
	if ve.Field != "id" || ve.Rule != "required" {
		t.Errorf("ValidationError = %+v", ve)
	}
}

func TestValidateStruct_GteLte(t *testing.T) {
	t.Parallel()
	type In struct {
		Limit int `json:"limit" validate:"gte=1,lte=100"`
	}

	if _, err := ValidateStruct[In](json.RawMessage(`{"limit": 50}`)); err != nil {
		t.Fatalf("limit=50 should pass: %v", err)
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"limit": 0}`)); err == nil {
		t.Fatal("limit=0 should fail gte=1")
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"limit": 200}`)); err == nil {
		t.Fatal("limit=200 should fail lte=100")
	}
}

func TestValidateStruct_OneOf(t *testing.T) {
	t.Parallel()
	type In struct {
		Period string `json:"period" validate:"required,oneof=day week month"`
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"period":"week"}`)); err != nil {
		t.Errorf("period=week should pass: %v", err)
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"period":"decade"}`)); err == nil {
		t.Errorf("period=decade should fail")
	}
}

func TestValidateStruct_Len(t *testing.T) {
	t.Parallel()
	type In struct {
		Code string `json:"code" validate:"required,len=4"`
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"code":"ABCD"}`)); err != nil {
		t.Errorf("code=ABCD should pass: %v", err)
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"code":"ABC"}`)); err == nil {
		t.Errorf("code=ABC should fail len=4")
	}
}

func TestValidateStruct_DivePerElement(t *testing.T) {
	t.Parallel()
	type In struct {
		IDs []int64 `json:"ids" validate:"required,gte=1,dive,gte=1"`
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"ids":[1,2,3]}`)); err != nil {
		t.Errorf("ids=[1,2,3] should pass: %v", err)
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"ids":[]}`)); err == nil {
		t.Errorf("ids=[] should fail length gte=1")
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"ids":[1, 0, 3]}`)); err == nil {
		t.Errorf("ids=[1,0,3] should fail per-element gte=1")
	}
}

func TestValidateStruct_RejectsUnknownFields(t *testing.T) {
	t.Parallel()
	type In struct {
		ID int64 `json:"id" validate:"required,gte=1"`
	}
	if _, err := ValidateStruct[In](json.RawMessage(`{"id":1, "extra":"oops"}`)); err == nil {
		t.Errorf("expected unknown-field rejection")
	}
}

func TestValidateStruct_EmptyPayloadProducesRequiredError(t *testing.T) {
	t.Parallel()
	type In struct {
		ID int64 `json:"id" validate:"required,gte=1"`
	}
	if _, err := ValidateStruct[In](nil); err == nil {
		t.Errorf("expected required error for nil payload")
	}
	if _, err := ValidateStruct[In](json.RawMessage("null")); err == nil {
		t.Errorf("expected required error for null payload")
	}
}
