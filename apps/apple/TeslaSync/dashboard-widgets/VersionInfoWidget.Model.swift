//
//  VersionInfoWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0111 · VersionInfoWidget (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + the SwiftUI half of
//  the P1/S10 i18n facade. The view binds through `VersionInfoModel`; no
//  networking lives in the view. The shared dashboard registry primitives
//  (`DashboardWidgetSize` / `DashboardWidgetRegistration`) are provided by the P4
//  core and reused here — this surface declares only its own seam types.
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
public protocol VersionInfoTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogVersionInfoTelemetry: VersionInfoTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState`
/// cases the production source projects from `Resource<T>`.
public enum VersionInfoLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (the web `DataFreshness` indicator).
public enum VersionInfoConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `VersionInfoSource`: the cached payload
/// plus its load/connection status. The model turns this into the projection.
public struct VersionInfoUpdate: Sendable, Equatable {
    public var status: VersionInfoLoadStatus
    public var connection: VersionInfoConnection
    public var snapshot: VersionInfoSnapshot?
    public var updatedAt: Date?

    public init(
        status: VersionInfoLoadStatus = .loading,
        connection: VersionInfoConnection = .live,
        snapshot: VersionInfoSnapshot? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the version query polling on the web
/// `STALE_TIMES.STANDARD` cadence + the capture-stats query on `FAST`); previews
/// and tests use `InMemoryVersionInfoSource`. The view never talks to the network.
@MainActor
public protocol VersionInfoSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (VersionInfoUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VersionInfoSource`,
/// recomputes the `VersionInfoVitals` projection, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class VersionInfoModel {
    /// The mutually-exclusive render branches (web shell loading / error / shown /
    /// empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VersionInfoConnection = .live
    public private(set) var snapshot: VersionInfoSnapshot?
    public private(set) var vitals: VersionInfoVitals = VersionInfoProjection.vitals(from: VersionInfoSnapshot())
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VersionInfoSource
    @ObservationIgnored private let telemetry: any VersionInfoTelemetry
    @ObservationIgnored private var started = false

    public init(source: any VersionInfoSource, telemetry: any VersionInfoTelemetry = OSLogVersionInfoTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VersionInfoWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the retry / refresh
    /// affordances.
    public func refresh() {
        source.refresh()
    }

    /// The web responsive breakpoint: compact at a single column (`size.cols <= 1`).
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    /// The web wide breakpoint (`size.cols >= 4`) — gates the OS/Arch line and the
    /// 4-up stat grid.
    public static func isWide(_ size: DashboardWidgetSize) -> Bool {
        size.cols >= 4
    }

    private func apply(_ update: VersionInfoUpdate) {
        connection = update.connection
        snapshot = update.snapshot
        updatedAt = update.updatedAt
        vitals = VersionInfoProjection.vitals(from: update.snapshot ?? VersionInfoSnapshot())
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shell shows the skeleton only on the
    /// initial fetch, the empty state when there is no `version.data` object, and
    /// keeps cached content visible behind background refresh/errors (the
    /// freshness chip conveys stale/offline). A hard failure with no cached data
    /// surfaces the error state with a retry. "Has data" mirrors the web
    /// `hasData = version.data != null`.
    static func resolvePhase(_ update: VersionInfoUpdate) -> Phase {
        let hasData = update.snapshot?.version != nil
        switch update.status {
        case .loading:
            return hasData ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasData ? .content : .empty
        case let .failed(message):
            return hasData ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryVersionInfoSource: VersionInfoSource {
    public var onUpdate: (@MainActor (VersionInfoUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VersionInfoUpdate?

    public init(initial: VersionInfoUpdate? = nil) {
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
    public func push(_ update: VersionInfoUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension VersionInfoStrings {
    /// `Text` convenience for the view layer (the Foundation `string` resolver
    /// lives in `VersionInfoWidget.Projection.swift`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
