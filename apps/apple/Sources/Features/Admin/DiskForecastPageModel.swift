import Foundation
import Observation

// MARK: - Severity (web `DiskForecastSeverity`)

/// The per-hypertable severity tier the backend computes from the configured quota
/// threshold (web `DiskForecastSeverity = 'ok' | 'warn' | 'critical' | 'unknown'`).
/// Carried as a tolerant enum so an unexpected server token folds to `.unknown`
/// instead of failing — mirroring the KMP model's "raw string" robustness strategy.
public enum DiskForecastSeverity: String, CaseIterable, Sendable, Equatable {
    case ok
    case warn
    case critical
    case unknown

    /// Folds a raw wire token onto the canonical tier (unknown tokens → `.unknown`).
    public init(wire: String) {
        self = DiskForecastSeverity(rawValue: wire) ?? .unknown
    }
}

// MARK: - Wire value types (web `HypertableSize` / `DiskForecastResponse`)

/// One hypertable's disk forecast — the native peer of the KMP
/// `io.teslasync.shared.core.presentation.operatorconfidence.HypertableSize`
/// (web `HypertableSize`). Field names/types mirror the wire 1:1 so the production
/// `OperatorConfidenceStore.diskForecast()` binding maps straight across. Byte counts
/// are NOT SI-unit-bearing (the admin control-plane is unit-agnostic), so they
/// round-trip verbatim and are only formatted at the display boundary.
public struct DiskForecastHypertable: Identifiable, Hashable, Sendable {
    public let hypertableName: String
    public let totalBytes: Int64
    public let uncompressedBytes: Int64
    public let compressedBytes: Int64
    public let chunkCount: Int64
    public let growthBytesPerDay: Double
    public let estDaysToQuota: Double?
    public let severity: DiskForecastSeverity

    /// Web `keyExtractor={(r) => r.hypertable_name}`.
    public var id: String {
        hypertableName
    }

    public init(
        hypertableName: String,
        totalBytes: Int64,
        uncompressedBytes: Int64,
        compressedBytes: Int64,
        chunkCount: Int64,
        growthBytesPerDay: Double,
        estDaysToQuota: Double?,
        severity: DiskForecastSeverity
    ) {
        self.hypertableName = hypertableName
        self.totalBytes = totalBytes
        self.uncompressedBytes = uncompressedBytes
        self.compressedBytes = compressedBytes
        self.chunkCount = chunkCount
        self.growthBytesPerDay = growthBytesPerDay
        self.estDaysToQuota = estDaysToQuota
        self.severity = severity
    }
}

/// The disk-forecast report (web `DiskForecastResponse`): the per-hypertable rows.
public struct DiskForecastReport: Equatable, Sendable {
    public let hypertables: [DiskForecastHypertable]

    public init(hypertables: [DiskForecastHypertable]) {
        self.hypertables = hypertables
    }
}

/// The fleet-wide roll-ups (web `fleetTotals` memo): summed across every hypertable.
public struct DiskForecastFleetTotals: Equatable, Sendable {
    public let totalBytes: Int64
    public let uncompressedBytes: Int64
    public let compressedBytes: Int64
    public let growthBytesPerDay: Double

    public init(totalBytes: Int64, uncompressedBytes: Int64, compressedBytes: Int64, growthBytesPerDay: Double) {
        self.totalBytes = totalBytes
        self.uncompressedBytes = uncompressedBytes
        self.compressedBytes = compressedBytes
        self.growthBytesPerDay = growthBytesPerDay
    }
}

// MARK: - Data source seam (web `useDiskForecast`, GET /admin/observability/disk-forecast)

/// Thrown when the deployment lacks the TimescaleDB hypertable metrics subsystem —
/// the native peer of the web `query.error.status === 503` (`subsystemMissing`)
/// branch that surfaces the "subsystem unavailable" banner. Distinct from a generic
/// failure so the page can reproduce the web's dedicated not-configured affordance.
public struct DiskForecastSubsystemUnavailable: Error {
    public init() {}
}

/// Supplies the disk-forecast report the page renders. The production implementation
/// binds the shared KMP `OperatorConfidenceStore.diskForecast()` feed (ADR-004 — the
/// view holds no networking); previews and tests inject doubles to drive the
/// loading / empty / unavailable / error / success states. Mirrors the
/// `ApiEndpointCatalogProviding` seam used by the sibling ApiPlayground page.
public protocol DiskForecastDataSource: Sendable {
    func load() async throws -> DiskForecastReport
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists
/// so the surface renders its populated state out of the box (mirroring the sibling
/// ApiPlayground's `StaticApiEndpointCatalog` default). Production replaces it with the
/// `OperatorConfidenceStore.diskForecast()` adapter.
public struct SampleDiskForecastDataSource: DiskForecastDataSource {
    public init() {}

    public func load() async throws -> DiskForecastReport {
        DiskForecastReport(hypertables: [
            DiskForecastHypertable(
                hypertableName: "signal_log",
                totalBytes: 48_318_382_080,
                uncompressedBytes: 12_884_901_888,
                compressedBytes: 35_433_480_192,
                chunkCount: 412,
                growthBytesPerDay: 1_181_116_006.4,
                estDaysToQuota: 73.4,
                severity: .warn
            ),
            DiskForecastHypertable(
                hypertableName: "drives",
                totalBytes: 6_442_450_944,
                uncompressedBytes: 4_294_967_296,
                compressedBytes: 2_147_483_648,
                chunkCount: 96,
                growthBytesPerDay: 104_857_600,
                estDaysToQuota: 612.0,
                severity: .ok
            ),
            DiskForecastHypertable(
                hypertableName: "charging_sessions",
                totalBytes: 2_147_483_648,
                uncompressedBytes: 1_610_612_736,
                compressedBytes: 536_870_912,
                chunkCount: 48,
                growthBytesPerDay: 31_457_280,
                estDaysToQuota: nil,
                severity: .unknown
            )
        ])
    }
}

// MARK: - Page state (web PageContainer query phases + subsystemMissing + empty)

/// The page's data state for the disk-forecast source. `.empty` is a successful load
/// with zero hypertables (web `rows.length === 0`); `.unavailable` is the 503
/// subsystem-missing branch; `.error` is a generic retryable failure (web
/// PageContainer error); `.loaded` carries one or more hypertables.
public enum DiskForecastState: Equatable, Sendable {
    case loading
    case empty
    case unavailable
    case error(String)
    case loaded([DiskForecastHypertable])
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state and derives the fleet roll-ups + display guards from it,
/// reading the report through the injected `DiskForecastDataSource` seam.
@MainActor
@Observable
public final class DiskForecastPageModel {
    public private(set) var state: DiskForecastState = .loading

    @ObservationIgnored private let dataSource: any DiskForecastDataSource

    public init(dataSource: any DiskForecastDataSource = SampleDiskForecastDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded hypertable rows (empty unless the state is `.loaded`).
    public var rows: [DiskForecastHypertable] {
        if case let .loaded(rows) = state { return rows }
        return []
    }

    /// Whether the fleet stat cards render (web guards them behind `rows.length > 0`).
    public var showsFleetStats: Bool {
        !rows.isEmpty
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// The fleet-wide roll-ups across the loaded hypertables (web `fleetTotals`).
    public var fleetTotals: DiskForecastFleetTotals {
        let rows = rows
        return DiskForecastFleetTotals(
            totalBytes: rows.reduce(0) { $0 + $1.totalBytes },
            uncompressedBytes: rows.reduce(0) { $0 + $1.uncompressedBytes },
            compressedBytes: rows.reduce(0) { $0 + $1.compressedBytes },
            growthBytesPerDay: rows.reduce(0) { $0 + $1.growthBytesPerDay }
        )
    }

    /// Loads the report and resolves the terminal state (web `useDiskForecast` query).
    public func load() async {
        state = .loading
        do {
            let report = try await dataSource.load()
            state = report.hypertables.isEmpty ? .empty : .loaded(report.hypertables)
        } catch is DiskForecastSubsystemUnavailable {
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

// MARK: - Display-boundary formatters (web `formatBytes` / `fmtNumber`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts`. Byte
/// counts use binary units (1024) labelled KB/MB/GB exactly as the web `formatBytes`;
/// `number` mirrors the web `fmtNumber` (en-US grouping, fixed precision). No SI
/// conversion applies — these are unit-agnostic control-plane counts.
public enum DiskForecastFormat {
    /// The em-dash shown for nil / non-finite values (web `formatBytes` default empty).
    public static let emptyValue = "—"

    /// Web `fmtNumber` global default precision.
    public static let defaultDecimals = 2

    /// Web `formatBytes(bytes)`: binary units, 1 decimal for KB/MB/GB, `—` for
    /// nil / non-finite.
    public static func bytes(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        if value < 1024 { return "\(wholeOrDecimal(value)) B" }
        if value < 1024 * 1024 { return String(format: "%.1f KB", value / 1024) }
        if value < 1024 * 1024 * 1024 { return String(format: "%.1f MB", value / (1024 * 1024)) }
        return String(format: "%.1f GB", value / (1024 * 1024 * 1024))
    }

    /// Convenience for the `Int64` byte fields.
    public static func bytes(_ value: Int64) -> String {
        bytes(Double(value))
    }

    /// Web `fmtNumber(v, decimals)`: locale-grouped (en-US), fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = defaultDecimals) -> String {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Web "Days to quota" cell: `—` for nil / non-finite, else `fmtNumber`.
    public static func daysToQuota(_ value: Double?) -> String {
        guard let value, value.isFinite else { return emptyValue }
        return number(value)
    }

    /// Web `((part / total) * 100).toFixed(1)`; `—` when total is non-positive.
    public static func percent(_ part: Int64, of total: Int64) -> String {
        guard total > 0 else { return emptyValue }
        return String(format: "%.1f", Double(part) / Double(total) * 100)
    }

    /// JS `String(n)`: integral values render without a trailing decimal.
    private static func wholeOrDecimal(_ value: Double) -> String {
        value == value.rounded() ? String(Int64(value)) : String(value)
    }
}
