// Package openapi serves the embedded OpenAPI spec YAML over HTTP.
//
// The spec bytes are loaded once at startup via SetOpenAPISpec (typically
// from a go:embed in cmd/api/main.go via the composition root in
// internal/app/new.go) and then served read-only by Handler() at
// GET /api/v1/system/openapi.
//
// The frontend parses the YAML with js-yaml on the client side, which lets
// us avoid adding a Go YAML dependency just for this single endpoint.
//
// Layer: handler
package openapi
