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
	// Phase-47/09 promoted these two to FAIL-level. Domain purity is
	// also enforced (more strictly) by TestDomainPurity (ADR-006), which
	// rejects ANY non-stdlib non-domain import; these edges remain in
	// ForbiddenEdges so that violations surface with the layering reason
	// in TestForbiddenEdges output as well.
	{
		Source: "internal/domain/...",
		Target: "internal/adapter/...",
		Reason: "domain must not depend on adapters (hexagonal inversion; ADR-006)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/database",
		Reason: "domain must not depend on the database package (hexagonal inversion; ADR-006)",
	},
	// Still advisory until phase-47/10 promotes to fail-level.
	{
		Source: "internal/handler/v1",
		Target: "internal/database",
		Reason: "handlers must call internal/app/* services, not the database directly (advisory until prompt 10)",
	},
	// Phase-47/09: hexagonal layering rules promoted to FAIL.
	// Ports never depend on adapters, persistence, transport, app, or platform.
	{
		Source: "internal/port/...",
		Target: "internal/adapter/...",
		Reason: "ports must not depend on adapters (hexagonal inversion; phase-47/09)",
	},
	{
		Source: "internal/port/...",
		Target: "internal/database",
		Reason: "ports must not depend on persistence directly (phase-47/09)",
	},
	{
		Source: "internal/port/...",
		Target: "internal/api",
		Reason: "ports must not depend on the HTTP handler package (phase-47/09)",
	},
	{
		Source: "internal/port/...",
		Target: "internal/handler/...",
		Reason: "ports must not depend on HTTP handlers (phase-47/09)",
	},
	{
		Source: "internal/port/...",
		Target: "internal/app/...",
		Reason: "ports must not depend on app services (phase-47/09)",
	},
	// Phase-47/09: adapters never depend on transport or use cases.
	{
		Source: "internal/adapter/...",
		Target: "internal/api",
		Reason: "adapters must not depend on the HTTP handler package (phase-47/09)",
	},
	{
		Source: "internal/adapter/...",
		Target: "internal/handler/...",
		Reason: "adapters must not depend on HTTP handlers (phase-47/09)",
	},
	{
		Source: "internal/adapter/...",
		Target: "internal/app/...",
		Reason: "adapters must not depend on app services (use callbacks via ports; phase-47/09)",
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
//
// Phase-47/09 cleared "internal/domain/...": both domain→adapter and
// domain→database edges in ForbiddenEdges are now FAIL-level.
// Domain purity is independently enforced (more strictly) by
// TestDomainPurity (ADR-006).
var AdvisorySources = map[string]bool{
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

// AllowedPlatformSubpackages is the closed set of permitted
// directories directly under internal/platform/. Per ADR-007
// (phase-47/08), adding a new one requires an ADR amendment AND
// updating this list in the same commit. arch_test
// (TestPlatformSubpackagesGated) enforces.
var AllowedPlatformSubpackages = []string{
	"buildinfo",
	"cache",
	"config",
	"database",
	"httputil",
	"telemetry",
}

// AdapterForbiddenImports lists internal/* package prefixes that
// internal/adapter/* packages may NOT import. Per the phase-47/09
// hexagonal contract, adapters MUST NOT depend on transport
// (internal/api, internal/handler/*) or use cases (internal/app/*).
// Adapters MAY import stdlib, internal/port/* (the interfaces they
// implement), internal/domain/* (entity types), internal/models (DB
// scan targets), internal/platform/* (cross-cutting infra), and
// 3rd-party drivers.
var AdapterForbiddenImports = []string{
	"internal/api",
	"internal/handler",
	"internal/app",
}

// PortAllowedInternalImports lists the internal/* package prefixes
// that an internal/port/* package may import. Per the phase-47/09
// hexagonal contract, ports declare interfaces and MAY import only
// stdlib, the parent internal/port package, sibling internal/port/*
// packages, and internal/domain/* (entity types appearing in port
// signatures). Anything else is forbidden.
var PortAllowedInternalImports = []string{
	"internal/port",
	"internal/domain",
}
