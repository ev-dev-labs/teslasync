package arch

// ForbiddenEdge represents an import-graph edge that MUST NOT exist.
// Both Source and Target are package paths relative to the module root,
// e.g. "internal/handler/v1" or "internal/database".
//
// Patterns may use a trailing "/..." to match any subpackage.
type ForbiddenEdge struct {
	Source string
	Target string
	Reason string // human-readable; printed on test failure
}

// ForbiddenEdges is the canonical list. Phase-47 seeds it with the 5
// edges established by the Principal Architect critique. Subsequent
// prompts (06, 09, 10) append new rules.
var ForbiddenEdges = []ForbiddenEdge{
	{
		Source: "cmd/notification-worker",
		Target: "internal/api",
		Reason: "workers must depend on internal/notify (extracted in phase-47/05), not the HTTP handler package",
	},
	{
		Source: "cmd/automation-worker",
		Target: "internal/api",
		Reason: "workers must depend on internal/notify (extracted in phase-47/05), not the HTTP handler package",
	},
	// The next three are warning-level until prompts 06/09/10 promote them
	// to fail-level. Marked "advisory" so the test passes today but emits
	// a t.Logf warning per violation.
	{
		Source: "internal/domain/...",
		Target: "internal/adapter/...",
		Reason: "domain must not depend on adapters (advisory until prompt 09)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/database",
		Reason: "domain must not depend on the database package (advisory until prompt 09)",
	},
	{
		Source: "internal/handler/v1",
		Target: "internal/database",
		Reason: "handlers must call internal/app/* services, not the database directly (advisory until prompt 10)",
	},
}

// Exception records edges that are forbidden by rule but grandfathered
// for now. Each entry MUST cite the prompt that will remove it.
type Exception struct {
	Source string
	Target string
	Until  string // prompt that removes the exception, e.g. "phase-47/05"
}

// AllowedExceptions lists currently-tolerated forbidden edges. Each entry
// MUST be removed by the cited prompt; arch_test will start failing again
// at that point unless the underlying violation is fixed.
//
// Phase-47/05 cleared the worker→internal/api exceptions: the workers now
// depend on internal/apilog and internal/notification/computed (extracted
// in that prompt) instead of the HTTP handler package.
var AllowedExceptions = []Exception{}

// AdvisorySources marks rules whose violations log a WARNING but DO NOT
// fail the test. Prompts that promote a rule to fail-level remove the
// matching entry from this set.
var AdvisorySources = map[string]bool{
	"internal/domain/...": true,
	"internal/handler/v1": true,
}

// FrozenPackages lists package paths where new .go files (excluding
// _test.go files for existing source files) are not allowed. Phase-47/06
// declares the first entry per ADR-009: internal/api is frozen against
// new files because internal/handler/v1 is now the canonical home for
// new HTTP handlers.
//
// arch_test compares the live file list against
// tools/archmetrics/baseline.json and fails if any production .go file
// appears in a frozen package that isn't in the baseline.
var FrozenPackages = []string{
	"internal/api",
}

// DomainAllowedInternalImports lists the internal/* package prefixes
// that an internal/domain/* package may import. Per ADR-006
// (.github/ARCHITECTURE.md), domain packages may also import stdlib
// freely; only internal/* imports are constrained. The parent
// `internal/domain` package and any `internal/domain/<sub>` package
// are allowed.
var DomainAllowedInternalImports = []string{
	"internal/domain",
}

// ModelsForbiddenImports lists the internal/* package prefixes that
// internal/models may NOT import. Per ADR-006, models is a DTO layer
// and must not depend on persistence (database/adapter), transport
// (api/handler), use cases (app), or ports. Importing
// internal/domain/* is explicitly allowed for ToDomain conversion
// methods.
var ModelsForbiddenImports = []string{
	"internal/database",
	"internal/adapter",
	"internal/api",
	"internal/handler",
	"internal/app",
	"internal/port",
}
