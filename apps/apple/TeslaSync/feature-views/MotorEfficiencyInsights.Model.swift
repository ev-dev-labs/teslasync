//
//  MotorEfficiencyInsights.Model.swift
//  TeslaSync — P4 feature view · 0171 · MotorEfficiencyInsights (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11 diagnostics), and the
//  i18n facade (P1/S10) for the Motor Efficiency Insights surface. The view binds
//  through `MotorEfficiencyInsightsModel`; no networking lives in the view.
//
//  The web source (MotorEfficiencyInsights.tsx) is a pure presentational leaf fed a
//  computed `motorStats` + `throttleStyle` (and the temperature display preference)
//  by its parent (the /driving dynamics page). The native input snapshot therefore
//  carries that view-model plus the parent's lifecycle (loading / error / live-state)
//  rather than issuing HTTP itself.
//
//  States — the web leaf's own branch is data-driven (each panel renders its stats
//  when `motorStats` is present and the shared `EmptyState` ("No motor data recorded
//  yet") when it is null). On top of that this surface honours the P4 leaf contract
//  (the same one AcDcStatsPanel/0096 + FlagsTable/0031 ship): a `phase`
//  (loading / empty / error / data) fed by the parent's query state, and an
//  orthogonal `connection` axis (live / stale / offline) surfaced as a freshness chip
//  + banner with a one-shot auto-refresh on the stale transition.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared-core diagnostics sink (consent-gated + redacted there).
public protocol MotorEfficiencyTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a redaction-safe
/// `view.opened` event. The slug is a static, non-identifying constant.
public struct OSLogMotorEfficiencyTelemetry: MotorEfficiencyTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Connectivity (P4 leaf freshness axis)

/// The freshness of the bound data — the orthogonal connectivity axis rendered as
/// the header chip + banner. `live` hides the banner; `stale` / `offline` show it.
public enum MotorEfficiencyConnection: String, Sendable, Equatable, CaseIterable {
    case live
    case stale
    case offline
}

// MARK: - Input snapshot (web props from the /driving page)

/// One coalesced snapshot of the surface's inputs — the native mirror of the web
/// props (`motorStats`, `throttleStyle`, the temperature display preference) plus the
/// parent surface's lifecycle (`isLoading`, an error message, and connectivity). The
/// metrics are the parent's already-computed presentation values, carried verbatim.
public struct MotorEfficiencyInput: Sendable, Equatable {
    public var metrics: MotorMetrics?
    public var throttleStyle: MotorThrottleStyle?
    public var temperatureUnit: MotorTemperatureUnit
    public var isLoading: Bool
    public var errorMessage: String?
    public var connection: MotorEfficiencyConnection

    public init(
        metrics: MotorMetrics? = nil,
        throttleStyle: MotorThrottleStyle? = nil,
        temperatureUnit: MotorTemperatureUnit = .celsius,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: MotorEfficiencyConnection = .live
    ) {
        self.metrics = metrics
        self.throttleStyle = throttleStyle
        self.temperatureUnit = temperatureUnit
        self.isLoading = isLoading
        self.errorMessage = errorMessage
        self.connection = connection
    }
}

// MARK: - Resolved view-state (web render branch + P4 leaf contract)

/// The resolved, view-ready state — the native mirror of the component's render
/// branch. `phase` selects the body; the effective throttle style, thermal
/// classification, and bar fraction are pre-computed so the view is a pure function
/// of this value.
public struct MotorEfficiencyResolved: Sendable, Equatable {
    public enum Phase: Sendable, Equatable {
        case loading
        case empty
        case error(String)
        case data
    }

    public let phase: Phase
    public let metrics: MotorMetrics?
    public let throttleStyle: MotorThrottleStyle
    public let thermalStatus: MotorThermalStatus
    public let temperatureUnit: MotorTemperatureUnit
    public let powerFraction: Double

    public init(
        phase: Phase,
        metrics: MotorMetrics?,
        throttleStyle: MotorThrottleStyle,
        thermalStatus: MotorThermalStatus,
        temperatureUnit: MotorTemperatureUnit,
        powerFraction: Double
    ) {
        self.phase = phase
        self.metrics = metrics
        self.throttleStyle = throttleStyle
        self.thermalStatus = thermalStatus
        self.temperatureUnit = temperatureUnit
        self.powerFraction = powerFraction
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web component's render branch plus the P4 leaf contract. Unit tested
/// across loading / empty / error / data and the derived style / thermal / fraction.
public enum MotorEfficiencyProjection {
    public static func resolve(_ input: MotorEfficiencyInput) -> MotorEfficiencyResolved {
        // P4 contract: a parent query failure surfaces at the leaf as `error`.
        if let message = input.errorMessage, !message.isEmpty {
            return chrome(.error(message), temperatureUnit: input.temperatureUnit)
        }
        // Initial fetch (web parent `isLoading`) before any stats resolve.
        guard !input.isLoading else {
            return chrome(.loading, temperatureUnit: input.temperatureUnit)
        }
        // Web `motorStats ? <stats> : <EmptyState/>` — null metrics ⇒ the empty body.
        guard let metrics = input.metrics else {
            return chrome(.empty, temperatureUnit: input.temperatureUnit)
        }
        // Web parent passes `throttleStyle`; fall back to `getThrottleStyle(avgPower)`.
        let style = input.throttleStyle ?? MotorThrottle.style(forAveragePowerKW: metrics.averagePowerKW)
        return MotorEfficiencyResolved(
            phase: .data,
            metrics: metrics,
            throttleStyle: style,
            thermalStatus: MotorThermalStatus.classify(maxMotorTempC: metrics.maxMotorTempC),
            temperatureUnit: input.temperatureUnit,
            powerFraction: MotorEfficiencyFormat.powerFraction(metrics.averagePowerKW)
        )
    }

    /// A non-data phase carries no metrics; the derived fields take safe defaults.
    private static func chrome(
        _ phase: MotorEfficiencyResolved.Phase,
        temperatureUnit: MotorTemperatureUnit
    ) -> MotorEfficiencyResolved {
        MotorEfficiencyResolved(
            phase: phase,
            metrics: nil,
            throttleStyle: .conservative,
            thermalStatus: .good,
            temperatureUnit: temperatureUnit,
            powerFraction: 0
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// /driving page's resolved motor query + the units facade; previews and tests use
/// `InMemoryMotorEfficiencySource`. The view never talks to the network directly.
@MainActor
public protocol MotorEfficiencySource: AnyObject {
    var onUpdate: (@MainActor (MotorEfficiencyInput) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `MotorEfficiencySource`,
/// recomputes the resolved projection, exposes a render `phase` + the resolved
/// view-state and the `connection` axis, and auto-refreshes once when the feed
/// transitions to stale.
@MainActor
@Observable
public final class MotorEfficiencyInsightsModel {
    public private(set) var resolved: MotorEfficiencyResolved =
        MotorEfficiencyProjection.resolve(MotorEfficiencyInput(isLoading: true))
    public private(set) var connection: MotorEfficiencyConnection = .live

    public var phase: MotorEfficiencyResolved.Phase {
        resolved.phase
    }

    @ObservationIgnored private let source: any MotorEfficiencySource
    @ObservationIgnored private let telemetry: any MotorEfficiencyTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any MotorEfficiencySource,
        telemetry: any MotorEfficiencyTelemetry = OSLogMotorEfficiencyTelemetry(),
        locale: Locale = .current
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// The locale used by the view's formatters (injected for deterministic tests).
    public var formattingLocale: Locale {
        locale
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MotorEfficiencyInsights.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-requests the upstream snapshot (header refresh button + error retry).
    public func refresh() {
        source.refresh()
    }

    private func apply(_ input: MotorEfficiencyInput) {
        resolved = MotorEfficiencyProjection.resolve(input)
        connection = input.connection
        handleAutoRefresh(for: input.connection)
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached stats on screen and does not refetch.
    private func handleAutoRefresh(for connection: MotorEfficiencyConnection) {
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

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMotorEfficiencySource: MotorEfficiencySource {
    public var onUpdate: (@MainActor (MotorEfficiencyInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MotorEfficiencyInput?

    public init(initial: MotorEfficiencyInput? = nil) {
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
    public func push(_ input: MotorEfficiencyInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded prose. Keys live in the "MotorEfficiencyInsights" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time; the per-surface
/// table keeps each parallel surface prompt self-contained.
public enum MotorEfficiencyStrings {
    public static let table = "MotorEfficiencyInsights"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
