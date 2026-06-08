//
//  TelemetryErrorsWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  The state-holder seam (P1/S8) + telemetry seam (P1/S11) + dashboard registry
//  primitives + the SwiftUI half of the P1/S10 i18n facade. The view binds
//  through `TelemetryErrorsWidgetModel`; no networking lives in the view.
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
public protocol TelemetryErrorsWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct TelemetryErrorsWidgetOSLogTelemetryErrorsTelemetry: TelemetryErrorsWidgetTelemetry {
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
public enum TelemetryErrorsLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring the web `DataFreshness` chip states
/// (`fresh` / `fetching` / `stale` / `error`) plus an explicit `offline`
/// no-connectivity case (ADR-013). Drives the header freshness chip.
public enum TelemetryErrorsFreshness: Sendable, Equatable {
    case live
    case fetching
    case stale
    case offline
    case error
}

/// One coalesced snapshot pushed by a `TelemetryErrorsWidgetSource`: the cached error
/// VIN + error lists plus the load/freshness status. The model turns this into
/// the projection.
public struct TelemetryErrorsUpdate: Sendable, Equatable {
    public var status: TelemetryErrorsLoadStatus
    public var freshness: TelemetryErrorsFreshness
    public var vins: [TelemetryErrorVIN]
    public var errors: [TelemetryErrorEntry]
    public var updatedAt: Date?

    public init(
        status: TelemetryErrorsLoadStatus = .loading,
        freshness: TelemetryErrorsFreshness = .live,
        vins: [TelemetryErrorVIN] = [],
        errors: [TelemetryErrorEntry] = [],
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.freshness = freshness
        self.vins = vins
        self.errors = errors
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holder (two `StateHolderModel<LoadableState<…>>` instances
/// over the KMP `TelemetryStore`, polling `/tesla/fleet-telemetry/error-vins`
/// and `/tesla/fleet-telemetry/errors` on the web `STALE_TIMES.STANDARD`
/// cadence and coalescing them); previews and tests use
/// `TelemetryErrorsWidgetInMemoryTelemetryErrorsSource`. The view never talks to the network.
@MainActor
public protocol TelemetryErrorsWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (TelemetryErrorsUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `TelemetryErrorsWidgetSource`,
/// recomputes the aggregation + status projection, and exposes a render `Phase`
/// + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class TelemetryErrorsWidgetModel {
    /// The mutually-exclusive render branches (web shell loading / error / shown
    /// / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var freshness: TelemetryErrorsFreshness = .live
    public private(set) var vins: [TelemetryErrorVIN] = []
    public private(set) var errors: [TelemetryErrorEntry] = []
    public private(set) var aggregates: [TelemetryErrorAggregate] = []
    public private(set) var activeVINCount = 0
    public private(set) var updatedAt: Date?

    /// The fleet health verdict (web `statusBadge` / `statusLabel`).
    public var status: TelemetryErrorsStatus {
        TelemetryErrorsStatus.resolve(activeVINCount: activeVINCount)
    }

    @ObservationIgnored private let source: any TelemetryErrorsWidgetSource
    @ObservationIgnored private let telemetry: any TelemetryErrorsWidgetTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any TelemetryErrorsWidgetSource,
        telemetry: any TelemetryErrorsWidgetTelemetry = TelemetryErrorsWidgetOSLogTelemetryErrorsTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TelemetryErrorsWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the freshness
    /// chip + retry affordances (web `onRefresh={() => refetchVINs()}`).
    public func refresh() {
        source.refresh()
    }

    /// The web's responsive breakpoint: compact at a single column
    /// (`size.cols <= 1`).
    public static func isCompact(_ size: DashboardWidgetSize) -> Bool {
        size.cols <= 1
    }

    private func apply(_ update: TelemetryErrorsUpdate) {
        freshness = update.freshness
        vins = update.vins
        errors = update.errors
        updatedAt = update.updatedAt
        activeVINCount = TelemetryErrorsWidgetProjection.activeVINCount(update.vins)
        let unknownLabel = TelemetryErrorsStrings.string("widget.telemetryErrors.unknown", "Unknown")
        aggregates = TelemetryErrorsWidgetProjection.aggregate(update.errors, unknownLabel: unknownLabel)
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shell shows the skeleton only on the
    /// initial fetch (`loading` with no cached lists), the empty state when both
    /// lists are empty (web `!hasData`), and keeps cached content visible behind
    /// background refresh/errors (the freshness chip conveys stale/offline/
    /// error). A hard failure with no cached data surfaces the error state with a
    /// retry.
    static func resolvePhase(_ update: TelemetryErrorsUpdate) -> Phase {
        let hasData = TelemetryErrorsWidgetProjection.hasData(vins: update.vins, errors: update.errors)
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
public final class TelemetryErrorsWidgetInMemoryTelemetryErrorsSource: TelemetryErrorsWidgetSource {
    public var onUpdate: (@MainActor (TelemetryErrorsUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TelemetryErrorsUpdate?

    public init(initial: TelemetryErrorsUpdate? = nil) {
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
    public func push(_ update: TelemetryErrorsUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/system.ts → "telemetry-errors")

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension TelemetryErrorsStrings {
    /// `Text` convenience for the view layer (the Foundation `string`/`count`
    /// resolvers live in `TelemetryErrorsWidget.Projection.swift`).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
