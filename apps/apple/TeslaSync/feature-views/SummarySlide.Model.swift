//
//  SummarySlide.Model.swift
//  TeslaSync — P4 feature view · 0069 · SummarySlide (Apple)
//
//  The P1/S8 state-holder seam (a Shared-free `YearReviewSource` the view binds
//  through), the cache-then-network load state + error taxonomy, the observable
//  view-model (carrying the `useUnits` distance preference), and the P1/S10 i18n
//  facade. No SwiftUI view code and no direct networking live here.
//

import Foundation
import Observation
import SwiftUI

// MARK: - Error taxonomy (mirrors the shared `FacadeError` cases the source maps)

/// The failure modes the source surfaces, mirroring the shared `FacadeError` shape
/// so the production binding is a 1:1 map (offline keeps the cached review; decode
/// is non-retryable; network/api are retryable → web `QueryError` retry).
public enum SummarySlideError: Equatable, Sendable {
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
/// last cached review to keep on screen behind a refresh/error and the ADR-013
/// `stale` flag. Mirrors the facade `LoadableState` without importing `Shared`, so
/// the surface host-compiles and every branch is unit-testable.
public enum SummarySlideLoadState<Value> {
    case idle
    case loading(cached: Value?, stale: Bool)
    case loaded(Value, stale: Bool)
    case empty(stale: Bool)
    case failed(SummarySlideError, cached: Value?, stale: Bool)
}

extension SummarySlideLoadState: Equatable where Value: Equatable {}

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the year-in-review feed, projected via
/// `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryYearReviewSource`.
@MainActor
public protocol YearReviewSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SummarySlideLoadState<YearReviewSummary>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryYearReviewSource: YearReviewSource {
    public var onUpdate: (@MainActor (SummarySlideLoadState<YearReviewSummary>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: SummarySlideLoadState<YearReviewSummary>?

    public init(initial: SummarySlideLoadState<YearReviewSummary>? = nil) {
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
    public func push(_ state: SummarySlideLoadState<YearReviewSummary>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a `YearReviewSource` and
/// republishes its load state for SwiftUI to switch over. `distanceUnit` mirrors
/// the web `useUnits().unitPrefs.distance` the slide reads; the production app
/// feeds it from the shared units state-holder. The view performs no networking;
/// `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class SummarySlideModel {
    /// The current cache-then-network state for the year-in-review feed.
    public private(set) var state: SummarySlideLoadState<YearReviewSummary> = .idle

    /// The display distance unit (web `useUnits().unitPrefs.distance`).
    public var distanceUnit: DistanceDisplayUnit

    @ObservationIgnored private let source: any YearReviewSource
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared year-in-review feed.
    public init(source: any YearReviewSource, distanceUnit: DistanceDisplayUnit = .kilometers) {
        self.source = source
        self.distanceUnit = distanceUnit
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(
        previewState: SummarySlideLoadState<YearReviewSummary>,
        distanceUnit: DistanceDisplayUnit = .kilometers
    ) {
        let inMemory = InMemoryYearReviewSource(initial: previewState)
        source = inMemory
        self.distanceUnit = distanceUnit
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the web source renders from a present `data: YearReview`
    /// (the parent page only mounts slides once the review has loaded). Maps the
    /// prop onto the load state so the native surface renders the identical card —
    /// or the friendly empty state for a zero-activity review.
    public convenience init(
        data: YearReviewSummary,
        loading: Bool = false,
        distanceUnit: DistanceDisplayUnit = .kilometers
    ) {
        self.init(
            previewState: SummarySlideModel.loadState(data: data, loading: loading),
            distanceUnit: distanceUnit
        )
    }

    /// Pure web-prop → load-state mapping (unit-tested): `loading` keeps the review
    /// as cache; otherwise a zero-activity review becomes the empty state and a
    /// populated one the loaded card. `nonisolated` because it touches no actor
    /// state — callable off the main actor.
    public nonisolated static func loadState(
        data: YearReviewSummary,
        loading: Bool
    ) -> SummarySlideLoadState<YearReviewSummary> {
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

    /// Forces a refresh; any cached review stays visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no view
/// holds a hardcoded literal. Keys live in the per-surface "SummarySlide" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time (kept
/// separate so parallel surface prompts never collide on the shared catalog).
public enum SummarySlideStrings {
    public static let table = "SummarySlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
