import Foundation

// MARK: - Order key (web `SlowQueryOrderBy`)

/// The sort key the backend orders `pg_stat_statements` by (web
/// `SlowQueryOrderBy = 'mean_time' | 'total_time' | 'calls' | 'max_time'`). The raw
/// values are the on-wire `order_by` query-param tokens; `CaseIterable` order matches
/// the web `ORDER_BY_OPTIONS` declaration order so the picker lists them identically.
/// Carried as a tolerant enum so an unexpected server token folds to `.meanTime`
/// (the web default) instead of failing.
public enum SlowQueryOrderBy: String, CaseIterable, Sendable, Equatable {
    case meanTime = "mean_time"
    case totalTime = "total_time"
    case calls
    case maxTime = "max_time"

    /// Folds a raw wire token onto the canonical key (unknown tokens → `.meanTime`).
    public init(wire: String) {
        self = SlowQueryOrderBy(rawValue: wire) ?? .meanTime
    }
}

// MARK: - Wire value type (web `SlowQueryRow`)

/// One `pg_stat_statements` row — the native peer of the web `SlowQueryRow`. Field
/// names/types mirror the wire 1:1 so the production `OperatorConfidenceStore`
/// binding maps straight across. These are control-plane counters (calls, block
/// hits) and millisecond timings, NOT SI-unit-bearing quantities, so they round-trip
/// verbatim and are only formatted at the display boundary (web `fmtNumber`).
public struct SlowQueryRow: Identifiable, Hashable, Sendable {
    public let queryID: Int64
    public let fingerprint: String
    public let calls: Int64
    public let totalTimeMs: Double
    public let meanTimeMs: Double
    public let maxTimeMs: Double
    public let rowsReturned: Int64
    public let sharedBlksHit: Int64?
    public let sharedBlksRead: Int64?

    /// Web `keyExtractor={(r) => r.query_id}`.
    public var id: Int64 {
        queryID
    }

    public init(
        queryID: Int64,
        fingerprint: String,
        calls: Int64,
        totalTimeMs: Double,
        meanTimeMs: Double,
        maxTimeMs: Double,
        rowsReturned: Int64,
        sharedBlksHit: Int64?,
        sharedBlksRead: Int64?
    ) {
        self.queryID = queryID
        self.fingerprint = fingerprint
        self.calls = calls
        self.totalTimeMs = totalTimeMs
        self.meanTimeMs = meanTimeMs
        self.maxTimeMs = maxTimeMs
        self.rowsReturned = rowsReturned
        self.sharedBlksHit = sharedBlksHit
        self.sharedBlksRead = sharedBlksRead
    }

    // MARK: Display-boundary cells (web column `render` callbacks)

    /// Web `{r.fingerprint || '—'}`.
    public var fingerprintText: String {
        fingerprint.isEmpty ? SlowQueriesFormat.emptyValue : fingerprint
    }

    /// Web `fmtNumber(r.calls)` (global default precision).
    public var callsText: String {
        SlowQueriesFormat.number(calls)
    }

    /// Web `fmtNumber(r.mean_time_ms, 2)`.
    public var meanText: String {
        SlowQueriesFormat.number(meanTimeMs, decimals: 2)
    }

    /// Web `fmtNumber(r.max_time_ms, 2)`.
    public var maxText: String {
        SlowQueriesFormat.number(maxTimeMs, decimals: 2)
    }

    /// Web `fmtNumber(r.total_time_ms, 0)`.
    public var totalText: String {
        SlowQueriesFormat.number(totalTimeMs, decimals: 0)
    }

    /// Web `fmtNumber(r.rows_returned)` (global default precision).
    public var rowsText: String {
        SlowQueriesFormat.number(rowsReturned)
    }

    /// Web `cacheHitRatio(r)`: `hit / (hit + read) * 100` to one decimal, or `—`
    /// when there were no shared-buffer accesses (so a slow row that never touched
    /// the buffer cache reads as "—" rather than a misleading 0 %).
    public var cacheHitRatioText: String {
        let hit = Double(sharedBlksHit ?? 0)
        let read = Double(sharedBlksRead ?? 0)
        let total = hit + read
        guard total > 0 else { return SlowQueriesFormat.emptyValue }
        return SlowQueriesFormat.percent(hit / total * 100)
    }
}

// MARK: - Result envelope (web `SlowQueriesResponse`)

/// The slow-queries response (web `SlowQueriesResponse`): the resolved sort key plus
/// the ordered rows the backend returned.
public struct SlowQueriesResult: Equatable, Sendable {
    public let orderBy: SlowQueryOrderBy
    public let rows: [SlowQueryRow]

    public init(orderBy: SlowQueryOrderBy, rows: [SlowQueryRow]) {
        self.orderBy = orderBy
        self.rows = rows
    }
}

// MARK: - Data source seam (web `useSlowQueries`, GET /admin/observability/slow-queries)

/// Thrown when `pg_stat_statements` is not installed on the deployment's PostgreSQL —
/// the native peer of the web `query.error.status === 503` (`subsystemMissing`) branch
/// that surfaces the "subsystem unavailable" banner. Distinct from a generic failure so
/// the page can reproduce the web's dedicated not-configured affordance.
public struct SlowQueriesSubsystemUnavailable: Error {
    public init() {}
}

/// Supplies the slow-queries report the page renders for a given sort key + limit. The
/// production implementation binds the shared KMP `OperatorConfidenceStore.slowQueries`
/// feed (ADR-004 — the view holds no networking); previews and tests inject doubles to
/// drive the loading / empty / unavailable / error / success states. Mirrors the sibling
/// `DiskForecastDataSource` seam.
public protocol SlowQueriesDataSource: Sendable {
    func load(orderBy: SlowQueryOrderBy, limit: Int) async throws -> SlowQueriesResult
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists so
/// the surface renders its populated state out of the box (mirroring the sibling Disk
/// Forecast default) and re-sorts/truncates to honour the requested key + limit exactly
/// as the backend would. Production replaces it with the `OperatorConfidenceStore` adapter.
public struct SampleSlowQueriesDataSource: SlowQueriesDataSource {
    private let rows: [SlowQueryRow]

    public init(rows: [SlowQueryRow] = SampleSlowQueriesDataSource.seed) {
        self.rows = rows
    }

    public func load(orderBy: SlowQueryOrderBy, limit: Int) async throws -> SlowQueriesResult {
        let sorted = SampleSlowQueriesDataSource.sort(rows, by: orderBy)
        return SlowQueriesResult(orderBy: orderBy, rows: Array(sorted.prefix(max(0, limit))))
    }

    /// Backend-equivalent ordering (descending on the chosen metric).
    public static func sort(_ rows: [SlowQueryRow], by orderBy: SlowQueryOrderBy) -> [SlowQueryRow] {
        switch orderBy {
        case .meanTime: rows.sorted { $0.meanTimeMs > $1.meanTimeMs }
        case .totalTime: rows.sorted { $0.totalTimeMs > $1.totalTimeMs }
        case .calls: rows.sorted { $0.calls > $1.calls }
        case .maxTime: rows.sorted { $0.maxTimeMs > $1.maxTimeMs }
        }
    }

    public static let seed: [SlowQueryRow] = [
        SlowQueryRow(
            queryID: 4_815_162_342,
            fingerprint: "SELECT * FROM signal_log WHERE vehicle_id = $1 AND ts >= $2 ORDER BY ts DESC",
            calls: 184_233,
            totalTimeMs: 1_284_551.4,
            meanTimeMs: 6.97,
            maxTimeMs: 412.55,
            rowsReturned: 9_211_650,
            sharedBlksHit: 48_233_910,
            sharedBlksRead: 511_204
        ),
        SlowQueryRow(
            queryID: 1_123_581_321,
            fingerprint: "UPDATE drives SET end_ts = $1, distance_m = $2 WHERE id = $3",
            calls: 52119,
            totalTimeMs: 642_880.0,
            meanTimeMs: 12.33,
            maxTimeMs: 2011.07,
            rowsReturned: 52119,
            sharedBlksHit: 1_044_512,
            sharedBlksRead: 988_004
        ),
        SlowQueryRow(
            queryID: 8_675_309,
            fingerprint: "SELECT vehicle_id, max(ts) FROM charging_sessions GROUP BY vehicle_id",
            calls: 9044,
            totalTimeMs: 488_201.9,
            meanTimeMs: 53.98,
            maxTimeMs: 1204.66,
            rowsReturned: 271_320,
            sharedBlksHit: 6_120_330,
            sharedBlksRead: 0
        ),
        SlowQueryRow(
            queryID: 2_718_281_828,
            fingerprint: "REFRESH MATERIALIZED VIEW CONCURRENTLY cagg_fleet_stats",
            calls: 288,
            totalTimeMs: 921_440.2,
            meanTimeMs: 3199.45,
            maxTimeMs: 9980.13,
            rowsReturned: 0,
            sharedBlksHit: 18_440_221,
            sharedBlksRead: 9_220_110
        ),
        SlowQueryRow(
            queryID: 3_141_592_653,
            fingerprint: "INSERT INTO signal_log (vehicle_id, ts, name, value) VALUES ($1, $2, $3, $4)",
            calls: 7_322_004,
            totalTimeMs: 2_044_118.7,
            meanTimeMs: 0.28,
            maxTimeMs: 88.41,
            rowsReturned: 7_322_004,
            sharedBlksHit: 91_002_551,
            sharedBlksRead: 220_118
        ),
        SlowQueryRow(
            queryID: 1_618_033_988,
            fingerprint: "DELETE FROM signal_log WHERE ts < now() - $1::interval",
            calls: 96,
            totalTimeMs: 311_904.0,
            meanTimeMs: 3249.0,
            maxTimeMs: 6120.92,
            rowsReturned: 14_902_330,
            sharedBlksHit: 2_011_880,
            sharedBlksRead: 4_550_221
        )
    ]
}

// MARK: - Page state (web PageContainer query phases + subsystemMissing + empty)

/// The page's data state. `.empty` is a successful load with zero rows that is NOT the
/// 503 case (web `rows.length === 0 && !subsystemMissing` → big `EmptyState`);
/// `.unavailable` is the 503 subsystem-missing branch (web banner + `DataTable`
/// `emptyMessage`); `.error` is a generic retryable failure (web PageContainer error);
/// `.loaded` carries one or more rows.
public enum SlowQueriesState: Equatable, Sendable {
    case loading
    case empty
    case unavailable
    case error(String)
    case loaded([SlowQueryRow])
}

// MARK: - Display-boundary formatters (web `fmtNumber` / `cacheHitRatio`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts`. `number`
/// mirrors the web `fmtNumber` (en-US grouping, fixed precision; the module default is 2);
/// `percent` mirrors the web `${fmtNumber(pct, 1)}%`. No SI conversion applies — these are
/// unit-agnostic control-plane counts + millisecond timings.
public enum SlowQueriesFormat {
    /// The em-dash shown for an empty fingerprint / no-cache-access row (web `'—'`).
    public static let emptyValue = "—"

    /// Web `fmtNumber` module-level default precision (`_globalPrecision = 2`).
    public static let defaultDecimals = 2

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

    /// Convenience for the `Int64` count fields.
    public static func number(_ value: Int64, decimals: Int = defaultDecimals) -> String {
        number(Double(value), decimals: decimals)
    }

    /// Web `${fmtNumber(pct, 1)}%`.
    public static func percent(_ value: Double) -> String {
        "\(number(value, decimals: 1))%"
    }
}
