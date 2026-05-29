// Package speed hosts the speed-profile and drive-context AI tools.
//
// Layer: domain
//
// # Contents
//
// - RegisterSpeedProfileInsightsTools — wires query_speed_profile +
// query_drive_context into the shared tools.Registry.
// - SpeedProfileInsightsSources — dependency bag (Drives repo only).
//
// # ADR-011 §3 alias convention
//
// Callers importing this package alongside the parent tools package use
// the alias `speedtool`:
//
//	import (
//	 "github.com/ev-dev-labs/teslasync/internal/ai/tools"
//	 speedtool "github.com/ev-dev-labs/teslasync/internal/ai/tools/speed"
//	)
//
// # ADR-015 §I12 contract
//
// The aivet contract remains stable across package moves:
// `aivet: OK — 59 AI route(s), 57 feature(s) in registry, 54 SPA wiring
// entries, TS mirror in sync`.
//
// # Package split notes
//
// - Shared pointer helpers live in the parent tools package so this
// package can stay focused on speed-profile behavior.
package speed
