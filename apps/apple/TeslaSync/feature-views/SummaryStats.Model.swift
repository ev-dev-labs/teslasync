//
//  SummaryStats.Model.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the driving-dynamics summary stats grid. The view binds through
//  `DynamicsSummaryStatsModel`; no networking lives in the view. The web source
//  (SummaryStats.tsx) is a pure presentational leaf fed by its parent (the Driving
//  Dynamics page) — so the "source" here carries the parent's prop snapshot
//  (`motorStats` + the `toTemperatureDisplay` / `tempUnit` preference) rather than
//  issuing HTTP itself. The web leaf's only render branches are the per-tile value
//  (a formatted number, or the temperature em-dash when `motorStats` is null) plus the
//  in-flight skeleton the shared StatCard supports; connectivity / error / stale /
//  offline handling is owned by the parent surface, not duplicated at this leaf — a
//  null `motorStats` renders zeros (and the temperature em-dash), exactly as the web
//  `stats?.x ?? 0` / `stats ? … : '—'` fallbacks do.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics sink (ADR-016 §5), which is consent-gated
/// and redacted there.
public protocol DynamicsSummaryStatsTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
/// The slug is a static, non-identifying constant logged verbatim; no payload, VIN, or
/// location is ever recorded.
public struct OSLogDynamicsSummaryStatsTelemetry: DynamicsSummaryStatsTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from the Driving Dynamics page)

/// One coalesced snapshot of the grid's inputs — the native mirror of the web props
/// (`motorStats: MotorStats | null`) plus the parent's display preference (locale +
/// temperature unit, the `toTemperatureDisplay` / `tempUnit` inputs) and the in-flight
/// `loading` flag. A nil `values` is the web `motorStats === null` case, which the
/// projection renders as zeros (and the temperature em-dash).
public struct DynamicsSummaryStatsInput: Sendable, Equatable {
    public var values: DynamicsSummaryStatsValues?
    public var formatting: DynamicsSummaryStatsFormatting
    public var isLoading: Bool

    public init(
        values: DynamicsSummaryStatsValues? = nil,
        formatting: DynamicsSummaryStatsFormatting = DynamicsSummaryStatsFormatting(),
        isLoading: Bool = false
    ) {
        self.values = values
        self.formatting = formatting
        self.isLoading = isLoading
    }
}

/// The resolved, view-ready state — the native mirror of the web component's render
/// (six tiles) and its in-flight skeleton branch.
public struct DynamicsSummaryStatsResolved: Sendable, Equatable {
    /// The render branch the tiles were resolved under.
    public enum Phase: Sendable, Equatable {
        case loading
        case data
    }

    public let phase: Phase
    public let cards: [DynamicsSummaryStatsCard]

    public init(phase: Phase, cards: [DynamicsSummaryStatsCard]) {
        self.phase = phase
        self.cards = cards
    }
}

// MARK: - Projection (web six `<StatCard>` children)

/// Pure projection from the input snapshot to the resolved view-state — the native port
/// of the web grid's six `<StatCard>` children: each tile's label key, its value branch
/// (`fmtNumber` string / raw count / converted temperature / em-dash), the optional
/// unit suffix, and the muted SF Symbol. When loading, every tile resolves to `.loading`
/// so the view renders the skeleton; a nil `values` resolves the numeric tiles to zeros
/// and the temperature tile to the em-dash (web `stats ? … : '—'`). Unit tested across
/// every branch and tile.
public enum DynamicsSummaryStatsProjection {
    public static func resolve(_ input: DynamicsSummaryStatsInput) -> DynamicsSummaryStatsResolved {
        let cards = makeCards(
            rawValues: input.values,
            formatting: input.formatting,
            loading: input.isLoading
        )
        return DynamicsSummaryStatsResolved(phase: input.isLoading ? .loading : .data, cards: cards)
    }

    /// Builds the six tiles in source order. Each numeric value is `.loading` while in
    /// flight (web skeleton) and a formatted `.value` otherwise; the temperature tile
    /// resolves to `.empty` (the em-dash) when `values` is nil and not loading, exactly
    /// as the web `motorStats ? … : '—'` ternary does.
    private static func makeCards(
        rawValues: DynamicsSummaryStatsValues?,
        formatting: DynamicsSummaryStatsFormatting,
        loading: Bool
    ) -> [DynamicsSummaryStatsCard] {
        let resolved = rawValues ?? .zero
        func numberValue(_ amount: Double) -> DynamicsSummaryStatsCardValue {
            loading ? .loading : .value(formatting.number(amount))
        }
        func countValue(_ amount: Int) -> DynamicsSummaryStatsCardValue {
            loading ? .loading : .value(formatting.count(amount))
        }
        return [
            DynamicsSummaryStatsCard(
                id: "totalReadings",
                labelKey: "dynamics.totalReadings",
                labelFallback: "Total Readings",
                value: countValue(resolved.totalReadings),
                unit: nil,
                symbol: "chart.bar.fill"
            ),
            DynamicsSummaryStatsCard(
                id: "avgTorque",
                labelKey: "dynamics.avgTorque",
                labelFallback: "Avg Torque",
                value: numberValue(resolved.avgTorque),
                unit: DynamicsSummaryStatsUnits.newtonMeter,
                symbol: "bolt.fill"
            ),
            DynamicsSummaryStatsCard(
                id: "peakPower",
                labelKey: "dynamics.peakPower",
                labelFallback: "Peak Power",
                value: numberValue(resolved.peakPower),
                unit: DynamicsSummaryStatsUnits.kilowatt,
                symbol: "arrow.turn.down.right"
            ),
            DynamicsSummaryStatsCard(
                id: "peakRegen",
                labelKey: "dynamics.peakRegen",
                labelFallback: "Peak Regen",
                value: numberValue(resolved.peakRegen),
                unit: DynamicsSummaryStatsUnits.kilowatt,
                symbol: "chart.line.downtrend.xyaxis"
            ),
            DynamicsSummaryStatsCard(
                id: "avgPower",
                labelKey: "dynamics.avgPower",
                labelFallback: "Avg Power",
                value: numberValue(resolved.avgPower),
                unit: DynamicsSummaryStatsUnits.kilowatt,
                symbol: "gauge.medium"
            ),
            temperatureCard(rawValues: rawValues, resolved: resolved, formatting: formatting, loading: loading)
        ]
    }

    /// The Avg Motor Temp tile — the web `motorStats ? ${fmtNumber(toTemperatureDisplay
    /// (avgMotorTemp),1)}${tempUnit} : '—'`: loading → skeleton; null `values` →
    /// em-dash with no unit; otherwise the converted, one-decimal value plus the
    /// preference's unit symbol.
    private static func temperatureCard(
        rawValues: DynamicsSummaryStatsValues?,
        resolved: DynamicsSummaryStatsValues,
        formatting: DynamicsSummaryStatsFormatting,
        loading: Bool
    ) -> DynamicsSummaryStatsCard {
        let value: DynamicsSummaryStatsCardValue
        let unit: DynamicsSummaryStatsUnit?
        if loading {
            value = .loading
            unit = formatting.temperatureUnitDescriptor
        } else if rawValues == nil {
            value = .empty
            unit = nil
        } else {
            value = .value(formatting.temperatureValue(resolved.avgMotorTempCelsius))
            unit = formatting.temperatureUnitDescriptor
        }
        return DynamicsSummaryStatsCard(
            id: "avgMotorTemp",
            labelKey: "dynamics.avgMotorTemp",
            labelFallback: "Avg Motor Temp",
            value: value,
            unit: unit,
            symbol: "thermometer.medium"
        )
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent
/// Driving Dynamics page's resolved `motorStats` + display preference; previews and
/// tests use `InMemoryDynamicsSummaryStatsSource`. The view never talks to the network
/// directly.
@MainActor
public protocol DynamicsSummaryStatsSource: AnyObject {
    var onUpdate: (@MainActor (DynamicsSummaryStatsInput) -> Void)? { get set }
    func start()
    func stop()
}

/// The grid's observable view-model. Subscribes to a `DynamicsSummaryStatsSource`,
/// recomputes the resolved projection, and exposes the render `Phase` plus the resolved
/// tiles for SwiftUI to render.
@MainActor
@Observable
public final class DynamicsSummaryStatsModel {
    public private(set) var phase: DynamicsSummaryStatsResolved.Phase = .loading
    public private(set) var cards: [DynamicsSummaryStatsCard] = []

    @ObservationIgnored private let source: any DynamicsSummaryStatsSource
    @ObservationIgnored private let telemetry: any DynamicsSummaryStatsTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any DynamicsSummaryStatsSource,
        telemetry: any DynamicsSummaryStatsTelemetry = OSLogDynamicsSummaryStatsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SummaryStats.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    private func apply(_ input: DynamicsSummaryStatsInput) {
        let resolved = DynamicsSummaryStatsProjection.resolve(input)
        phase = resolved.phase
        cards = resolved.cards
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDynamicsSummaryStatsSource: DynamicsSummaryStatsSource {
    public var onUpdate: (@MainActor (DynamicsSummaryStatsInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    private let initial: DynamicsSummaryStatsInput?

    public init(initial: DynamicsSummaryStatsInput? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial { onUpdate?(initial) }
    }

    public func stop() {
        stopCount += 1
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ input: DynamicsSummaryStatsInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SummaryStats" table, folded into the
/// app `Localizable.xcstrings` catalog at integration time.
public enum SSDStrings {
    public static let table = "SummaryStats"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
