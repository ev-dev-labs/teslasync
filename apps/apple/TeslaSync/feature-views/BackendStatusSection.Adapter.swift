//
//  BackendStatusSection.Adapter.swift
//  TeslaSync — P4 feature view · 0239 · BackendStatusSection (Apple)
//
//  The testable projection core for the system-status "Backend Status" surface —
//  the faithful port of features/system/components/status/BackendStatusSection.tsx
//  (and its sibling helpers.tsx). Everything here is pure and dependency-free
//  (Foundation only) so it can be unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component composes THREE live reads — `getExtendedHealth()`
//      (/system/health), `useConnectionPool()` (/dev-tools/runtime-info) and
//      `getVersionInfo()` (/system/version). The native source seam (P1/S8) hands
//      this adapter the same shapes via `BackendHealthDTO` / `ConnectionPoolDTO` /
//      `VersionDTO`, and the projections below derive the component rows, the
//      connection-pool stat tiles, the system-runtime key/values, and the render
//      phase from them.
//    • `getStatusIcon` / `statusTextClass` (helpers.tsx) — the exact lowercase
//      case lists — become `BackendComponentStatus.tone`, mapped to an adaptive
//      semantic tone + an SF Symbol (checkmark / triangle / xmark) so the table
//      status cell renders natively.
//    • `okCount = rows.filter(status === 'ok' || 'healthy')` becomes
//      `BackendStatusProjection.okCount`, driving the header "okCount/total healthy"
//      badge (success when all ok, warning otherwise).
//    • `formatUptime`, `fmtNumber(_, 1)`, `fmtInt`, `formatDateTime` (numberFormat /
//      dateFormat) become `BackendStatusFormat`, returning the same "—" em-dash
//      fallback for missing values (web contract).
//    • The web always renders the three-section frame (the DataTable owns its own
//      "No components found" empty message); the prompt's surface-level `empty`
//      state (no components AND no pool AND no runtime) and the loading / error
//      envelope are resolved by `resolvePhase` so no state is ever a blank box.
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the projections.
public enum BackendStatusDisplay {
    /// The universal em-dash fallback the web formatters return for missing values
    /// (web `'—'`), reused for an absent last-check, Go version, or OS/arch.
    public static let emDash = "—"
}

// MARK: - Status tone (web `getStatusIcon` / `statusTextClass`)

/// The semantic tone of a component health status, the native parity of the web
/// `statusTextClass` color + `getStatusIcon` glyph. Drives the status cell color
/// and icon; the visible status text is the raw data value, never a fixed key.
public enum BackendStatusTone: String, Sendable, Equatable, CaseIterable, Identifiable {
    case success
    case warning
    case danger
    case neutral

    public var id: String {
        rawValue
    }

    /// The SF Symbol mirroring the web `getStatusIcon` glyph: `CheckCircle` →
    /// checkmark, `AlertTriangle` → triangle, `XCircle` → xmark. The web default
    /// branch (unknown status) is an `AlertTriangle`, so `neutral` maps to the
    /// triangle too — matching the source exactly.
    public var symbol: String {
        switch self {
        case .success: "checkmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .danger: "xmark.circle.fill"
        case .neutral: "exclamationmark.triangle.fill"
        }
    }
}

/// Pure status classification — the faithful port of the web `getStatusIcon` /
/// `statusTextClass` lowercase case lists (helpers.tsx).
public enum BackendComponentStatus {
    /// Maps a raw health status to a semantic tone using the exact web case lists:
    /// `healthy|ok|online|connected|ready|sent|completed` → success,
    /// `degraded|warning|pending|queued|processing` → warning,
    /// `unhealthy|offline|error|down|failed` → danger, anything else → neutral.
    public static func tone(_ raw: String) -> BackendStatusTone {
        switch raw.lowercased() {
        case "healthy", "ok", "online", "connected", "ready", "sent", "completed":
            .success
        case "degraded", "warning", "pending", "queued", "processing":
            .warning
        case "unhealthy", "offline", "error", "down", "failed":
            .danger
        default:
            .neutral
        }
    }

    /// Whether a component counts toward the header "healthy" tally — the web
    /// `okCount` predicate `status === 'ok' || status === 'healthy'` (case-exact).
    public static func isOK(_ raw: String) -> Bool {
        raw == "ok" || raw == "healthy"
    }
}

// MARK: - Transport DTOs (the P1/S8 source seam input)

/// One component's health row as handed to the surface by its bound source — the
/// native parity of one `extHealth.components` entry (snake_case JSON → here).
public struct ComponentHealthDTO: Sendable, Equatable {
    /// The component name (web `Object.entries` key), e.g. "database", "redis".
    public var name: String
    /// The raw health status (web `c.status`), e.g. "ok", "degraded".
    public var status: String
    /// Probe latency in milliseconds (web `c.latency_ms ?? 0`).
    public var latencyMs: Double
    /// Consecutive failure count (web `c.consecutive_failures ?? 0`).
    public var consecutiveFailures: Int
    /// The last-check ISO timestamp, when known (web `c.last_check ?? ''`).
    public var lastCheck: String?

    public init(
        name: String,
        status: String,
        latencyMs: Double = 0,
        consecutiveFailures: Int = 0,
        lastCheck: String? = nil
    ) {
        self.name = name
        self.status = status
        self.latencyMs = latencyMs
        self.consecutiveFailures = consecutiveFailures
        self.lastCheck = lastCheck
    }
}

/// The runtime system block (web `extHealth.system`).
public struct SystemInfoDTO: Sendable, Equatable {
    public var goroutines: Int
    public var goVersion: String?
    public var uptimeSeconds: Int

    public init(goroutines: Int = 0, goVersion: String? = nil, uptimeSeconds: Int = 0) {
        self.goroutines = goroutines
        self.goVersion = goVersion
        self.uptimeSeconds = uptimeSeconds
    }
}

/// The extended-health envelope (web `getExtendedHealth()` → `ExtendedHealthResponse`).
/// Only the fields the surface renders are modeled; the source projects the rest away.
public struct BackendHealthDTO: Sendable, Equatable {
    /// The overall status (web `extHealth.status`); retained for fidelity.
    public var status: String
    /// The per-component health rows (web `extHealth.components`), in source order.
    public var components: [ComponentHealthDTO]
    /// The runtime system block (web `extHealth.system`).
    public var system: SystemInfoDTO?

    public init(status: String = "", components: [ComponentHealthDTO] = [], system: SystemInfoDTO? = nil) {
        self.status = status
        self.components = components
        self.system = system
    }
}

/// The database connection-pool snapshot (web `useConnectionPool()` → `ConnectionPool`
/// from `/dev-tools/runtime-info`). Field names mirror the camelCase JSON exactly.
public struct ConnectionPoolDTO: Sendable, Equatable {
    public var maxOpen: Int
    public var open: Int
    public var inUse: Int
    public var idle: Int
    public var waitCount: Int
    public var waitDurationMs: Double

    public init(
        maxOpen: Int = 0,
        open: Int = 0,
        inUse: Int = 0,
        idle: Int = 0,
        waitCount: Int = 0,
        waitDurationMs: Double = 0
    ) {
        self.maxOpen = maxOpen
        self.open = open
        self.inUse = inUse
        self.idle = idle
        self.waitCount = waitCount
        self.waitDurationMs = waitDurationMs
    }
}

/// The version/runtime info (web `getVersionInfo()` → `VersionInfo` from
/// `/system/version`). Only the fields the surface renders are modeled.
public struct VersionDTO: Sendable, Equatable {
    public var goVersion: String?
    public var os: String
    public var arch: String
    public var uptimeSeconds: Int
    public var goroutines: Int

    public init(
        goVersion: String? = nil,
        os: String = "",
        arch: String = "",
        uptimeSeconds: Int = 0,
        goroutines: Int = 0
    ) {
        self.goVersion = goVersion
        self.os = os
        self.arch = arch
        self.uptimeSeconds = uptimeSeconds
        self.goroutines = goroutines
    }
}

// MARK: - Projected component row (one web DataTable row)

/// The view-ready projection of one component-health row: the raw status + its
/// tone, latency, failure count, and last-check timestamp. Identifiable by the
/// component name exactly like the web `keyExtractor={(r) => r.name}`.
public struct BackendComponentRow: Sendable, Equatable, Identifiable {
    public var name: String
    public var status: String
    public var tone: BackendStatusTone
    public var latencyMs: Double
    public var failures: Int
    /// The last-check ISO string (nil / empty → em-dash at the display boundary).
    public var lastCheckISO: String?

    public var id: String {
        name
    }

    public init(
        name: String,
        status: String,
        tone: BackendStatusTone,
        latencyMs: Double,
        failures: Int,
        lastCheckISO: String?
    ) {
        self.name = name
        self.status = status
        self.tone = tone
        self.latencyMs = latencyMs
        self.failures = failures
        self.lastCheckISO = lastCheckISO
    }
}

// MARK: - Connection-pool tile (web StatCard grid)

/// The five connection-pool metrics the web renders as a `Grid` of `StatCard`s.
/// The raw value carries the metric identity; the label + SF Symbol live here so
/// the view stays declarative (web `<StatCard label icon>` per metric).
public enum BackendPoolMetric: String, Sendable, Equatable, CaseIterable, Identifiable {
    case maxOpen
    case open
    case inUse
    case idle
    case waitCount

    public var id: String {
        rawValue
    }

    /// The i18n key + English fallback (web `t('Max Open')` etc.).
    public var labelKey: String {
        switch self {
        case .maxOpen: "Max Open"
        case .open: "Open"
        case .inUse: "In Use"
        case .idle: "Idle"
        case .waitCount: "Wait Count"
        }
    }

    /// The SF Symbol mirroring the web lucide icon (Database / Activity / Clock /
    /// Gauge) for each tile.
    public var symbol: String {
        switch self {
        case .maxOpen: "cylinder.split.1x2"
        case .open: "cylinder"
        case .inUse: "waveform.path.ecg"
        case .idle: "clock"
        case .waitCount: "gauge.medium"
        }
    }
}

/// One projected connection-pool tile: the metric + its locale-formatted integer
/// value (web `fmtInt(pool.<field>)`).
public struct BackendPoolStat: Sendable, Equatable, Identifiable {
    public var metric: BackendPoolMetric
    public var value: String

    public var id: String {
        metric.rawValue
    }

    public init(metric: BackendPoolMetric, value: String) {
        self.metric = metric
        self.value = value
    }
}

// MARK: - System-runtime key/value (web KVList)

/// One system-runtime key/value (web `KVList` item): the localized label + the
/// resolved value. Identifiable by the stable label key.
public struct BackendRuntimeRow: Sendable, Equatable, Identifiable {
    public var labelKey: String
    public var value: String

    public var id: String {
        labelKey
    }

    public init(labelKey: String, value: String) {
        self.labelKey = labelKey
        self.value = value
    }
}
