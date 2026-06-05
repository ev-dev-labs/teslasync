package gen

import (
	"reflect"
	"strings"
)

// jsonSchema is a minimal JSON-Schema / OpenAPI 3.1 schema object.
type jsonSchema map[string]any

// nullable wraps a base scalar type into the OpenAPI 3.1 nullable form. The 3.0
// `nullable: true` keyword was removed in 3.1; the canonical way to express a
// Go pointer field's nullability is a JSON-Schema type array including "null".
func withNull(base string) []any { return []any{base, "null"} }

// unitDescription returns an SI-unit note derived from a snake_case JSON field
// name suffix, per the Phase-42/48 SI-canonical contract (meters, seconds,
// watt-hours, m/s, watts, Celsius, pascals, ...). Returns "" when the field
// carries no recognised physical unit.
func unitDescription(jsonName string) string {
	parts := strings.Split(jsonName, "_")
	last := parts[len(parts)-1]
	switch last {
	case "m":
		if jsonName == "start_lng" || jsonName == "start_lat" {
			return ""
		}
		return "meters (SI)"
	case "s":
		return "seconds (SI)"
	case "wh":
		return "watt-hours (SI)"
	case "w":
		return "watts (SI)"
	case "mps":
		return "meters per second (SI)"
	case "c":
		return "degrees Celsius (SI)"
	case "pa":
		return "pascals (SI)"
	case "kpa":
		return "kilopascals"
	case "a":
		return "amperes (SI)"
	case "v":
		return "volts (SI)"
	case "pct":
		return "percent (0-100)"
	case "km":
		return "kilometers"
	}
	switch {
	case strings.Contains(jsonName, "latitude") || jsonName == "lat" || strings.HasSuffix(jsonName, "_lat"):
		return "decimal degrees latitude"
	case strings.Contains(jsonName, "longitude") || jsonName == "lon" || strings.HasSuffix(jsonName, "_lon") || strings.HasSuffix(jsonName, "_lng"):
		return "decimal degrees longitude"
	case strings.Contains(jsonName, "odometer"):
		return "meters (SI)"
	}
	return ""
}

// schemaForType reflects a Go type into an OpenAPI 3.1 schema. Pointer types are
// rendered nullable (type array including "null"). time.Time renders as a
// date-time string. Structs recurse over their json-tagged exported fields.
func schemaForType(t reflect.Type) jsonSchema {
	nullable := false
	for t.Kind() == reflect.Ptr {
		nullable = true
		t = t.Elem()
	}

	// time.Time → RFC3339 string.
	if t.PkgPath() == "time" && t.Name() == "Time" {
		s := jsonSchema{"format": "date-time"}
		if nullable {
			s["type"] = withNull("string")
		} else {
			s["type"] = "string"
		}
		return s
	}

	switch t.Kind() {
	case reflect.Struct:
		props := jsonSchema{}
		var required []string
		for i := 0; i < t.NumField(); i++ {
			f := t.Field(i)
			if f.PkgPath != "" { // unexported
				continue
			}
			name, omit, skip := jsonFieldName(f)
			if skip {
				continue
			}
			fs := schemaForType(f.Type)
			if desc := unitDescription(name); desc != "" {
				fs["description"] = desc
			}
			props[name] = fs
			if !omit && f.Type.Kind() != reflect.Ptr {
				required = append(required, name)
			}
		}
		s := jsonSchema{"properties": props, "additionalProperties": false}
		if nullable {
			s["type"] = withNull("object")
		} else {
			s["type"] = "object"
		}
		if len(required) > 0 {
			s["required"] = required
		}
		return s

	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 { // []byte → base64 string
			return scalarSchema("string", nullable)
		}
		return jsonSchema{"type": "array", "items": schemaForType(t.Elem())}

	case reflect.Map:
		return jsonSchema{"type": "object", "additionalProperties": true}

	case reflect.Bool:
		return scalarSchema("boolean", nullable)

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
		reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		return scalarSchema("integer", nullable)

	case reflect.Float32, reflect.Float64:
		return scalarSchema("number", nullable)

	case reflect.String:
		return scalarSchema("string", nullable)

	case reflect.Interface:
		return jsonSchema{} // any

	default:
		return jsonSchema{}
	}
}

func scalarSchema(base string, nullable bool) jsonSchema {
	if nullable {
		return jsonSchema{"type": withNull(base)}
	}
	return jsonSchema{"type": base}
}

// jsonFieldName parses a struct field's json tag, returning the wire name,
// whether it is omitempty, and whether the field is skipped (`json:"-"`).
func jsonFieldName(f reflect.StructField) (name string, omitempty bool, skip bool) {
	tag := f.Tag.Get("json")
	if tag == "-" {
		return "", false, true
	}
	if tag == "" {
		return f.Name, false, false
	}
	parts := strings.Split(tag, ",")
	name = parts[0]
	if name == "" {
		name = f.Name
	}
	for _, p := range parts[1:] {
		if p == "omitempty" {
			omitempty = true
		}
	}
	return name, omitempty, false
}
