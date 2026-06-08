//
//  StatChartSlide.Model.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `StatChartSlideSource` the view binds
//  through), the cache-then-network load state + error taxonomy, the input DTO that
//  mirrors the subset of the web `YearReview` this slide reads, the observable
//  view-model, and the P1/S10 i18n facade. No SwiftUI view code and no direct
//  networking live here, so every branch host-compiles + unit-tests on a plain host.
//
//  Parity target: features/analytics/components/review/StatChartSlide.tsx — the
//  web slide takes a resolved `data: YearReview` prop; the parent story owns the
//  query. The P4 surface contract additionally requires the loading / empty / error
//  / stale / offline chrome, so the model carries the full cache-then-network state
//  while the web-prop init maps `<StatChartSlide data />` onto its content branch.
//

import Foundation
import Observation

// MARK: - Input DTO (the web `YearReview` subset this slide reads)

/// One month's drive tally — the subset of the web `YearReviewMonthStat` the slide
/// charts (`month` is 1-based as the API delivers it; `drives` is the bar value).
public struct StatChartSlideMonthStat: Equatable, Sendable {
    public let month: Int
    public let drives: Int

    public init(month: Int, drives: Int) {
        self.month = month
        self.drives = drives
    }
}

/// The cached year-in-review inputs this slide consumes, mirroring the exact subset
/// of the web `YearReview` DTO `StatChartSlide` reads: `total_drives`,
/// `avg_drives_per_week`, and `monthly_stats`. Kept surface-local (not shared with
/// the dashboard `YearReviewWidget`) so the slide compiles + tests in isolation and
/// parallel surface prompts never collide on a shared type.
public struct StatChartSlideData: Equatable, Sendable {
    public let totalDrives: Int
    public let avgDrivesPerWeek: Double
    public let monthlyStats: [StatChartSlideMonthStat]

    public init(
        totalDrives: Int = 0,
        avgDrivesPerWeek: Double = 0,
        monthlyStats: [StatChartSlideMonthStat] = []
    ) {
        self.totalDrives = totalDrives
        self.avgDrivesPerWeek = avgDrivesPerWeek
        self.monthlyStats = monthlyStats
    }

    /// Whether the recap holds no drives at all — there were no trips this year, so
    /// the slide shows the friendly empty state instead of an all-zero chart.
    public var isEmpty: Bool {
        totalDrives == 0 && monthlyStats.allSatisfy { $0.drives == 0 }
    }
}

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError` shape
/// so the production binding is a 1:1 map (offline keeps the cached recap; decode is
/// non-retryable; network / api are retryable).
public enum StatChartSlideError: Equatable, Sendable {
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
public enum StatChartSlideLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(StatChartSlideError, cached: Value?, stale: Bool)
}

extension StatChartSlideLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the `AnalyticsStore.yearReview` query projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryStatChartSlideSource`.
@MainActor
public protocol StatChartSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (StatChartSlideLoadState<StatChartSlideData>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryStatChartSlideSource: StatChartSlideSource {
    public var onUpdate: (@MainActor (StatChartSlideLoadState<StatChartSlideData>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: StatChartSlideLoadState<StatChartSlideData>?

    public init(initial: StatChartSlideLoadState<StatChartSlideData>? = nil) {
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
    public func push(_ state: StatChartSlideLoadState<StatChartSlideData>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a `StatChartSlideSource` and
/// republishes its load state for SwiftUI to switch over. The view performs no
/// networking; `start` / `stop` / `refresh` delegate to the source.
@MainActor
@Observable
public final class StatChartSlideModel {
    /// The current cache-then-network state for the year-in-review recap.
    public private(set) var state: StatChartSlideLoadState<StatChartSlideData> = .idle

    @ObservationIgnored private let source: any StatChartSlideSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared year-in-review feed.
    public init(source: any StatChartSlideSource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: StatChartSlideLoadState<StatChartSlideData>) {
        let inMemory = InMemoryStatChartSlideSource(initial: previewState)
        source = inMemory
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component renders from a resolved `data` prop
    /// (`<StatChartSlide data={data} />`). Maps the prop onto the loaded / empty
    /// content branch so the native surface renders the identical slide.
    public convenience init(data: StatChartSlideData) {
        self.init(previewState: StatChartSlideModel.loadState(data: data, loading: false))
    }

    /// Pure web-prop → load-state mapping (unit-tested): a `loading` prop keeps any
    /// resolved recap as cache; otherwise an empty recap becomes the friendly empty
    /// state and a populated recap the content slide. `nonisolated` because it
    /// touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        data: StatChartSlideData,
        loading: Bool
    ) -> StatChartSlideLoadState<StatChartSlideData> {
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
/// holds a hardcoded literal. Keys live in the per-surface "StatChartSlide" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time (kept
/// separate so parallel surface prompts never collide on the shared catalog). The
/// SwiftUI `text(_:_:)` helper lives in `StatChartSlide.Components.swift` so this
/// facade stays Foundation-only for the adapter + accessibility seams.
public enum StatChartSlideStrings {
    public static let table = "StatChartSlide"

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
