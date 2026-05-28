// Package auth holds repository types for the authentication aggregate:
// sessions, subjects, sudo elevation tokens, TOTP enrollment + credentials,
// generic tokens, and role-permission matrix rows.
//
// Carved from internal/database in Phase R4.4 per ADR-011 (bounded-context
// subpackages). Callers import as `dbauth` to disambiguate from the parent
// internal/database package and from internal/auth (the runtime auth service).
//
// Layer: adapter (database)
package auth
