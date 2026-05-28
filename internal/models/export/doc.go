// Package export hosts persistence + transport DTOs for the
// data-export bounded context: async export jobs persisted in the
// database, lightweight job summaries for the listing endpoint, and
// MQTT-bound job-request envelopes.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.6 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `exportmodel "internal/models/export"`.
package export
