// Package automation hosts the AI automation-builder tool cluster carved
// from internal/ai/tools/ in Phase R6.30.
//
// Layer: domain (per ADR-007 — AI tools sit at the domain layer because
// they expose pure capability surfaces to the AI orchestrator without
// reaching into HTTP/transport concerns).
//
// # Contents
//
//   - RegisterAutomationBuilderTools — wires draft_automation_graph +
//     validate_automation_graph into the shared tools.Registry.
//   - AutomationBuilderSources — dependency bag (just the validator).
//   - AutomationGraphValidator — narrow validation interface the tools
//     depend on; the production wrapper lives in
//     internal/api/ai_automation_handler.go (AIAutomationGraphValidator).
//
// # ADR-011 §3 alias convention
//
// The subpackage name `automation` COLLIDES with internal/automation
// (already imported in router.go as `automation`). Per ADR-011 Lesson 11,
// callsites importing this subpkg use the alias `automationtool`:
//
//	import (
//	    "github.com/ev-dev-labs/teslasync/internal/ai/tools"
//	    "github.com/ev-dev-labs/teslasync/internal/automation"
//	    automationtool "github.com/ev-dev-labs/teslasync/internal/ai/tools/automation"
//	)
//
// Updated callsites: internal/api/router.go (registration) +
// internal/api/ai_automation_handler.go (godoc references + the
// AIAutomationGraphValidator wrapper).
//
// # ADR-015 §I12 contract
//
// The aivet contract is preserved verbatim across the carve:
// `aivet: OK — 59 AI route(s), 57 feature(s) in registry, 54 SPA wiring
// entries, TS mirror in sync` — verified after every R6 cluster.
//
// # Phase R6 lessons exercised
//
//   - Lesson 11 (subpackage name collision): the new `automation` subpkg
//     collides with the existing top-level `internal/automation` package.
//     Aliased as `automationtool` at internal/api/* callsites. The
//     subpackage's own `package automation` declaration is fine because
//     the parent dir name carries no collision risk inside the subpkg.
//   - Lesson 12 (shared parent helpers consumed): tools.Lower (R6.26
//     promotion) is the sole shared helper called from automation.go;
//     prefixed at every call site. No new parent files created.
//   - Lesson 15 (dotted-access field rename): the local stub
//     stubAutomationValidator had its `failWith` + `calls` fields
//     promoted to `FailWith` + `Calls` to match the toolstest-style
//     PascalCase convention (caught by go vet after the dotted-access
//     regex flipped the access sites).
package automation
