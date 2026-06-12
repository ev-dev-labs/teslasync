import Foundation
import Observation

// MARK: - Wire value types (web `SchemaFingerprint` / `SchemaDrift` / `SchemaDriftResponse`)

/// One schema fingerprint — the native peer of the KMP
/// `io.teslasync.shared.core.presentation.operatorconfidence.SchemaFingerprint`
/// (web `SchemaFingerprint`, Go `schemacheck.Fingerprint`). Field names/types mirror
/// the wire 1:1 so the production `OperatorConfidenceStore.schemaDrift()` binding maps
/// straight across. Table/column/index counts are control-plane integers, NOT
/// SI-unit-bearing, so they round-trip verbatim and are only formatted at the display
/// boundary by `SchemaDriftFormat`.
public struct SchemaFingerprint: Hashable, Sendable {
    public let sha256: String
    public let tableCount: Int
    public let columnCount: Int
    public let indexCount: Int

    public init(sha256: String, tableCount: Int, columnCount: Int, indexCount: Int) {
        self.sha256 = sha256
        self.tableCount = tableCount
        self.columnCount = columnCount
        self.indexCount = indexCount
    }
}

/// The current-vs-seed comparison (web `SchemaDrift`, Go `schemacheck.Drift`): the two
/// fingerprints plus the per-count deltas. `expectedGeneratedAt` is the ISO-8601 capture
/// time of the seed fingerprint (web `expected_generated_at`, optional).
public struct SchemaDrift: Hashable, Sendable {
    public let hasDrift: Bool
    public let current: SchemaFingerprint
    public let expected: SchemaFingerprint
    public let tableCountDelta: Int
    public let columnCountDelta: Int
    public let indexCountDelta: Int
    public let expectedGeneratedAt: String?

    public init(
        hasDrift: Bool,
        current: SchemaFingerprint,
        expected: SchemaFingerprint,
        tableCountDelta: Int,
        columnCountDelta: Int,
        indexCountDelta: Int,
        expectedGeneratedAt: String?
    ) {
        self.hasDrift = hasDrift
        self.current = current
        self.expected = expected
        self.tableCountDelta = tableCountDelta
        self.columnCountDelta = columnCountDelta
        self.indexCountDelta = indexCountDelta
        self.expectedGeneratedAt = expectedGeneratedAt
    }
}

/// The schema-drift report (web `SchemaDriftResponse`): the comparison plus the
/// top-level `is_different` flag. The page's drift status mirrors the web
/// `data.is_different ?? drift.has_drift` — the Go contract always sends `is_different`,
/// so `isDrifted` resolves to it, falling back to `drift.hasDrift` defensively.
public struct SchemaDriftReport: Hashable, Sendable {
    public let drift: SchemaDrift
    public let isDifferent: Bool

    public init(drift: SchemaDrift, isDifferent: Bool) {
        self.drift = drift
        self.isDifferent = isDifferent
    }

    /// Web `const isDrifted = data.is_different ?? drift.has_drift`.
    public var isDrifted: Bool {
        isDifferent || drift.hasDrift
    }
}

// MARK: - Data source seam (web `useSchemaDrift`, GET /admin/observability/schema-drift)

/// Thrown when the deployment lacks the schema-fingerprinting subsystem — the native
/// peer of the web `query.error.status === 503` (`subsystemMissing`) branch that
/// surfaces the "subsystem unavailable" banner. Distinct from a generic failure so the
/// page can reproduce the web's dedicated not-configured affordance.
public struct SchemaDriftSubsystemUnavailable: Error {
    public init() {}
}

/// Supplies the schema-drift report the page renders. The production implementation
/// binds the shared KMP `OperatorConfidenceStore.schemaDrift()` feed (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive the
/// loading / empty / unavailable / error / success states. A `nil` result models the
/// web's `!query.data` empty branch (no seed fingerprint computed yet). Mirrors the
/// `DiskForecastDataSource` seam used by the sibling Disk Forecast page.
public protocol SchemaDriftDataSource: Sendable {
    func load() async throws -> SchemaDriftReport?
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists
/// so the surface renders its populated state out of the box (mirroring the sibling
/// Disk Forecast's `SampleDiskForecastDataSource` default). Production replaces it with
/// the `OperatorConfidenceStore.schemaDrift()` adapter. The seed shows a drifted state
/// (one extra table + two extra columns) so both fingerprint cards render distinctly.
public struct SampleSchemaDriftDataSource: SchemaDriftDataSource {
    public init() {}

    public func load() async throws -> SchemaDriftReport? {
        let current = SchemaFingerprint(
            sha256: "9f2c1ab7e4d8c0b35a6f81d29c47e0b3f5a9d6c2e1b8470f3a2c9d5e6f10b8a4",
            tableCount: 142,
            columnCount: 1893,
            indexCount: 327
        )
        let expected = SchemaFingerprint(
            sha256: "3b7d4e9a1c08f62b5d0a9e7c4f1b836a2d5c9e0f7a4b1d8c63e2f905a7b1c4d6",
            tableCount: 141,
            columnCount: 1891,
            indexCount: 327
        )
        return SchemaDriftReport(
            drift: SchemaDrift(
                hasDrift: true,
                current: current,
                expected: expected,
                tableCountDelta: 1,
                columnCountDelta: 2,
                indexCountDelta: 0,
                expectedGeneratedAt: "2026-05-28T09:14:22Z"
            ),
            isDifferent: true
        )
    }
}

// MARK: - Page state (web PageContainer query phases + subsystemMissing + empty)

/// The page's data state for the schema-drift source. `.empty` is a successful load
/// with no fingerprint (web `!query.data` → "No fingerprint available"); `.unavailable`
/// is the 503 subsystem-missing branch (web `subsystemMissing`); `.error` is a generic
/// retryable failure (web PageContainer error); `.loaded` carries the report.
public enum SchemaDriftState: Equatable, Sendable {
    case loading
    case empty
    case unavailable
    case error(String)
    case loaded(SchemaDriftReport)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state and derives the display guards from it, reading the report
/// through the injected `SchemaDriftDataSource` seam.
@MainActor
@Observable
public final class SchemaDriftPageModel {
    public private(set) var state: SchemaDriftState = .loading

    @ObservationIgnored private let dataSource: any SchemaDriftDataSource

    public init(dataSource: any SchemaDriftDataSource = SampleSchemaDriftDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded report (nil unless the state is `.loaded`).
    public var report: SchemaDriftReport? {
        if case let .loaded(report) = state { return report }
        return nil
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// Whether drift was detected for the loaded report (web `isDrifted`); false when
    /// no report is loaded.
    public var isDrifted: Bool {
        report?.isDrifted ?? false
    }

    /// Loads the report and resolves the terminal state (web `useSchemaDrift` query).
    public func load() async {
        state = .loading
        do {
            if let report = try await dataSource.load() {
                state = .loaded(report)
            } else {
                state = .empty
            }
        } catch is SchemaDriftSubsystemUnavailable {
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

// MARK: - Display-boundary formatters (web `fmtNumber` / `formatDelta` / `formatDateTime`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts` and
/// `web/src/lib/dateFormat.ts`. Counts use the web `fmtNumber` global default
/// (en-US grouping, 2 fraction digits); deltas mirror the web `formatDelta`; the
/// captured-time string mirrors `formatDateTime`. No SI conversion applies — schema
/// counts are unit-agnostic control-plane values.
public enum SchemaDriftFormat {
    /// The em-dash shown for an absent sha256 / unparseable timestamp (web `|| '—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber` global default precision.
    public static let defaultDecimals = 2

    /// Web `fmtNumber(v)`: locale-grouped (en-US), fixed fraction digits (default 2).
    public static func number(_ value: Int, decimals: Int = defaultDecimals) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(value)
    }

    /// Web `formatDelta(delta)`: `0` renders as the bare "0"; positives gain a leading
    /// `+`; negatives keep `fmtNumber`'s own minus sign.
    public static func delta(_ value: Int) -> String {
        if value == 0 { return "0" }
        let formatted = number(value)
        return value > 0 ? "+\(formatted)" : formatted
    }

    /// Web `{{current}} current · {{expected}} expected` sublabel — both counts run
    /// through `fmtNumber`. `template` is the resolved catalog format
    /// (`"%1$@ current · %2$@ expected"`).
    public static func countSub(_ template: String, current: Int, expected: Int) -> String {
        String(format: template, number(current), number(expected))
    }

    /// Web `formatDateTime(iso)`: en-US `MMM d, yyyy, hh:mm a`; the em-dash for nil /
    /// unparseable input (web returns "—" for a falsy / invalid date).
    public static func dateTime(_ iso: String?) -> String {
        guard let iso, let date = parseISO(iso) else { return emptyValue }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy, hh:mm a"
        return formatter.string(from: date)
    }

    /// Tolerant ISO-8601 parse (with and without fractional seconds).
    private static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }
}
