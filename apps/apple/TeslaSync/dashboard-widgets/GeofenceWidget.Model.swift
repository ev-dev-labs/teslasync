//
//  GeofenceWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0053 · GeofenceWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + i18n facade (P1/S10) +
//  the testable accessibility summary. The SwiftUI view binds through
//  `GeofenceWidgetModel`; no networking lives in the view.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` / `screen_view` product-analytics event for a surface.
/// The default logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol GeofenceWidgetTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
public struct OSLogGeofenceWidgetTelemetry: GeofenceWidgetTelemetry {
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
/// cases the production source projects from `Resource<T>`. It coalesces the web
/// source's two queries (`useGeofences` + `useVehicleState`).
public enum GeofenceWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip + the "stale"/"offline" mandated states.
public enum GeofenceWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline

    /// Whether the data is a fresh live read.
    public var isLive: Bool {
        self == .live
    }
}

/// One coalesced snapshot pushed by a `GeofenceWidgetSource`: the cached fences +
/// vehicle fix + display unit plus their load/connection status. The model turns
/// this into the `GeofenceWidgetProjection`.
public struct GeofenceWidgetUpdate: Sendable, Equatable {
    public var status: GeofenceWidgetLoadStatus
    public var connection: GeofenceWidgetConnection
    public var fences: [GeofenceWidgetFenceInput]
    public var vehicle: GeofenceWidgetVehicleFix?
    public var distanceUnit: GeofenceWidgetDistanceUnit
    public var updatedAt: Date?

    public init(
        status: GeofenceWidgetLoadStatus = .loading,
        connection: GeofenceWidgetConnection = .live,
        fences: [GeofenceWidgetFenceInput] = [],
        vehicle: GeofenceWidgetVehicleFix? = nil,
        distanceUnit: GeofenceWidgetDistanceUnit = .kilometers,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.fences = fences
        self.vehicle = vehicle
        self.distanceUnit = distanceUnit
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (the `useGeofences` list holder + the
/// `useVehicleState` holder + the `useUnits` preference holder); previews and
/// tests use `InMemoryGeofenceWidgetSource`. The view never talks to the network.
@MainActor
public protocol GeofenceWidgetSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (GeofenceWidgetUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `GeofenceWidgetSource`,
/// recomputes the `GeofenceWidgetProjection` via `GeofenceWidgetProjectionBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class GeofenceWidgetModel {
    /// The mutually-exclusive render branches (skeleton / empty / error / content).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: GeofenceWidgetConnection = .live
    public private(set) var projection: GeofenceWidgetProjection = .empty
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any GeofenceWidgetSource
    @ObservationIgnored private let telemetry: any GeofenceWidgetTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any GeofenceWidgetSource,
        telemetry: any GeofenceWidgetTelemetry = OSLogGeofenceWidgetTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: GeofenceWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached fences stay visible). Wired to the refresh
    /// control and the error-state retry affordance.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: GeofenceWidgetUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = GeofenceWidgetProjectionBuilder.build(
            fences: update.fences,
            vehicle: update.vehicle,
            unit: update.distanceUnit
        )
        phase = Self.resolvePhase(status: update.status, hasFences: !projection.isEmpty)
    }

    /// Resolves the render phase. Cached fences keep the list visible behind a
    /// refresh or a failed re-fetch (stale/offline surface via the chip); a
    /// failure with no cached fences shows the dedicated error state with a retry;
    /// a resolved-but-empty result shows the friendly empty state.
    static func resolvePhase(status: GeofenceWidgetLoadStatus, hasFences: Bool) -> Phase {
        switch status {
        case .loading:
            hasFences ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasFences ? .content : .empty
        case let .failed(message):
            hasFences ? .content : .error(message)
        }
    }
}

// MARK: - In-memory source (previews + tests)

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryGeofenceWidgetSource: GeofenceWidgetSource {
    public var onUpdate: (@MainActor (GeofenceWidgetUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: GeofenceWidgetUpdate?

    public init(initial: GeofenceWidgetUpdate? = nil) {
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
    public func push(_ update: GeofenceWidgetUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "GeofenceWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum GeofenceWidgetStrings {
    public static let table = "GeofenceWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Accessibility summary (testable seam)

/// Builds the VoiceOver content spoken for the widget + its fence rows. Pure +
/// public so the spoken text can be unit-tested without rendering the view.
public enum GeofenceWidgetAccessibility {
    /// The map / header spoken value: the active zone when inside one, otherwise
    /// the web "No zone" copy.
    public static func zoneSummary(_ projection: GeofenceWidgetProjection) -> String {
        if let zone = projection.currentZone {
            let inside = GeofenceWidgetStrings.string("widget.geofence.inside", "Inside")
            return "\(inside) \(zone.name)"
        }
        return GeofenceWidgetStrings.string("widget.geofence.noZone", "No zone")
    }

    /// A single fence row's spoken label: name, membership, and radius.
    public static func rowLabel(_ fence: GeofenceWidgetFenceStatus) -> String {
        let radius = GeofenceWidgetStrings.string("widget.geofence.radius", "Radius")
        var parts = [fence.name, membershipLabel(fence.membership)]
        parts.append("\(radius) \(fence.radiusText)")
        return parts.joined(separator: ", ")
    }

    /// The localized membership word for a fence's badge.
    public static func membershipLabel(_ membership: GeofenceWidgetFenceStatus.Membership) -> String {
        switch membership {
        case .disabled: GeofenceWidgetStrings.string("widget.geofence.disabled", "Disabled")
        case .inside: GeofenceWidgetStrings.string("widget.geofence.inside", "Inside")
        case .outside: GeofenceWidgetStrings.string("widget.geofence.outside", "Outside")
        }
    }
}
