//
//  TripPlannerMap.Model.swift
//  TeslaSync — P4 feature view · 0178 · TripPlannerMap (Apple)
//
//  The state-holder seams the map binds through: the P1/S11 telemetry contract
//  (`view.opened`), the P1/S10 i18n facade (web `useTranslation`), the P1/S8 source
//  that pushes the resolved trip-plan slice + freshness, and the `@Observable`
//  view-model that resolves the render phase and memoises the projection. The web
//  `TripPlannerMap` receives `origin` / `destination` / `legs` / `chargeStops` as
//  props derived by the trip-planner page, which owns the loading / error / freshness
//  lifecycle; the native surface reproduces that whole lifecycle through a
//  `TripPlannerMapSource` so every prompt-required state renders here. No networking
//  lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016),
/// which is consent-gated and redacted there. `Sendable` so a default sink can be an
/// `init` default.
public protocol TripPlannerMapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// Default sink: a redaction-safe `view.opened` `os_log` event. The slug is a
/// static, non-identifying constant logged verbatim; no VIN, route geometry, or
/// location is ever recorded.
public struct OSLogTripPlannerMapTelemetry: TripPlannerMapTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the view
/// holds no hardcoded literals. Keys live in the "TripPlannerMap" table, folded into
/// the app `Localizable.xcstrings` catalog at integration time; the per-surface table
/// keeps each parallel surface prompt self-contained.
public enum TripPlannerMapStrings {
    public static let table = "TripPlannerMap"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    /// A `Text` for a facade key, rendered verbatim so the resolved (possibly
    /// localized) value is never re-interpreted as a SwiftUI string key.
    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Source snapshot

/// One coalesced snapshot pushed by a `TripPlannerMapSource`: the planned trip's
/// origin / destination / legs / charge stops (web props), plus the load status, the
/// live connection, and the last-update timestamp. The model turns this into the
/// render phase + the map projection.
public struct TripPlannerMapUpdate: Sendable, Equatable {
    public var status: TripPlannerMapLoadStatus
    public var origin: TripPlannerLocation?
    public var destination: TripPlannerLocation?
    public var legs: [TripPlannerLeg]
    public var chargeStops: [TripPlannerChargeStop]
    public var connection: TripPlannerMapConnection
    public var refreshing: Bool
    public var updatedAt: Date?

    public init(
        status: TripPlannerMapLoadStatus = .loading,
        origin: TripPlannerLocation? = nil,
        destination: TripPlannerLocation? = nil,
        legs: [TripPlannerLeg] = [],
        chargeStops: [TripPlannerChargeStop] = [],
        connection: TripPlannerMapConnection = .live,
        refreshing: Bool = false,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.origin = origin
        self.destination = destination
        self.legs = legs
        self.chargeStops = chargeStops
        self.connection = connection
        self.refreshing = refreshing
        self.updatedAt = updatedAt
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders — composing the trip-plan query the web page reads and
/// mapping it into the origin / destination / legs / charge-stop props. Previews +
/// tests use `InMemoryTripPlannerMapSource`. The view never talks to the network.
@MainActor
public protocol TripPlannerMapSource: AnyObject {
    var onUpdate: (@MainActor (TripPlannerMapUpdate) -> Void)? { get set }
    func start()
    func stop()
    /// Re-runs the underlying query (web refetch / the stale auto-refresh).
    func refresh()
}

// MARK: - State holder (P1/S8)

/// The surface's observable view-model. Subscribes to a `TripPlannerMapSource`,
/// memoises each snapshot into the map projection (polyline + markers + camera
/// inputs), exposes a render `TripPlannerMapPhase` + freshness for SwiftUI to switch
/// over, and emits the `view.opened` diagnostics event once on first appearance.
@MainActor
@Observable
public final class TripPlannerMapModel {
    public private(set) var phase: TripPlannerMapPhase = .loading
    public private(set) var connection: TripPlannerMapConnection = .live
    public private(set) var projection = TripPlannerMapProjection(
        markers: [],
        polyline: [],
        hasData: false,
        centerLatitude: TripPlannerMapProjection.fallbackCenterLatitude,
        centerLongitude: TripPlannerMapProjection.fallbackCenterLongitude,
        zoom: TripPlannerMapProjection.defaultZoom
    )
    public private(set) var refreshing = false
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any TripPlannerMapSource
    @ObservationIgnored private let telemetry: any TripPlannerMapTelemetry
    @ObservationIgnored private let locale: Locale
    @ObservationIgnored let localize: (String, String) -> String
    @ObservationIgnored private var started = false
    @ObservationIgnored private var didAutoRefreshForStale = false

    public init(
        source: any TripPlannerMapSource,
        telemetry: any TripPlannerMapTelemetry = OSLogTripPlannerMapTelemetry(),
        locale: Locale = .current,
        localize: @escaping (String, String) -> String = TripPlannerMapStrings.string
    ) {
        self.source = source
        self.telemetry = telemetry
        self.locale = locale
        self.localize = localize
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// The locale used for the callout's number formatting.
    public var displayLocale: Locale {
        locale
    }

    // MARK: Lifecycle

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: TripPlannerMapSurface.slug)
        source.start()
    }

    /// Stops observing the upstream query.
    public func stop() {
        started = false
        source.stop()
    }

    /// Re-runs the underlying query (web refetch) — the error-state retry + the
    /// freshness-chip refresh action.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: TripPlannerMapUpdate) {
        connection = update.connection
        refreshing = update.refreshing
        updatedAt = update.updatedAt
        projection = TripPlannerMapProjection.make(
            origin: update.origin,
            destination: update.destination,
            legs: update.legs,
            chargeStops: update.chargeStops
        )
        phase = Self.resolvePhase(update.status, hasData: projection.hasData)
        handleAutoRefresh(for: update.connection)
    }

    /// Resolves the render phase from the bound load status + whether there is
    /// anything to map (web `hasData ? <map> : <EmptyState>`). The loading / error
    /// envelope comes from the status; freshness (stale / offline) is orthogonal and
    /// keeps the cached route on screen as `.content`.
    public static func resolvePhase(_ status: TripPlannerMapLoadStatus, hasData: Bool) -> TripPlannerMapPhase {
        switch status {
        case .loading:
            .loading
        case let .failed(message):
            .error(message)
        case .loaded:
            hasData ? .content : .empty
        }
    }

    /// Stale → one guarded auto-refresh (prompt "stale chip + auto-refresh"); reset
    /// once live so a later stale episode re-triggers exactly once. Offline keeps the
    /// cached route on screen and does not refetch.
    private func handleAutoRefresh(for connection: TripPlannerMapConnection) {
        switch connection {
        case .stale:
            guard !didAutoRefreshForStale else { return }
            didAutoRefreshForStale = true
            source.refresh()
        case .live:
            didAutoRefreshForStale = false
        case .offline:
            break
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit tests. Seeds an optional initial snapshot on
/// `start()` and lets a test push further snapshots via `push(_:)`.
@MainActor
public final class InMemoryTripPlannerMapSource: TripPlannerMapSource {
    public var onUpdate: (@MainActor (TripPlannerMapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: TripPlannerMapUpdate?

    public init(initial: TripPlannerMapUpdate? = nil) {
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

    /// Pushes a snapshot to the bound model (test / preview affordance).
    public func push(_ update: TripPlannerMapUpdate) {
        onUpdate?(update)
    }
}
