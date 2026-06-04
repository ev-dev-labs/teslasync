// Package httpx provides the flat-shape JSON helpers shared by internal/api subpackages.
//
// Layer: handler
//
// The flat response contract is intentional: SPA hooks and frontend types expect successful payloads as top-level fields and errors as {"error": "...", "code": "..."}. Do not swap these helpers for enveloped responders as a refactor side effect.
//
// During the R2 migration, parent-package wrappers delegate here until all handlers move into resource subpackages. Parent-bound error catalogs remain in internal/api until a dedicated apierr carve-out.
package httpx
