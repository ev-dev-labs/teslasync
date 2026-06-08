//
//  TelemetryErrorsWidget.Projection.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  The pure, Foundation-only adapter for the surface: the cached DTO inputs
//  (web `FleetTelemetryErrorVIN` / `FleetTelemetryError`), the `aggregate`
//  projection (a 1:1 port of the `aggregated` useMemo in
//  features/dashboard/widgets/TelemetryErrorsWidget.tsx), the active-VIN /
//  status / freshness derivations, the fmtInt + formatRelative formatters
//  (ports of lib/numberFormat.ts `fmtInt` and lib/dateFormat.ts
//  `formatRelative`), the ISO-8601 seam parser, the P1/S10 i18n facade, and the
//  testable VoiceOver summary. No SwiftUI here so the projection can be compiled
//  into a host harness and EXECUTED (cached → projection) without a simulator.
//

import Foundation

// MARK: - Cached DTO inputs (web `FleetTelemetryErrorVIN` + `FleetTelemetryError`)

/// One Fleet-Telemetry "error VIN" record, mirroring the web
/// `FleetTelemetryErrorVIN` (`/tesla/fleet-telemetry/error-vins`). The
/// production source decodes the snake_case payload into this normalized shape;
/// the timestamps are parsed to `Date` at the seam so the projection works with
/// real instants rather than the web's lexical ISO strings.
public struct TelemetryErrorVIN: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var vin: String
    public var active: Bool
    public var firstSeenAt: Date?
    public var lastSeenAt: Date?
    public var resolvedAt: Date?

    public init(
        id: Int64,
        vin: String,
        active: Bool,
        firstSeenAt: Date? = nil,
        lastSeenAt: Date? = nil,
        resolvedAt: Date? = nil
    ) {
        self.id = id
        self.vin = vin
        self.active = active
        self.firstSeenAt = firstSeenAt
        self.lastSeenAt = lastSeenAt
        self.resolvedAt = resolvedAt
    }
}

/// One Fleet-Telemetry error record, mirroring the web `FleetTelemetryError`
/// (`/tesla/fleet-telemetry/errors`). `errorCode` is optional like the web
/// `error_code: string | null`; the aggregation timestamp is `reportedAt ??
/// fetchedAt` (web `e.reported_at ?? e.fetched_at`).
public struct TelemetryErrorEntry: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var vin: String
    public var errorCode: String?
    public var errorMessage: String?
    public var reportedAt: Date?
    public var teslaUpdatedAt: Date?
    public var fetchedAt: Date?

    public init(
        id: Int64,
        vin: String,
        errorCode: String? = nil,
        errorMessage: String? = nil,
        reportedAt: Date? = nil,
        teslaUpdatedAt: Date? = nil,
        fetchedAt: Date? = nil
    ) {
        self.id = id
        self.vin = vin
        self.errorCode = errorCode
        self.errorMessage = errorMessage
        self.reportedAt = reportedAt
        self.teslaUpdatedAt = teslaUpdatedAt
        self.fetchedAt = fetchedAt
    }

    /// The timestamp the aggregation buckets on (web `reported_at ?? fetched_at`).
    public var aggregationTimestamp: Date? {
        reportedAt ?? fetchedAt
    }
}

// MARK: - Projection (port of the web `aggregated` useMemo)

/// One aggregated `{vin, error_code}` feed row, mirroring the entries the web
/// `aggregated` `useMemo` builds: a running `count` and the most-recent
/// `lastSeen`. `errorCode` is the display string (the localized "Unknown" when
/// the source code was null, web `error_code ?? t('…unknown','Unknown')`).
public struct TelemetryErrorAggregate: Sendable, Equatable {
    public var vin: String
    public var errorCode: String
    public var count: Int
    public var lastSeen: Date?

    public init(vin: String, errorCode: String, count: Int, lastSeen: Date?) {
        self.vin = vin
        self.errorCode = errorCode
        self.count = count
        self.lastSeen = lastSeen
    }
}

/// Pure adapter for the surface: every derivation the web component performs
/// over the two cached lists (`errorVINs`, `errors`).
public enum TelemetryErrorsWidgetProjection {
    /// One hour in seconds — the "recent" window (web `ONE_HOUR_MS`).
    public static let recentWindow: TimeInterval = 60 * 60

    /// Active error-VIN count (web `vinList.filter((v) => v.active).length`).
    public static func activeVINCount(_ vins: [TelemetryErrorVIN]) -> Int {
        vins.reduce(0) { $0 + ($1.active ? 1 : 0) }
    }

    /// Whether the surface has any data at all (web `vinList.length > 0 ||
    /// errorList.length > 0`). Drives the top-level empty branch.
    public static func hasData(vins: [TelemetryErrorVIN], errors: [TelemetryErrorEntry]) -> Bool {
        !vins.isEmpty || !errors.isEmpty
    }

    /// Aggregates the raw error list by `vin` + `error_code`, summing the
    /// occurrence `count` and tracking the latest `lastSeen`, then sorts newest
    /// first with undated rows last — a 1:1 port of the web `aggregated`
    /// `useMemo`. The dedup key uses the raw code (web literal `'unknown'`),
    /// while the displayed `errorCode` falls back to the localized `unknownLabel`
    /// (web `t('widget.telemetryErrors.unknown', 'Unknown')`). The sort is
    /// stable on ties so equal/undated rows keep their first-seen order, matching
    /// the web `Array.from(map.values())` insertion order under a stable sort.
    public static func aggregate(
        _ errors: [TelemetryErrorEntry],
        unknownLabel: String
    ) -> [TelemetryErrorAggregate] {
        var order: [String] = []
        var map: [String: TelemetryErrorAggregate] = [:]

        for entry in errors {
            let rawCode = entry.errorCode ?? "unknown"
            let key = "\(entry.vin)::\(rawCode)"
            let timestamp = entry.aggregationTimestamp

            if var existing = map[key] {
                existing.count += 1
                if let timestamp, existing.lastSeen == nil || timestamp > (existing.lastSeen ?? .distantPast) {
                    existing.lastSeen = timestamp
                }
                map[key] = existing
            } else {
                order.append(key)
                map[key] = TelemetryErrorAggregate(
                    vin: entry.vin,
                    errorCode: entry.errorCode ?? unknownLabel,
                    count: 1,
                    lastSeen: timestamp
                )
            }
        }

        let values = order.compactMap { map[$0] }
        return values.enumerated()
            .sorted { lhs, rhs in
                switch (lhs.element.lastSeen, rhs.element.lastSeen) {
                case let (left?, right?):
                    left == right ? lhs.offset < rhs.offset : left > right
                case (_?, nil):
                    true
                case (nil, _?):
                    false
                case (nil, nil):
                    lhs.offset < rhs.offset
                }
            }
            .map(\.element)
    }

    /// Whether an aggregate's last sighting is inside the one-hour "recent"
    /// window (web `Date.now() - new Date(entry.last_seen).getTime() <
    /// ONE_HOUR_MS`). Undated rows are never "recent".
    public static func isRecent(_ lastSeen: Date?, now: Date = Date()) -> Bool {
        guard let lastSeen else { return false }
        return now.timeIntervalSince(lastSeen) < recentWindow
    }
}

// MARK: - Status tone (web `statusBadge` / `statusLabel`)

/// The fleet health verdict driving the status badge: `errors` (web `danger`)
/// when any error VIN is active, otherwise `healthy` (web `success`).
public enum TelemetryErrorsStatus: Sendable, Equatable {
    case errors
    case healthy

    /// Derives the verdict from the active-VIN count (web
    /// `activeVINCount > 0 ? 'danger' : 'success'`).
    public static func resolve(activeVINCount: Int) -> TelemetryErrorsStatus {
        activeVINCount > 0 ? .errors : .healthy
    }

    /// The localized status word (web `'Errors'` / `'Healthy'`).
    public var label: String {
        switch self {
        case .errors:
            TelemetryErrorsStrings.string("widget.telemetryErrors.errors", "Errors")
        case .healthy:
            TelemetryErrorsStrings.string("widget.telemetryErrors.healthy", "Healthy")
        }
    }
}

// MARK: - Relative-time bucket (port of lib/dateFormat.ts `formatRelative`)

/// The relative-time bucket for a timestamp, mirroring the web `formatRelative`
/// thresholds (just now / m / h / d / absolute date) the `TimeStamp` renders.
public enum TelemetryErrorsRelativeLabel: Equatable, Sendable {
    case justNow
    case minutes(Int)
    case hours(Int)
    case days(Int)
    case absolute(Date)
}

// MARK: - Formatters (port of lib/numberFormat.ts + lib/dateFormat.ts)

/// Integer + relative-time formatters that match the web `fmtInt` and
/// `formatRelative` output the widget relies on.
public enum TelemetryErrorsWidgetFormat {
    /// Shared "no value" glyph (web `'—'`).
    public static let emDash = "—"

    /// Locale-aware grouped integer (web `fmtInt`, which rounds via `fmtNumber`).
    public static func int(_ value: Int, locale: Locale = .current) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        formatter.usesGroupingSeparator = true
        formatter.maximumFractionDigits = 0
        formatter.roundingMode = .halfUp
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Buckets a timestamp into a relative label (web `formatRelative`).
    public static func relative(_ date: Date, now: Date = Date()) -> TelemetryErrorsRelativeLabel {
        let seconds = Int(now.timeIntervalSince(date).rounded(.down))
        if seconds < 60 { return .justNow }
        let minutes = seconds / 60
        if minutes < 60 { return .minutes(minutes) }
        let hours = minutes / 60
        if hours < 24 { return .hours(hours) }
        let days = hours / 24
        if days < 7 { return .days(days) }
        return .absolute(date)
    }

    /// Resolves a relative label to a localized string through the P1/S10 facade.
    public static func relativeText(
        _ label: TelemetryErrorsRelativeLabel,
        locale: Locale = .current
    ) -> String {
        switch label {
        case .justNow:
            return TelemetryErrorsStrings.string("widget.telemetryErrors.justNow", "just now")
        case let .minutes(value):
            return TelemetryErrorsStrings.count("widget.telemetryErrors.minAgo", "%lldm ago", value)
        case let .hours(value):
            return TelemetryErrorsStrings.count("widget.telemetryErrors.hourAgo", "%lldh ago", value)
        case let .days(value):
            return TelemetryErrorsStrings.count("widget.telemetryErrors.dayAgo", "%lldd ago", value)
        case let .absolute(date):
            let formatter = DateFormatter()
            formatter.locale = locale
            formatter.setLocalizedDateFormatFromTemplate("MMMdyyyy")
            return formatter.string(from: date)
        }
    }

    /// The relative label for an optional timestamp, or the em dash when absent
    /// (web `<TimeStamp value={entry.last_seen || null} />`, which renders `'—'`
    /// for a null/unparseable value).
    public static func relativeText(for date: Date?, now: Date = Date(), locale: Locale = .current) -> String {
        guard let date else { return emDash }
        return relativeText(relative(date, now: now), locale: locale)
    }
}

// MARK: - ISO-8601 seam parser

/// Parses the API's ISO-8601 timestamps into `Date` at the state-holder seam, so
/// the projection never compares lexical strings. Tolerates the fractional-second
/// and whole-second variants the backend emits. The formatter is built locally
/// per call (rather than cached in a `static let`) so the helper stays
/// `Sendable`-safe under `SWIFT_STRICT_CONCURRENCY=complete` — parsing runs once
/// per fetch at the source seam, not on a render hot path.
public enum TelemetryErrorsTimestamp {
    /// Parses an optional ISO-8601 string, returning `nil` for `nil`/empty/
    /// unparseable input (web `new Date(...)` → `NaN` → `'—'`).
    public static func parse(_ iso: String?) -> Date? {
        guard let iso, !iso.isEmpty else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// code path holds a hardcoded literal. Keys live in the per-surface
/// "TelemetryErrorsWidget" table, folded into the app `Localizable.xcstrings`
/// master catalog at integration time (kept separate so each parallel surface
/// owns its own strings without editing the shared catalog). The SwiftUI
/// `text(_:_:)` convenience is added in `TelemetryErrorsWidget.Model.swift`.
public enum TelemetryErrorsStrings {
    public static let table = "TelemetryErrorsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the surface. Pure + public so the a11y
/// label content can be unit-tested without rendering the view.
public enum TelemetryErrorsWidgetAccessibility {
    /// The widget-level summary (status + active VIN count).
    public static func summary(activeVINCount: Int, status: TelemetryErrorsStatus) -> String {
        let countText = TelemetryErrorsStrings.count(
            "widget.telemetryErrors.activeVINs",
            "%lld VINs with errors",
            activeVINCount
        )
        return [status.label, countText].joined(separator: ". ")
    }

    /// One feed-row summary (web row: VIN, error code, ×count, relative time, and
    /// the optional "recent" flag).
    public static func rowLabel(
        for aggregate: TelemetryErrorAggregate,
        isRecent: Bool,
        now: Date = Date(),
        locale: Locale = .current
    ) -> String {
        var parts = [
            aggregate.vin,
            aggregate.errorCode,
            TelemetryErrorsStrings.count("widget.telemetryErrors.countA11y", "%lld occurrences", aggregate.count),
            TelemetryErrorsWidgetFormat.relativeText(for: aggregate.lastSeen, now: now, locale: locale)
        ]
        if isRecent {
            parts.append(TelemetryErrorsStrings.string("widget.telemetryErrors.recent", "recent"))
        }
        return parts.joined(separator: ", ")
    }
}
