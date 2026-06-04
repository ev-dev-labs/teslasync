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
// Per ADR-011, use the alias `geomodel` when importing this package
// alongside other internal/models subpackages.
package geo
