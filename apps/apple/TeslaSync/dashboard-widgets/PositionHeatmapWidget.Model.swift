//
//  PositionHeatmapWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0072 · PositionHeatmapWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + the observable view-model
//  + an in-memory source for previews/tests + the i18n facade (P1/S10). The
//  dashboard-tier registry types (`DashboardWidgetSize` / `DashboardWidgetRegistration`)
//  are the shared primitives the first widget in this directory (DigitalTwinWidget)
//  defines; this surface reuses them unchanged.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for a surface.
/// The default logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there.
public protocol PositionHeatmapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogPositionHeatmapTelemetry: PositionHeatmapTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("screen_view surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the KMP `VehicleStore` positions stream projected
/// to `StateHolderModel<LoadableState<…>>`); previews and tests use
/// `InMemoryPositionHeatmapSource`. The view never performs HTTP directly.
@MainActor
public protocol PositionHeatmapSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (PositionHeatmapUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `PositionHeatmapSource`,
/// stores the cached positions + freshness, and exposes a render `Phase` the
/// SwiftUI surface switches over. Clusters are derived in the view because they
/// depend on the live grid size (precision).
@MainActor
@Observable
public final class PositionHeatmapModel {
    /// The mutually-exclusive render branches (web shell loading / empty / map).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: PositionHeatmapConnection = .live
    public private(set) var positions: [HeatPosition] = []
    public private(set) var updatedAt: Date?

    /// The total cached samples (web `safePositions.length` → count badge).
    public var totalPositions: Int {
        positions.count
    }

    @ObservationIgnored private let source: any PositionHeatmapSource
    @ObservationIgnored private let telemetry: any PositionHeatmapTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any PositionHeatmapSource,
        telemetry: any PositionHeatmapTelemetry = OSLogPositionHeatmapTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: PositionHeatmapWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached positions stay visible). Wired to retry/refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: PositionHeatmapUpdate) {
        connection = update.connection
        positions = update.positions
        updatedAt = update.updatedAt
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. Whenever positions are known the map renders
    /// (cached values stay visible behind refresh/errors); the skeleton only shows
    /// on the initial fetch and the error state only when there is nothing cached.
    static func resolvePhase(_ update: PositionHeatmapUpdate) -> Phase {
        let hasData = !update.positions.isEmpty
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
public final class InMemoryPositionHeatmapSource: PositionHeatmapSource {
    public var onUpdate: (@MainActor (PositionHeatmapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: PositionHeatmapUpdate?

    public init(initial: PositionHeatmapUpdate? = nil) {
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
    public func push(_ update: PositionHeatmapUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "PositionHeatmapWidget"
/// table, folded into the app `Localizable.xcstrings` catalog at integration time.
public enum PositionHeatmapStrings {
    public static let table = "PositionHeatmapWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    /// A single-count formatted string (web `t(key, '{{count}} …', { count })`).
    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }

    /// A multi-argument formatted string (e.g. the accessibility value).
    public static func format(_ key: String, _ fallbackFormat: String, _ args: CVarArg...) -> String {
        String(format: string(key, fallbackFormat), arguments: args)
    }
}
