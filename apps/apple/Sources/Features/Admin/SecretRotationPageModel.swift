import Foundation
import Observation

// MARK: - Severity (web `SecretRotationSeverity`)

/// The per-secret rotation tier the backend computes from the configured per-kind
/// warn/critical day thresholds (web `SecretRotationSeverity = 'ok' | 'warn' |
/// 'critical' | 'unknown'`). Carried as a tolerant enum so an unexpected server token
/// folds to `.unknown` instead of failing — mirroring the KMP model's "raw string"
/// robustness strategy used by the sibling Disk Forecast surface.
public enum SecretRotationSeverity: String, CaseIterable, Sendable, Equatable {
    case ok
    case warn
    case critical
    case unknown

    /// Folds a raw wire token onto the canonical tier (unknown tokens → `.unknown`).
    public init(wire: String) {
        self = SecretRotationSeverity(rawValue: wire) ?? .unknown
    }
}

// MARK: - Wire value type (web `SecretRotationStatus`)

/// One tracked secret's rotation status — the native peer of the wire
/// `internal/rotation/tracker.go` `Status` (web `SecretRotationStatus`). Field
/// names/types mirror the JSON 1:1 so the production `OperatorConfidenceStore`
/// binding maps straight across. Timestamps round-trip as their raw ISO strings
/// (exactly as the web stores them) and are parsed only at the display boundary;
/// day counts are plain control-plane integers (not SI-unit-bearing).
public struct SecretRotationStatus: Identifiable, Hashable, Sendable {
    public let kind: String
    public let targetID: String?
    public let lastRotated: String
    public let ageDays: Int
    public let expiresAt: String?
    public let daysToExpiry: Int?
    public let warnDays: Int
    public let criticalDays: Int
    public let severity: SecretRotationSeverity
    public let message: String?

    /// Web `keyExtractor={(r) => `${r.kind}:${r.target_id ?? ''}`}`.
    public var id: String {
        "\(kind):\(targetID ?? "")"
    }

    public init(
        kind: String,
        targetID: String? = nil,
        lastRotated: String,
        ageDays: Int,
        expiresAt: String? = nil,
        daysToExpiry: Int? = nil,
        warnDays: Int,
        criticalDays: Int,
        severity: SecretRotationSeverity,
        message: String? = nil
    ) {
        self.kind = kind
        self.targetID = targetID
        self.lastRotated = lastRotated
        self.ageDays = ageDays
        self.expiresAt = expiresAt
        self.daysToExpiry = daysToExpiry
        self.warnDays = warnDays
        self.criticalDays = criticalDays
        self.severity = severity
        self.message = message
    }
}

/// The summary roll-ups (web `counts` memo): tracked/ok/warn/critical tallies that
/// back the four stat cards and the overdue-rotations banner gate.
public struct SecretRotationCounts: Equatable, Sendable {
    public let ok: Int
    public let warn: Int
    public let critical: Int
    public let total: Int

    public init(ok: Int, warn: Int, critical: Int, total: Int) {
        self.ok = ok
        self.warn = warn
        self.critical = critical
        self.total = total
    }
}

// MARK: - Data source seam (web `useSecretRotation`, GET /admin/observability/secret-rotation)

/// Thrown when the deployment lacks the rotation-tracker subsystem — the native peer
/// of the web `query.error.status === 503` (`subsystemMissing`) branch that surfaces
/// the "subsystem unavailable" banner. Distinct from a generic failure so the page can
/// reproduce the web's dedicated not-configured affordance.
public struct SecretRotationSubsystemUnavailable: Error {
    public init() {}
}

/// Supplies the rotation status rows the page renders. The production implementation
/// binds the shared KMP `OperatorConfidenceStore.secretRotation()` feed (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive the
/// loading / empty / unavailable / error / success states. Mirrors the
/// `DiskForecastDataSource` seam used by the sibling Disk Forecast page.
public protocol SecretRotationDataSource: Sendable {
    func load() async throws -> [SecretRotationStatus]
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists
/// so the surface renders its populated state out of the box (mirroring the sibling
/// Disk Forecast's `SampleDiskForecastDataSource`). Production replaces it with the
/// `OperatorConfidenceStore.secretRotation()` adapter.
public struct SampleSecretRotationDataSource: SecretRotationDataSource {
    public init() {}

    public func load() async throws -> [SecretRotationStatus] {
        [
            SecretRotationStatus(
                kind: "tesla_refresh_token",
                lastRotated: "2026-05-30T08:15:00Z",
                ageDays: 16,
                expiresAt: "2026-06-29T08:15:00Z",
                daysToExpiry: 14,
                warnDays: 21,
                criticalDays: 7,
                severity: .ok
            ),
            SecretRotationStatus(
                kind: "mqtt_mtls_cert",
                targetID: "fleet-telemetry-broker",
                lastRotated: "2026-03-02T00:00:00Z",
                ageDays: 105,
                expiresAt: "2026-07-01T00:00:00Z",
                daysToExpiry: 16,
                warnDays: 60,
                criticalDays: 30,
                severity: .warn
            ),
            SecretRotationStatus(
                kind: "database_password",
                lastRotated: "2025-09-18T12:00:00Z",
                ageDays: 270,
                warnDays: 180,
                criticalDays: 240,
                severity: .critical
            ),
            SecretRotationStatus(
                kind: "session_jwk",
                lastRotated: "2026-06-01T00:00:00Z",
                ageDays: 14,
                warnDays: 90,
                criticalDays: 180,
                severity: .ok
            )
        ]
    }
}

// MARK: - Page state (web PageContainer query phases + subsystemMissing + empty)

/// The page's data state. `.empty` is a successful load with zero tracked secrets
/// (web `items.length === 0`); `.unavailable` is the 503 subsystem-missing branch;
/// `.error` is a generic retryable failure (web PageContainer error); `.loaded`
/// carries one or more rotation rows.
public enum SecretRotationState: Equatable, Sendable {
    case loading
    case empty
    case unavailable
    case error(String)
    case loaded([SecretRotationStatus])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state and derives the summary tallies + display guards from it,
/// reading the rows through the injected `SecretRotationDataSource` seam.
@MainActor
@Observable
public final class SecretRotationPageModel {
    public private(set) var state: SecretRotationState = .loading

    @ObservationIgnored private let dataSource: any SecretRotationDataSource

    public init(dataSource: any SecretRotationDataSource = SampleSecretRotationDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded rotation rows (empty unless the state is `.loaded`).
    public var rows: [SecretRotationStatus] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// Whether the four summary stat cards render (web guards them behind
    /// `items.length > 0`).
    public var showsSummary: Bool {
        !rows.isEmpty
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// The tracked/ok/warn/critical tallies across the loaded rows (web `counts`).
    public var counts: SecretRotationCounts {
        var ok = 0
        var warn = 0
        var critical = 0
        for row in rows {
            switch row.severity {
            case .ok: ok += 1
            case .warn: warn += 1
            case .critical: critical += 1
            case .unknown: break
            }
        }
        return SecretRotationCounts(ok: ok, warn: warn, critical: critical, total: rows.count)
    }

    /// Whether the overdue-rotations danger banner shows (web `counts.critical > 0`).
    public var hasCriticalOverdue: Bool {
        counts.critical > 0
    }

    /// Loads the rows and resolves the terminal state (web `useSecretRotation` query).
    public func load() async {
        state = .loading
        do {
            let items = try await dataSource.load()
            state = items.isEmpty ? .empty : .loaded(items)
        } catch is SecretRotationSubsystemUnavailable {
            state = .unavailable
        } catch {
            state = .error(error.localizedDescription)
        }
    }

    /// Re-runs the load (web error-retry / refetch).
    public func refresh() async {
        await load()
    }
}

// MARK: - Display-boundary formatters (web `numberFormat.ts` / `dateFormat.ts`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts` +
/// `web/src/lib/dateFormat.ts`. `number` mirrors the web `fmtNumber` (en-US grouping,
/// the default 2-fraction-digit precision from `decimal_precision`); the date helpers
/// mirror `formatDateTime` / `formatDate` / `formatRelative`. No SI conversion applies —
/// these are unit-agnostic control-plane values formatted only at the display boundary.
public enum SecretRotationFormat {
    /// The em-dash shown for nil / unparseable values (web default empty token).
    public static let emptyValue = "—"

    /// Web `fmtNumber` global default precision (`decimal_precision: 2`).
    public static let defaultDecimals = 2

    /// The locale the web `Intl` formatters default to.
    public static let defaultLocale = Locale(identifier: "en_US")

    /// Web `fmtNumber(v, decimals)`: locale-grouped (en-US), fixed fraction digits.
    public static func number(
        _ value: Double,
        decimals: Int = defaultDecimals,
        locale: Locale = defaultLocale
    ) -> String {
        let formatter = NumberFormatter()
        formatter.locale = locale
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Convenience for the `Int` day-count fields (web `fmtNumber(r.age_days)` etc.).
    public static func number(_ value: Int, decimals: Int = defaultDecimals, locale: Locale = defaultLocale) -> String {
        number(Double(value), decimals: decimals, locale: locale)
    }

    /// Web thresholds cell: `{fmtNumber(warn_days)}d / {fmtNumber(critical_days)}d`.
    public static func thresholds(warnDays: Int, criticalDays: Int, locale: Locale = defaultLocale) -> String {
        "\(number(warnDays, locale: locale))d / \(number(criticalDays, locale: locale))d"
    }

    /// Parses an RFC3339 / ISO-8601 timestamp (with or without fractional seconds).
    public static func parseISO(_ iso: String) -> Date? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// Web `formatDateTime`: `MMM d, yyyy, hh:mm a` (en-US), `—` for nil / unparseable.
    public static func dateTime(
        _ iso: String?,
        timeZone: TimeZone = .current,
        locale: Locale = defaultLocale
    ) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d, yyyy, hh:mm a"
        return formatter.string(from: date)
    }

    /// Web `formatDate`: date-only `MMM d, yyyy` (the `formatRelative` ≥ 7-day fallback).
    public static func dateOnly(
        _ iso: String?,
        timeZone: TimeZone = .current,
        locale: Locale = defaultLocale
    ) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = timeZone
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    /// Web `formatRelative`: just now / `{m}m ago` / `{h}h ago` / `{d}d ago`, falling
    /// back to the date-only form past a week. `now` is injectable for deterministic
    /// tests; the view passes the wall clock.
    public static func relative(
        _ iso: String?,
        now: Date = Date(),
        timeZone: TimeZone = .current,
        locale: Locale = defaultLocale
    ) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let seconds = Int(now.timeIntervalSince(date).rounded(.down))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return dateOnly(iso, timeZone: timeZone, locale: locale)
    }
}
