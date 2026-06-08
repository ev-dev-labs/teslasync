//
//  SystemHealthWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0099 · SystemHealthWidget (Apple)
//
//  Pure, Foundation-only adapter: the cached DTO inputs (web useSystemHealth /
//  useDBStats / useConnectionPool), the `vitals` projection (1:1 port of the web
//  SystemHealthWidget.tsx body), the fmtInt formatters, the P1/S10 i18n facade,
//  and the testable VoiceOver summary. No SwiftUI → host-compilable + EXECUTED.
//

import Foundation

// MARK: - Cached DTO inputs (web `SystemHealth` / `DBStats` / `ConnectionPool`)

/// One server component's health, mirroring the web `SystemHealthComponent`. The
/// widget only renders `status`; the production source decodes the `/system/health`
/// `components` map (snake_case or camelCase) into this normalized shape.
public struct SystemHealthComponentData: Sendable, Equatable {
    public var status: String

    public init(status: String) {
        self.status = status
    }
}

/// The normalized `/system/health` payload the widget renders, mirroring the web
/// `useSystemHealth` result (`status`, `components`, `databaseSize`).
public struct SystemHealthData: Sendable, Equatable {
    public var status: String
    public var components: [String: SystemHealthComponentData]
    public var databaseSize: String?

    public init(
        status: String = "unknown",
        components: [String: SystemHealthComponentData] = [:],
        databaseSize: String? = nil
    ) {
        self.status = status
        self.components = components
        self.databaseSize = databaseSize
    }
}

/// The normalized `/dev-tools/db-stats` payload (web `useDBStats`). Only
/// `databaseSize` participates in the widget (the web fallback for `dbSize`).
public struct SystemHealthDBStats: Sendable, Equatable {
    public var databaseSize: String?

    public init(databaseSize: String? = nil) {
        self.databaseSize = databaseSize
    }
}

/// The normalized `/dev-tools/runtime-info` payload (web `useConnectionPool`,
/// plus the runtime extras the web reads off the same object). `inUse`/`maxOpen`
/// come from the connection pool; `goroutines`/`memoryMB` are the Go runtime
/// counters the web reads defensively (`pool.data as Record<string, unknown>`).
public struct SystemHealthRuntimeInfo: Sendable, Equatable {
    public var inUse: Int
    public var maxOpen: Int
    public var goroutines: Int?
    public var memoryMB: Double?

    public init(inUse: Int = 0, maxOpen: Int = 0, goroutines: Int? = nil, memoryMB: Double? = nil) {
        self.inUse = inUse
        self.maxOpen = maxOpen
        self.goroutines = goroutines
        self.memoryMB = memoryMB
    }
}

/// One coalesced snapshot of the three independent web queries. The widget's
/// "has data" gate mirrors the web `hasData = health.data != null`, so the
/// snapshot is considered renderable only when `health` is present.
public struct SystemHealthSnapshot: Sendable, Equatable {
    public var health: SystemHealthData?
    public var dbStats: SystemHealthDBStats?
    public var runtime: SystemHealthRuntimeInfo?

    public init(
        health: SystemHealthData? = nil,
        dbStats: SystemHealthDBStats? = nil,
        runtime: SystemHealthRuntimeInfo? = nil
    ) {
        self.health = health
        self.dbStats = dbStats
        self.runtime = runtime
    }
}

// MARK: - Service status (web `ServiceStatus` union + `statusColor`)

/// A per-component status, mirroring the web `ServiceStatus`
/// (`'ok' | 'healthy' | 'degraded' | 'unhealthy'`). Unknown strings normalize to
/// `.unhealthy`, exactly like the web default (`components[key]?.status ?? 'unhealthy'`).
public enum SystemHealthServiceStatus: Sendable, Equatable {
    case ok
    case healthy
    case degraded
    case unhealthy

    public init(raw: String) {
        switch raw.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "ok": self = .ok
        case "healthy": self = .healthy
        case "degraded": self = .degraded
        default: self = .unhealthy
        }
    }

    /// The web `statusColor` "green" branch: `status === 'ok' || status === 'healthy'`.
    public var isHealthy: Bool {
        self == .ok || self == .healthy
    }
}

/// The overall badge tone, mirroring the web `overallBadgeStatus`
/// (`'online' | 'away' | 'offline'`) fed to `StatusBadge`.
public enum SystemHealthOverallBadge: Sendable, Equatable {
    case online
    case away
    case offline

    /// Port of the web `overallBadgeStatus(status)`.
    public init(overallStatus: String) {
        switch overallStatus {
        case "healthy": self = .online
        case "degraded": self = .away
        default: self = .offline
        }
    }
}

// MARK: - Projection (port of the web `services` useMemo + derived values)

/// One service row in the status grid (web `services.map`). `labelKey` +
/// `defaultLabel` resolve through the P1/S10 facade at the view layer, mirroring
/// the web `t(\`widget.systemHealth.${svc.i18n}\`, <title-cased key>)`.
public struct SystemHealthService: Sendable, Equatable, Identifiable {
    public var key: String
    public var labelKey: String
    public var defaultLabel: String
    public var status: SystemHealthServiceStatus

    public var id: String {
        key
    }

    public init(key: String, labelKey: String, defaultLabel: String, status: SystemHealthServiceStatus) {
        self.key = key
        self.labelKey = labelKey
        self.defaultLabel = defaultLabel
        self.status = status
    }
}

/// The fully-derived view state for the surface, a 1:1 projection of the web
/// component body's `useMemo` + the derived `overallStatus` / `healthyCount` /
/// `dbSize` / `activeConns` / `maxConns` / `goroutines` / `memory` values.
public struct SystemHealthVitals: Sendable, Equatable {
    public var overallStatus: String
    public var overallBadge: SystemHealthOverallBadge
    public var services: [SystemHealthService]
    public var healthyCount: Int
    public var dbSize: String
    public var activeConns: Int
    public var maxConns: Int
    public var goroutines: Int?
    public var memoryMB: Double?

    public init(
        overallStatus: String,
        overallBadge: SystemHealthOverallBadge,
        services: [SystemHealthService],
        healthyCount: Int,
        dbSize: String,
        activeConns: Int,
        maxConns: Int,
        goroutines: Int?,
        memoryMB: Double?
    ) {
        self.overallStatus = overallStatus
        self.overallBadge = overallBadge
        self.services = services
        self.healthyCount = healthyCount
        self.dbSize = dbSize
        self.activeConns = activeConns
        self.maxConns = maxConns
        self.goroutines = goroutines
        self.memoryMB = memoryMB
    }
}

/// Pure adapter: cached `SystemHealthSnapshot` → `SystemHealthVitals`. Reproduces
/// the web `SystemHealthWidget` body: the `SERVICE_KEYS` map, the
/// `components[key]?.status ?? 'unhealthy'` default, the `healthyCount` filter,
/// and the `dbSize` / `activeConns` / `maxConns` / `goroutines` / `memory`
/// resolution.
public enum SystemHealthProjection {
    /// The canonical service rows (web `SERVICE_KEYS`): `key` matches the
    /// `/system/health` component map; `i18n` is the `widget.systemHealth.*`
    /// label suffix.
    public static let serviceKeys: [(key: String, i18n: String)] = [
        (key: "database", i18n: "db"),
        (key: "mqtt", i18n: "mqtt"),
        (key: "tesla_api", i18n: "teslaApi"),
        (key: "fleet_telemetry", i18n: "workers")
    ]

    public static func vitals(from snapshot: SystemHealthSnapshot) -> SystemHealthVitals {
        let health = snapshot.health
        let components = health?.components ?? [:]

        let services = serviceKeys.map { svc in
            SystemHealthService(
                key: svc.key,
                labelKey: "widget.systemHealth.\(svc.i18n)",
                defaultLabel: titleCase(svc.key),
                status: SystemHealthServiceStatus(raw: components[svc.key]?.status ?? "unhealthy")
            )
        }

        let overallStatus = health?.status ?? "unknown"
        let healthyCount = services.count(where: { $0.status.isHealthy })

        let dbSize = firstNonEmpty(health?.databaseSize, snapshot.dbStats?.databaseSize)
            ?? SystemHealthFormat.emDash

        return SystemHealthVitals(
            overallStatus: overallStatus,
            overallBadge: SystemHealthOverallBadge(overallStatus: overallStatus),
            services: services,
            healthyCount: healthyCount,
            dbSize: dbSize,
            activeConns: snapshot.runtime?.inUse ?? 0,
            maxConns: snapshot.runtime?.maxOpen ?? 0,
            goroutines: snapshot.runtime?.goroutines,
            memoryMB: snapshot.runtime?.memoryMB
        )
    }

    /// Title-cases a component key the way the web fallback does:
    /// `key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())`
    /// (uppercases the first letter of each underscore-separated word, leaving the
    /// remainder untouched — e.g. `tesla_api` → `Tesla Api`, `mqtt` → `Mqtt`).
    public static func titleCase(_ key: String) -> String {
        key.split(separator: "_", omittingEmptySubsequences: true).map { word -> String in
            guard let first = word.first else { return "" }
            return String(first).uppercased() + word.dropFirst()
        }.joined(separator: " ")
    }

    /// Mirrors the web `a ?? b ?? '—'` nil-coalescing, treating an
    /// empty/whitespace string as absent so a blank API value falls through to the
    /// next source rather than rendering an empty cell.
    private static func firstNonEmpty(_ values: String?...) -> String? {
        for value in values {
            if let value, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return value
            }
        }
        return nil
    }
}

// MARK: - Overall-status labelling (port of the web `overallLabel`)

/// The localized "Healthy / Degraded / Down" overall label, mirroring the web
/// `overallLabel(status, t)`.
public enum SystemHealthOverall {
    public static func labelKey(for status: String) -> (key: String, fallback: String) {
        switch status {
        case "healthy": ("widget.systemHealth.healthy", "Healthy")
        case "degraded": ("widget.systemHealth.degraded", "Degraded")
        default: ("widget.systemHealth.down", "Down")
        }
    }

    /// Resolves the overall label through the P1/S10 facade.
    public static func label(for status: String) -> String {
        let entry = labelKey(for: status)
        return SystemHealthStrings.string(entry.key, entry.fallback)
    }

    /// The capitalized badge word for the online/away/offline tone.
    public static func badgeLabel(_ badge: SystemHealthOverallBadge) -> String {
        switch badge {
        case .online: SystemHealthStrings.string("widget.systemHealth.online", "Online")
        case .away: SystemHealthStrings.string("widget.systemHealth.away", "Away")
        case .offline: SystemHealthStrings.string("widget.systemHealth.offline", "Offline")
        }
    }
}

// MARK: - Formatters (port of lib/numberFormat.ts `fmtInt`)

/// Integer formatter + value glyphs that match the web `fmtInt` output and the
/// `dbSize` / `activeConns` / `memory` / `goroutines` cell strings.
public enum SystemHealthFormat {
    /// Shared "no value" glyph (web `'—'`).
    public static let emDash = "—"

    /// Locale-aware grouped integer (web `fmtInt`).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Locale-aware grouped integer for a real value, rounding half-up like the
    /// web `fmtInt(number)` (used for the `memoryMB` runtime counter).
    public static func int(_ value: Double, locale: Locale = .current) -> String {
        let safe = value.isFinite ? value : 0
        return int(Int(safe.rounded(.toNearestOrAwayFromZero)), locale: locale)
    }

    /// The Active Conns cell: `maxConns > 0 ? '${inUse}/${maxOpen}' : '${inUse}'`.
    public static func activeConns(inUse: Int, maxOpen: Int, locale: Locale = .current) -> String {
        maxOpen > 0 ? "\(int(inUse, locale: locale))/\(int(maxOpen, locale: locale))" : int(inUse, locale: locale)
    }

    /// The Memory cell: `memory != null ? '${fmtInt(memory)} MB' : '—'`.
    public static func memory(_ memoryMB: Double?, locale: Locale = .current) -> String {
        guard let memoryMB else { return emDash }
        return "\(int(memoryMB, locale: locale)) MB"
    }

    /// The Goroutines cell: `goroutines != null ? fmtInt(goroutines) : '—'`.
    public static func goroutines(_ goroutines: Int?, locale: Locale = .current) -> String {
        guard let goroutines else { return emDash }
        return int(goroutines, locale: locale)
    }

    /// The compact "X/Y services" suffix counter (web `${healthyCount}/${services.length}`).
    public static func serviceCount(healthy: Int, total: Int, locale: Locale = .current) -> String {
        "\(int(healthy, locale: locale))/\(int(total, locale: locale))"
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback (no
/// hardcoded literals). Keys live in the per-surface "SystemHealthWidget" table,
/// folded into the app `Localizable.xcstrings` at integration time. The SwiftUI
/// `text(_:_:)` convenience is added in `SystemHealthWidget.Model.swift`.
public enum SystemHealthStrings {
    public static let table = "SystemHealthWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the content. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum SystemHealthAccessibility {
    public static func summary(from vitals: SystemHealthVitals) -> String {
        var parts: [String] = [
            SystemHealthStrings.string("widget.systemHealth.title", "System Health")
                + ": " + SystemHealthOverall.label(for: vitals.overallStatus),
            SystemHealthFormat.serviceCount(healthy: vitals.healthyCount, total: vitals.services.count)
                + " " + SystemHealthStrings.string("widget.systemHealth.services", "services")
        ]

        for service in vitals.services {
            let label = SystemHealthStrings.string(service.labelKey, service.defaultLabel)
            let status = service.status.isHealthy
                ? SystemHealthStrings.string("widget.systemHealth.healthy", "Healthy")
                : (service.status == .degraded
                    ? SystemHealthStrings.string("widget.systemHealth.degraded", "Degraded")
                    : SystemHealthStrings.string("widget.systemHealth.down", "Down"))
            parts.append("\(label): \(status)")
        }

        parts.append(SystemHealthStrings.string("widget.systemHealth.dbSize", "DB Size") + ": " + vitals.dbSize)
        parts.append(
            SystemHealthStrings.string("widget.systemHealth.activeConns", "Active Conns") + ": "
                + SystemHealthFormat.activeConns(inUse: vitals.activeConns, maxOpen: vitals.maxConns)
        )
        parts.append(
            SystemHealthStrings.string("widget.systemHealth.memory", "Memory") + ": "
                + SystemHealthFormat.memory(vitals.memoryMB)
        )
        parts.append(
            SystemHealthStrings.string("widget.systemHealth.goroutines", "Goroutines") + ": "
                + SystemHealthFormat.goroutines(vitals.goroutines)
        )

        return parts.joined(separator: ". ")
    }
}
