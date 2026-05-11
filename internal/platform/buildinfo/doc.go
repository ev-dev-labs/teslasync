// Package buildinfo exposes build-time metadata (version, commit, build time).
//
// Layer: platform
//
// CANONICAL per ADR-007 — this is the right home for build-time
// metadata. Phase-47/04 explicitly chose not to extract a separate
// internal/buildinfo package (commit 56de71940 deviation note);
// ADR-007 ratifies that decision. No duplicate exists.
package buildinfo
