//
//  TimeToChargeSection.Model.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  The P1/S8 state-holder seam (a shared-framework-free `TimeToChargeSource` the
//  view binds through), the observable view-model, and the P1/S10 i18n facade for
//  the time-to-charge analysis section. The view binds through
//  `TimeToChargeModel`; no networking lives in the view. The web source is fed its
//  `sessions` by the parent ChargingCurve page, so the production binding projects
//  that feed (the charging-sessions query, via `StateHolderModel<LoadableState<…>>`)
//  into the cache-then-network load state, while previews/tests drive an
//  in-memory source. Telemetry reuses the shared P1/S11 widget sink so the surface
//  emits exactly one PII-free `view.opened` event with its slug.
//

import Foundation
import Observation

// MARK: - Source seam (P1/S8) — the view never touches HTTP

/// The seam the model binds through. The production app implements this over the
/// shared P1/S8 state holders (the charging-sessions feed the web page passes as
/// `sessions`); previews and tests use `InMemoryTimeToChargeSource`.
@MainActor
public protocol TimeToChargeSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TimeToChargeLoadState<[ChargingSessionSummary]>) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryTimeToChargeSource: TimeToChargeSource {
    public var onUpdate: (@MainActor (TimeToChargeLoadState<[ChargingSessionSummary]>) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TimeToChargeLoadState<[ChargingSessionSummary]>?

    public init(initial: TimeToChargeLoadState<[ChargingSessionSummary]>? = nil) {
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
    public func push(_ state: TimeToChargeLoadState<[ChargingSessionSummary]>) {
        onUpdate?(state)
    }
}

// MARK: - View model (P1/S8 binding)

/// The surface's observable view-model. Subscribes to a `TimeToChargeSource` and
/// republishes its load state for SwiftUI to switch over. The view performs no
/// networking; `start`/`stop`/`refresh` delegate to the source.
@MainActor
@Observable
public final class TimeToChargeModel {
    /// The current cache-then-network state for the charging-sessions feed.
    public private(set) var state: TimeToChargeLoadState<[ChargingSessionSummary]> = .idle

    @ObservationIgnored private let source: any TimeToChargeSource
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored private var started = false

    /// Live binding: observe the shared charging-sessions feed.
    public init(source: any TimeToChargeSource, locale: Locale = .current) {
        self.source = source
        self.locale = locale
        source.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Preview / test binding: render a fixed state without the shared core.
    public init(previewState: TimeToChargeLoadState<[ChargingSessionSummary]>, locale: Locale = .current) {
        let inMemory = InMemoryTimeToChargeSource(initial: previewState)
        source = inMemory
        self.locale = locale
        state = previewState
        inMemory.onUpdate = { [weak self] state in self?.state = state }
    }

    /// Web-prop binding: the source component renders from `sessions` + `loading`.
    /// Maps the two web props onto the cache-then-network load state so the native
    /// surface renders the identical loading / empty / content branches.
    public convenience init(
        sessions: [ChargingSessionSummary],
        loading: Bool,
        locale: Locale = .current
    ) {
        self.init(previewState: TimeToChargeModel.loadState(sessions: sessions, loading: loading), locale: locale)
    }

    /// The locale the projection formats numbers with.
    public var resolvedLocale: Locale {
        locale
    }

    /// The render-ready presentation for the current state (P1/S9 + P1/S10 applied
    /// in the view); pure projection over the load state.
    public var presentation: TimeToChargePresentation {
        TimeToChargePresentation.resolve(state: state, locale: locale)
    }

    /// Pure web-prop → load-state mapping (unit-tested): `loading` keeps any
    /// sessions as cache (web shows the prior cards while refetching); otherwise
    /// an empty set becomes the empty state and a present set the content.
    /// `nonisolated` because it touches no actor state — callable off the main actor.
    public nonisolated static func loadState(
        sessions: [ChargingSessionSummary],
        loading: Bool
    ) -> TimeToChargeLoadState<[ChargingSessionSummary]> {
        if loading { return .loading(cached: sessions.isEmpty ? nil : sessions, stale: false) }
        return sessions.isEmpty ? .empty(stale: false) : .loaded(sessions, stale: false)
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

    /// Forces a refresh; any cached sessions stay visible (web `refetch`).
    public func refresh() {
        source.refresh()
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so no
/// view holds a hardcoded literal. Keys live in the per-surface
/// "TimeToChargeSection" table, folded into the app `Localizable.xcstrings`
/// catalog at integration time (kept separate so parallel surface prompts never
/// collide on the shared catalog).
public enum TimeToChargeStrings {
    public static let table = "TimeToChargeSection"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves a card subtitle, formatting the `Session #{{id}}` interpolation
    /// (web `t('charging.curve.sessionId', { id })`) when an id is present.
    public static func cardSubtitle(_ card: TimeToChargeCardModel) -> String? {
        guard let key = card.subtitleKey, let fallback = card.subtitleFallback else { return nil }
        if let sessionID = card.subtitleSessionID {
            return String(format: string(key, fallback), sessionID)
        }
        return string(key, fallback)
    }
}
