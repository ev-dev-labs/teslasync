package tools

import (
	"encoding/json"
	"fmt"
	"reflect"
	"sort"
	"strconv"
	"strings"
)

// Generate builds a JSON-Schema document from a Go struct type
// annotated with `json:"..."` and `validate:"..."` tags.
//
// The generator and the runtime [ValidateStruct] check the same set
// of tag rules, so a payload accepted by one is accepted by the
// other. This is the R2 mitigation called out in the F4 design doc:
// the schema the LLM sees is reflected from the same source the
// dispatcher's validator uses, eliminating the class of bug where
// the model proposes a payload the handler rejects.
//
// Supported `validate:"..."` rules
//
//	required        — field MUST be present in the payload
//	gte=N           — numeric field ≥ N (also: array/string min length on slice/string types)
//	lte=N           — numeric field ≤ N (also: array/string max length on slice/string types)
//	min=N / max=N   — alias for gte / lte (lenient — go-playground users mix the two)
//	len=N           — string length / slice length == N
//	oneof=a b c     — value MUST be one of the listed strings (uppercase / lowercase preserved)
//	dive            — apply the remaining rules to slice elements (unsupported for maps)
//
// Unsupported rules are silently skipped; the validator does the
// same so the two stay aligned.
//
// Field naming: the generator uses the `json:"name"` tag if present,
// falling back to lower-snake_case of the Go field name. Anonymous
// embedded structs are flattened into the parent (matching encoding/json
// behaviour). Pointer fields generate the same schema as the underlying
// type but are not marked required by default.
//
// Usage:
//
//	type Input struct {
//	    VehicleID int64  `json:"vehicle_id" validate:"required,gte=1"`
//	    Limit     int    `json:"limit"      validate:"gte=1,lte=100"`
//	}
//	schema := tools.Generate(reflect.TypeOf(Input{}))
//	tool := &MyTool{schema: schema}
//
// The returned [json.RawMessage] is a fully-rendered JSON document;
// callers do NOT need to re-marshal it before feeding to a provider.
func Generate(t reflect.Type) json.RawMessage {
	schema := schemaFor(t)
	// Stable, deterministic JSON — sort keys via a manual marshal so
	// the same struct always produces byte-identical output. This is
	// important for golden-file tests in later eval slices.
	out, err := json.MarshalIndent(schema, "", "  ")
	if err != nil {
		// json.Marshal of a map[string]any produced by schemaFor cannot
		// fail in practice; panic on the impossible so a future
		// regression surfaces immediately.
		panic(fmt.Sprintf("tools.Generate: marshal: %v", err))
	}
	return json.RawMessage(out)
}

// schemaFor recursively builds the schema map for one type. Returns a
// map[string]any with at minimum a "type" key. Object types include
// "properties" and "required"; array types include "items"; primitive
// types include only "type".
func schemaFor(t reflect.Type) map[string]any {
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}

	switch t.Kind() {
	case reflect.Struct:
		return objectSchema(t)
	case reflect.Slice, reflect.Array:
		return map[string]any{
			"type":  "array",
			"items": schemaFor(t.Elem()),
		}
	case reflect.String:
		return map[string]any{"type": "string"}
	case reflect.Bool:
		return map[string]any{"type": "boolean"}
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return map[string]any{"type": "integer"}
	case reflect.Float32, reflect.Float64:
		return map[string]any{"type": "number"}
	case reflect.Map:
		// Maps degrade to a generic object with string keys; the
		// validator does not enforce per-key constraints either.
		return map[string]any{"type": "object"}
	case reflect.Interface:
		// `any`-typed fields accept any JSON shape.
		return map[string]any{}
	default:
		// Channels, funcs, etc. — unrepresentable. Emit an empty
		// schema rather than panicking; the validator will reject
		// any value that reaches a non-representable kind.
		return map[string]any{}
	}
}

// objectSchema produces the JSON Schema object representation of a
// Go struct type, walking embedded fields and consulting validate
// tags for each exported field.
func objectSchema(t reflect.Type) map[string]any {
	props := map[string]any{}
	required := []string{}

	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		// Honor json:"-" the same way encoding/json does.
		jsonTag := f.Tag.Get("json")
		jsonName, jsonOpts := parseJSONTag(jsonTag, f.Name)
		if jsonName == "-" {
			continue
		}

		// Anonymous embedded structs are flattened.
		if f.Anonymous && f.Type.Kind() == reflect.Struct {
			child := objectSchema(f.Type)
			if cp, ok := child["properties"].(map[string]any); ok {
				for k, v := range cp {
					props[k] = v
				}
			}
			if cr, ok := child["required"].([]string); ok {
				required = append(required, cr...)
			}
			continue
		}

		fieldSchema := schemaFor(f.Type)
		validateTag := f.Tag.Get("validate")
		applyValidateRules(fieldSchema, validateTag, f.Type)

		if descriptionOf(f) != "" {
			fieldSchema["description"] = descriptionOf(f)
		}

		props[jsonName] = fieldSchema

		if isRequired(validateTag) {
			required = append(required, jsonName)
		}
		_ = jsonOpts
	}

	out := map[string]any{
		"type":       "object",
		"properties": props,
	}
	if len(required) > 0 {
		// Stable order so generated schemas are deterministic.
		sort.Strings(required)
		out["required"] = required
	}
	out["additionalProperties"] = false
	return out
}

// applyValidateRules mutates fieldSchema in-place to encode the
// constraints listed in tag. The function is split per-rule so the
// runtime ValidateStruct can reuse the same parsing logic.
func applyValidateRules(fieldSchema map[string]any, tag string, fieldType reflect.Type) {
	rules, postDive := parseValidateTag(tag)
	for _, r := range rules {
		applySingleRule(fieldSchema, r, fieldType)
	}
	// "dive" pivots remaining rules onto the array element schema.
	if len(postDive) > 0 {
		items, ok := fieldSchema["items"].(map[string]any)
		if !ok {
			items = map[string]any{}
			fieldSchema["items"] = items
		}
		elemType := fieldType
		if fieldType.Kind() == reflect.Slice || fieldType.Kind() == reflect.Array {
			elemType = fieldType.Elem()
		}
		for _, r := range postDive {
			applySingleRule(items, r, elemType)
		}
	}
}

func applySingleRule(schema map[string]any, r validateRule, t reflect.Type) {
	switch r.Name {
	case "required":
		// Encoded at the parent level; nothing to do on the field
		// schema itself.
	case "gte", "min":
		if isStringKind(t) {
			schema["minLength"] = mustInt(r.Value)
		} else if isArrayKind(t) {
			schema["minItems"] = mustInt(r.Value)
		} else {
			schema["minimum"] = mustNumber(r.Value)
		}
	case "lte", "max":
		if isStringKind(t) {
			schema["maxLength"] = mustInt(r.Value)
		} else if isArrayKind(t) {
			schema["maxItems"] = mustInt(r.Value)
		} else {
			schema["maximum"] = mustNumber(r.Value)
		}
	case "len":
		n := mustInt(r.Value)
		if isStringKind(t) {
			schema["minLength"] = n
			schema["maxLength"] = n
		} else if isArrayKind(t) {
			schema["minItems"] = n
			schema["maxItems"] = n
		}
	case "oneof":
		// oneof values are space-separated; preserve order so the
		// schema's enum array matches the validator's check order.
		parts := strings.Fields(r.Value)
		enum := make([]any, 0, len(parts))
		for _, p := range parts {
			enum = append(enum, p)
		}
		schema["enum"] = enum
	}
}

// validateRule is one parsed token from a `validate:"..."` tag.
// e.g. "gte=1" → {Name: "gte", Value: "1"}.
type validateRule struct {
	Name  string
	Value string
}

// parseValidateTag splits a comma-separated `validate:"..."` tag into
// rules. "dive" partitions the rules: anything BEFORE dive applies to
// the slice itself, anything AFTER applies to elements.
func parseValidateTag(tag string) (preDive, postDive []validateRule) {
	if tag == "" {
		return nil, nil
	}
	tokens := strings.Split(tag, ",")
	dived := false
	for _, raw := range tokens {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		if raw == "dive" {
			dived = true
			continue
		}
		name, value, _ := strings.Cut(raw, "=")
		// oneof's value contains spaces; strings.Cut returns the
		// whole thing after the first '=' so this is correct.
		r := validateRule{Name: strings.TrimSpace(name), Value: strings.TrimSpace(value)}
		if dived {
			postDive = append(postDive, r)
		} else {
			preDive = append(preDive, r)
		}
	}
	return preDive, postDive
}

// isRequired reports whether tag contains the required token.
func isRequired(tag string) bool {
	rules, _ := parseValidateTag(tag)
	for _, r := range rules {
		if r.Name == "required" {
			return true
		}
	}
	return false
}

// parseJSONTag splits "name,opt1,opt2" → ("name", ["opt1","opt2"]).
// Returns fallbackName when the tag is empty.
func parseJSONTag(tag, fallback string) (string, []string) {
	if tag == "" {
		return camelToSnake(fallback), nil
	}
	parts := strings.Split(tag, ",")
	name := parts[0]
	if name == "" {
		name = camelToSnake(fallback)
	}
	return name, parts[1:]
}

// descriptionOf reads a `desc:"..."` struct tag if present so tool
// authors can annotate fields with LLM-visible hints. The validator
// ignores this tag.
func descriptionOf(f reflect.StructField) string {
	return strings.TrimSpace(f.Tag.Get("desc"))
}

func isStringKind(t reflect.Type) bool {
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	return t.Kind() == reflect.String
}

func isArrayKind(t reflect.Type) bool {
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	return t.Kind() == reflect.Slice || t.Kind() == reflect.Array
}

func mustInt(s string) int {
	n, err := strconv.Atoi(s)
	if err != nil {
		// Validate-tag authors get a deterministic panic at boot,
		// rather than a silently-malformed schema served to the LLM.
		panic(fmt.Sprintf("tools: invalid integer in validate tag: %q", s))
	}
	return n
}

func mustNumber(s string) float64 {
	n, err := strconv.ParseFloat(s, 64)
	if err != nil {
		panic(fmt.Sprintf("tools: invalid number in validate tag: %q", s))
	}
	return n
}

// camelToSnake converts a Go-style identifier to lower_snake_case for
// use as a JSON field name when the struct field has no `json:"..."`
// tag. Mirrors encoding/json's behaviour minimally — Go field names
// "DriveID" → "drive_id", "VIN" → "vin", "AvgSpeedMph" → "avg_speed_mph".
func camelToSnake(s string) string {
	if s == "" {
		return s
	}
	var b strings.Builder
	for i, r := range s {
		if i > 0 && r >= 'A' && r <= 'Z' {
			// Insert _ when the previous rune was lowercase, OR when
			// the next rune is lowercase (ABCdef → ab_cdef).
			prev := rune(s[i-1])
			next := rune(0)
			if i+1 < len(s) {
				next = rune(s[i+1])
			}
			if (prev >= 'a' && prev <= 'z') || (next >= 'a' && next <= 'z' && prev >= 'A' && prev <= 'Z') {
				b.WriteByte('_')
			}
		}
		if r >= 'A' && r <= 'Z' {
			b.WriteRune(r + ('a' - 'A'))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}
