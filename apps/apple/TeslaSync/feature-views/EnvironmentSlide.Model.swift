//
//  EnvironmentSlide.Model.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + surface registry + i18n facade
//  (P1/S10) for the Year-in-Review "environment" slide. Vendor-agnostic and SwiftUI-free so the
//  projection/model logic compiles and runs on a plain host (the surface view layers SwiftUI
//  chrome on top in EnvironmentSlide.swift / EnvironmentSlide.Views.swift).
//
//  Parity target: features/analytics/components/review/EnvironmentSlide.tsx. The web leaf is a
//  presentational slide fed `data: YearReview` by its parent (the Year-in-Review story). It reads a
//  single field — `co2_offset_kg` — and derives a planted-trees equivalent. The native surface binds
//  the same value through a state holder so it can additionally render the P4 load/connection states
//  (loading / empty / error / stale / offline) the shared story shell exposes around the slide.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default implementation logs
/// via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated and redacted there.
public protocol EnvironmentSlideTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogEnvironmentSlideTelemetry: EnvironmentSlideTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the slide's data, mirroring the shared `LoadableState` cases the production
/// source projects from `Resource<T>` (web `isLoading` / `isError` / data present).
public enum EnvironmentSlideLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the web
/// `DataFreshness` chip / `isStale` flag the story shell renders.
public enum EnvironmentSlideConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached subset of the web `YearReview` DTO this slide consumes. The web component reads exactly
/// one field — `data.co2_offset_kg` (kilograms of CO₂ offset for the recap year) — so the native DTO
/// carries the same single value. Kept SI-free of unit suffixes beyond the API's own `_kg`: the value
/// is delivered already in kilograms by `GET /analytics/year-review`, matching the web source.
public struct EnvironmentReviewDTO: Sendable, Equatable {
    public var co2OffsetKg: Double

    public init(co2OffsetKg: Double = 0) {
        self.co2OffsetKg = co2OffsetKg
    }
}

/// One coalesced snapshot pushed by an `EnvironmentSlideSource`: the cached DTO + the display locale
/// plus the load/connection status. The model turns this into the projection. The `localeIdentifier`
/// mirrors the locale `useTranslation()`/`Intl` resolve so the formatted CO₂ figure groups exactly as
/// the web `fmtNumber` does.
public struct EnvironmentSlideUpdate: Sendable, Equatable {
    public var status: EnvironmentSlideLoadStatus
    public var connection: EnvironmentSlideConnection
    public var isFetching: Bool
    public var stats: EnvironmentReviewDTO?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: EnvironmentSlideLoadStatus = .loading,
        connection: EnvironmentSlideConnection = .live,
        isFetching: Bool = false,
        stats: EnvironmentReviewDTO? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.stats = stats
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (`StateHolderModel<LoadableState<…>>` from the KMP `AnalyticsStore.yearReview` +
/// `SettingsStore` locale); previews and tests use `InMemoryEnvironmentSlideSource`. The view never
/// talks to the network directly.
@MainActor
public protocol EnvironmentSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (EnvironmentSlideUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The slide's observable view-model. Subscribes to an `EnvironmentSlideSource`, recomputes the
/// `EnvironmentSlideProjection` via `EnvironmentSlideProjector`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class EnvironmentSlideModel {
    /// The mutually-exclusive render branches. The web leaf only ever renders its single content
    /// body; the surrounding states (loading / empty / error) come from the story shell and are
    /// reproduced here so the slide owns every P4 state rather than assuming a happy path.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: EnvironmentSlideConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: EnvironmentSlideProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any EnvironmentSlideSource
    @ObservationIgnored private let telemetry: any EnvironmentSlideTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any EnvironmentSlideSource,
        telemetry: any EnvironmentSlideTelemetry = OSLogEnvironmentSlideTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: EnvironmentSlideSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry affordance (web
    /// `refetch`) and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web `DataFreshnessAuto` self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: EnvironmentSlideUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        updatedAt = update.updatedAt
        projection = update.stats.map {
            EnvironmentSlideProjector.project(stats: $0, localeIdentifier: update.localeIdentifier)
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.stats != nil)
    }

    /// Resolves the render phase. The skeleton shows only on the initial fetch and the empty state
    /// when there is no recap; whenever a DTO is known the slide renders (cached values stay visible
    /// behind refresh/transient failures so an offline or stale pod still shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(
        status: EnvironmentSlideLoadStatus,
        hasData: Bool
    ) -> Phase {
        switch status {
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        case let .failed(message):
            hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryEnvironmentSlideSource: EnvironmentSlideSource {
    public var onUpdate: (@MainActor (EnvironmentSlideUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: EnvironmentSlideUpdate?

    public init(initial: EnvironmentSlideUpdate? = nil) {
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
    public func push(_ update: EnvironmentSlideUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface metadata (diagnostics slug)

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `EnvironmentSlide` re-exposes it as `surfaceSlug` for API parity with the
/// other surfaces.
public enum EnvironmentSlideSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "EnvironmentSlide"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "EnvironmentSlide" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string`/`trees` are Foundation-only so the
/// adapter's accessibility summary can use them; the SwiftUI `text(_:_:)` helper lives in the view
/// file.
public enum EnvironmentSlideStrings {
    public static let table = "EnvironmentSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// Resolves the pluralized "Like planting {{count}} trees" caption and substitutes the i18next
    /// `{{count}}` interpolation token (also tolerating a single-brace `{count}`). The count is
    /// substituted raw — matching i18next's default interpolation, which does not group the number —
    /// while the headline CO₂ figure is grouped separately via `EnvironmentSlideFormat`.
    public static func trees(_ count: Int) -> String {
        let template = string("yearReview.treesEquiv", "Like planting {{count}} trees")
        let value = String(count)
        return template
            .replacingOccurrences(of: "{{count}}", with: value)
            .replacingOccurrences(of: "{count}", with: value)
    }
}
