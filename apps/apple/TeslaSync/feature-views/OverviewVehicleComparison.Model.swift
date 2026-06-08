//
//  OverviewVehicleComparison.Model.swift
//  TeslaSync — P4 feature view · 0060 · OverviewVehicleComparison (Apple)
//
//  The telemetry seam (P1/S11), the state-holder seam (P1/S8), the observable
//  view-model, and the SwiftUI half of the i18n facade. The view binds through this
//  model and never performs networking itself. Unlike a bundled-catalog tool, the
//  fleet-comparison data is a live analytics resource, so the production app injects
//  a source that bridges the shared P1/S8 fleet-analytics + units state-holders; the
//  surface stays transport-free behind the `OverviewComparisonSource` seam.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` (`screen_view`) product-analytics event for this surface.
/// The default implementation logs via `os.Logger`; the production app injects an
/// adapter that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol OverviewComparisonTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogOverviewComparisonTelemetry: OverviewComparisonTelemetry {
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
/// shared P1/S8 fleet-analytics + units state-holders (projecting their
/// `Resource<FleetAnalytics>` + `UnitPref` into `OverviewComparisonUpdate`);
/// previews / tests use `InMemoryOverviewComparisonSource`. The view never talks to
/// the network directly.
@MainActor
public protocol OverviewComparisonSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (OverviewComparisonUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit / UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryOverviewComparisonSource: OverviewComparisonSource {
    public var onUpdate: (@MainActor (OverviewComparisonUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: OverviewComparisonUpdate?

    public init(initial: OverviewComparisonUpdate? = nil) {
        self.initial = initial
    }

    public func start() {
        startCount += 1
        if let initial {
            onUpdate?(initial)
        }
    }

    public func stop() {
        stopCount += 1
    }

    public func refresh() {
        refreshCount += 1
    }

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: OverviewComparisonUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable view-model

/// The surface's observable view-model. Subscribes to an `OverviewComparisonSource`,
/// stores the vehicle rows + the resolved distance unit, and exposes a render
/// `phase` + freshness for SwiftUI to switch over. The per-panel projections are
/// recomputed by the view from `vehicles` + `distanceUnit` through the pure
/// `OverviewComparisonBuilder` (mirroring the web `useMemo` derivations).
@MainActor
@Observable
public final class OverviewComparisonModel {
    /// Diagnostics surface slug (P1/S11 `view.opened`). Canonical source of truth,
    /// re-exported by the view.
    public static let surfaceSlug = "OverviewVehicleComparison"

    public private(set) var phase: OverviewRenderPhase = .loading
    public private(set) var freshness: OverviewFreshness = .fresh
    public private(set) var connection: OverviewConnection = .live
    public private(set) var vehicles: [OverviewVehicle] = []
    public private(set) var distanceUnit: OverviewDistanceUnit = .km
    public private(set) var updatedAt: Date?

    /// The number of cached vehicle rows — backs the empty/content distinction.
    public var vehicleCount: Int {
        vehicles.count
    }

    @ObservationIgnored private let source: any OverviewComparisonSource
    @ObservationIgnored private let telemetry: any OverviewComparisonTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any OverviewComparisonSource,
        telemetry: any OverviewComparisonTelemetry = OSLogOverviewComparisonTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: Self.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached vehicles stay visible). Wired to the retry / banner.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: OverviewComparisonUpdate) {
        connection = update.connection
        vehicles = update.vehicles
        distanceUnit = update.distanceUnit
        updatedAt = update.updatedAt
        phase = OverviewComparisonBuilder.resolvePhase(
            status: update.status,
            vehicleCount: update.vehicles.count
        )
        freshness = OverviewComparisonBuilder.resolveFreshness(update)
    }
}

// MARK: - Localization facade (P1/S10) — SwiftUI half

public extension OverviewComparisonStrings {
    /// A `Text` resolved by key with the web English fallback (verbatim so the
    /// resolved value is not re-interpreted as a format string).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
