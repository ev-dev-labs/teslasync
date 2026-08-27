// Package main implements routetemplategen, the generator that mirrors the
// canonical SPA route table into Go.
//
// The backend route normaliser (internal/api/webvitals) must template every
// parameter position the SPA declares — `/s/:token`, `/year-review/:year`,
// `/trips/:id` and friends all carry opaque, digit-free slugs that shape
// heuristics cannot distinguish from a real page name. The Go binary must not
// read the web tree at runtime, so the table is generated into a committed
// artifact and pinned by a drift test that re-parses the TypeScript source at
// test time only.
//
// Usage (runs from anywhere inside the module — the module root is located by
// walking up for go.mod, so `go generate` works from the package directory):
//
//	go run ./cmd/routetemplategen
//	go run ./cmd/routetemplategen --check
//
// Source of truth: web/src/lib/routeRegistry.ts (itself generated from
// web/src/App.tsx by web/scripts/generate-route-registry.mjs).
// Output: internal/api/webvitals/routetemplates_gen.go.
//
// Layer: tool
package main
