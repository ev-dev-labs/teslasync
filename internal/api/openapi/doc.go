// Package openapi serves the embedded OpenAPI YAML at GET /api/v1/system/openapi.
// The spec is injected once at startup, and the frontend parses YAML client-side
// to avoid a Go YAML dependency for this read-only endpoint.
//
// Layer: handler
package openapi
