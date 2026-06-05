package gen

import (
	"reflect"
	"sort"
	"strings"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	energymodel "github.com/ev-dev-labs/teslasync/internal/models/energy"
	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
)

// SpecVersion is the contract version stamped into info.version. Bump when the
// HTTP surface changes in a backwards-incompatible way.
const SpecVersion = "1.0.0"

// componentModels are the Go response structs reflected into named component
// schemas. Documenting every one of the 533 routes' bodies is out of scope for
// this artifact (ADR-003 establishes the contract skeleton); these core
// resources are typed precisely from their Go structs (snake_case json tags,
// pointer→nullable, SI units in descriptions) and the remaining operations
// reference a generic JSON object plus the shared Error schema.
var componentModels = map[string]any{
	"Vehicle":                vehiclemodel.Vehicle{},
	"VehicleState":           vehiclemodel.VehicleState{},
	"Drive":                  drivemodel.Drive{},
	"DriveTelemetryReading":  drivemodel.DriveTelemetryReading{},
	"ShareToken":             drivemodel.ShareToken{},
	"ChargingSession":        chargingmodel.ChargingSession{},
	"ChargeTelemetryReading": chargingmodel.ChargeTelemetryReading{},
	"EnergyStatsRow":         energymodel.EnergyStatsRow{},
}

// resourceRefs maps "METHOD path" to the success-response schema for the core
// typed resources. A leading "[]" denotes an array of the named component.
var resourceRefs = map[string]string{
	"GET /api/v1/vehicles/":                      "[]Vehicle",
	"GET /api/v1/vehicles/{vehicleID}/":          "Vehicle",
	"GET /api/v1/vehicles/{vehicleID}/state":     "VehicleState",
	"GET /api/v1/drives/":                        "[]Drive",
	"GET /api/v1/drives/{driveID}/":              "Drive",
	"GET /api/v1/drives/{driveID}/telemetry":     "[]DriveTelemetryReading",
	"GET /api/v1/share/{token}":                  "ShareToken",
	"GET /api/v1/charging-sessions":              "[]ChargingSession",
	"GET /api/v1/charging/{sessionID}/":          "ChargingSession",
	"GET /api/v1/charging/{sessionID}/telemetry": "[]ChargeTelemetryReading",
	"GET /api/v1/analytics/energy":               "[]EnergyStatsRow",
}

// queryParams maps "METHOD path" to verified snake_case query parameters. These
// are read directly from the handler/router source (not guessed), keeping the
// documented parameters honest.
var queryParams = map[string][]queryParam{
	"GET /api/v1/drives/": {
		{Name: "vehicle_id", Type: "integer", Desc: "Filter drives by vehicle id."},
	},
	"GET /api/v1/charging-sessions": {
		{Name: "vehicle_id", Type: "integer", Desc: "Filter charging sessions by vehicle id."},
	},
	"GET /api/v1/signals/history": {
		{Name: "vehicle_id", Type: "integer", Desc: "Vehicle id."},
		{Name: "signals", Type: "string", Desc: "Comma-separated Tesla signal names."},
		{Name: "from", Type: "string", Desc: "RFC3339 start of the time window."},
		{Name: "to", Type: "string", Desc: "RFC3339 end of the time window."},
		{Name: "page", Type: "integer", Desc: "1-based page number."},
		{Name: "per_page", Type: "integer", Desc: "Page size."},
	},
	"GET /api/v1/signals/stats": {
		{Name: "vehicle_id", Type: "integer", Desc: "Vehicle id."},
		{Name: "signals", Type: "string", Desc: "Comma-separated Tesla signal names."},
		{Name: "from", Type: "string", Desc: "RFC3339 start of the time window."},
		{Name: "to", Type: "string", Desc: "RFC3339 end of the time window."},
	},
}

type queryParam struct {
	Name string
	Type string
	Desc string
}

// openAPIMethods is the set of HTTP methods that have a corresponding OpenAPI
// 3.1 Path Item field. CONNECT is intentionally absent — the spec cannot
// represent it.
var openAPIMethods = map[string]bool{
	"GET": true, "PUT": true, "POST": true, "DELETE": true,
	"OPTIONS": true, "HEAD": true, "PATCH": true, "TRACE": true,
}

// IsOpenAPIMethod reports whether an HTTP method can be represented as an
// OpenAPI 3.1 Path Item field. CONNECT cannot and is therefore excluded from
// both the emitted spec and the conformance comparison.
func IsOpenAPIMethod(method string) bool {
	return openAPIMethods[strings.ToUpper(method)]
}

// publicPrefixes are route prefixes served without bearer auth (handled by
// ForwardAuth at the edge, or genuinely public). Operations under these get an
// explicit empty security requirement (security: []).
var publicPrefixes = []string{
	"/healthz",
	"/readyz",
	"/metrics",
	"/.well-known/",
	"/internal/",
	"/api/v1/auth/",
	"/api/v1/share/",
	"/api/v1/sse-token",
	"/api/v1/web-vitals",
	"/api/v1/web-errors",
}

// BuildSpec constructs the OpenAPI 3.1 document from the router's routes.
func BuildSpec(routes []Route) map[string]any {
	paths := map[string]any{}
	tagSet := map[string]struct{}{}

	for _, rt := range routes {
		if !openAPIMethods[strings.ToUpper(rt.Method)] {
			// CONNECT (chi registers /metrics for all methods) has no
			// OpenAPI path-item field; it cannot be represented. Skipped
			// here and excluded from the conformance comparison.
			continue
		}
		key := rt.Method + " " + rt.Path
		tag := tagFor(rt.Path)
		tagSet[tag] = struct{}{}

		op := map[string]any{
			"operationId": operationID(rt.Method, rt.Path),
			"summary":     summaryFor(rt.Method, rt.Path),
			"description": descriptionFor(rt.Method, rt.Path),
			"tags":        []any{tag},
			"responses":   responsesFor(key, rt.Path),
		}

		params := pathParameters(rt.Path)
		for _, qp := range queryParams[key] {
			params = append(params, map[string]any{
				"name":        qp.Name,
				"in":          "query",
				"required":    false,
				"description": qp.Desc,
				"schema":      map[string]any{"type": qp.Type},
			})
		}
		if len(params) > 0 {
			op["parameters"] = params
		}

		if isPublic(rt.Path) {
			op["security"] = []any{}
		}

		pi, ok := paths[rt.Path].(map[string]any)
		if !ok {
			pi = map[string]any{}
			paths[rt.Path] = pi
		}
		pi[strings.ToLower(rt.Method)] = op
	}

	tags := make([]any, 0, len(tagSet))
	names := make([]string, 0, len(tagSet))
	for n := range tagSet {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		tags = append(tags, map[string]any{
			"name":        n,
			"description": "Operations under the " + n + " resource group.",
		})
	}

	doc := map[string]any{
		"openapi": "3.1.0",
		"info": map[string]any{
			"title":       "TeslaSync API",
			"version":     SpecVersion,
			"description": "Self-hosted Tesla Fleet Intelligence Platform HTTP API. All quantitative fields are SI canonical (meters, seconds, watt-hours, m/s, watts, °C, pascals); display-unit conversion happens only at the frontend render boundary. Generated from the Chi router (ADR-003: OpenAPI is the source of truth).",
			"license":     map[string]any{"name": "Proprietary", "url": "https://github.com/ev-dev-labs/teslasync"},
			"contact":     map[string]any{"name": "TeslaSync", "url": "https://github.com/ev-dev-labs/teslasync"},
		},
		"servers": []any{
			map[string]any{"url": "/", "description": "Relative to the deployment origin; paths already include the /api/v1 prefix."},
		},
		"tags":     tags,
		"security": []any{map[string]any{"bearerAuth": []any{}}},
		"paths":    paths,
		"components": map[string]any{
			"securitySchemes": map[string]any{
				"bearerAuth": map[string]any{
					"type":        "http",
					"scheme":      "bearer",
					"description": "Bearer token. In the standard deployment, Authentik ForwardAuth terminates auth at the edge proxy ahead of the API (ADR-008).",
				},
			},
			"schemas": buildComponentSchemas(),
		},
	}
	return doc
}

func buildComponentSchemas() map[string]any {
	schemas := map[string]any{
		"Error": map[string]any{
			"type":                 "object",
			"description":          "Structured error envelope returned by writeError.",
			"additionalProperties": false,
			"properties": map[string]any{
				"error": map[string]any{"type": "string", "description": "Human-readable error message."},
				"code":  map[string]any{"type": "string", "description": "Stable machine-readable error code (e.g. NOT_FOUND)."},
			},
			"required": []any{"error"},
		},
	}
	for name, model := range componentModels {
		schemas[name] = schemaForType(reflect.TypeOf(model))
	}
	return schemas
}

// responsesFor returns the responses object for an operation. SSE endpoints
// document a text/event-stream 200; everything else a JSON 200 (typed for core
// resources, generic object otherwise) plus a shared default Error.
func responsesFor(key, path string) map[string]any {
	defaultErr := map[string]any{
		"description": "Error response.",
		"content": map[string]any{
			"application/json": map[string]any{
				"schema": map[string]any{"$ref": "#/components/schemas/Error"},
			},
		},
	}
	badRequest := map[string]any{
		"description": "Invalid request (validation, bad parameters, or unauthorized).",
		"content": map[string]any{
			"application/json": map[string]any{
				"schema": map[string]any{"$ref": "#/components/schemas/Error"},
			},
		},
	}

	if isSSE(path) {
		return map[string]any{
			"200": map[string]any{
				"description": "Server-Sent Events stream.",
				"content": map[string]any{
					"text/event-stream": map[string]any{
						"schema": map[string]any{
							"type":        "string",
							"description": "A stream of SSE `event:`/`data:` frames; each data payload is a JSON object.",
						},
					},
				},
			},
			"400":     badRequest,
			"default": defaultErr,
		}
	}

	return map[string]any{
		"200": map[string]any{
			"description": "Successful response.",
			"content": map[string]any{
				"application/json": map[string]any{
					"schema": successSchema(key),
				},
			},
		},
		"400":     badRequest,
		"default": defaultErr,
	}
}

func successSchema(key string) map[string]any {
	ref, ok := resourceRefs[key]
	if !ok {
		return map[string]any{"type": "object", "description": "JSON response payload."}
	}
	if strings.HasPrefix(ref, "[]") {
		return map[string]any{
			"type":  "array",
			"items": map[string]any{"$ref": "#/components/schemas/" + strings.TrimPrefix(ref, "[]")},
		}
	}
	return map[string]any{"$ref": "#/components/schemas/" + ref}
}

// pathParameters extracts {param} segments. Names are kept verbatim from the
// chi template (the OpenAPI parameter name must match the path-template
// variable exactly), and typed as string since path identifiers are matched as
// opaque strings by the router.
func pathParameters(path string) []map[string]any {
	var params []map[string]any
	for _, seg := range strings.Split(path, "/") {
		if len(seg) >= 2 && strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
			name := seg[1 : len(seg)-1]
			params = append(params, map[string]any{
				"name":        name,
				"in":          "path",
				"required":    true,
				"description": "Path identifier (" + name + ").",
				"schema":      map[string]any{"type": "string"},
			})
		}
	}
	return params
}

// tagFor derives a tag from the first meaningful path segment.
func tagFor(path string) string {
	trimmed := strings.TrimPrefix(path, "/api/v1/")
	trimmed = strings.TrimPrefix(trimmed, "/")
	for _, seg := range strings.Split(trimmed, "/") {
		if seg == "" {
			continue
		}
		if strings.HasPrefix(seg, "{") {
			continue
		}
		return seg
	}
	return "system"
}

func operationID(method, path string) string {
	repl := strings.NewReplacer("/", "_", "{", "", "}", "", "-", "_", ".", "_")
	cleaned := strings.Trim(repl.Replace(path), "_")
	cleaned = strings.ReplaceAll(cleaned, "__", "_")
	return strings.ToLower(method) + "_" + cleaned
}

func summaryFor(method, path string) string {
	return method + " " + path
}

func descriptionFor(method, path string) string {
	b := &strings.Builder{}
	b.WriteString("Route registered in internal/api/router.go.")
	if isSSE(path) {
		b.WriteString(" Server-Sent Events (text/event-stream) endpoint.")
	}
	return b.String()
}

func isSSE(path string) bool {
	return strings.HasSuffix(path, "/live") ||
		strings.HasSuffix(path, "/events") ||
		strings.HasSuffix(path, "/stream")
}

func isPublic(path string) bool {
	for _, p := range publicPrefixes {
		if path == p || strings.HasPrefix(path, p) {
			return true
		}
	}
	return false
}
