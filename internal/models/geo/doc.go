// Package geo hosts persistence + transport DTOs for the
// geocoding / visited-places bounded context: reverse-geocoded addresses
// and aggregated visited-location summaries.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.7 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `geomodel "internal/models/geo"`.
package geo
