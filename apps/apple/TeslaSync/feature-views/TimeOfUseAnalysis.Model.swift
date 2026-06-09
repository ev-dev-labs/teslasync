//
//  TimeOfUseAnalysis.Model.swift
//  TeslaSync — P4 feature view · 0119 · TimeOfUseAnalysis (Apple)
//
//  The seams the view binds through: the P1/S8 state-holder source for the
//  cost-analysis hourly slice (no networking in the view — the web component takes
//  `hourlyData` / `touInsights` as props; here a source pushes coalesced snapshots),
//  the formatting facade (web `fmtNumber` / `fmtInt`), the P1/S11 telemetry contract
//  (`view.opened`), and the `@Observable` view-model that resolves the render phase +
//  drives the stale auto-refresh. Previews/tests drive the model with
//  `InMemoryTimeOfUseSource`; production wires a source over the shared cost-analysis
//  state holder. SwiftUI parity of
//  features/charging/components/cost-analysis/TimeOfUseAnalysis.tsx.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol TimeOfUseTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogTimeOfUseTelemetry: TimeOfUseTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Formatting seam (P1/S8 — web `fmtNumber` / `fmtInt`)

/// The display-boundary formatting the surface needs: a currency rate (web
/// `"$" + fmtNumber(avgCost, 3)`), a grouped integer (web `fmtInt(sessions)`), and a
/// percent (web `fmtNumber(offPeakPct, 1) + "%"`). Production injects a
/// settings-backed implementation (currency symbol + precision + locale from
/// `useSettings`); previews/tests use `DefaultTimeOfUseFormatting`.
public protocol TimeOfUseFormatting {
    func formatCurrency(_ amount: Double, fractionDigits: Int) -> String
    func formatCount(_ value: Int) -> String
    func formatPercent(_ value: Double, fractionDigits: Int) -> String
}

public extension TimeOfUseFormatting {
    /// Currency at the web insight precision (3) — `"$" + fmtNumber(avgCost, 3)`.
    func formatCurrency(_ amount: Double) -> String {
        formatCurrency(amount, fractionDigits: 3)
    }

    /// Percent at the web off-peak precision (1) — `fmtNumber(offPeakPct, 1) + "%"`.
    func formatPercent(_ value: Double) -> String {
        formatPercent(value, fractionDigits: 1)
    }
}

/// Bundle-free default formatter: a `"$"` symbol + grouped thousands + fixed
/// decimals for the rate, a grouped integer for counts, and a grouped number + `"%"`
/// for the share — the parity of the web `fmtNumber` / `fmtInt` (locale grouping,
/// fixed fraction digits, rounding half-up). Stateless and `Sendable`.
public struct DefaultTimeOfUseFormatting: TimeOfUseFormatting, Sendable {
    private let currencySymbol: String
    private let localeIdentifier: String

    public init(currencySymbol: String = "$", localeIdentifier: String = "en_US") {
        self.currencySymbol = currencySymbol
        self.localeIdentifier = localeIdentifier
    }

    private func formatter(fractionDigits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.locale = Locale(identifier: localeIdentifier)
        formatter.numberStyle = .decimal
        formatter.usesGroupingSeparator = true
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter
    }

    private func number(_ value: Double, fractionDigits: Int) -> String {
        let safe = TimeOfUseNumeric.safe(value)
        let digits = Swift.max(0, fractionDigits)
        return formatter(fractionDigits: digits).string(from: NSNumber(value: safe)) ?? "0"
    }

    public func formatCurrency(_ amount: Double, fractionDigits: Int) -> String {
        currencySymbol + number(amount, fractionDigits: fractionDigits)
    }

    public func formatCount(_ value: Int) -> String {
        number(Double(TimeOfUseNumeric.safeCount(value)), fractionDigits: 0)
    }

    public func formatPercent(_ value: Double, fractionDigits: Int) -> String {
        number(value, fractionDigits: fractionDigits) + "%"
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TimeOfUseSource`: the raw hourly buckets +
/// their load status + the live-state connection + the last-update timestamp.
public struct TimeOfUseUpdate: Sendable, Equatable {
    public var status: TimeOfUseLoadStatus
    /// The web `hourlyData` array (`HourBucket[]`).
    public var hours: [TimeOfUseHourSample]
    public var connection: TimeOfUseConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TimeOfUseLoadStatus = .loading,
        hours: [TimeOfUseHourSample] = [],
        connection: TimeOfUseConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.hours = hours
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the cost-analysis query the web
/// `useCostAnalysisData` reads and projecting it to the hourly buckets. Previews +
/// tests use `InMemoryTimeOfUseSource`. The view never talks to the network.
@MainActor
public protocol TimeOfUseSource: AnyObject {
    var onUpdate: (@MainActor (TimeOfUseUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web parent refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TimeOfUseSource`, projects
/// each snapshot into plotted points + derived insights, exposes a render
/// `TimeOfUsePhase` + freshness for SwiftUI to switch over, and emits the
/// `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class TimeOfUseModel {
    public private(set) var phase: TimeOfUsePhase = .loading
    public private(set) var connection: TimeOfUseConnection = .live
    public private(set) var points: [TimeOfUseHourPoint] = []
    public private(set) var insights: TimeOfUseInsights?
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored let formatting: any TimeOfUseFormatting
    @ObservationIgnored let localize: (String, String) -> String

    @ObservationIgnored private let source: any TimeOfUseSource
    @ObservationIgnored private let telemetry: any TimeOfUseTelemetry
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TimeOfUseSource,
        telemetry: any TimeOfUseTelemetry = OSLogTimeOfUseTelemetry(),
        formatting: any TimeOfUseFormatting = DefaultTimeOfUseFormatting(),
        localize: @escaping (String, String) -> String = TimeOfUseStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.formatting = formatting
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The thinned X-axis tick labels for the current hours (web `interval={2}`).
    public var axisTickLabels: [String] {
        TimeOfUseProjection.axisTickLabels(points)
    }

    /// The combined VoiceOver summary for the surface, state-aware so loading /
    /// empty / error are never announced as a blank chart.
    public var accessibilitySummary: String {
        switch phase {
        case .content:
            return TimeOfUseAccessibility.chartSummary(
                points,
                localize: localize,
                formatCount: { [formatting] value in formatting.formatCount(value) }
            )
        case .empty:
            let title = localize("costAnalysis.tou.title", "Electricity Rate Analysis (Time-of-Use)")
            return title + ": " + localize("costAnalysis.charts.noData", "Not enough data")
        case .loading:
            return localize("costAnalysis.tou.a11y.loading", "Loading time-of-use analysis")
        case let .error(message):
            let title = localize("costAnalysis.tou.a11y.errorTitle", "Couldn't load time-of-use analysis")
            return message.isEmpty ? title : "\(title). \(message)"
        }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TimeOfUseSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TimeOfUseUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        points = TimeOfUseProjection.points(from: update.hours)
        insights = TimeOfUseProjection.insights(points)
        phase = TimeOfUseProjection.resolvePhase(update.status, count: points.count)
        handleAutoRefresh(for: update.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached figures on screen and does not refetch.
    private func handleAutoRefresh(for connection: TimeOfUseConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTimeOfUseSource: TimeOfUseSource {
    public var onUpdate: (@MainActor (TimeOfUseUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TimeOfUseUpdate?

    public init(initial: TimeOfUseUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TimeOfUseUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "TimeOfUseAnalysis" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum TimeOfUseStrings {
    public static let table = "TimeOfUseAnalysis"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
