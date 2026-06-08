//
//  SummaryStatsGrid.Model.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  The state-holder seam (P1/S8), the telemetry seam (P1/S11), and the i18n facade
//  (P1/S10) for the charging-curve summary stats grid. The view binds through
//  `SummaryStatsGridModel`; no networking lives in the view. The web source
//  (SummaryStatsGrid.tsx) is a pure presentational leaf fed by its parent (the
//  ChargingCurve page) — so the "source" here carries the parent's prop snapshot
//  (`stats` + the `useFormatting` output) rather than issuing HTTP itself, and the
//  only lifecycle branch the web leaf has is the per-card `loading` skeleton vs. the
//  resolved row of six cards. Connectivity / empty / error / stale handling is owned
//  by the parent surface, not duplicated at this leaf — a null `stats` renders zeros,
//  exactly as the web `stats?.x ?? 0` fallbacks do.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core diagnostics sink (ADR-016 §5), which is consent-gated
/// and redacted there.
public protocol SummaryStatsGridTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
/// The slug is a static, non-identifying constant logged verbatim; no payload, VIN,
/// or location is ever recorded.
public struct OSLogSummaryStatsGridTelemetry: SummaryStatsGridTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Input snapshot (web props from the ChargingCurve page)

/// One coalesced snapshot of the grid's inputs — the native mirror of the web props
/// (`stats: SummaryStats | null`) plus the `useFormatting` output (currency symbol +
/// decimal precision) and the per-card `loading` flag. A nil `values` is the web
/// `stats === null` case, which the projection renders as zeros.
public struct SummaryStatsGridInput: Sendable, Equatable {
    public var values: SummaryStatsGridValues?
    public var formatting: SummaryStatsGridFormatting
    public var isLoading: Bool

    public init(
        values: SummaryStatsGridValues? = nil,
        formatting: SummaryStatsGridFormatting = SummaryStatsGridFormatting(),
        isLoading: Bool = false
    ) {
        self.values = values
        self.formatting = formatting
        self.isLoading = isLoading
    }
}

/// The resolved, view-ready state — the native mirror of the web component's render
/// (six cards) and its per-card `loading` skeleton branch.
public struct SummaryStatsGridResolved: Sendable, Equatable {
    /// The render branch the cards were resolved under.
    public enum Phase: Sendable, Equatable {
        case loading
        case data
    }

    public let phase: Phase
    public let cards: [SummaryStatsGridCard]

    public init(phase: Phase, cards: [SummaryStatsGridCard]) {
        self.phase = phase
        self.cards = cards
    }
}

/// Pure projection from the input snapshot to the resolved view-state — the native
/// port of the web grid's six `<SummaryCard>` children: each card's label key, the
/// `fmtInt` / `fmtNumber` / `formatCurrency` value, and the unit suffix. When loading,
/// every card's value is `nil` so the view renders the skeleton (web `loading`
/// branch); a nil `values` resolves to zeros (web `stats?.x ?? 0`). Unit tested across
/// both branches and every card.
public enum SummaryStatsGridProjection {
    public static func resolve(_ input: SummaryStatsGridInput) -> SummaryStatsGridResolved {
        let cards = makeCards(
            values: input.values ?? SummaryStatsGridValues(),
            formatting: input.formatting,
            loading: input.isLoading
        )
        return SummaryStatsGridResolved(phase: input.isLoading ? .loading : .data, cards: cards)
    }

    /// Builds the six cards in source order. Each value is `nil` while loading (web
    /// per-card skeleton) and the `fmtInt` / `fmtNumber` / `formatCurrency` string
    /// otherwise; the `kWh` / `kW` / `min` unit suffixes are carried as i18n tokens.
    private static func makeCards(
        values: SummaryStatsGridValues,
        formatting: SummaryStatsGridFormatting,
        loading: Bool
    ) -> [SummaryStatsGridCard] {
        let kwh = SummaryStatsGridUnit(key: "charging.curve.unit.kwh", fallback: "kWh")
        let kilowatt = SummaryStatsGridUnit(key: "charging.curve.unit.kw", fallback: "kW")
        let minutes = SummaryStatsGridUnit(key: "charging.curve.unit.min", fallback: "min")
        func value(_ text: String) -> String? {
            loading ? nil : text
        }
        return [
            SummaryStatsGridCard(
                id: "totalSessions",
                labelKey: "charging.curve.totalSessions",
                labelFallback: "Total Sessions",
                value: value(formatting.integer(values.totalSessions)),
                unit: nil
            ),
            SummaryStatsGridCard(
                id: "totalEnergy",
                labelKey: "charging.curve.totalEnergy",
                labelFallback: "Total Energy",
                value: value(formatting.number(values.totalEnergy)),
                unit: kwh
            ),
            SummaryStatsGridCard(
                id: "avgChargeRate",
                labelKey: "charging.curve.avgChargeRate",
                labelFallback: "Avg Charge Rate",
                value: value(formatting.number(values.avgRate)),
                unit: kilowatt
            ),
            SummaryStatsGridCard(
                id: "peakRate",
                labelKey: "charging.curve.peakRate",
                labelFallback: "Peak Rate",
                value: value(formatting.number(values.peakRate)),
                unit: kilowatt
            ),
            SummaryStatsGridCard(
                id: "avgDuration",
                labelKey: "charging.curve.avgDuration",
                labelFallback: "Avg Duration",
                value: value(formatting.integer(values.avgDuration)),
                unit: minutes
            ),
            SummaryStatsGridCard(
                id: "totalCost",
                labelKey: "charging.curve.totalCost",
                labelFallback: "Total Cost",
                value: value(formatting.currency(values.totalCost)),
                unit: nil
            )
        ]
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the parent
/// ChargingCurve page's resolved `stats` + formatting; previews and tests use
/// `InMemorySummaryStatsGridSource`. The view never talks to the network directly.
@MainActor
public protocol SummaryStatsGridSource: AnyObject {
    var onUpdate: (@MainActor (SummaryStatsGridInput) -> Void)? { get set }
    func start()
    func stop()
}

/// The grid's observable view-model. Subscribes to a `SummaryStatsGridSource`,
/// recomputes the resolved projection, and exposes the render `Phase` plus the
/// resolved cards for SwiftUI to render.
@MainActor
@Observable
public final class SummaryStatsGridModel {
    public private(set) var phase: SummaryStatsGridResolved.Phase = .loading
    public private(set) var cards: [SummaryStatsGridCard] = []

    @ObservationIgnored private let source: any SummaryStatsGridSource
    @ObservationIgnored private let telemetry: any SummaryStatsGridTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SummaryStatsGridSource,
        telemetry: any SummaryStatsGridTelemetry = OSLogSummaryStatsGridTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] input in self?.apply(input) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: SummaryStatsGrid.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    private func apply(_ input: SummaryStatsGridInput) {
        let resolved = SummaryStatsGridProjection.resolve(input)
        phase = resolved.phase
        cards = resolved.cards
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySummaryStatsGridSource: SummaryStatsGridSource {
    public var onUpdate: (@MainActor (SummaryStatsGridInput) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0

    private let initial: SummaryStatsGridInput?

    public init(initial: SummaryStatsGridInput? = nil) {
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
    public func push(_ input: SummaryStatsGridInput) {
        onUpdate?(input)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "SummaryStatsGrid" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time.
public enum SSGStrings {
    public static let table = "SummaryStatsGrid"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
