//
//  SavingsSlide.Model.swift
//  TeslaSync — P4 feature view · 0065 · SavingsSlide (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `SavingsSlideSource` the view binds
//  through), the cache-then-network load state + error taxonomy, the observable
//  view-model, the P1/S10 i18n facade, and the testable accessibility summary.
//  No SwiftUI view code and no direct networking live here.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError`
/// shape so the production binding is a 1:1 map (offline keeps cached savings;
/// decode is non-retryable; network/api are retryable).
public enum SavingsSlideError: Equatable, Sendable {
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
public enum SavingsSlideLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(SavingsSlideError, cached: Value?, stale: Bool)
}

extension SavingsSlideLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the year-review feed, projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemorySavingsSlideSource`.
@MainActor
public protocol SavingsSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SavingsSlideLoadState<YearReviewSavings>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemorySavingsSlideSource: SavingsSlideSource {
    public var onUpdate: (@MainActor (SavingsSlideLoadState<YearReviewSavings>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SavingsSlideLoadState<YearReviewSavings>?

    public init(initial: SavingsSlideLoadState<YearReviewSavings>? = nil) {
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
    public func push(_ state: SavingsSlideLoadState<YearReviewSavings>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a `SavingsSlideSource` and
/// republishes its load state for SwiftUI to switch over. The view performs no
/// networking; `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class SavingsSlideModel {
    /// The current cache-then-network state for the year-review savings.
    public private(set) var state: SavingsSlideLoadState<YearReviewSavings> = .idle

    @ObservationIgnored private let source: any SavingsSlideSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared year-review feed.
    public init(source: any SavingsSlideSource) {
        self.source = source
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: SavingsSlideLoadState<YearReviewSavings>) {
        let inMemory = InMemorySavingsSlideSource(initial: previewState)
        source = inMemory
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component receives `data: YearReview`. Maps
    /// that prop onto the cache-then-network load state so the native surface
    /// renders the identical content composition (the web slide is only mounted
    /// once `data` resolves, so the default is `.loaded`).
    public convenience init(data: YearReviewSavings, loading: Bool = false) {
        self.init(previewState: SavingsSlideModel.loadState(data: data, loading: loading))
    }

    /// Pure web-prop → load-state mapping (unit-tested): `loading` keeps the value
    /// as cache behind a spinner; otherwise it is the loaded slide. `nonisolated`
    /// because it touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        data: YearReviewSavings,
        loading: Bool
    ) -> SavingsSlideLoadState<YearReviewSavings> {
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

    /// Forces a refresh; any cached savings stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// view holds a hardcoded literal. Keys live in the per-surface "SavingsSlide"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time
/// (kept separate so parallel surface prompts never collide on the shared catalog).
public enum SavingsSlideStrings {
    public static let table = "SavingsSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility (testable seam)

/// Builds the VoiceOver label spoken for the slide. Pure + public so the a11y
/// content can be unit-tested without rendering the view.
public enum SavingsSlideAccessibility {
    public static func summary(for projection: SavingsSlideProjection) -> String {
        let saved = SavingsSlideStrings.string("yearReview.youSaved", "You saved")
        let vsGas = SavingsSlideStrings.string("yearReview.vsGas", "vs. driving a gas car")
        let gas = SavingsSlideStrings.string("yearReview.gasCost", "Gas would cost")
        let electric = SavingsSlideStrings.string("yearReview.electricCost", "Electric cost")
        return [
            "\(saved) \(projection.savingsText) \(vsGas).",
            "\(gas) \(projection.gasCostText), \(electric) \(projection.electricCostText).",
            projection.coffeeNote
        ].joined(separator: " ")
    }
}
