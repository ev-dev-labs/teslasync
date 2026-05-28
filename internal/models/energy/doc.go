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
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.5 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `energymodel "internal/models/energy"`.
//
// All numeric fields are SI canonical (Wh / m / Wh-per-m) per ADR-008
// and Phase-48; conversion to user units happens at the React render boundary.
package energy
