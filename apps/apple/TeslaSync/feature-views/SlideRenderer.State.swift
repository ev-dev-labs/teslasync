//
//  SlideRenderer.State.swift
//  TeslaSync — P4 feature view · 0066 · SlideRenderer (Apple)
//
//  State-holder seam (P1/S8): load/connection status, coalesced update, the source protocol, the @Observable model, the
//  parent-injected render context, and the in-memory source. SwiftUI-free; split from SlideRenderer.Model.swift for
//  file-length hygiene.
//

import Foundation
import Observation
import OSLog

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the recap, mirroring the shared `LoadableState` cases the production source
/// projects from the `Resource<YearReview>` feeding the story shell (web `isLoading` / `isError` /
/// data present).
public enum SlideRendererLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Freshness of the underlying query, mirroring `LiveConnectionState` (ADR-013) and the
/// `DataFreshness` chip / `isStale` flag the web story shell renders. The renderer keeps the cached
/// recap visible and surfaces a stale/offline chip, never blanking — the P4 `stale` / `offline`
/// states.
public enum SlideRendererConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `SlideRendererSource`: the slide deck + the selected index + the
/// cached recap + display locale + the load/connection status. The model turns the selected slide +
/// recap into a `SlideProjection`. `localeIdentifier` mirrors the web global locale that the number
/// formatters read.
public struct SlideRendererUpdate: Sendable, Equatable {
    public var status: SlideRendererLoadStatus
    public var connection: SlideRendererConnection
    public var isFetching: Bool
    public var slides: [SlideDefinitionInput]
    public var index: Int
    public var data: YearReviewRecap?
    public var localeIdentifier: String
    public var updatedAt: Date?

    public init(
        status: SlideRendererLoadStatus = .loading,
        connection: SlideRendererConnection = .live,
        isFetching: Bool = false,
        slides: [SlideDefinitionInput] = [],
        index: Int = 0,
        data: YearReviewRecap? = nil,
        localeIdentifier: String = "en_US",
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.isFetching = isFetching
        self.slides = slides
        self.index = index
        self.data = data
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state
/// holders (the `AnalyticsStore.yearReview` resource + the story-shell slide index + `SettingsStore`
/// locale); previews and tests use `InMemorySlideRendererSource`. The view never talks to the network
/// directly. `select(index:)` mirrors the web parent advancing the deck (which re-keys
/// `AnimatePresence`).
@MainActor
public protocol SlideRendererSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (SlideRendererUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
    func select(index: Int)
}

public extension SlideRendererSource {
    /// Default no-op so sources that do not drive the deck index (static previews) need not implement
    /// it; the model still clamps + re-projects locally.
    func select(index _: Int) {}
}

/// The surface's observable view-model. Subscribes to a `SlideRendererSource`, tracks the slide deck +
/// selected index, recomputes the current `SlideProjection` via `SlideRendererProjector`, and exposes
/// a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class SlideRendererModel {
    /// The mutually-exclusive render branches (web story shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: SlideRendererConnection = .live
    public private(set) var isFetching = false
    public private(set) var slides: [SlideDefinitionInput] = []
    public private(set) var index = 0
    public private(set) var recap: YearReviewRecap?
    public private(set) var projection: SlideProjection?
    public private(set) var localeIdentifier = "en_US"
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any SlideRendererSource
    @ObservationIgnored private let telemetry: any SlideRendererTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any SlideRendererSource,
        telemetry: any SlideRendererTelemetry = OSLogSlideRendererTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The currently-selected slide definition, if the deck is non-empty and the index is in range.
    public var currentSlide: SlideDefinitionInput? {
        guard slides.indices.contains(index) else { return nil }
        return slides[index]
    }

    /// The render context for the current slide — the value passed to the parent-injected slide body
    /// builder. `nil` until a slide + recap + projection are all resolved (i.e. the `.content` phase).
    public var currentContext: SlideRenderContext? {
        guard let slide = currentSlide, let recap, let projection else { return nil }
        return SlideRenderContext(
            index: index,
            slide: slide,
            recap: recap,
            projection: projection,
            connection: connection
        )
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        SlideRendererSurface.reportOpen(to: telemetry)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached recap stays visible). Wired to the retry / refresh affordances
    /// (web `refetch`) and to the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    /// Advances the deck to `index` — the native parity of the web parent re-keying `AnimatePresence`.
    /// Clamps + re-projects locally for an immediate, animatable change, then forwards to the source so
    /// the shared story-shell index stays in sync.
    public func select(index newIndex: Int) {
        let clamped = clamp(newIndex)
        if clamped != index {
            index = clamped
            reproject()
        }
        source.select(index: clamped)
    }

    /// Auto-refreshes when the recap has gone stale but is not already being fetched — the native
    /// parity of the web story shell's self-refresh on `isStale` queries.
    public func autoRefreshIfStale() {
        guard connection == .stale, !isFetching else { return }
        source.refresh()
    }

    private func apply(_ update: SlideRendererUpdate) {
        connection = update.connection
        isFetching = update.isFetching
        localeIdentifier = update.localeIdentifier
        updatedAt = update.updatedAt
        slides = update.slides
        recap = update.data
        index = clamp(update.index)
        reproject()
        phase = Self.resolvePhase(status: update.status, hasData: update.data != nil)
    }

    /// Recomputes the current slide's projection from the selected definition + recap + locale.
    private func reproject() {
        guard let slide = currentSlide, let recap else {
            projection = nil
            return
        }
        projection = SlideRendererProjector.project(
            slide: slide,
            recap: recap,
            index: index,
            localeIdentifier: localeIdentifier,
            localize: SlideRendererStrings.string
        )
    }

    /// Clamps a requested index into the current deck's bounds (empty deck → 0).
    private func clamp(_ requested: Int) -> Int {
        guard !slides.isEmpty else { return 0 }
        return min(max(requested, 0), slides.count - 1)
    }

    /// Resolves the render phase. Mirroring the web story shell + slide body: the skeleton shows only
    /// on the initial fetch and the empty state when there is no recap; whenever the recap is known the
    /// deck renders (cached values stay visible behind refresh / transient failures so an offline or
    /// stale pod still shows the last-known recap).
    ///
    /// `nonisolated` because it is pure (touches no actor state); this lets the phase logic be
    /// unit-tested from a non-isolated context under Swift 6 strict concurrency.
    public nonisolated static func resolvePhase(status: SlideRendererLoadStatus, hasData: Bool) -> Phase {
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

// MARK: - Render context (the parent-injected slide-body seam)

/// The value handed to the parent-supplied slide renderer for one slide — the native port of what the
/// web `SlideRenderer` arm forwards to a child slide component (`data`, and for `drive-highlight` the
/// resolved drive + label + emoji). The production app's builder maps this to the real child surface
/// (TitleSlide / StatHeroSlide / …, each its own P4 prompt); the renderer's built-in
/// `SlideDispatchContent` maps it to the composed default body. The `projection` carries the
/// renderer-computed gradient + default hero + VoiceOver summary so a custom body can reuse them.
public struct SlideRenderContext: Equatable, Sendable, Identifiable {
    public let index: Int
    public let slide: SlideDefinitionInput
    public let recap: YearReviewRecap
    public let projection: SlideProjection
    public let connection: SlideRendererConnection

    /// Stable identity for the keyed transition (web `AnimatePresence` `key={slideIndex}`).
    public var id: Int {
        index
    }

    /// The slide's dispatch kind (web `slide.type`).
    public var kind: SlideKind {
        slide.kind
    }

    public init(
        index: Int,
        slide: SlideDefinitionInput,
        recap: YearReviewRecap,
        projection: SlideProjection,
        connection: SlideRendererConnection
    ) {
        self.index = index
        self.slide = slide
        self.recap = recap
        self.projection = projection
        self.connection = connection
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`; records the start/stop/
/// refresh/select call counts so the model's delegation can be asserted.
@MainActor
public final class InMemorySlideRendererSource: SlideRendererSource {
    public var onUpdate: (@MainActor (SlideRendererUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0
    public private(set) var selectedIndices: [Int] = []

    private let initial: SlideRendererUpdate?

    public init(initial: SlideRendererUpdate? = nil) {
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

    public func select(index: Int) {
        selectedIndices.append(index)
    }

    /// Pushes a snapshot to the bound model (test/preview affordance).
    public func push(_ update: SlideRendererUpdate) {
        onUpdate?(update)
    }
}
