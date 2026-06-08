//
//  UptimeMonitorWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  The pure, Foundation-only adapter for the surface: the cached DTO inputs
//  (the `SystemHealth` payload the web `useSystemHealth` returns), the `services`
//  projection (a 1:1 port of the web `useMemo` + `healthyCount` + `overallStatus`
//  in features/dashboard/widgets/UptimeMonitorWidget.tsx), the status→tone map
//  (port of the web `statusVariant`), the DB-size/table-count formatters, the
//  P1/S10 i18n facade, and the testable VoiceOver summary. No SwiftUI here so the
//  projection can be compiled into a host harness and EXECUTED (cached →
//  projection) without a simulator.
//

import Foundation

// MARK: - Cached DTO inputs (web `SystemHealth` / `SystemHealthComponent`)

/// One component's health, mirroring the web `SystemHealthComponent` fields the
/// widget reads (`status`, `consecutiveFailures`, `lastError`). The production
/// source decodes the `/system/health` payload (snake_case or camelCase) into
/// this normalized shape; `status` stays a raw string because the web
/// `ComponentStatus` is an open union (healthy/ok/degraded/unhealthy/offline/…).
public struct UptimeMonitorWidgetSystemHealthComponentData: Sendable, Equatable {
    public var status: String
    public var consecutiveFailures: Int
    public var lastError: String?

    public init(status: String, consecutiveFailures: Int = 0, lastError: String? = nil) {
        self.status = status
        self.consecutiveFailures = consecutiveFailures
        self.lastError = lastError
    }
}

/// The normalized system-health payload the widget renders, mirroring the web
/// `SystemHealth` (`status`, `components`, `databaseSize`, `tableCount`).
/// `databaseSize`/`tableCount` are optional so the web's defensive `?? '—'`
/// fallbacks are reproduced exactly.
public struct UptimeMonitorWidgetSystemHealthData: Sendable, Equatable {
    public var status: String
    public var components: [String: UptimeMonitorWidgetSystemHealthComponentData]
    public var databaseSize: String?
    public var tableCount: Int?

    public init(
        status: String,
        components: [String: UptimeMonitorWidgetSystemHealthComponentData] = [:],
        databaseSize: String? = nil,
        tableCount: Int? = nil
    ) {
        self.status = status
        self.components = components
        self.databaseSize = databaseSize
        self.tableCount = tableCount
    }
}

// MARK: - Status tone (port of the web `statusVariant`)

/// The semantic tone a status maps to — the native counterpart of the web
/// `Badge` variant (`success` / `warning` / `danger`).
public enum UptimeStatusTone: Sendable, Equatable {
    case success
    case warning
    case danger
}

// MARK: - Projection (port of the web `services` useMemo + healthyCount + overall)

/// One service row in the projection, mirroring the web `services[]` entries
/// (`key`, `status`, `failures`, `lastError`) plus the resolved `tone`. The
/// localized `label` is resolved at the view boundary via
/// `UptimeMonitorStrings.serviceLabel(_:)` so the projection stays locale-pure
/// and host-executable.
public struct UptimeMonitorService: Sendable, Equatable {
    public var key: String
    public var status: String
    public var tone: UptimeStatusTone
    public var failures: Int
    public var lastError: String?

    public init(key: String, status: String, tone: UptimeStatusTone, failures: Int, lastError: String?) {
        self.key = key
        self.status = status
        self.tone = tone
        self.failures = failures
        self.lastError = lastError
    }
}

/// The fully-resolved render model for the surface — the native counterpart of
/// everything the web component derives from `data` before the JSX.
public struct UptimeMonitorProjection: Sendable, Equatable {
    public var services: [UptimeMonitorService]
    public var overallStatus: String
    public var overallTone: UptimeStatusTone
    public var healthyCount: Int
    public var totalCount: Int
    public var databaseSize: String?
    public var tableCount: Int?

    public init(
        services: [UptimeMonitorService] = [],
        overallStatus: String = UptimeMonitorProjector.unknownOverall,
        overallTone: UptimeStatusTone = .danger,
        healthyCount: Int = 0,
        totalCount: Int = 0,
        databaseSize: String? = nil,
        tableCount: Int? = nil
    ) {
        self.services = services
        self.overallStatus = overallStatus
        self.overallTone = overallTone
        self.healthyCount = healthyCount
        self.totalCount = totalCount
        self.databaseSize = databaseSize
        self.tableCount = tableCount
    }
}

/// Pure adapter: cached `UptimeMonitorWidgetSystemHealthData` → `UptimeMonitorProjection`. Reproduces
/// the web `useMemo`/derivations exactly: the fixed `SERVICE_KEYS` order, the
/// `status ?? 'unhealthy'` default, `statusVariant`, `healthyCount`, and the
/// `data?.status ?? 'unknown'` overall fallback.
public enum UptimeMonitorProjector {
    /// The fixed service order from the web `SERVICE_KEYS`.
    public static let serviceKeys = ["database", "mqtt", "tesla_api", "fleet_telemetry"]

    /// The web `'unhealthy'` default a missing component status falls back to.
    public static let defaultServiceStatus = "unhealthy"

    /// The web `'unknown'` overall fallback when there is no payload status.
    public static let unknownOverall = "unknown"

    /// Port of the web `statusVariant`: ok/healthy → success, degraded → warning,
    /// everything else (unhealthy/offline/down/failed/unknown/…) → danger.
    public static func tone(for status: String) -> UptimeStatusTone {
        switch status.lowercased() {
        case "ok", "healthy":
            .success
        case "degraded":
            .warning
        default:
            .danger
        }
    }

    /// Whether a status counts as healthy for `healthyCount` (web `s.status ===
    /// 'ok' || s.status === 'healthy'`).
    public static func isHealthy(_ status: String) -> Bool {
        let lowered = status.lowercased()
        return lowered == "ok" || lowered == "healthy"
    }

    public static func project(from data: UptimeMonitorWidgetSystemHealthData) -> UptimeMonitorProjection {
        let services = serviceKeys.map { key -> UptimeMonitorService in
            let component = data.components[key]
            let status = component?.status ?? defaultServiceStatus
            return UptimeMonitorService(
                key: key,
                status: status,
                tone: tone(for: status),
                failures: component?.consecutiveFailures ?? 0,
                lastError: component?.lastError
            )
        }
        let healthy = services.reduce(0) { $0 + (isHealthy($1.status) ? 1 : 0) }
        let overall = data.status.isEmpty ? unknownOverall : data.status
        return UptimeMonitorProjection(
            services: services,
            overallStatus: overall,
            overallTone: tone(for: overall),
            healthyCount: healthy,
            totalCount: services.count,
            databaseSize: data.databaseSize,
            tableCount: data.tableCount
        )
    }
}

// MARK: - Formatters (web `data.databaseSize ?? '—'`, `data.tableCount ?? '—'`)

/// Number / value formatters that match the web fallbacks the widget relies on.
public enum UptimeMonitorFormat {
    /// Shared "no value" glyph (web `'—'`).
    public static let emDash = "—"

    /// The DB-size string, falling back to an em dash like the web
    /// `data.databaseSize ?? '—'` (also treating blank as missing).
    public static func databaseSize(_ value: String?) -> String {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? emDash : trimmed
    }

    /// The table count, grouped, falling back to an em dash like the web
    /// `data.tableCount ?? '—'`.
    public static func tableCount(_ value: Int?, locale: Locale = .current) -> String {
        guard let value else { return emDash }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// The "healthy / total" count shown in the compact layout (web
    /// `{healthyCount}/{services.length}`).
    public static func healthRatio(healthy: Int, total: Int) -> String {
        "\(healthy)/\(total)"
    }
}

// MARK: - Status labels (web `'OK'` / raw status, `'All OK'` / raw overall)

/// Resolves the human-facing status words through the P1/S10 facade, reproducing
/// the web's `status === 'ok' || 'healthy' ? 'OK' : status` (service badge) and
/// `overallStatus === 'healthy' ? 'All OK' : overallStatus` (overall badge), with
/// localized words for the known states and the raw token as the final fallback.
public enum UptimeMonitorStatusText {
    /// The badge text for an individual service (web ternary → 'OK' or raw status).
    public static func serviceBadge(_ status: String) -> String {
        if UptimeMonitorProjector.isHealthy(status) {
            return UptimeMonitorStrings.string("widget.uptime.ok", "OK")
        }
        return localizedStatus(status)
    }

    /// The badge text for the overall row (web ternary → 'All OK' or raw status).
    public static func overallBadge(_ status: String) -> String {
        if status.lowercased() == "healthy" {
            return UptimeMonitorStrings.string("widget.uptime.allOk", "All OK")
        }
        return localizedStatus(status)
    }

    /// Maps a known status token to a localized word, falling back to the raw
    /// token (so unexpected backend states still render, like the web).
    public static func localizedStatus(_ status: String) -> String {
        switch status.lowercased() {
        case "ok":
            UptimeMonitorStrings.string("widget.uptime.ok", "OK")
        case "healthy":
            UptimeMonitorStrings.string("widget.uptime.healthy", "Healthy")
        case "degraded":
            UptimeMonitorStrings.string("widget.uptime.degraded", "Degraded")
        case "unhealthy":
            UptimeMonitorStrings.string("widget.uptime.unhealthy", "Unhealthy")
        case "offline":
            UptimeMonitorStrings.string("widget.uptime.statusOffline", "Offline")
        case "down":
            UptimeMonitorStrings.string("widget.uptime.down", "Down")
        case "failed":
            UptimeMonitorStrings.string("widget.uptime.failed", "Failed")
        case "unknown":
            UptimeMonitorStrings.string("widget.uptime.unknown", "Unknown")
        default:
            status
        }
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// code path holds a hardcoded literal. Keys live in the per-surface
/// "UptimeMonitorWidget" table, folded into the app `Localizable.xcstrings`
/// master catalog at integration time (kept separate so each parallel surface
/// owns its own strings without editing the shared catalog). The SwiftUI
/// `text(_:_:)` convenience is added in `UptimeMonitorWidget.Model.swift`.
public enum UptimeMonitorStrings {
    public static let table = "UptimeMonitorWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// The localized service label (web
    /// `t('widget.uptime.${key}', humanize(key))`). The fallback is the web's
    /// humanized token so a missing catalog entry still reads naturally.
    public static func serviceLabel(_ key: String) -> String {
        string("widget.uptime.\(key)", humanize(key))
    }

    /// Port of the web `key.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase())`.
    static func humanize(_ key: String) -> String {
        key
            .split(separator: "_")
            .map { word -> String in
                guard let first = word.first else { return "" }
                return first.uppercased() + word.dropFirst()
            }
            .joined(separator: " ")
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the content. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum UptimeMonitorAccessibility {
    public static func summary(for projection: UptimeMonitorProjection) -> String {
        let overall = UptimeMonitorStrings.string("widget.uptime.overall", "Overall")
            + ": " + UptimeMonitorStatusText.overallBadge(projection.overallStatus)
        let healthy = UptimeMonitorStrings.count(
            "widget.uptime.healthyA11y",
            "%lld services healthy",
            projection.healthyCount
        ) + " " + UptimeMonitorStrings.count("widget.uptime.ofTotalA11y", "of %lld", projection.totalCount)
        let database = UptimeMonitorStrings.string("widget.uptime.dbSize", "DB Size")
            + ": " + UptimeMonitorFormat.databaseSize(projection.databaseSize)
        let tables = UptimeMonitorStrings.string("widget.uptime.tables", "Tables")
            + ": " + UptimeMonitorFormat.tableCount(projection.tableCount)
        return [overall, healthy, database, tables].joined(separator: ". ")
    }
}
