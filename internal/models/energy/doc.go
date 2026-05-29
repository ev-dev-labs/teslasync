// Package energy hosts persistence + transport DTOs for the
// energy/efficiency bounded context: aggregated fleet energy statistics
// rows backing the analytics charts.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011, use `energymodel` as the caller alias when importing alongside
// other model subpackages.
//
// All numeric fields are SI canonical (Wh / m / Wh-per-m); conversion to user
// units happens at the React render boundary.
package energy
