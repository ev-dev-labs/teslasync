// Package auth holds repository types for the authentication aggregate:
// sessions, subjects, sudo elevation tokens, TOTP enrollment + credentials,
// generic tokens, and role-permission matrix rows.
//
// Per ADR-011, this bounded-context subpackage keeps auth repositories out of
// the parent internal/database package. Callers import it as `dbauth` to
// disambiguate from internal/auth (the runtime auth service).
//
// Layer: adapter
package auth
