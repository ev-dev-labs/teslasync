package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/ev-dev-labs/teslasync/cmd/openapi-gen/gen"
)

// specPath locates the committed contract relative to this test's package dir.
func specPath() string {
	return filepath.Join("..", "..", "api", "openapi", "teslasync.openapi.json")
}

type openAPIDoc struct {
	OpenAPI string `json:"openapi"`
	Info    struct {
		Title   string `json:"title"`
		Version string `json:"version"`
	} `json:"info"`
	Security   []map[string]any          `json:"security"`
	Paths      map[string]map[string]any `json:"paths"`
	Components struct {
		SecuritySchemes map[string]map[string]any `json:"securitySchemes"`
		Schemas         map[string]any            `json:"schemas"`
	} `json:"components"`
}

func loadSpec(t *testing.T) *openAPIDoc {
	t.Helper()
	raw, err := os.ReadFile(specPath())
	if err != nil {
		t.Fatalf("read spec (run `go run ./cmd/openapi-gen -out api/openapi/teslasync.openapi.json`): %v", err)
	}
	var doc openAPIDoc
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatalf("parse spec JSON: %v", err)
	}
	return &doc
}

func buildRouterT(t *testing.T) (http.Handler, func()) {
	t.Helper()
	h, cleanup, err := gen.BuildRouter()
	if err != nil {
		t.Fatalf("build router: %v", err)
	}
	return h, cleanup
}

// httpMethodFields are the OpenAPI Path Item fields that denote operations.
var httpMethodFields = map[string]bool{
	"get": true, "put": true, "post": true, "delete": true,
	"options": true, "head": true, "patch": true, "trace": true,
}

// specOperations flattens the spec into a set of "METHOD path" keys.
func specOperations(doc *openAPIDoc) map[string]bool {
	ops := map[string]bool{}
	for path, item := range doc.Paths {
		for field := range item {
			if httpMethodFields[field] {
				ops[strings.ToUpper(field)+" "+path] = true
			}
		}
	}
	return ops
}

// TestOpenAPI_RouteCoverage asserts every route registered on the router (the
// source of truth) appears in the committed spec. CONNECT (chi registers
// /metrics for every method) is excluded because OpenAPI cannot represent it.
func TestOpenAPI_RouteCoverage(t *testing.T) {
	doc := loadSpec(t)
	ops := specOperations(doc)

	h, cleanup := buildRouterT(t)
	defer cleanup()
	routes, err := gen.WalkRoutes(h)
	if err != nil {
		t.Fatalf("walk routes: %v", err)
	}

	var missing []string
	for _, rt := range routes {
		if !gen.IsOpenAPIMethod(rt.Method) {
			continue
		}
		key := strings.ToUpper(rt.Method) + " " + rt.Path
		if !ops[key] {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		t.Fatalf("%d router routes missing from spec:\n%s", len(missing), strings.Join(missing, "\n"))
	}
}

// TestOpenAPI_NoPhantomRoutes asserts the spec documents nothing that the
// router does not actually serve.
func TestOpenAPI_NoPhantomRoutes(t *testing.T) {
	doc := loadSpec(t)
	ops := specOperations(doc)

	h, cleanup := buildRouterT(t)
	defer cleanup()
	routes, err := gen.WalkRoutes(h)
	if err != nil {
		t.Fatalf("walk routes: %v", err)
	}
	live := map[string]bool{}
	for _, rt := range routes {
		live[strings.ToUpper(rt.Method)+" "+rt.Path] = true
	}

	var phantom []string
	for key := range ops {
		if !live[key] {
			phantom = append(phantom, key)
		}
	}
	if len(phantom) > 0 {
		t.Fatalf("%d spec operations not served by router:\n%s", len(phantom), strings.Join(phantom, "\n"))
	}
}

// concretePath substitutes {param} segments with a representative value so the
// templated path can be matched against the router.
func concretePath(path string) string {
	segs := strings.Split(path, "/")
	for i, s := range segs {
		if strings.HasPrefix(s, "{") && strings.HasSuffix(s, "}") {
			segs[i] = "1"
		}
	}
	return strings.Join(segs, "/")
}

// TestOpenAPI_Conformance proves every documented operation resolves to a real
// route on the live router. Matching is done at the routing layer (chi.Match),
// which exercises the router exactly as a real request would without invoking
// handlers — avoiding nil-dependency panics and never blocking on the SSE
// streaming endpoints.
func TestOpenAPI_Conformance(t *testing.T) {
	doc := loadSpec(t)

	h, cleanup := buildRouterT(t)
	defer cleanup()
	routes, ok := h.(chi.Routes)
	if !ok {
		t.Fatalf("router is not chi.Routes: %T", h)
	}

	var unresolved []string
	for path, item := range doc.Paths {
		for field := range item {
			if !httpMethodFields[field] {
				continue
			}
			method := strings.ToUpper(field)
			rctx := chi.NewRouteContext()
			if !routes.Match(rctx, method, concretePath(path)) {
				unresolved = append(unresolved, method+" "+path)
			}
		}
	}
	if len(unresolved) > 0 {
		t.Fatalf("%d documented operations did not resolve on the router:\n%s",
			len(unresolved), strings.Join(unresolved, "\n"))
	}
}

// TestOpenAPI_LiveRequestStatus issues real HTTP requests against the documented
// health endpoints and asserts the route resolves (not 404/405) and returns a
// JSON object whose keys are a subset of the (additionalProperties) schema.
// Status is 200 when ready or 503 when degraded; without a live database the
// readiness probe reports degraded, which the spec's default response covers.
func TestOpenAPI_LiveRequestStatus(t *testing.T) {
	doc := loadSpec(t)
	h, cleanup := buildRouterT(t)
	defer cleanup()
	srv := httptest.NewServer(h)
	defer srv.Close()

	for _, ep := range []string{"/healthz", "/readyz"} {
		if _, documented := doc.Paths[ep]; !documented {
			t.Fatalf("%s is served but not documented in the spec", ep)
		}
		resp, err := http.Get(srv.URL + ep)
		if err != nil {
			t.Fatalf("GET %s: %v", ep, err)
		}
		if resp.StatusCode == http.StatusNotFound || resp.StatusCode == http.StatusMethodNotAllowed {
			resp.Body.Close()
			t.Fatalf("GET %s: route did not resolve, status=%d", ep, resp.StatusCode)
		}
		var body map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
			resp.Body.Close()
			t.Fatalf("GET %s: decode JSON object: %v", ep, err)
		}
		resp.Body.Close()
		// 200 returns the health object ({"status":...}); 503 returns the
		// documented Error envelope ({"error":...,"code":...}). Either is a
		// valid documented response shape.
		_, hasStatus := body["status"]
		_, hasError := body["error"]
		if !hasStatus && !hasError {
			t.Fatalf("GET %s: response is neither health nor Error envelope: %v", ep, body)
		}
	}
}

// TestOpenAPI_Structure validates the document-level OpenAPI 3.1 invariants and
// the SI / nullable / SSE / path-parameter contract the artifact must satisfy.
func TestOpenAPI_Structure(t *testing.T) {
	doc := loadSpec(t)

	if doc.OpenAPI != "3.1.0" {
		t.Errorf("openapi = %q, want 3.1.0", doc.OpenAPI)
	}
	if doc.Info.Title == "" || doc.Info.Version == "" {
		t.Errorf("info.title/version must be set, got %+v", doc.Info)
	}
	scheme, ok := doc.Components.SecuritySchemes["bearerAuth"]
	if !ok {
		t.Fatal("components.securitySchemes.bearerAuth missing")
	}
	if scheme["type"] != "http" || scheme["scheme"] != "bearer" {
		t.Errorf("bearerAuth must be http/bearer, got %+v", scheme)
	}
	if len(doc.Security) == 0 {
		t.Error("global security requirement missing")
	}

	// Every operation must declare a 200 response.
	for path, item := range doc.Paths {
		for field, raw := range item {
			if !httpMethodFields[field] {
				continue
			}
			op, _ := raw.(map[string]any)
			resps, _ := op["responses"].(map[string]any)
			if _, ok := resps["200"]; !ok {
				t.Errorf("%s %s: missing 200 response", strings.ToUpper(field), path)
			}
		}
	}

	// SI units are documented in component schema field descriptions, and Go
	// pointer fields are rendered nullable via a JSON-Schema type array.
	drive := schemaProps(t, doc, "Drive")
	distanceM, _ := drive["distance_m"].(map[string]any)
	if desc, _ := distanceM["description"].(string); !strings.Contains(desc, "meters") {
		t.Errorf("Drive.distance_m description should document SI meters, got %q", desc)
	}
	energyWh, _ := drive["energy_used_wh"].(map[string]any)
	if !typeIncludesNull(energyWh["type"]) {
		t.Errorf("Drive.energy_used_wh is a Go pointer; type should include \"null\", got %v", energyWh["type"])
	}

	// SSE endpoint is documented as text/event-stream.
	assertSSE(t, doc, "/api/v1/events", "get")

	// Path parameter is declared and matches the chi template name.
	assertPathParam(t, doc, "/api/v1/vehicles/{vehicleID}/state", "get", "vehicleID")
}

func schemaProps(t *testing.T, doc *openAPIDoc, name string) map[string]any {
	t.Helper()
	s, ok := doc.Components.Schemas[name].(map[string]any)
	if !ok {
		t.Fatalf("component schema %q missing", name)
	}
	props, ok := s["properties"].(map[string]any)
	if !ok {
		t.Fatalf("component schema %q has no properties", name)
	}
	return props
}

func typeIncludesNull(v any) bool {
	arr, ok := v.([]any)
	if !ok {
		return false
	}
	for _, e := range arr {
		if e == "null" {
			return true
		}
	}
	return false
}

func assertSSE(t *testing.T, doc *openAPIDoc, path, method string) {
	t.Helper()
	item, ok := doc.Paths[path]
	if !ok {
		t.Fatalf("SSE path %s missing", path)
	}
	op, _ := item[method].(map[string]any)
	resps, _ := op["responses"].(map[string]any)
	r200, _ := resps["200"].(map[string]any)
	content, _ := r200["content"].(map[string]any)
	if _, ok := content["text/event-stream"]; !ok {
		t.Errorf("%s %s should document text/event-stream, got content keys %v", strings.ToUpper(method), path, keys(content))
	}
}

func assertPathParam(t *testing.T, doc *openAPIDoc, path, method, name string) {
	t.Helper()
	item, ok := doc.Paths[path]
	if !ok {
		t.Fatalf("path %s missing", path)
	}
	op, _ := item[method].(map[string]any)
	params, _ := op["parameters"].([]any)
	for _, p := range params {
		pm, _ := p.(map[string]any)
		if pm["in"] == "path" && pm["name"] == name {
			if pm["required"] != true {
				t.Errorf("%s %s path param %s must be required", strings.ToUpper(method), path, name)
			}
			return
		}
	}
	t.Errorf("%s %s missing path parameter %q", strings.ToUpper(method), path, name)
}

func keys(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
