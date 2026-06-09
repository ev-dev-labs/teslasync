//
//  ChargingBreakdownSlide.Model.swift
//  TeslaSync — P4 feature view · 0061 · ChargingBreakdownSlide (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `ChargingBreakdownSlideSource` the
//  view binds through), the cache-then-network load state + error taxonomy, the
//  input DTO that mirrors the subset of the web `YearReview` this slide reads, the
//  observable view-model, and the P1/S10 i18n facade. No SwiftUI view code and no
//  direct networking live here, so every branch host-compiles + unit-tests on a
//  plain host.
//
//  Parity target: features/analytics/components/review/ChargingBreakdownSlide.tsx —
//  the web slide takes a resolved `data: YearReview` prop; the parent story owns the
//  query. The P4 surface contract additionally requires the loading / empty / error
//  / stale / offline chrome, so the model carries the full cache-then-network state
//  while the web-prop init maps `<ChargingBreakdownSlide data />` onto its content
//  branch.
//

import Foundation
import Observation

// MARK: - Input DTO (the web `YearReview` subset this slide reads)

/// The cached year-in-review inputs this slide consumes, mirroring the exact subset
/// of the web `YearReview` DTO `ChargingBreakdownSlide` reads: `supercharger_pct`,
/// `dc_fast_pct`, `ac_other_pct`, `total_charge_sessions`, and
/// `avg_charge_start_soc`. Kept surface-local (not shared with the dashboard
/// `YearReviewWidget`) so the slide compiles + tests in isolation and parallel
/// surface prompts never collide on a shared type. Percentages are `0…100`.
public struct ChargingBreakdownSlideData: Equatable, Sendable {
    public let superchargerPct: Double
    public let dcFastPct: Double
    public let acOtherPct: Double
    public let totalChargeSessions: Int
    public let avgChargeStartSoc: Double

    public init(
        superchargerPct: Double = 0,
        dcFastPct: Double = 0,
        acOtherPct: Double = 0,
        totalChargeSessions: Int = 0,
        avgChargeStartSoc: Double = 0
    ) {
        self.superchargerPct = superchargerPct
        self.dcFastPct = dcFastPct
        self.acOtherPct = acOtherPct
        self.totalChargeSessions = totalChargeSessions
        self.avgChargeStartSoc = avgChargeStartSoc
    }

    /// Whether any charging-mix slice is non-zero (web `chartData.filter(value > 0)`
    /// would yield at least one slice). Drives the donut-vs-fallback decision.
    public var hasMix: Bool {
        superchargerPct > 0 || dcFastPct > 0 || acOtherPct > 0
    }

    /// Whether the recap holds no charging at all — no sessions and no mix, so the
    /// slide shows the friendly empty state instead of an all-zero donut.
    public var isEmpty: Bool {
        totalChargeSessions == 0 && !hasMix
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError` shape
/// so the production binding is a 1:1 map (offline keeps the cached recap; decode is
/// non-retryable; network / api are retryable).
public enum ChargingBreakdownSlideError: Equatable, Sendable {
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

/// Native projection of the shared core's `Resource<T>` lifecycle, carrying the last
/// cached value to keep on screen behind a refresh / error and the ADR-013 `stale`
/// flag. Mirrors the facade `LoadableState` without importing `Shared`, so the
/// surface host-compiles and every branch is unit-testable.
public enum ChargingBreakdownSlideLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(ChargingBreakdownSlideError, cached: Value?, stale: Bool)
}

extension ChargingBreakdownSlideLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the `AnalyticsStore.yearReview` query projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryChargingBreakdownSlideSource`.
@MainActor
public protocol ChargingBreakdownSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryChargingBreakdownSlideSource: ChargingBreakdownSlideSource {
    public var onUpdate: (@MainActor (ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>?

    public init(initial: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>? = nil) {
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
    public func push(_ state: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a
/// `ChargingBreakdownSlideSource` and republishes its load state for SwiftUI to
/// switch over. The view performs no networking; `start` / `stop` / `refresh`
/// delegate to the source.
@MainActor
@Observable
public final class ChargingBreakdownSlideModel {
    /// The current cache-then-network state for the year-in-review recap.
    public private(set) var state: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData> = .idle

    @ObservationIgnored private let source: any ChargingBreakdownSlideSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared year-in-review feed.
    public init(source: any ChargingBreakdownSlideSource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData>) {
        let inMemory = InMemoryChargingBreakdownSlideSource(initial: previewState)
        source = inMemory
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component renders from a resolved `data` prop
    /// (`<ChargingBreakdownSlide data={data} />`). Maps the prop onto the loaded /
    /// empty content branch so the native surface renders the identical slide.
    public convenience init(data: ChargingBreakdownSlideData) {
        self.init(previewState: ChargingBreakdownSlideModel.loadState(data: data, loading: false))
    }

    /// Pure web-prop → load-state mapping (unit-tested): a `loading` prop keeps any
    /// resolved recap as cache; otherwise an empty recap becomes the friendly empty
    /// state and a populated recap the content slide. `nonisolated` because it
    /// touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        data: ChargingBreakdownSlideData,
        loading: Bool
    ) -> ChargingBreakdownSlideLoadState<ChargingBreakdownSlideData> {
        if loading { return .loading(cached: data.isEmpty ? nil : data, stale: false) }
        return data.isEmpty ? .empty(stale: false) : .loaded(data, stale: false)
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

    /// Forces a refresh; any cached recap stays visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no view
/// holds a hardcoded literal. Keys live in the per-surface "ChargingBreakdownSlide"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time
/// (kept separate so parallel surface prompts never collide on the shared catalog).
/// The SwiftUI `text(_:_:)` helper lives in `ChargingBreakdownSlide.Components.swift`
/// so this facade stays Foundation-only for the adapter + accessibility seams.
public enum ChargingBreakdownSlideStrings {
    public static let table = "ChargingBreakdownSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a templated string and substitutes `{{name}}` tokens, matching
    /// the web i18next `t(key, { name, defaultValue })` interpolation signature.
    public static func format(_ key: String, _ fallback: String, _ values: [String: String]) -> String {
        var resolved = string(key, fallback)
        for (name, value) in values {
            resolved = resolved.replacingOccurrences(of: "{{\(name)}}", with: value)
        }
        return resolved
    }
}
