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
// Per ADR-011, use the alias `exportmodel` when importing this package
// alongside other internal/models subpackages.
package export
