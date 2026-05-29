// Package automation hosts the AI automation-builder tool cluster.
//
// Layer: domain
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
// (already imported in router.go as `automation`). To avoid ambiguity,
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
// The aivet contract is preserved across this package: AI routes,
// feature registry entries, SPA wiring, and the TypeScript mirror must
// stay in sync.
package automation
