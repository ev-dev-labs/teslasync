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

// ForbiddenEdges is the canonical list of import-graph boundaries. The
// current rules cover Clean Architecture edges including app→handler,
// app→api, handler→infra-direct, models→outward, adapter→app, and
// cmd→api.
//
// The DAG mirrored here MUST match tools/archmetrics/main.go forbiddenEdges
// — the two systems are deliberately redundant (arch_test enforces against
// HEAD with explicit reasons, archmetrics ratchets against baseline.json).
var ForbiddenEdges = []ForbiddenEdge{
	// ----------------------------------------------------------------------
	// cmd binaries must not bypass the internal/app composition root for
	// HTTP API wiring. Workers depend on internal/apilog and
	// internal/notification/computed for their cross-cutting needs.
	// ----------------------------------------------------------------------
	{
		Source: "cmd/...",
		Target: "internal/api",
		Reason: "cmd binaries must not import internal/api; the composition root in internal/app is the only legitimate wiring layer for HTTP transport (phase-A3.1)",
	},

	// ----------------------------------------------------------------------
	// Domain packages are pure. TestDomainPurity (ADR-006) enforces this
	// more strictly by rejecting any non-stdlib, non-domain import. These
	// edges stay here so TestForbiddenEdges reports the layering reason too.
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
		Target: "internal/models/...",
		Reason: "domain entities must not depend on persistence/transport DTOs (ADR-006; phase-A3.1; broadened to models/... in phase-R5.0)",
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
	// Ports never depend on adapters, persistence, transport, app, or
	// platform. Ports are interface contracts in pure-domain terms.
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
	// Adapters never depend on transport or use cases.
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
	// Use cases (internal/app/*svc) must not depend on HTTP transport or
	// the legacy router. The internal/app top-level composition root is the
	// explicit carve-out and is exempted via AllowedExceptions.
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
		Target: "internal/models/...",
		Reason: "handlers use internal/handler/dto for transport DTOs (ADR-006; phase-47/10; broadened to models/... in phase-R5.0)",
	},
	{
		Source: "internal/handler/...",
		Target: "internal/api",
		Reason: "internal/api is FROZEN per ADR-009; handlers must not import it (phase-47/10; broadened to handler/... in phase-A3.1)",
	},
	// Handlers must not reach into infra/vendor SDKs; everything routes
	// through internal/app/*svc and ports.
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
	// Models (DTOs) are leaves. Per ADR-006 they must not depend on any
	// other layer. TestModelsImportsRestricted enforces this more strictly;
	// these edges mirror it for layering reason output. The source covers
	// internal/models/... so each bounded-context subpackage inherits the
	// DTO-leaf contract.
	{
		Source: "internal/models/...",
		Target: "internal/database",
		Reason: "models (DTOs) must not depend on persistence implementation (ADR-006; phase-A3.1; broadened in phase-R5.0)",
	},
	{
		Source: "internal/models/...",
		Target: "internal/adapter/...",
		Reason: "models (DTOs) must not depend on adapters (ADR-006; phase-A3.1; broadened in phase-R5.0)",
	},
	{
		Source: "internal/models/...",
		Target: "internal/handler/...",
		Reason: "models (DTOs) must not depend on handlers (ADR-006; phase-A3.1; broadened in phase-R5.0)",
	},
	{
		Source: "internal/models/...",
		Target: "internal/app/...",
		Reason: "models (DTOs) must not depend on use cases (ADR-006; phase-A3.1; broadened in phase-R5.0)",
	},
	{
		Source: "internal/models/...",
		Target: "internal/api",
		Reason: "models (DTOs) must not depend on the HTTP router (ADR-006; phase-A3.1; broadened in phase-R5.0)",
	},
}

// Exception records edges that are forbidden by rule but grandfathered
// for now. Each entry must explain when it can be removed.
type Exception struct {
	Source string
	Target string
	Until  string // condition or milestone that removes the exception
}

// AllowedExceptions lists currently tolerated forbidden edges. Each entry
// must be removed when its stated condition is met; arch_test will start
// failing again unless the underlying violation is fixed.
//
// These carve-outs mirror the composition-root exceptions in
// tools/archmetrics/main.go forbiddenEdges (ExceptFrom):
//   - internal/app top-level is the ONLY legitimate wiring layer for
//     internal/api (HTTP transport) — it owns the router lifecycle.
//   - internal/handler/middleware exposes a per-request pgx query counter
//     that must be attached to context. The counter primitive lives in
//     internal/database/query_budget.go (an observability cross-cut). The
//     proper fix is to extract that primitive to internal/platform/
//     dbobserver/ during a platform reshape.
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

// AdvisorySources marks rules whose violations log a warning but do not
// fail the test. Empty means every configured rule is fail-level.
// Domain purity and handler thinness are also enforced by focused tests.
var AdvisorySources = map[string]bool{}

// FrozenPackages lists package paths where new .go files (excluding
// _test.go files for existing source files) are not allowed. ADR-009
// freezes internal/api because internal/handler/v1 is the canonical home
// for new HTTP handlers.
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

// AllowedPlatformSubpackages is the closed set of permitted directories
// directly under internal/platform/. Per ADR-007, adding a new one
// requires an ADR amendment and updating this list in the same commit.
// arch_test (TestPlatformSubpackagesGated) enforces this.
var AllowedPlatformSubpackages = []string{
	"buildinfo",
	"cache",
	"config",
	"database",
	"httputil",
	"telemetry",
}

// AdapterForbiddenImports lists internal/* package prefixes that
// internal/adapter/* packages may NOT import. Per the hexagonal
// contract, adapters MUST NOT depend on transport
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
// that an internal/port/* package may import. Per the hexagonal
// contract, ports declare interfaces and MAY import only
// stdlib, the parent internal/port package, sibling internal/port/*
// packages, and internal/domain/* (entity types appearing in port
// signatures). Anything else is forbidden.
var PortAllowedInternalImports = []string{
	"internal/port",
	"internal/domain",
}

// HandlerV1ForbiddenImports lists internal/* package prefixes that
// files in internal/handler/v1 may NOT import. Per the thin-handler
// contract, handlers MUST NOT touch persistence
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
