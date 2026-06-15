import Foundation
import Observation
import SwiftUI

// MARK: - Selectable window (web `WINDOW_OPTIONS` / `windowDays` state)

/// The trailing window the per-vehicle report covers (web `WINDOW_OPTIONS`: 1 / 7 / 30 /
/// 90 days, defaulting to 30). The production source maps `days` onto the web `since`
/// query parameter (`now - days`); the sample/preview source ignores it (static seed).
public enum VehicleCostWindow: Int, CaseIterable, Identifiable, Sendable {
    case days1 = 1
    case days7 = 7
    case days30 = 30
    case days90 = 90

    public var id: Int {
        rawValue
    }

    /// The window length in days (web `windowDays`).
    public var days: Int {
        rawValue
    }

    /// The web `since` cutoff for this window, relative to `now` (web
    /// `new Date(Date.now() - windowDays * 24*60*60*1000)`).
    public func since(from now: Date = Date()) -> Date {
        now.addingTimeInterval(-Double(days) * 24 * 60 * 60)
    }

    /// The catalog label for the selector option (web `WINDOW_OPTIONS[].labelKey`).
    public var labelKey: LocalizedStringKey {
        switch self {
        case .days1: "admin.vehicleCost.window1d"
        case .days7: "admin.vehicleCost.window7d"
        case .days30: "admin.vehicleCost.window30d"
        case .days90: "admin.vehicleCost.window90d"
        }
    }
}

// MARK: - Wire value types (web `VehicleCostRow` / `VehicleCostTotals` / `VehicleCostResponse`)

/// One vehicle's ingest-cost row — the native peer of the KMP
/// `io.teslasync.shared.core.presentation.operatorconfidence.VehicleCostRow`
/// (web `VehicleCostRow`). Field names/types mirror the wire 1:1 so the production
/// `OperatorConfidenceStore.vehicleCost()` binding maps straight across. Counts and byte
/// estimates are NOT SI-unit-bearing (the admin control-plane is unit-agnostic), so they
/// round-trip verbatim and are only formatted at the display boundary.
public struct VehicleCostRow: Identifiable, Hashable, Sendable {
    public let vehicleID: Int64
    public let displayName: String?
    public let signalRowCount: Int64
    public let signalBytesEst: Int64
    public let ingestRatePerMinute24h: Double
    public let dlqFailures24h: Int64
    public let lastSeenAt: String

    /// Web `keyExtractor={(r) => r.vehicle_id}`.
    public var id: Int64 {
        vehicleID
    }

    public init(
        vehicleID: Int64,
        displayName: String?,
        signalRowCount: Int64,
        signalBytesEst: Int64,
        ingestRatePerMinute24h: Double,
        dlqFailures24h: Int64,
        lastSeenAt: String
    ) {
        self.vehicleID = vehicleID
        self.displayName = displayName
        self.signalRowCount = signalRowCount
        self.signalBytesEst = signalBytesEst
        self.ingestRatePerMinute24h = ingestRatePerMinute24h
        self.dlqFailures24h = dlqFailures24h
        self.lastSeenAt = lastSeenAt
    }
}

/// The fleet-wide roll-ups the backend returns alongside the rows (web
/// `VehicleCostTotals`). Unlike the disk-forecast page these are server-computed, not
/// summed client-side, so they arrive even when zero vehicles match the window.
public struct VehicleCostTotals: Equatable, Sendable {
    public let totalRows: Int64
    public let totalBytesEst: Int64
    public let totalRatePerMinute24h: Double
    public let totalFailures24h: Int64

    public init(
        totalRows: Int64,
        totalBytesEst: Int64,
        totalRatePerMinute24h: Double,
        totalFailures24h: Int64
    ) {
        self.totalRows = totalRows
        self.totalBytesEst = totalBytesEst
        self.totalRatePerMinute24h = totalRatePerMinute24h
        self.totalFailures24h = totalFailures24h
    }
}

/// The vehicle-cost report (web `VehicleCostResponse`): the per-vehicle rows plus the
/// server-side fleet totals.
public struct VehicleCostReport: Equatable, Sendable {
    public let vehicles: [VehicleCostRow]
    public let totals: VehicleCostTotals

    public init(vehicles: [VehicleCostRow], totals: VehicleCostTotals) {
        self.vehicles = vehicles
        self.totals = totals
    }
}

// MARK: - Data source seam (web `useVehicleCost`, GET /admin/observability/vehicle-cost)

/// Thrown when the deployment lacks the ingest-x-ray subsystem — the native peer of the
/// web `query.error.status === 503` (`subsystemMissing`) branch that surfaces the
/// "subsystem unavailable" banner. Distinct from a generic failure so the page can
/// reproduce the web's dedicated not-configured affordance.
public struct VehicleCostSubsystemUnavailable: Error {
    public init() {}
}

/// Supplies the vehicle-cost report the page renders for a selected window. The
/// production implementation binds the shared KMP `OperatorConfidenceStore.vehicleCost()`
/// feed (ADR-004 — the view holds no networking); previews and tests inject doubles to
/// drive the loading / empty / unavailable / error / success states. Mirrors the
/// `DiskForecastDataSource` seam used by the sibling Disk Forecast page.
public protocol VehicleCostDataSource: Sendable {
    func load(window: VehicleCostWindow) async throws -> VehicleCostReport
}

/// A representative local seed used as the page/preview default until the KMP-backed
/// source is injected at composition time. It is NOT production telemetry — it exists so
/// the surface renders its populated state out of the box (mirroring the sibling Disk
/// Forecast's `SampleDiskForecastDataSource` default). Production replaces it with the
/// `OperatorConfidenceStore.vehicleCost()` adapter.
public struct SampleVehicleCostDataSource: VehicleCostDataSource {
    public init() {}

    public func load(window _: VehicleCostWindow) async throws -> VehicleCostReport {
        let rows = [
            VehicleCostRow(
                vehicleID: 1,
                displayName: "Model 3 Performance",
                signalRowCount: 18_452_119,
                signalBytesEst: 1_771_403_424,
                ingestRatePerMinute24h: 842.6,
                dlqFailures24h: 0,
                lastSeenAt: SampleVehicleCostDataSource.iso(minutesAgo: 2)
            ),
            VehicleCostRow(
                vehicleID: 2,
                displayName: "Model Y Long Range",
                signalRowCount: 9_233_870,
                signalBytesEst: 886_451_520,
                ingestRatePerMinute24h: 410.2,
                dlqFailures24h: 3,
                lastSeenAt: SampleVehicleCostDataSource.iso(minutesAgo: 47)
            ),
            VehicleCostRow(
                vehicleID: 3,
                displayName: nil,
                signalRowCount: 1_204_551,
                signalBytesEst: 115_636_896,
                ingestRatePerMinute24h: 12.7,
                dlqFailures24h: 0,
                lastSeenAt: SampleVehicleCostDataSource.iso(minutesAgo: 1930)
            )
        ]
        let totals = VehicleCostTotals(
            totalRows: rows.reduce(0) { $0 + $1.signalRowCount },
            totalBytesEst: rows.reduce(0) { $0 + $1.signalBytesEst },
            totalRatePerMinute24h: rows.reduce(0) { $0 + $1.ingestRatePerMinute24h },
            totalFailures24h: rows.reduce(0) { $0 + $1.dlqFailures24h }
        )
        return VehicleCostReport(vehicles: rows, totals: totals)
    }

    /// A stable ISO-8601 `last_seen_at` a fixed number of minutes before now.
    private static func iso(minutesAgo: Int) -> String {
        let date = Date().addingTimeInterval(-Double(minutesAgo) * 60)
        return ISO8601DateFormatter().string(from: date)
    }
}

// MARK: - Page state (web PageContainer query phases + subsystemMissing + empty)

/// The page's data state for the vehicle-cost source. `.empty` is a successful load with
/// zero vehicles (web `vehicles.length === 0`) — it still carries the server totals so the
/// fleet stat cards render; `.unavailable` is the 503 subsystem-missing branch; `.error`
/// is a generic retryable failure (web PageContainer error); `.loaded` carries one or more
/// vehicles plus the totals.
public enum VehicleCostState: Equatable, Sendable {
    case loading
    case empty(VehicleCostTotals)
    case unavailable
    case error(String)
    case loaded(VehicleCostReport)
}

// MARK: - Page model

/// The `@Observable` state holder the page binds to (ADR-004 — no networking in the
/// view). Owns the load state + selected window and derives the display guards from it,
/// reading the report through the injected `VehicleCostDataSource` seam.
@MainActor
@Observable
public final class VehicleCostPageModel {
    public private(set) var state: VehicleCostState = .loading

    /// The selected trailing window (web `windowDays` `useState`, default 30). Settable so
    /// the view's `@Bindable` picker drives it; the page reloads on change via `.onChange`.
    public var window: VehicleCostWindow = .days30

    @ObservationIgnored private let dataSource: any VehicleCostDataSource

    public init(dataSource: any VehicleCostDataSource = SampleVehicleCostDataSource()) {
        self.dataSource = dataSource
    }

    /// The loaded vehicle rows (empty unless the state is `.loaded`).
    public var vehicles: [VehicleCostRow] {
        if case let .loaded(report) = state { return report.vehicles }
        return []
    }

    /// The fleet totals, present for both the populated and empty success states (web
    /// `query.data?.totals`). The stat-card grid is guarded behind this being non-nil.
    public var totals: VehicleCostTotals? {
        switch state {
        case let .loaded(report): report.totals
        case let .empty(totals): totals
        default: nil
        }
    }

    /// Whether the fleet stat cards render (web `{totals && ...}`).
    public var showsFleetTotals: Bool {
        totals != nil
    }

    /// Whether the subsystem-unavailable banner shows (web `subsystemMissing`).
    public var isSubsystemUnavailable: Bool {
        state == .unavailable
    }

    /// Initial load for the current window (web first `useVehicleCost` fetch) — shows the
    /// skeleton.
    public func load() async {
        await fetch(showLoading: true)
    }

    /// Re-query after a window change. Keeps the current rows visible while the next window
    /// resolves (web TanStack `isFetching`, not `isLoading`) unless there is nothing to
    /// keep, so the table never flashes back to a skeleton mid-scan.
    public func reload() async {
        await fetch(showLoading: vehicles.isEmpty)
    }

    /// Re-runs the load from scratch (web error-retry / refetch) — shows the skeleton.
    public func refresh() async {
        await fetch(showLoading: true)
    }

    private func fetch(showLoading: Bool) async {
        if showLoading { state = .loading }
        let window = window
        do {
            let report = try await dataSource.load(window: window)
            state = report.vehicles.isEmpty ? .empty(report.totals) : .loaded(report)
        } catch is VehicleCostSubsystemUnavailable {
            state = .unavailable
        } catch {
            state = .error(error.localizedDescription)
        }
    }
}

// MARK: - Display-boundary formatters (web `fmtNumber` / `formatBytes` / `formatRelative`)

/// Pure, testable display formatters ported from `web/src/lib/numberFormat.ts` and
/// `web/src/lib/dateFormat.ts`. Counts/rates use the web `fmtNumber` global precision
/// (en-US grouping, 2 fraction digits by default, 1 for rates); byte estimates use the
/// binary-unit `formatBytes`; `relative` reproduces the web `formatRelative` ladder. No SI
/// conversion applies — these are unit-agnostic control-plane values.
public enum VehicleCostFormat {
    /// The em-dash shown for nil / non-finite values (web `formatBytes` default empty).
    public static let emptyValue = "—"

    /// Web `fmtNumber` global default precision.
    public static let defaultDecimals = 2

    /// Web `fmtNumber(v, decimals)`: locale-grouped (en-US), fixed fraction digits.
    public static func number(_ value: Double, decimals: Int = defaultDecimals) -> String {
        guard value.isFinite else { return number(0.0, decimals: decimals) }
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = decimals
        formatter.maximumFractionDigits = decimals
        return formatter.string(from: NSNumber(value: value)) ?? String(format: "%.\(decimals)f", value)
    }

    /// Convenience for the `Int64` count fields (web `fmtNumber(r.signal_row_count)`).
    public static func number(_ value: Int64, decimals: Int = defaultDecimals) -> String {
        number(Double(value), decimals: decimals)
    }

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

    /// Web `formatRelative(iso)`: "just now" / "{m}m ago" / "{h}h ago" / "{d}d ago" for
    /// the first week, then the absolute `formatDate` ("MMM d, yyyy"). `—` for unparseable
    /// input. The English ladder mirrors the web util's hardcoded tokens verbatim (it has
    /// no i18n keys), so it renders through `Text(verbatim:)` at the call site.
    public static func relative(_ iso: String, now: Date = Date()) -> String {
        guard let date = parseISO(iso) else { return emptyValue }
        let diff = now.timeIntervalSince(date)
        let seconds = Int(floor(diff))
        if seconds < 60 { return "just now" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m ago" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h ago" }
        let days = hours / 24
        if days < 7 { return "\(days)d ago" }
        return absoluteDate(date)
    }

    /// Web `formatDate(iso)` fallback: "MMM d, yyyy" in en-US (e.g. "Apr 4, 2026").
    static func absoluteDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.dateFormat = "MMM d, yyyy"
        return formatter.string(from: date)
    }

    /// Parses an ISO-8601 `last_seen_at`, tolerating the fractional-seconds variant the
    /// backend emits. Returns `nil` for unparseable input (web `isNaN(d.getTime())`).
    static func parseISO(_ iso: String) -> Date? {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = withFraction.date(from: iso) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: iso)
    }

    /// JS `String(n)`: integral values render without a trailing decimal.
    private static func wholeOrDecimal(_ value: Double) -> String {
        value == value.rounded() ? String(Int64(value)) : String(value)
    }
}
