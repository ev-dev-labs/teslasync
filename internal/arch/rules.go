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

// ForbiddenEdges is the canonical list. Phase-47 seeded it with the 5
// edges established by the Principal Architect critique; phase-47 prompts
// 06, 09, and 10 appended additional rules. Phase-A3.1 (chore/repo-
// reorganization) broadens handler/v1-scoped rules to handler/... and
// adds the missing Clean Architecture edges (app→handler, app→api,
// handler→infra-direct, models→outward, adapter→app, cmd→api).
//
// The DAG mirrored here MUST match tools/archmetrics/main.go forbiddenEdges
// — the two systems are deliberately redundant (arch_test enforces against
// HEAD with explicit reasons, archmetrics ratchets against baseline.json).
var ForbiddenEdges = []ForbiddenEdge{
	// ----------------------------------------------------------------------
	// Phase-A3.1: generalised cmd/* rule (subsumes phase-47/05 worker-
	// specific entries). The composition root for the HTTP API lives in
	// internal/app since phase-47/56de7194; cmd binaries must not bypass
	// it. Workers depend on internal/apilog and internal/notification/
	// computed for their cross-cutting needs.
	// ----------------------------------------------------------------------
	{
		Source: "cmd/...",
		Target: "internal/api",
		Reason: "cmd binaries must not import internal/api; the composition root in internal/app is the only legitimate wiring layer for HTTP transport (phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Phase-47/09: domain layer is pure. Also enforced (more strictly) by
	// TestDomainPurity (ADR-006), which rejects ANY non-stdlib non-domain
	// import; these edges stay in ForbiddenEdges so violations surface with
	// the layering reason in TestForbiddenEdges output as well.
	// Phase-A3.1 adds the missing outward edges (models/port/handler/api/app).
	// ----------------------------------------------------------------------
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
	{
		Source: "internal/domain/...",
		Target: "internal/models",
		Reason: "domain entities must not depend on persistence/transport DTOs (ADR-006; phase-A3.1)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/port/...",
		Reason: "domain must not know about its ports; ports live at the consumer (svc) boundary (ADR-007; phase-A3.1)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/handler/...",
		Reason: "domain must not depend on HTTP handlers (wrong direction; phase-A3.1)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/api",
		Reason: "domain must not depend on the HTTP router (wrong direction; phase-A3.1)",
	},
	{
		Source: "internal/domain/...",
		Target: "internal/app/...",
		Reason: "domain must not depend on use cases (wrong direction; phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Phase-47/09: ports never depend on adapters, persistence, transport,
	// app, or platform. Ports are interface contracts in pure-domain terms.
	// ----------------------------------------------------------------------
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

	// ----------------------------------------------------------------------
	// Phase-47/09: adapters never depend on transport or use cases.
	// Phase-A3.1 adds the missing adapter → app rule.
	// ----------------------------------------------------------------------
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
		Reason: "adapters must not depend on use cases (wrong direction; phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Phase-A3.1: use cases (internal/app/*svc) must not depend on HTTP
	// transport or the legacy router. The composition root (internal/app
	// top-level — see internal/app/{app,new,run,lifecycle,adapters}.go)
	// is the explicit carve-out and is exempted via AllowedExceptions.
	// ----------------------------------------------------------------------
	{
		Source: "internal/app/...",
		Target: "internal/handler/...",
		Reason: "use cases (internal/app/*svc) must not depend on HTTP transport; the composition root internal/app is the carve-out (phase-A3.1)",
	},
	{
		Source: "internal/app/...",
		Target: "internal/api",
		Reason: "use cases (internal/app/*svc) must not depend on the legacy HTTP router; the composition root internal/app is the carve-out (phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Phase-47/10 (handler thinness) BROADENED to handler/... in phase-A3.1.
	// Handlers in any handler subdir must stay thin: no direct database/
	// adapter/models/api access, no infra-SDK reach-through. internal/api
	// itself is exempt from these rules — it IS the legacy frozen package;
	// its existing handlers freely query the DB until per-handler migration
	// to handler/v1 lands. TestHandlerV1Thinness continues to enforce the
	// stricter handler/v1-specific subset (no internal/models, etc).
	// ----------------------------------------------------------------------
	{
		Source: "internal/handler/...",
		Target: "internal/database",
		Reason: "handlers must call internal/app/<name>svc, not the database directly (phase-47/10; broadened to handler/... in phase-A3.1)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/platform/database",
		Reason: "handlers must call internal/app/<name>svc, not platform DB helpers (phase-47/10; broadened to handler/... in phase-A3.1)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/adapter/...",
		Reason: "handlers must depend on ports, not adapter implementations (phase-47/10; broadened to handler/... in phase-A3.1)",
	},
	{
		Source: "internal/handler/v1",
		Target: "internal/models",
		Reason: "handlers use internal/handler/dto for transport DTOs (ADR-006; phase-47/10)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/api",
		Reason: "internal/api is FROZEN per ADR-009; handlers must not import it (phase-47/10; broadened to handler/... in phase-A3.1)",
	},
	// Phase-A3.1: handlers must not reach into infra/vendor SDKs.
	// Everything routes through internal/app/*svc + ports.
	{
		Source: "internal/handler/...",
		Target: "internal/tesla/...",
		Reason: "handlers must not call the Tesla pipeline directly; route through internal/app/<name>svc + ports (phase-A3.1)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/mqtt/...",
		Reason: "handlers must not call MQTT directly; route through internal/app/<name>svc + ports (phase-A3.1)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/redis/...",
		Reason: "handlers must not call Redis directly; route through internal/app/<name>svc + ports (phase-A3.1)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/geocoding/...",
		Reason: "handlers must not call the geocoding adapter directly; route through internal/app/<name>svc + ports (phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Phase-A3.1: models (DTOs) are leaves. Per ADR-006 they MUST NOT depend
	// on any other layer. Independently enforced (more strictly) by
	// TestModelsImportsRestricted; mirrored here for layering reason output.
	// ----------------------------------------------------------------------
	{
		Source: "internal/models",
		Target: "internal/database",
		Reason: "models (DTOs) must not depend on persistence implementation (ADR-006; phase-A3.1)",
	},
	{
		Source: "internal/models",
		Target: "internal/adapter/...",
		Reason: "models (DTOs) must not depend on adapters (ADR-006; phase-A3.1)",
	},
	{
		Source: "internal/models",
		Target: "internal/handler/...",
		Reason: "models (DTOs) must not depend on handlers (ADR-006; phase-A3.1)",
	},
	{
		Source: "internal/models",
		Target: "internal/app/...",
		Reason: "models (DTOs) must not depend on use cases (ADR-006; phase-A3.1)",
	},
	{
		Source: "internal/models",
		Target: "internal/api",
		Reason: "models (DTOs) must not depend on the HTTP router (ADR-006; phase-A3.1)",
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
//
// Phase-A3.1 adds three carve-outs that mirror the composition-root
// exception in tools/archmetrics/main.go forbiddenEdges (ExceptFrom):
//   - internal/app top-level is the ONLY legitimate wiring layer for
//     internal/api (HTTP transport) — it owns the router lifecycle.
//   - internal/handler/middleware exposes a per-request pgx query counter
//     that must be attached to context. The counter primitive lives in
//     internal/database/query_budget.go (an observability cross-cut). The
//     proper fix is to extract that primitive to internal/platform/
//     dbobserver/ in Phase A5 (audit) or a dedicated platform reshape.
var AllowedExceptions = []Exception{
	{
		Source: "internal/app",
		Target: "internal/api",
		Until:  "permanent — internal/app top-level is THE composition root for HTTP transport (phase-A3.1)",
	},
	{
		Source: "internal/handler/middleware",
		Target: "internal/database",
		Until:  "phase-A5 or later — extract query-budget counter primitive to internal/platform/dbobserver/ (phase-A3.1)",
	},
}

// AdvisorySources marks rules whose violations log a WARNING but DO NOT
// fail the test. Prompts that promote a rule to fail-level remove the
// matching entry from this set.
//
// Phase-47/09 cleared "internal/domain/...": both domain→adapter and
// domain→database edges in ForbiddenEdges are now FAIL-level.
// Domain purity is independently enforced (more strictly) by
// TestDomainPurity (ADR-006).
//
// Phase-47/10 cleared "internal/handler/v1": handler→database is now
// FAIL-level. Handler thinness is independently enforced (more
// strictly, with extra deny-list targets) by TestHandlerV1Thinness.
var AdvisorySources = map[string]bool{}

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

// HandlerV1ForbiddenImports lists internal/* package prefixes that
// files in internal/handler/v1 may NOT import. Per the phase-47/10
// thinness contract, handlers MUST NOT touch persistence
// (internal/database, internal/platform/database), adapters
// (internal/adapter/*), persistence DTOs (internal/models), or the
// FROZEN HTTP package (internal/api). Handlers depend on
// internal/app/<name>svc for use cases and on internal/handler/dto
// for transport types.
//
// internal/api is exempt from this rule (it IS frozen; its existing
// handlers freely query the DB until per-handler migration moves them
// to handler/v1).
var HandlerV1ForbiddenImports = []string{
	"internal/database",
	"internal/platform/database",
	"internal/adapter",
	"internal/models",
	"internal/api",
}
