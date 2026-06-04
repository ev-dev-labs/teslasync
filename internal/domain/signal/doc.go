// Package signal holds the pure-domain value objects for the two-layer
// telemetry signal store — the append-only provider-native raw layer and the
// SI-united canonical query layer (ADR-0091; migrations 000214/000215).
//
// Layer: domain
//
// Repo adaptation note
// ────────────────────
// The source prompt (Phase 2 / prompt 05, Contract C) specifies a
// framework-free Kotlin repository port + row DTOs under
// packages/contract-storage/interfaces/ (SignalStore.kt). This repository is
// Go on a hexagonal layout, so — mirroring the SQL adaptation already made for
// the raw/canonical tables in 000214/000215 — the artifact is adapted to the
// verified local conventions:
//   - the row DTOs live here as pure-domain structs (the Go analogue of the
//     Kotlin "pure data classes"); and
//   - the repository port lives in internal/port/repository/signalstore.go.
//
// The semantics — framework purity (H31), SI numeric as float64/Double (H13),
// and idempotent at-least-once upsert (H24 / TL-7) — are exactly as the prompt
// specifies.
//
// Per ADR-006: this package contains business value objects and invariants and
// may import only stdlib + other internal/domain/* subpackages. Persistence
// (database/pgx), transport (proto/HTTP), and framework imports are forbidden
// here and enforced by internal/arch (TestDomainPurity / TestPortPurity). That
// purity is what makes RawSignalRow / CanonicalSignalRow usable verbatim in the
// repository port without leaking a framework type into the contract (H31).
package signal
