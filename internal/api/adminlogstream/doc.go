// Package adminlogstream serves the admin log-tail SSE endpoint.
//
// The handler owns request validation, SSE framing, filters, and slow-client
// drop reporting; router.go keeps the process-global zerolog tap wiring.
//
// Layer: handler
package adminlogstream
