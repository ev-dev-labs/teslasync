// Package v1 contains the canonical HTTP handlers for TeslaSync's
// REST API under /api/v1.
//
// Layer: handler
//
// CANONICAL per ADR-009. New endpoints land here. Handlers are THIN
// per the contract installed in phase-47/10 and enforced by arch_test
// (TestHandlerV1Thinness):
//
//   - May import: stdlib, internal/app/<name>svc, internal/handler/dto,
//     internal/handler/middleware, internal/port/*, internal/domain/*,
//     internal/platform/* (httputil, etc.), and 3rd-party HTTP framework
//     packages (e.g. go-chi).
//   - May NOT import: internal/database, internal/platform/database,
//     internal/adapter/*, internal/models, or internal/api.
//
// Canonical handler shape (see example_thin_handler_test.go for a
// runnable copy):
//
//  1. Decode the request from r.Body / chi.URLParam.
//  2. Call a use-case method on internal/app/<name>svc (always typed as
//     a port interface, never the concrete struct).
//  3. Encode the use-case's domain return into the matching DTO from
//     internal/handler/dto, then write JSON.
//  4. Map errors via internal/platform/httputil.WriteError.
//
// Direct DB access, raw SQL, or pulling rows through internal/models is
// a hard arch_test failure. Move the logic into internal/app/<name>svc
// (or extend the existing service) and call THAT from the handler.
//
// Subpackages (ADR-011):
//
//	v1 currently holds <30 files (1 per resource), so per ADR-011's
//	≥30-file threshold no subpackage split is required yet. Once the
//	internal/api -> handler/v1 migration (Phase R2) lands in waves
//	and one or more resources need multiple handler files (split by
//	surface: list / detail / bulk / events / ...), each resource
//	graduates to its own subpkg following the alias convention:
//
//	  internal/handler/v1/<resource>/
//
//	imported by the router as `<resource>handler` (e.g. charginghandler,
//	vehiclehandler) per ADR-011 §3. The router file then mounts each
//	subpkg via its `Mount(r chi.Router, deps Deps)` constructor per
//	ADR-011 §7.
package v1
