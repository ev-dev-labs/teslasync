// Package auth stores verified upstream subject observations and encrypted
// Tesla OAuth tokens. It does not store or issue application browser credentials.
//
// Per ADR-011, this bounded-context subpackage keeps auth repositories out of
// the parent internal/database package. Callers import it as `dbauth` to
// disambiguate from internal/auth (the runtime auth service).
//
// Layer: adapter
package auth
