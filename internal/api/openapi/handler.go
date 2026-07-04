package openapi

import (
	"net/http"
	"sync/atomic"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
)

// spec holds the raw YAML bytes of the OpenAPI spec, stored atomically so the
// startup writer (SetOpenAPISpec) and concurrent HTTP readers (Handler) never
// race. A nil pointer means no spec has been injected yet.
//
// It is normally set once at startup (typically from a go:embed'd file in
// main.go), but the atomic guard also keeps a late or repeated SetOpenAPISpec
// call safe while requests are in flight.
var spec atomic.Pointer[[]byte]

// SetOpenAPISpec stores the raw YAML bytes for serving. Passing a nil or empty
// slice clears the stored spec, after which Handler responds 404 until a real
// spec is injected. Safe for concurrent use with in-flight requests.
func SetOpenAPISpec(yamlBytes []byte) {
	if len(yamlBytes) == 0 {
		spec.Store(nil)
		return
	}
	spec.Store(&yamlBytes)
}

// Handler serves the embedded OpenAPI spec as YAML. The frontend parses it with
// js-yaml to avoid adding a Go YAML dependency for this read-only endpoint.
//
// The spec bytes are loaded exactly once per request, so a concurrent
// SetOpenAPISpec cannot make the emptiness check and the response body
// disagree. When no spec has been injected the handler responds 404 with the
// standard JSON error envelope.
func Handler() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		p := spec.Load()
		if p == nil || len(*p) == 0 {
			httpx.WriteError(w, http.StatusNotFound, "OpenAPI spec not available")
			return
		}
		w.Header().Set("Content-Type", "text/yaml; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		w.WriteHeader(http.StatusOK)
		if _, err := w.Write(*p); err != nil {
			// The client hung up mid-stream; headers are already sent so
			// there is nothing to recover — record it for diagnostics only.
			log.Debug().Err(err).Msg("openapi: write response failed")
		}
	}
}
