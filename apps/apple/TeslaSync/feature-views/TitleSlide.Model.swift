//
//  TitleSlide.Model.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11 diagnostics) + surface identity +
//  i18n facade (P1/S10). Vendor-agnostic and SwiftUI-free so the projection/model logic
//  compiles and runs on a plain host (the surface view layers SwiftUI chrome on top in
//  TitleSlide.swift). The view binds through `TitleSlideModel`; no networking lives in the
//  view.
//
//  Parity target: features/analytics/components/review/TitleSlide.tsx — the opening slide of
//  the analytics "Year in Review" story. The web component is presentational (it receives the
//  resolved `YearReview` and only reads `data.year` + `data.vehicle.display_name`); the load /
//  empty / error / stale / offline chrome that the parent story shell owns on the web is
//  reproduced here on the slide's own state-holder so the native surface renders every state.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default implementation
/// logs via `os.Logger`; the production app injects an adapter that forwards to the shared core
/// `Telemetry.track(.viewOpened(surface:…))`, which is consent-gated and redacted there.
public protocol TitleSlideTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event.
public struct OSLogTitleSlideTelemetry: TitleSlideTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the slide's recap data, mirroring the shared `LoadableState` cases the
/// production source projects from the `Resource<YearReview>` feeding the story shell (web
/// `isLoading` / `isError` / data present).
public enum TitleSlideLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the
/// `DataFreshness` chip / `isStale` flag the web story shell renders.
public enum TitleSlideConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The cached inputs this surface consumes — the exact subset of the web `YearReview` DTO the
/// TitleSlide reads (`data.year` + `data.vehicle.display_name`). Everything else on the recap is
/// owned by the other slide surfaces, so it is intentionally not modeled here.
public struct TitleSlideDTO: Sendable, Equatable {
    public var year: Int
    public var vehicleDisplayName: String

    public init(year: Int, vehicleDisplayName: String) {
        self.year = year
        self.vehicleDisplayName = vehicleDisplayName
    }
}

/// One coalesced snapshot pushed by a `TitleSlideSource`: the cached DTO + display locale + the
/// load/connection status. The model turns this into the projection. `localeIdentifier` mirrors
/// the web global locale (`getGlobalLocale()` set by `useSettings`) that `fmtNumber` reads when it
/// formats the year.
public struct TitleSlideUpdate: Sendable, Equatable {
    public var status: TitleSlideLoadStatus
    public var connection: TitleSlideConnection
    public var isFetching: Bool
    public var data: TitleSlideDTO?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: TitleSlideLoadStatus = .loading,
        connection: TitleSlideConnection = .live,
        isFetching: Bool = false,
        data: TitleSlideDTO? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.data = data
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `AnalyticsStore.yearReview` resource + `SettingsStore` locale); previews and tests
/// use `InMemoryTitleSlideSource`. The view never talks to the network directly.
@MainActor
public protocol TitleSlideSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TitleSlideUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The surface's observable view-model. Subscribes to a `TitleSlideSource`, recomputes the
/// `TitleSlideProjection` via `TitleSlideProjector`, and exposes a render `Phase` + freshness for
/// SwiftUI to switch over.
@MainActor
@Observable
public final class TitleSlideModel {
    /// The mutually-exclusive render branches (web story shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TitleSlideConnection = .live
    public private(set) var isFetching = false
    public private(set) var projection: TitleSlideProjection?
    public private(set) var localeIdentifier = "en_US"
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TitleSlideSource
    @ObservationIgnored private let telemetry: any TitleSlideTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TitleSlideSource,
        telemetry: any TitleSlideTelemetry = OSLogTitleSlideTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TitleSlideSurface.slug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances (web `refetch`) and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Auto-refreshes when the data has gone stale but is not already being fetched — the native
    /// parity of the web story shell's self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: TitleSlideUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        localeIdentifier = update.localeIdentifier
        updatedAt = update.updatedAt
        projection = update.data.map { dto in
            TitleSlideProjector.project(data: dto, localeIdentifier: update.localeIdentifier)
        }
        phase = Self.resolvePhase(status: update.status, hasData: update.data != nil)
    }

    /// Resolves the render phase. Mirroring the web story shell + slide body: the skeleton shows
    /// only on the initial fetch and the empty state when there is no recap; whenever data is known
    /// the slide renders (cached values stay visible behind refresh / transient failures so an
    /// offline or stale pod still shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: TitleSlideLoadStatus, hasData: Bool) -> Phase {
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
public final class InMemoryTitleSlideSource: TitleSlideSource {
    public var onUpdate: (@MainActor (TitleSlideUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TitleSlideUpdate?

    public init(initial: TitleSlideUpdate? = nil) {
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
    public func push(_ update: TitleSlideUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Surface identity (P1/S11) — kept SwiftUI-free

/// Diagnostics slug for this surface, kept out of the SwiftUI view so the model/adapter compile and
/// test without SwiftUI. `TitleSlide` re-exposes this as `surfaceSlug` for API parity with the
/// other surfaces.
public enum TitleSlideSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "TitleSlide"
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view holds no
/// hardcoded literals. Keys live in the "TitleSlide" table, folded into the app
/// `Localizable.xcstrings` catalog at integration time. `string` is Foundation-only so the
/// adapter's accessibility summary can use it; the SwiftUI `text(_:_:)` helper lives in the view file.
public enum TitleSlideStrings {
    public static let table = "TitleSlide"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
