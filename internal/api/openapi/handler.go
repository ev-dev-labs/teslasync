package openapi

import (
	"net/http"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// openAPISpec holds the raw YAML bytes of the OpenAPI spec.
// Set at startup via SetOpenAPISpec (typically from go:embed in main.go).
var openAPISpec []byte

// SetOpenAPISpec stores the raw YAML bytes for serving.
func SetOpenAPISpec(yamlBytes []byte) {
	openAPISpec = yamlBytes
}

// Handler serves the embedded OpenAPI spec as YAML.
// Frontend parses with js-yaml to avoid adding a Go YAML dependency.
func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if len(openAPISpec) == 0 {
			httpx.WriteError(w, http.StatusNotFound, "OpenAPI spec not available")
			return
		}
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		w.Write(openAPISpec)
	}
}
