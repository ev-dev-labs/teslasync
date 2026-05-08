// Package v1 contains the canonical HTTP handlers for TeslaSync's
// REST API under /api/v1.
//
// Layer: handler
//
// CANONICAL per ADR-009. New endpoints land here. Handlers are thin:
// they decode the request, call internal/app/<bounded-context>svc, and
// encode the response. Direct database access is forbidden — arch_test
// (phase-47/10) enforces this.
package v1
