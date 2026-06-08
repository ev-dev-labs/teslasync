//
//  SavingsCalculator.Model.swift
//  TeslaSync — P4 feature view · 0118 · SavingsCalculator (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `SavingsCalculatorSource` the view
//  binds through), the cache-then-network load state + error taxonomy, the
//  observable view-model that *also* owns the three interactive assumption fields
//  (web input state) and the "Reset Defaults" action, the P1/S10 i18n facade, and
//  the testable accessibility summary. No SwiftUI view code and no direct
//  networking live here.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError`
/// shape so the production binding is a 1:1 map (offline keeps cached aggregates;
/// decode is non-retryable; network/api are retryable).
public enum SavingsCalculatorError: Equatable, Sendable {
    case offline
    case network(message: String)
    case decode(message: String)
    case api(status: Int, code: String?, body: String?)

    /// Whether a retry affordance should be offered (web `QueryError` retry).
    public var isRetryable: Bool {
        switch self {
        case .offline, .network, .api: true
        case .decode: false
        }
    }
}

// MARK: - Load state (cache-then-network + stale flag, ADR-013)

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the
/// last cached value to keep on screen behind a refresh/error and the ADR-013
/// `stale` flag. Mirrors the facade `LoadableState` without importing `Shared`,
/// so the surface host-compiles and every branch is unit-testable.
public enum SavingsCalculatorLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(SavingsCalculatorError, cached: Value?, stale: Bool)
}

extension SavingsCalculatorLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the charging cost-analysis feed, projected through
/// the units facade into display-ready aggregates via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemorySavingsCalculatorSource`.
@MainActor
public protocol SavingsCalculatorSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SavingsCalculatorLoadState<SavingsCalculatorData>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySavingsCalculatorSource: SavingsCalculatorSource {
    public var onUpdate: (@MainActor (SavingsCalculatorLoadState<SavingsCalculatorData>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SavingsCalculatorLoadState<SavingsCalculatorData>?

    public init(initial: SavingsCalculatorLoadState<SavingsCalculatorData>? = nil) {
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
    public func push(_ state: SavingsCalculatorLoadState<SavingsCalculatorData>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding + assumption state)

/// The surface's observable view-model. It subscribes to a
/// `SavingsCalculatorSource` for the charging aggregates *and* owns the three
/// editable assumption fields (web input state) plus the reset action. The view
/// performs no networking; `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class SavingsCalculatorModel {
    /// The current cache-then-network state for the charging aggregates.
    public private(set) var state: SavingsCalculatorLoadState<SavingsCalculatorData> = .idle

    /// Gas-price field text (web `gasPrice` input, `$/gal`). Bound by the view.
    public var gasPriceText: String
    /// MPG field text (web `mpg` input). Bound by the view.
    public var mpgText: String
    /// Electricity-rate field text (web `electricityRate` input, `$/kWh`).
    public var electricityRateText: String

    @ObservationIgnored private let source: any SavingsCalculatorSource
    @ObservationIgnored private var started = false

    /// The live, parsed assumptions derived from the field text (web
    /// `Number(...) || n` guards applied per field).
    public var assumptions: SavingsCalculatorAssumptions {
        SavingsCalculatorAssumptions(
            gasPrice: SavingsCalculatorAssumptions.parseRate(gasPriceText),
            mpg: SavingsCalculatorAssumptions.parseMpg(mpgText),
            electricityRate: SavingsCalculatorAssumptions.parseRate(electricityRateText)
        )
    }

    /// Live binding: observe the shared aggregates feed. Seeds the fields with
    /// the supplied assumptions (defaulting to the web defaults).
    public init(
        source: any SavingsCalculatorSource,
        assumptions: SavingsCalculatorAssumptions = .defaults
    ) {
        self.source = source
        gasPriceText = SavingsCalculatorAssumptions.fieldText(assumptions.gasPrice)
        mpgText = SavingsCalculatorAssumptions.fieldText(assumptions.mpg)
        electricityRateText = SavingsCalculatorAssumptions.fieldText(assumptions.electricityRate)
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(
        previewState: SavingsCalculatorLoadState<SavingsCalculatorData>,
        assumptions: SavingsCalculatorAssumptions = .defaults
    ) {
        let inMemory = InMemorySavingsCalculatorSource(initial: previewState)
        source = inMemory
        state = previewState
        gasPriceText = SavingsCalculatorAssumptions.fieldText(assumptions.gasPrice)
        mpgText = SavingsCalculatorAssumptions.fieldText(assumptions.mpg)
        electricityRateText = SavingsCalculatorAssumptions.fieldText(assumptions.electricityRate)
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component renders from `gasComparison` derived
    /// from the page aggregates. Maps the aggregates onto the load state so the
    /// native surface renders the identical comparison (the web grid only shows
    /// once the data resolves, so the default is `.loaded`).
    public convenience init(
        data: SavingsCalculatorData,
        assumptions: SavingsCalculatorAssumptions = .defaults,
        loading: Bool = false
    ) {
        self.init(
            previewState: SavingsCalculatorModel.loadState(data: data, loading: loading),
            assumptions: assumptions
        )
    }

    /// Pure web-prop → load-state mapping (unit-tested): `loading` keeps the value
    /// as cache behind a spinner; otherwise it is the loaded comparison.
    /// `nonisolated` because it touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        data: SavingsCalculatorData,
        loading: Bool
    ) -> SavingsCalculatorLoadState<SavingsCalculatorData> {
        loading ? .loading(cached: data, stale: false) : .loaded(data, stale: false)
    }

    /// Begins observing the upstream feed (idempotent).
    public func start() {
        guard !started else { return }
        started = true
        source.start()
    }

    /// Stops observing and closes the upstream subscription.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh; any cached aggregates stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }

    /// Restores the three assumptions to the web defaults (the "Reset Defaults"
    /// button), re-seeding the field text.
    public func resetDefaults() {
        let defaults = SavingsCalculatorAssumptions.defaults
        gasPriceText = SavingsCalculatorAssumptions.fieldText(defaults.gasPrice)
        mpgText = SavingsCalculatorAssumptions.fieldText(defaults.mpg)
        electricityRateText = SavingsCalculatorAssumptions.fieldText(defaults.electricityRate)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// view holds a hardcoded literal. Keys live in the per-surface
/// "SavingsCalculator" table, folded into the app `Localizable.xcstrings` catalog
/// at integration time (kept separate so parallel surface prompts never collide
/// on the shared catalog).
public enum SavingsCalculatorStrings {
    public static let table = "SavingsCalculator"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver label spoken for the comparison grid. Pure + public so the
/// a11y content can be unit-tested without rendering the view.
public enum SavingsCalculatorAccessibility {
    public static func summary(for projection: SavingsCalculatorProjection) -> String {
        let total = SavingsCalculatorStrings.string("costAnalysis.calculator.totalSavings", "Total Savings")
        let gas = SavingsCalculatorStrings.string("costAnalysis.calculator.gasCost", "Gas Cost (equivalent)")
        let electric = SavingsCalculatorStrings.string("costAnalysis.calculator.evCost", "EV Cost (actual)")
        let monthly = SavingsCalculatorStrings.string("costAnalysis.calculator.monthlySavings", "Monthly Savings")
        return [
            "\(total) \(projection.totalSavingsText).",
            "\(gas) \(projection.gasCostText), \(electric) \(projection.evCostText).",
            "\(monthly) \(projection.monthlySavingsText), \(projection.yearlySavingsText)."
        ].joined(separator: " ")
    }
}
