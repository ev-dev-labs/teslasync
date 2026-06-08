//
//  UptimeMonitorWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0104 · UptimeMonitorWidget (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + dashboard registry
//  primitives + the SwiftUI half of the P1/S10 i18n facade. The view binds
//  through `UptimeMonitorModel`; no networking lives in the view.
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
public protocol UptimeMonitorTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogUptimeMonitorTelemetry: UptimeMonitorTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared
/// `LoadableState` cases the production source projects from `Resource<T>`.
public enum UptimeLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// header freshness chip (the web `DataFreshness` indicator).
public enum UptimeConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by an `UptimeMonitorSource`: the cached payload
/// plus its load/connection status. The model turns this into the projection.
public struct UptimeMonitorUpdate: Sendable, Equatable {
    public var status: UptimeLoadStatus
    public var connection: UptimeConnection
    public var data: UptimeMonitorWidgetSystemHealthData?
    public var updatedAt: Date?

    public init(
        status: UptimeLoadStatus = .loading,
        connection: UptimeConnection = .live,
        data: UptimeMonitorWidgetSystemHealthData? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.data = data
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holder (`StateHolderModel<LoadableState<…>>` from the KMP
/// `AdminStore`, polling `/system/health` on the web `INTERVALS.STANDARD`
/// cadence); previews and tests use `InMemoryUptimeMonitorSource`. The view never
/// talks to the network directly.
@MainActor
public protocol UptimeMonitorSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (UptimeMonitorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to an `UptimeMonitorSource`,
/// recomputes the `UptimeMonitorProjection`, and exposes a render `Phase` +
/// freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class UptimeMonitorModel {
    /// The mutually-exclusive render branches (web shell loading / error / shown
    /// / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: UptimeConnection = .live
    public private(set) var data: UptimeMonitorWidgetSystemHealthData?
    public private(set) var projection = UptimeMonitorProjection()
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any UptimeMonitorSource
    @ObservationIgnored private let telemetry: any UptimeMonitorTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any UptimeMonitorSource,
        telemetry: any UptimeMonitorTelemetry = OSLogUptimeMonitorTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: UptimeMonitorWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the retry /
    /// refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The web's responsive breakpoint: compact only at a single 1×1 cell
    /// (web `size.cols === 1 && size.rows === 1`).
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols == 1 && size.rows == 1
    }

    /// The web's tall breakpoint that reveals the DB-size/tables footer
    /// (web `size.rows >= 2`).
    public static func isTall(_ size: DashboardWidgetSize) -> Bool {
        size.rows >= 2
    }

    private func apply(_ update: UptimeMonitorUpdate) {
        connection = update.connection
        data = update.data
        updatedAt = update.updatedAt
        projection = update.data.map(UptimeMonitorProjector.project) ?? UptimeMonitorProjection()
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shell shows the skeleton only on the
    /// initial fetch, the empty state when there is no `data` object, and keeps
    /// cached content visible behind background refresh/errors (the freshness
    /// chip conveys stale/offline). A hard failure with no cached data surfaces
    /// the error state with a retry.
    static func resolvePhase(_ update: UptimeMonitorUpdate) -> Phase {
        let hasData = update.data != nil
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
public final class InMemoryUptimeMonitorSource: UptimeMonitorSource {
    public var onUpdate: (@MainActor (UptimeMonitorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: UptimeMonitorUpdate?

    public init(initial: UptimeMonitorUpdate? = nil) {
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
    public func push(_ update: UptimeMonitorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/system.ts → "uptime-monitor")

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension UptimeMonitorStrings {
    /// `Text` convenience for the view layer (the Foundation `string`/`count`
    /// resolvers live in `UptimeMonitorWidget.Projection.swift`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
