//
//  XRayHeader.Model.swift
//  TeslaSync — P4 feature view · 0035 · XRayHeader (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) for
//  the Ingest X-Ray header strip. The view binds through `XRayHeaderModel`; no
//  networking lives in the view. The model holds the cached summary + the
//  operator-selected window + freshness and exposes a render `Phase` for SwiftUI
//  to switch over; the view derives the three stat tiles via the pure adapter.
//
//  The seam mirrors the shared facade vocabulary — `LoadableState`
//  (loading/loaded/empty/failed, cached-stays-visible) and `LiveConnectionState`
//  (open/stale/closed) — without importing `Shared`, so the surface compiles and
//  unit-tests standalone. The production app wires the real `StateHolderModel`
//  (the admin ingest-xray store + the SSE freshness) into the `Source`.
//

import Foundation
import Observation
import OSLog

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// logs via `os.Logger`; the production app injects an adapter that forwards to
/// the shared-core diagnostics (consent-gated + redacted there).
public protocol XRayHeaderTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogXRayHeaderTelemetry: XRayHeaderTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the strip's data, mirroring the shared `LoadableState`
/// cases the production source projects from the ingest-xray `Resource<T>` query.
public enum XRayHeaderLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): `live` ≈
/// open, `stale` ≈ open-but-past-the-freshness-window, `offline` ≈ closed.
public enum XRayHeaderConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `XRayHeaderSource`: the cached summary +
/// the operator-selected window plus the load/connection status. The window is
/// always present (an operator selection that is meaningful even before data
/// loads); the summary is absent until the first successful fetch.
public struct XRayHeaderUpdate: Sendable, Equatable {
    public var status: XRayHeaderLoadStatus
    public var connection: XRayHeaderConnection
    public var window: IngestXRayWindow
    public var summary: IngestXRaySummary?
    public var updatedAt: Date?

    public init(
        status: XRayHeaderLoadStatus = .loading,
        connection: XRayHeaderConnection = .live,
        window: IngestXRayWindow = .m15,
        summary: IngestXRaySummary? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.window = window
        self.summary = summary
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the admin ingest-xray store + the window-selection
/// state + the SSE freshness); previews and tests use `InMemoryXRayHeaderSource`.
/// The view never talks to the network directly.
@MainActor
public protocol XRayHeaderSource: AnyObject {
    var onUpdate: (@MainActor (XRayHeaderUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The strip's observable view-model. Subscribes to an `XRayHeaderSource`, stores
/// the cached summary + selected window + freshness, and exposes a render `Phase`
/// for SwiftUI to switch over. The three-tile projection stays in the view (so a
/// resize / locale change re-derives it) via the pure adapter.
@MainActor
@Observable
public final class XRayHeaderModel {
    /// The mutually-exclusive render branches: a skeleton on the initial fetch,
    /// the `QueryError` equivalent on any failure, the friendly empty note when
    /// the window resolved with no samples, and the populated strip otherwise.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: XRayHeaderConnection = .live
    public private(set) var window: IngestXRayWindow = .m15
    public private(set) var summary: IngestXRaySummary?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any XRayHeaderSource
    @ObservationIgnored private let telemetry: any XRayHeaderTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any XRayHeaderSource,
        telemetry: any XRayHeaderTelemetry = OSLogXRayHeaderTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: XRayHeader.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (the cached summary stays visible). Wired to retry and to
    /// the stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: XRayHeaderUpdate) {
        connection = update.connection
        window = update.window
        summary = update.summary
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. A skeleton only on the initial fetch (no cached
    /// summary); the error state on any failure; the friendly empty note when the
    /// load resolves with a summary whose samples and fields are both zero (web
    /// `?? 0`) or with no summary at all. When a summary is cached it stays
    /// visible — the freshness banner reflects stale/offline.
    public static func resolvePhase(_ update: XRayHeaderUpdate) -> Phase {
        let hasSummary = update.summary != nil
        switch update.status {
        case .loading:
            return hasSummary ? .content : .loading
        case let .failed(message):
            return .error(message)
        case .empty:
            return .empty
        case .loaded:
            guard let summary = update.summary else { return .empty }
            let total = summary.totalSamples ?? 0
            let fields = summary.uniqueFields ?? 0
            return total == 0 && fields == 0 ? .empty : .content
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryXRayHeaderSource: XRayHeaderSource {
    public var onUpdate: (@MainActor (XRayHeaderUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: XRayHeaderUpdate?

    public init(initial: XRayHeaderUpdate? = nil) {
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
    public func push(_ update: XRayHeaderUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "XRayHeader" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time.
public enum XRayHeaderStrings {
    public static let table = "XRayHeader"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}
