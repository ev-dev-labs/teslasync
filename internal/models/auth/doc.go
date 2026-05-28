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
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.2 (extracted from models.go). Recommended
// caller alias when importing alongside other models subpackages
// (per ADR-011 §3): `authmodel "internal/models/auth"`.
package auth
