//
//  SolarProductionWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware kWh formatters and the testable accessibility summary. The
//  view binds through `SolarProductionModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared `Telemetry.track(.screenView(screen:…))` (consent-gated + redacted
/// there).
public protocol SolarProductionTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogSolarProductionTelemetry: SolarProductionTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from the sites + history `Resource<T>`s.
public enum SolarLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Data freshness, mirroring the web `DataFreshness` props (`isStale` / online).
/// `fresh` is the green dot; `stale` the amber "may be stale" chip + auto-refresh;
/// `offline` the muted "showing cached" chip (ADR-013).
public enum SolarFreshness: Sendable, Equatable {
    case fresh
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SolarProductionSource`: the cached site +
/// daily history rows plus their combined load/freshness status and the resolved
/// "today" key. The model turns this into the chart/summary projection + render
/// phase.
public struct SolarProductionUpdate: Sendable, Equatable {
    public var status: SolarLoadStatus
    public var freshness: SolarFreshness
    public var hasSites: Bool
    public var site: SolarEnergySite?
    public var history: [SolarHistoryEntry]
    public var todayKey: String
    public var updatedAt: Date?
    public var isFetching: Bool

    public init(
        status: SolarLoadStatus = .loading,
        freshness: SolarFreshness = .fresh,
        hasSites: Bool = false,
        site: SolarEnergySite? = nil,
        history: [SolarHistoryEntry] = [],
        todayKey: String = "",
        updatedAt: Date? = nil,
        isFetching: Bool = false
    ) {
        self.status = status
        self.freshness = freshness
        self.hasSites = hasSites
        self.site = site
        self.history = history
        self.todayKey = todayKey
        self.updatedAt = updatedAt
        self.isFetching = isFetching
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` over the KMP
/// `EnergyStore` — `useTeslaEnergySites` + `useTeslaEnergyHistory`); previews and
/// tests use `InMemorySolarProductionSource`.
@MainActor
public protocol SolarProductionSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SolarProductionUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `SolarProductionSource`,
/// recomputes the `SolarProjection` via `SolarProductionBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SolarProductionModel {
    /// The mutually-exclusive render branches (web shell + chart-summary states).
    public enum Phase: Equatable {
        case loading
        case noSite
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var freshness: SolarFreshness = .fresh
    public private(set) var projection: SolarProjection = .empty
    public private(set) var site: SolarEnergySite?
    public private(set) var hasSites = false
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any SolarProductionSource
    @ObservationIgnored private let telemetry: any SolarProductionTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SolarProductionSource,
        telemetry: any SolarProductionTelemetry = OSLogSolarProductionTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SolarProductionWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of both queries (web `handleRefresh`). Cached values stay
    /// visible.
    public func refresh() {
        source.refresh()
    }

    /// Whether the surface uses the compact (big-number, no-chart) layout — web
    /// `isCompact = size.cols <= 1`.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Whether the surface uses the wide (denser axis ticks) layout — web
    /// `isWide = size.cols >= 3`.
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: SolarProductionUpdate) {
        hasSites = update.hasSites
        site = update.site
        freshness = update.freshness
        updatedAt = update.updatedAt
        isFetching = update.isFetching
        projection = SolarProductionBuilder.buildProjection(
            history: update.history,
            todayKey: update.todayKey
        )
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, keeping cached content visible behind background
    /// refreshes and errors. Mirrors the web ordering: the shell shows its
    /// skeleton only on the initial fetch (`isLoading` true, no cached rows); the
    /// "No Tesla Energy site linked" empty state wins whenever there are no sites
    /// (the web's first `if`); otherwise the content branch renders (its own
    /// chart-summary shows "No solar data" when `hasData` is false).
    static func resolvePhase(_ update: SolarProductionUpdate) -> Phase {
        let hasCached = !update.history.isEmpty
        switch update.status {
        case .loading:
            return hasCached ? .content : .loading
        case .loaded, .empty:
            if !update.hasSites { return .noSite }
            return .content
        case let .failed(message):
            if !update.hasSites { return .noSite }
            return hasCached ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySolarProductionSource: SolarProductionSource {
    public var onUpdate: (@MainActor (SolarProductionUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SolarProductionUpdate?

    public init(initial: SolarProductionUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SolarProductionUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "SolarProductionWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration.
public enum SolarProductionStrings {
    public static let table = "SolarProductionWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - kWh formatting (locale-aware, web `fmtNumber` / `fmtInt`)

/// Formats kWh magnitudes the way the web `fmtNumber(value, decimals)` /
/// `fmtInt(value)` do: fixed fraction digits, locale-aware grouping.
public enum SolarProductionFormat {
    private static func formatter(fractionDigits: Int) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        return formatter
    }

    /// `fmtNumber(value, fractionDigits)` — e.g. `number(4.25, 1)` → `"4.3"`.
    public static func number(_ value: Double, fractionDigits: Int = 1) -> String {
        let safe = value.isFinite ? value : 0
        return formatter(fractionDigits: fractionDigits)
            .string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    /// `fmtInt(value)` — rounded, grouped integer (e.g. `integer(1234.6)` → `"1,235"`).
    public static func integer(_ value: Double) -> String {
        let safe = value.isFinite ? value : 0
        return formatter(fractionDigits: 0).string(from: NSNumber(value: safe.rounded()))
            ?? String(format: "%.0f", safe.rounded())
    }

    /// The value with its `kWh` unit (e.g. `"4.3 kWh"`).
    public static func value(_ value: Double, fractionDigits: Int = 1) -> String {
        let unit = SolarProductionStrings.string("widget.solarProduction.unitKwh", "kWh")
        return "\(number(value, fractionDigits: fractionDigits)) \(unit)"
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the solar surface. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum SolarProductionAccessibility {
    public static func summary(for projection: SolarProjection) -> String {
        guard projection.hasData else {
            return SolarProductionStrings.string("widget.solarProduction.noData", "No solar data")
        }
        let today = SolarProductionStrings.string("widget.solarProduction.today", "Today")
        let avg = SolarProductionStrings.string("widget.solarProduction.avg", "Daily Avg")
        let total = SolarProductionStrings.string("widget.solarProduction.total30d", "30-Day Total")
        return [
            "\(today) \(SolarProductionFormat.value(projection.todayKwh))",
            "\(avg) \(SolarProductionFormat.value(projection.avgKwh))",
            "\(total) \(SolarProductionFormat.value(projection.totalKwh, fractionDigits: 0))"
        ].joined(separator: ". ")
    }
}
