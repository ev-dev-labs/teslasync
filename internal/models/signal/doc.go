// Package signal hosts persistence + transport DTOs for the
// signal-catalog bounded context: observation samples and the catalog
// metadata (data kind + storage tier) that drives routing.
//
// Layer: domain
//
// Per ADR-006 this is a DTO leaf — it MUST NOT import internal/database,
// internal/adapter/*, internal/handler/*, internal/app/*, internal/port/*,
// or internal/api.
//
// Note: this package collides on short name with internal/signal (the
// in-process live-state store / L1 cache). At any callsite importing
// both, alias this one as “signalmodel“ per ADR-011 §3:
//
//	signalmodel "github.com/ev-dev-labs/teslasync/internal/models/signal"
//
// Per ADR-011 this package was carved out of the formerly-flat
// internal/models in phase-R5.17 (via `git mv` of signal.go +
// enum_signal_types.go renamed to enums.go).
package signal
