//
//  EnergyStatsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the locale-aware SI display formatters and the testable accessibility
//  summary. The view binds through `EnergyStatsModel`; no networking lives in
//  the view.
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
public protocol EnergyStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogEnergyStatsTelemetry: EnergyStatsTelemetry {
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
/// cases the production source projects from the energy `Resource<EnergyStats>`.
public enum EnergyStatsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Data freshness, mirroring the web `DataFreshness` props (`isStale` / online).
/// `fresh` is the green dot; `stale` the amber "may be stale" chip + auto-refresh;
/// `offline` the muted "showing cached" chip (ADR-013).
public enum EnergyStatsFreshness: Sendable, Equatable {
    case fresh
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `EnergyStatsSource`: the cached
/// `EnergyStats` aggregate plus its load/freshness status and the resolved
/// display preferences. The model turns this into the chart/summary projection +
/// render phase.
public struct EnergyStatsUpdate: Sendable, Equatable {
    public var status: EnergyStatsLoadStatus
    public var freshness: EnergyStatsFreshness
    public var data: EnergyStatsData?
    public var prefs: EnergyStatsUnitPrefs
    public var updatedAt: Date?
    public var isFetching: Bool

    public init(
        status: EnergyStatsLoadStatus = .loading,
        freshness: EnergyStatsFreshness = .fresh,
        data: EnergyStatsData? = nil,
        prefs: EnergyStatsUnitPrefs = .metric,
        updatedAt: Date? = nil,
        isFetching: Bool = false
    ) {
        self.status = status
        self.freshness = freshness
        self.data = data
        self.prefs = prefs
        self.updatedAt = updatedAt
        self.isFetching = isFetching
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<EnergyStats>>`
/// over the KMP `EnergyStore` — `useVehicles` to resolve the id, then
/// `useEnergyStats`); previews and tests use `InMemoryEnergyStatsSource`.
@MainActor
public protocol EnergyStatsSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EnergyStatsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `EnergyStatsSource`,
/// recomputes the `EnergyStatsProjection` via `EnergyStatsBuilder`, and exposes a
/// render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class EnergyStatsModel {
    /// The mutually-exclusive render branches (web shell + content states).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var freshness: EnergyStatsFreshness = .fresh
    public private(set) var projection: EnergyStatsProjection = .empty
    public private(set) var prefs: EnergyStatsUnitPrefs = .metric
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any EnergyStatsSource
    @ObservationIgnored private let telemetry: any EnergyStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnergyStatsSource,
        telemetry: any EnergyStatsTelemetry = OSLogEnergyStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnergyStatsWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh of the query (web `onRefresh` → `refetch()`). Cached
    /// values stay visible.
    public func refresh() {
        source.refresh()
    }

    /// Whether the surface uses the compact (big-number, no-chart) layout — web
    /// `isCompact = size.cols <= 1`.
    public static func isCompact(for size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// Whether the surface uses the wide (3-up stat grid + extra stats) layout —
    /// web `isWide = size.cols >= 3`.
    public static func isWide(for size: DashboardWidgetSize) -> Bool {
        size.cols >= 3
    }

    private func apply(_ update: EnergyStatsUpdate) {
        prefs = update.prefs
        freshness = update.freshness
        updatedAt = update.updatedAt
        isFetching = update.isFetching
        projection = EnergyStatsBuilder.buildProjection(data: update.data)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase, keeping cached content visible behind background
    /// refreshes and errors. Mirrors the web ordering: the shell shows its
    /// skeleton only on the initial fetch (`isLoading` true, no cached aggregate);
    /// once resolved, the content branch renders whenever there is a `data`
    /// aggregate (web `hasData = !!data`), otherwise the "No energy data
    /// available" empty state wins; a failure with no cached aggregate surfaces
    /// the error shell.
    static func resolvePhase(_ update: EnergyStatsUpdate) -> Phase {
        let hasCached = update.data != nil
        switch update.status {
        case .loading:
            return hasCached ? .content : .loading
        case .loaded:
            return hasCached ? .content : .empty
        case .empty:
            return .empty
        case let .failed(message):
            return hasCached ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEnergyStatsSource: EnergyStatsSource {
    public var onUpdate: (@MainActor (EnergyStatsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnergyStatsUpdate?

    public init(initial: EnergyStatsUpdate? = nil) {
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
    public func push(_ update: EnergyStatsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "EnergyStatsWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration.
public enum EnergyStatsStrings {
    public static let table = "EnergyStatsWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - SI display formatting (locale-aware, web `useUnits` / `fmtNumber`)

/// Formats the surface's SI magnitudes at the display boundary, the way the web
/// `useUnits` (`formatEnergy`, the `toEfficiencyDisplay` factor) and `fmtNumber`
/// do: fixed fraction digits, locale-aware grouping, unit-converted at render.
public enum EnergyStatsFormat {
    private static func formatter(fractionDigits: Int, locale: String) -> NumberFormatter {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.minimumFractionDigits = fractionDigits
        formatter.maximumFractionDigits = fractionDigits
        formatter.roundingMode = .halfUp
        formatter.locale = Locale(identifier: locale)
        return formatter
    }

    /// `fmtNumber(value, fractionDigits)` — locale-grouped fixed-digit number.
    public static func number(_ value: Double, fractionDigits: Int = 1, locale: String = "en_US") -> String {
        let safe = value.isFinite ? value : 0
        return formatter(fractionDigits: fractionDigits, locale: locale)
            .string(from: NSNumber(value: safe)) ?? String(format: "%.\(fractionDigits)f", safe)
    }

    /// `formatEnergy(wh, { precision })` — converts SI Wh to the energy preference
    /// (kWh → `wh / 1000`, Wh → `wh`) and appends the unit label (e.g. `"18.0 kWh"`).
    public static func energy(_ wh: Double, prefs: EnergyStatsUnitPrefs, fractionDigits: Int = 1) -> String {
        let safe = wh.isFinite ? wh : 0
        let value = prefs.energy == .kwh ? safe / 1000 : safe
        return "\(number(value, fractionDigits: fractionDigits, locale: prefs.localeIdentifier)) \(prefs.energy.label)"
    }

    /// `toEfficiencyDisplay(whPerM)` — Wh/m → Wh/mi (`× 1609.344`) or Wh/km
    /// (`× 1000`) per the distance preference.
    public static func efficiencyDisplay(_ whPerM: Double, distance: EnergyStatsDistanceUnit) -> Double {
        let safe = whPerM.isFinite ? whPerM : 0
        return distance == .mi ? safe * 1609.344 : safe * 1000
    }

    /// The efficiency stat value (number only; the unit is a separate chip) —
    /// web `fmtNumber(toEfficiencyDisplay(avg_efficiency_wh_per_m), 1)`.
    public static func efficiency(_ whPerM: Double, prefs: EnergyStatsUnitPrefs, fractionDigits: Int = 1) -> String {
        number(
            efficiencyDisplay(whPerM, distance: prefs.distance),
            fractionDigits: fractionDigits,
            locale: prefs.localeIdentifier
        )
    }

    /// The cost stat value (number only; the currency symbol is a separate chip)
    /// — web `fmtNumber(total_cost, 2)`.
    public static func cost(_ value: Double, prefs: EnergyStatsUnitPrefs, fractionDigits: Int = 2) -> String {
        number(value, fractionDigits: fractionDigits, locale: prefs.localeIdentifier)
    }

    /// The compact headline (`total_wh / 1000`) formatted with one fraction digit
    /// — web compact `AnimatedNumber value={(total_wh ?? 0) / 1000}`.
    public static func compact(_ kwh: Double, prefs: EnergyStatsUnitPrefs, fractionDigits: Int = 1) -> String {
        number(kwh, fractionDigits: fractionDigits, locale: prefs.localeIdentifier)
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the energy chart/content. Pure + public
/// so the a11y content can be unit-tested without rendering the view.
public enum EnergyStatsAccessibility {
    public static func summary(for projection: EnergyStatsProjection, prefs: EnergyStatsUnitPrefs) -> String {
        guard projection.hasData else {
            return EnergyStatsStrings.string("widget.energyStats.noData", "No energy data available")
        }
        let used = EnergyStatsStrings.string("widget.energyStats.totalUsed", "Total Used")
        let charged = EnergyStatsStrings.string("widget.energyStats.totalCharged", "Total Charged")
        let efficiency = EnergyStatsStrings.string("widget.energyStats.avgEfficiency", "Avg Efficiency")
        let co2 = EnergyStatsStrings.string("widget.energyStats.co2Saved", "CO₂ Saved")
        let kg = EnergyStatsStrings.string("widget.energyStats.unitKg", "kg")

        let usedValue = EnergyStatsFormat.energy(projection.totalEnergyUsedWh, prefs: prefs)
        let chargedValue = EnergyStatsFormat.energy(projection.totalEnergyChargedWh, prefs: prefs)
        let effValue = EnergyStatsFormat.efficiency(projection.avgEfficiencyWhPerM, prefs: prefs)
        let co2Value = EnergyStatsFormat.number(
            projection.co2SavedKg,
            fractionDigits: 1,
            locale: prefs.localeIdentifier
        )

        return [
            "\(used) \(usedValue)",
            "\(charged) \(chargedValue)",
            "\(efficiency) \(effValue) \(prefs.efficiencyUnit)",
            "\(co2) \(co2Value) \(kg)"
        ].joined(separator: ". ")
    }
}
