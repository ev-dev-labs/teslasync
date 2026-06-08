//
//  HttpStatusTool.Model.swift
//  TeslaSync — P4 feature view · 0016 · HttpStatusTool (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + the SwiftUI half of
//  the P1/S10 i18n facade. The view binds through `HttpStatusModel`; no
//  networking lives in the view. The web tool sources its rows from the
//  `HTTP_CODES` module constant, so the production-equivalent source
//  (`StaticHttpStatusSource`) emits the canonical catalog immediately; the seam
//  still models loading / empty / error / freshness so every state renders and
//  is testable.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for a
/// surface. The default implementation logs via `os.Logger`; the production app
/// injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is consent-gated
/// and redacted there.
public protocol HttpStatusTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogHttpStatusTelemetry: HttpStatusTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the surface's data, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum HttpStatusLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (the web `DataFreshness` indicator). A static catalog is
/// always `.live`; the seam still models stale/offline so cached-content states
/// render and are testable.
public enum HttpStatusConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `HttpStatusSource`: the cached catalog
/// plus its load/connection status. The model turns this into the projection.
public struct HttpStatusUpdate: Sendable, Equatable {
    public var status: HttpStatusLoadStatus
    public var connection: HttpStatusConnection
    public var codes: [HttpStatusCode]?
    public var updatedAt: Date?

    public init(
        status: HttpStatusLoadStatus = .loading,
        connection: HttpStatusConnection = .live,
        codes: [HttpStatusCode]? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.codes = codes
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holder; the canonical implementation simply serves the
/// `HttpStatusCatalog` (the web module constant). Previews and tests use
/// `InMemoryHttpStatusSource`. The view never talks to the network directly.
@MainActor
public protocol HttpStatusSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (HttpStatusUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The production-equivalent source: emits the canonical `HttpStatusCatalog`
/// rows immediately on `start`/`refresh`, mirroring the web component reading the
/// `HTTP_CODES` module constant synchronously.
@MainActor
public final class StaticHttpStatusSource: HttpStatusSource {
    public var onUpdate: (@MainActor (HttpStatusUpdate) -> Void)?
    private let codes: [HttpStatusCode]

    public init(codes: [HttpStatusCode] = HttpStatusCatalog.codes) {
        self.codes = codes
    }

    public func start() {
        emit()
    }

    public func stop() {}

    public func refresh() {
        emit()
    }

    private func emit() {
        onUpdate?(
            HttpStatusUpdate(
                status: codes.isEmpty ? .empty : .loaded,
                connection: .live,
                codes: codes,
                updatedAt: Date()
            )
        )
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryHttpStatusSource: HttpStatusSource {
    public var onUpdate: (@MainActor (HttpStatusUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: HttpStatusUpdate?

    public init(initial: HttpStatusUpdate? = nil) {
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
    public func push(_ update: HttpStatusUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Model

/// The surface's observable view-model. Holds the cached catalog (from an
/// `HttpStatusSource`) plus the local UI state the web component owns (`search`,
/// the sortable `code` column, the current page), and recomputes the
/// `HttpStatusProjection` whenever any of them change. The view switches over
/// `phase` and reads `projection`.
@MainActor
@Observable
public final class HttpStatusModel {
    /// The mutually-exclusive render branches (web shell loading / error / shown
    /// / catalog-empty). A non-matching *search* is not a phase — it is the
    /// in-table empty inside `.content` (web `DataTable` empty body).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: HttpStatusConnection = .live
    public private(set) var updatedAt: Date?
    public private(set) var projection = HttpStatusProjection()

    /// The web `search` state. Setting it resets to the first page and recomputes
    /// the projection (web `filtered` + page reset on filter change).
    public var search: String = "" {
        didSet {
            guard search != oldValue else { return }
            page = 1
            recompute()
        }
    }

    public private(set) var sort: HttpStatusSort = .unsorted
    public private(set) var page = 1

    @ObservationIgnored private var codes: [HttpStatusCode] = []
    @ObservationIgnored private var status: HttpStatusLoadStatus = .loading
    @ObservationIgnored private let source: any HttpStatusSource
    @ObservationIgnored private let telemetry: any HttpStatusTelemetry
    @ObservationIgnored private let pageSize: Int
    @ObservationIgnored private var started = false

    public init(
        source: any HttpStatusSource,
        telemetry: any HttpStatusTelemetry = OSLogHttpStatusTelemetry(),
        pageSize: Int = HttpStatusProjector.defaultPageSize
    ) {
        self.source = source
        self.telemetry = telemetry
        self.pageSize = pageSize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: HttpStatusTool.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached rows stay visible). Wired to the retry / refresh
    /// affordances.
    public func refresh() {
        source.refresh()
    }

    /// Activates the sortable `code` header (web `onSort`): cycles the tri-state
    /// and resets to the first page.
    public func toggleSort() {
        sort = sort.next
        page = 1
        recompute()
    }

    /// Moves to a 1-based page, clamped into range (web `Pagination` onPageChange).
    public func goToPage(_ target: Int) {
        let clamped = min(max(1, target), projection.pageCount)
        guard clamped != page else { return }
        page = clamped
        recompute()
    }

    public func nextPage() {
        goToPage(page + 1)
    }

    public func previousPage() {
        goToPage(page - 1)
    }

    private func apply(_ update: HttpStatusUpdate) {
        status = update.status
        connection = update.connection
        updatedAt = update.updatedAt
        if let codes = update.codes { self.codes = codes }
        recompute()
    }

    private func recompute() {
        projection = HttpStatusProjector.project(
            codes: codes,
            query: search,
            sort: sort,
            page: page,
            pageSize: pageSize
        )
        phase = Self.resolvePhase(status: status, hasCatalog: !codes.isEmpty)
    }

    /// Resolves the render phase. The shell shows the skeleton only on the initial
    /// fetch, the empty state when the catalog itself has no rows, and keeps
    /// cached rows visible behind a background refresh/error (the freshness chip
    /// conveys stale/offline). A hard failure with no cached rows surfaces the
    /// error state with a retry.
    static func resolvePhase(status: HttpStatusLoadStatus, hasCatalog: Bool) -> Phase {
        switch status {
        case .loading:
            hasCatalog ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasCatalog ? .content : .empty
        case let .failed(message):
            hasCatalog ? .content : .error(message)
        }
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension HttpStatusStrings {
    /// `Text` convenience for the view layer (the Foundation `string`/`count`
    /// resolvers live in `HttpStatusTool.Projection.swift`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
