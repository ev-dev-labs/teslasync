// Package speed hosts the speed-profile + drive-context AI tools cluster
// carved from internal/ai/tools/ in Phase R6.29.
//
// Layer: domain
//
// # Contents
//
//   - RegisterSpeedProfileInsightsTools — wires query_speed_profile +
//     query_drive_context into the shared tools.Registry.
//   - SpeedProfileInsightsSources — dependency bag (Drives repo only).
//
// # ADR-011 §3 alias convention
//
// Callers importing this package alongside the parent tools package use
// the alias `speedtool`:
//
//	import (
//	    "github.com/ev-dev-labs/teslasync/internal/ai/tools"
//	    speedtool "github.com/ev-dev-labs/teslasync/internal/ai/tools/speed"
//	)
//
// # ADR-015 §I12 contract
//
// The aivet contract is preserved verbatim across the carve:
// `aivet: OK — 59 AI route(s), 57 feature(s) in registry, 54 SPA wiring
// entries, TS mirror in sync` — verified after every R6 cluster.
//
// # Phase R6 lessons exercised
//
//   - Lesson 9 (`go build` after regex pass surfaces tool-specific shared
//     symbols): cleanly handled — DriveSource was the only such symbol
//     and was already known from prior carves.
//   - Lesson 12 (unexported helpers consumed by parent peers must be
//     promoted before the carve): NO NEW PROMOTIONS this carve. The four
//     ptr helpers (CToFPtr / DerefFloat64Ptr / DerefInt16Ptr /
//     DerefStringPtr) used in speed.go were already promoted to
//     tools.* in R6.25 (ptrhelpers.go). speed.go consumed them via the
//     unqualified parent-package call form; this carve adds the tools.
//     prefix at every call site.
//   - Lesson 13 (local test fakes referenced by other parent tests
//     duplicated rather than moved): failingDrivesImpl moved with the
//     carve; the duplicate placed in the parent's speed_profile_test.go
//     in R6.25 is now obsolete and was removed with the file move.
package speed
