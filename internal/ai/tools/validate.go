package tools

import (
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// ValidateStruct decodes raw into a fresh instance of T and runs the
// same `validate:"..."` tag rules the [Generate] schema encodes. It
// is the runtime half of the R2 mitigation: by sharing parseValidateTag
// + the rule-application code with the schema generator, we guarantee
// that every payload accepted by the JSON-Schema is also accepted here
// (and vice versa).
//
// Returns the typed value (zero value when err != nil) and the first
// validation error encountered. Errors include the offending field's
// JSON name so the LLM can fix its proposal on the next turn.
//
// Generic over T so the tool's typed input contract is preserved at
// compile time. Use it from a tool's Validate as:
//
//	func (t *MyTool) Validate(raw json.RawMessage) (any, error) {
//	    return tools.ValidateStruct[MyInput](raw)
//	}
func ValidateStruct[T any](raw json.RawMessage) (any, error) {
	var v T
	if len(raw) == 0 || string(raw) == "null" {
		// No payload — let validation tell the caller which required
		// fields are missing rather than producing a generic
		// "empty body" message.
		raw = []byte("{}")
	}
	dec := json.NewDecoder(strings.NewReader(string(raw)))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&v); err != nil {
		return v, fmt.Errorf("tools: decode: %w", err)
	}
	if err := validateValue(reflect.ValueOf(v), reflect.TypeOf(v), ""); err != nil {
		return v, err
	}
	return v, nil
}

// ValidationError is the structured failure surface. Tool authors
// receive this from ValidateStruct and feed the .Field + .Rule pair
// back to the LLM so the model knows which key to fix.
type ValidationError struct {
	Field string // JSON path, e.g. "vehicle_id" or "filters.kind"
	Rule  string // The violated rule name, e.g. "required" / "gte=1"
	Msg   string // Human-readable message
}

func (e *ValidationError) Error() string {
	return fmt.Sprintf("tools: %s: %s", e.Field, e.Msg)
}

// validateValue is the runtime mirror of [applyValidateRules]. It
// walks the value alongside its type and applies every rule it finds
// in `validate:"..."` tags. Returns the first error encountered.
func validateValue(v reflect.Value, t reflect.Type, path string) error {
	for v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return nil
		}
		v = v.Elem()
		t = t.Elem()
	}

	switch v.Kind() {
	case reflect.Struct:
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if !f.IsExported() {
				continue
			}
			jsonName, _ := parseJSONTag(f.Tag.Get("json"), f.Name)
			if jsonName == "-" {
				continue
			}
			child := v.Field(i)
			fieldPath := jsonName
			if path != "" {
				fieldPath = path + "." + jsonName
			}
			validateTag := f.Tag.Get("validate")
			if err := applyRulesRuntime(child, f.Type, validateTag, fieldPath); err != nil {
				return err
			}
			// Recurse into nested structs (validate any fields they declare).
			if f.Type.Kind() == reflect.Struct {
				if err := validateValue(child, f.Type, fieldPath); err != nil {
					return err
				}
			}
			if f.Type.Kind() == reflect.Slice || f.Type.Kind() == reflect.Array {
				// Recurse into slice elements when they are structs;
				// post-dive rules were already applied above.
				if f.Type.Elem().Kind() == reflect.Struct {
					for j := 0; j < child.Len(); j++ {
						elemPath := fmt.Sprintf("%s[%d]", fieldPath, j)
						if err := validateValue(child.Index(j), f.Type.Elem(), elemPath); err != nil {
							return err
						}
					}
				}
			}
		}
	}
	return nil
}

// applyRulesRuntime is the value-side counterpart of applySingleRule
// — it checks the constraints rather than emitting them.
//
// `omitempty` (a standard go-playground/validator keyword that the
// schema generator silently ignores) short-circuits the rest of the
// rules when the value is its zero value. This matches the
// convention LLM-facing tools rely on for optional fields whose
// presence-OR-absence is acceptable but whose value MUST be drawn
// from a constrained set when present (e.g. trigger_mode in the
// nl-alert-builder slice).
func applyRulesRuntime(v reflect.Value, t reflect.Type, tag, path string) error {
	pre, post := parseValidateTag(tag)
	// omitempty: skip every other pre-dive rule when the value is
	// its zero value. The convention mirrors the canonical
	// go-playground/validator semantics so a tool author who knows
	// the validator library is not surprised here.
	for _, r := range pre {
		if r.Name == "omitempty" && isZero(v) {
			return nil
		}
	}
	for _, r := range pre {
		if r.Name == "omitempty" {
			continue
		}
		if err := checkRule(v, t, r, path); err != nil {
			return err
		}
	}
	if len(post) > 0 {
		// Apply post-dive rules to each slice element.
		if t.Kind() != reflect.Slice && t.Kind() != reflect.Array {
			return nil
		}
		for v.Kind() == reflect.Ptr {
			if v.IsNil() {
				return nil
			}
			v = v.Elem()
		}
		for i := 0; i < v.Len(); i++ {
			elem := v.Index(i)
			elemPath := fmt.Sprintf("%s[%d]", path, i)
			for _, r := range post {
				if r.Name == "omitempty" {
					if isZero(elem) {
						break
					}
					continue
				}
				if err := checkRule(elem, t.Elem(), r, elemPath); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// checkRule enforces ONE validate-rule on ONE value. Mirrors
// [applySingleRule] one-for-one so a payload accepted by the schema
// is accepted here.
func checkRule(v reflect.Value, t reflect.Type, r validateRule, path string) error {
	switch r.Name {
	case "required":
		if isZero(v) {
			return &ValidationError{Field: path, Rule: "required", Msg: "field is required"}
		}
	case "gte", "min":
		if isStringKind(t) {
			if v.Len() < mustInt(r.Value) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("string length must be ≥ %s", r.Value)}
			}
		} else if isArrayKind(t) {
			if v.Len() < mustInt(r.Value) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("array length must be ≥ %s", r.Value)}
			}
		} else if isNumericKind(t) {
			if numericLess(v, mustNumber(r.Value)) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("must be ≥ %s", r.Value)}
			}
		}
	case "lte", "max":
		if isStringKind(t) {
			if v.Len() > mustInt(r.Value) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("string length must be ≤ %s", r.Value)}
			}
		} else if isArrayKind(t) {
			if v.Len() > mustInt(r.Value) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("array length must be ≤ %s", r.Value)}
			}
		} else if isNumericKind(t) {
			if numericGreater(v, mustNumber(r.Value)) {
				return &ValidationError{Field: path, Rule: r.Name + "=" + r.Value, Msg: fmt.Sprintf("must be ≤ %s", r.Value)}
			}
		}
	case "len":
		n := mustInt(r.Value)
		if isStringKind(t) || isArrayKind(t) {
			if v.Len() != n {
				return &ValidationError{Field: path, Rule: "len=" + r.Value, Msg: fmt.Sprintf("length must equal %d", n)}
			}
		}
	case "oneof":
		opts := strings.Fields(r.Value)
		if !isStringKind(t) {
			return nil
		}
		got := v.String()
		for _, o := range opts {
			if got == o {
				return nil
			}
		}
		return &ValidationError{Field: path, Rule: "oneof=" + r.Value, Msg: fmt.Sprintf("must be one of: %s", strings.Join(opts, ", "))}
	}
	return nil
}

// isZero is the validate-required check. A required field fails when
// it is the zero value of its type — the same convention go-playground/
// validator uses.
func isZero(v reflect.Value) bool {
	for v.Kind() == reflect.Ptr {
		if v.IsNil() {
			return true
		}
		v = v.Elem()
	}
	return !v.IsValid() || v.IsZero()
}

func isNumericKind(t reflect.Type) bool {
	for t.Kind() == reflect.Ptr {
		t = t.Elem()
	}
	switch t.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
		reflect.Float32, reflect.Float64:
		return true
	}
	return false
}

func numericLess(v reflect.Value, threshold float64) bool {
	switch v.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(v.Int()) < threshold
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return float64(v.Uint()) < threshold
	case reflect.Float32, reflect.Float64:
		return v.Float() < threshold
	}
	return false
}

func numericGreater(v reflect.Value, threshold float64) bool {
	switch v.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return float64(v.Int()) > threshold
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return float64(v.Uint()) > threshold
	case reflect.Float32, reflect.Float64:
		return v.Float() > threshold
	}
	return false
}

// AsValidationError unwraps an error chain to its underlying
// [*ValidationError], returning nil + false when the error is some
// other kind. Used by the dispatcher to format the LLM-visible reply.
func AsValidationError(err error) (*ValidationError, bool) {
	var ve *ValidationError
	if errors.As(err, &ve) {
		return ve, true
	}
	return nil, false
}
