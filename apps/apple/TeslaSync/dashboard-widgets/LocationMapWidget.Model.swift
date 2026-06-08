//
//  LocationMapWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0060 · LocationMapWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry metadata +
//  i18n facade (P1/S10) + the testable accessibility summary. The SwiftUI view
//  binds through `LocationMapModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for a
/// surface. The default implementation logs via `os.Logger`; the production app
/// injects an adapter that forwards to the shared core
/// `Telemetry.track(.screenView(screen:…))` (ADR-016 §5), which is
/// consent-gated and redacted there.
public protocol LocationMapTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogLocationMapTelemetry: LocationMapTelemetry {
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
public enum LocationLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). `isLive`
/// is the native parity of the web `stateData?.live` flag that gates the
/// "Last known position" overlay.
public enum LocationConnection: Sendable, Equatable {
    case live
    case stale
    case offline

    /// Whether the position is a fresh live fix (web `isLive`).
    public var isLive: Bool {
        self == .live
    }
}

/// The selected vehicle, mirroring the web `vehicles?.[0]` fallback selection.
public struct LocationVehicle: Sendable, Equatable {
    public var id: Int64
    public var displayName: String?

    public init(id: Int64, displayName: String? = nil) {
        self.id = id
        self.displayName = displayName
    }
}

/// One coalesced snapshot pushed by a `LocationMapSource`: the cached position
/// inputs plus their load/connection status. The model turns this into the
/// `VehicleLocation` projection.
public struct LocationMapUpdate: Sendable, Equatable {
    public var status: LocationLoadStatus
    public var connection: LocationConnection
    public var vehicle: LocationVehicle?
    public var position: LocationInput?
    public var updatedAt: Date?

    public init(
        status: LocationLoadStatus = .loading,
        connection: LocationConnection = .live,
        vehicle: LocationVehicle? = nil,
        position: LocationInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.position = position
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` fed by the
/// KMP `VehicleStore` for `useVehicles` + the vehicle-state holder for
/// `useVehicleState`); previews and tests use `InMemoryLocationMapSource`. The
/// view never talks to the network directly.
@MainActor
public protocol LocationMapSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (LocationMapUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `LocationMapSource`,
/// recomputes the `VehicleLocation` projection via `LocationProjectionBuilder`,
/// and exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class LocationMapModel {
    /// The mutually-exclusive render branches (web shell skeleton / map empty /
    /// map shown), plus a first-class error branch for the mandated error state.
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: LocationConnection = .live
    public private(set) var location: VehicleLocation = .none
    public private(set) var vehicle: LocationVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any LocationMapSource
    @ObservationIgnored private let telemetry: any LocationMapTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any LocationMapSource,
        telemetry: any LocationMapTelemetry = OSLogLocationMapTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: LocationMapWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached position stays visible). Wired to the
    /// refresh control and the error-state retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: LocationMapUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        location = LocationProjectionBuilder.build(update.position)
        phase = Self.resolvePhase(status: update.status, hasCoordinate: location.hasCoordinate)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the map's empty state when there is no usable coordinate;
    /// whenever a coordinate is known the map renders (cached values stay
    /// visible behind a refresh or a failed re-fetch). A failure with no cached
    /// coordinate surfaces the dedicated error state with a retry.
    static func resolvePhase(status: LocationLoadStatus, hasCoordinate: Bool) -> Phase {
        switch status {
        case .loading:
            hasCoordinate ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasCoordinate ? .content : .empty
        case let .failed(message):
            hasCoordinate ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryLocationMapSource: LocationMapSource {
    public var onUpdate: (@MainActor (LocationMapUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: LocationMapUpdate?

    public init(initial: LocationMapUpdate? = nil) {
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
    public func push(_ update: LocationMapUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "LocationMapWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum LocationMapStrings {
    public static let table = "LocationMapWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver value spoken for the map. Pure + public so the spoken
/// content can be unit-tested without rendering the view.
public enum LocationMapAccessibility {
    /// The map's spoken value: empty-state copy when there is no coordinate,
    /// otherwise the freshness ("Live"/"Last known position"), the heading, and
    /// the formatted coordinates.
    public static func summary(location: VehicleLocation, connection: LocationConnection) -> String {
        guard location.hasCoordinate else {
            return LocationMapStrings.string("widget.locationMap.noData", "No location data available")
        }
        var parts: [String] = []
        if connection.isLive {
            parts.append(LocationMapStrings.string("widget.locationMap.live", "Live"))
        } else {
            parts.append(LocationMapStrings.string("widget.locationMap.lastKnown", "Last known position"))
        }
        if let degrees = location.headingDegrees {
            let label = LocationMapStrings.string("widget.locationMap.heading", "Heading")
            parts.append("\(label) \(degrees)°")
        }
        parts.append(location.coordinatesText)
        return parts.joined(separator: ". ")
    }
}
