//
//  HealthProbesSection.Adapter.swift
//  TeslaSync — P4 feature view · 0244 · HealthProbesSection (Apple)
//
//  The testable projection core for the system-status "Health Probes" surface —
//  the faithful port of features/system/components/status/HealthProbesSection.tsx
//  (and its sibling helpers.tsx). Everything here is pure and dependency-free
//  (Foundation only) so it can be unit-tested without a bundle or a rendered view.
//
//  Web parity notes:
//    • The web component reads ONE source — `getExtendedHealth()` (/system/health,
//      30s refetch) — and renders two probe cards (Liveness — /healthz, Readiness —
//      /readyz). The native source seam (P1/S8) hands this adapter the same shape via
//      `HealthProbesHealthDTO`; the projections in `.Projection` derive the two
//      cards, the header Live / Ready badges, and the render phase from it.
//    • `statusToBadgeVariant` (helpers.tsx) — the exact lowercase case list (note it
//      omits "connected", unlike `statusTextClass`) — becomes
//      `HealthProbeStatus.variant`, mapped to a semantic `HealthProbeTone` so the
//      badges tint natively.
//    • `data?.status ?? 'unknown'` / `data?.database?.status ?? 'unknown'` keep the
//      raw status value (rendered verbatim, exactly like the web — never localized);
//      the `'unknown'` fallback is the `HealthProbesDisplay.unknownStatus` data value.
//    • `fmtInt`, `fmtNumber(_, 1)`, `formatUptime` and the `'—'` latency fallback are
//      ported in `HealthProbesFormat` (`.Projection`).
//

import Foundation

// MARK: - Shared display constants

/// Display helpers shared by the projections.
public enum HealthProbesDisplay {
    /// The em-dash the web renders for a missing latency value
    /// (web `dbLatency != null ? … : '—'`).
    public static let emDash = "—"
    /// The raw status fallback the web uses when a probe omits a status
    /// (web `?? 'unknown'`). A data value rendered verbatim, never localized.
    public static let unknownStatus = "unknown"
}

// MARK: - Status variant (web `statusToBadgeVariant`)

/// The semantic tone of a probe status — the native parity of the web
/// `statusToBadgeVariant` (helpers.tsx). Drives the badge tint.
public enum HealthProbeTone: String, Sendable, Equatable, CaseIterable, Identifiable {
    case success
    case warning
    case danger
    case neutral

    public var id: String {
        rawValue
    }
}

/// Pure status classification — the faithful port of the web `statusToBadgeVariant`
/// lowercase case list (helpers.tsx). The success list omits "connected" (present in
/// `statusTextClass` but NOT in `statusToBadgeVariant` — the source distinction).
public enum HealthProbeStatus {
    public static func variant(_ raw: String) -> HealthProbeTone {
        switch raw.lowercased() {
        case "healthy", "ok", "online", "ready", "sent", "completed":
            .success
        case "degraded", "warning", "pending", "queued", "processing":
            .warning
        case "unhealthy", "offline", "error", "down", "failed":
            .danger
        default:
            .neutral
        }
    }
}

// MARK: - Transport DTOs (the P1/S8 source seam input)

/// The database readiness block (web `extHealth.database`).
public struct DatabaseProbeDTO: Sendable, Equatable {
    /// The database readiness status (web `data.database.status`).
    public var status: String
    /// Probe latency in milliseconds, when known (web `data?.database?.latency_ms`).
    public var latencyMs: Double?

    public init(status: String, latencyMs: Double? = nil) {
        self.status = status
        self.latencyMs = latencyMs
    }
}

/// The runtime system block the surface reads (web `extHealth.system`).
public struct SystemProbeDTO: Sendable, Equatable {
    public var goroutines: Int
    public var uptimeSeconds: Int

    public init(goroutines: Int = 0, uptimeSeconds: Int = 0) {
        self.goroutines = goroutines
        self.uptimeSeconds = uptimeSeconds
    }
}

/// The connection-pool block the surface reads (web `extHealth.database_pool`).
public struct DatabasePoolProbeDTO: Sendable, Equatable {
    /// Total pool connections (web `data?.database_pool?.total_conns`).
    public var totalConns: Int

    public init(totalConns: Int = 0) {
        self.totalConns = totalConns
    }
}

/// The extended-health envelope (web `getExtendedHealth()` → `ExtendedHealthResponse`).
/// Only the fields the surface renders are modeled; the source projects the rest away.
public struct HealthProbesHealthDTO: Sendable, Equatable {
    /// The overall liveness status (web `data.status`).
    public var status: String
    public var database: DatabaseProbeDTO?
    public var system: SystemProbeDTO?
    public var databasePool: DatabasePoolProbeDTO?

    public init(
        status: String,
        database: DatabaseProbeDTO? = nil,
        system: SystemProbeDTO? = nil,
        databasePool: DatabasePoolProbeDTO? = nil
    ) {
        self.status = status
        self.database = database
        self.system = system
        self.databasePool = databasePool
    }
}

// MARK: - Projected header badge (web `<Badge dot>`)

/// One header probe badge (web `<Badge variant size dot>{t('Live')}</Badge>`): the
/// localized label key + the tone derived from the underlying status.
public struct HealthProbeBadge: Sendable, Equatable, Identifiable {
    public var labelKey: String
    public var tone: HealthProbeTone

    public var id: String {
        labelKey
    }

    public init(labelKey: String, tone: HealthProbeTone) {
        self.labelKey = labelKey
        self.tone = tone
    }
}

// MARK: - Projected key/value (web `KVList` item)

/// One probe key/value line (web `KVList` item): the localized label key + the
/// resolved value. Identifiable by the stable label key.
public struct HealthProbeKV: Sendable, Equatable, Identifiable {
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

// MARK: - Projected probe card (web `<Card>`)

/// One probe card (web `<Card>` with `<CardHeader title action>` + `<KVList>`): the
/// localized title key, the raw status value rendered in the header badge + its tone,
/// and the key/value rows. Identifiable by the stable title key.
public struct HealthProbeCard: Sendable, Equatable, Identifiable {
    public var titleKey: String
    public var status: String
    public var tone: HealthProbeTone
    public var rows: [HealthProbeKV]

    public var id: String {
        titleKey
    }

    public init(titleKey: String, status: String, tone: HealthProbeTone, rows: [HealthProbeKV]) {
        self.titleKey = titleKey
        self.status = status
        self.tone = tone
        self.rows = rows
    }
}
