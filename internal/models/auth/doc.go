// Package auth hosts persistence + transport DTOs for the
// authentication bounded context: user-generated API keys for
// external integrations and stored OAuth tokens for the Tesla
// Fleet API.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Per ADR-011 this package owns auth DTOs split from the formerly flat
// internal/models package. Recommended caller alias when importing alongside
// other models subpackages: `authmodel "internal/models/auth"`.
package auth
