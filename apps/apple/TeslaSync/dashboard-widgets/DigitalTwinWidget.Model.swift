//
//  DigitalTwinWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10) + the testable accessibility
//  summary.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `screen_view` product-analytics event for a surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter
/// that forwards to the shared core `Telemetry.track(.screenView(screen:…))`
/// (ADR-016 §5), which is consent-gated and redacted there.
public protocol DigitalTwinTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `screen_view`.
/// Bridges 1:1 to the shared `Telemetry.track(.screenView(screen: surface, …))`
/// at the composition root.
public struct OSLogDigitalTwinTelemetry: DigitalTwinTelemetry {
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
public enum TwinLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013).
public enum TwinConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `DigitalTwinSource`: the cached DTO inputs
/// plus their load/connection status. The model turns this into the projection.
public struct DigitalTwinUpdate: Sendable, Equatable {
    public var status: TwinLoadStatus
    public var connection: TwinConnection
    public var vehicle: DigitalTwinWidgetTwinVehicle?
    public var security: TwinSecurityInput?
    public var vehicleState: TwinVehicleStateInput?
    public var charging: TwinChargingInput?
    public var updatedAt: Date?

    public init(
        status: TwinLoadStatus = .loading,
        connection: TwinConnection = .live,
        vehicle: DigitalTwinWidgetTwinVehicle? = nil,
        security: TwinSecurityInput? = nil,
        vehicleState: TwinVehicleStateInput? = nil,
        charging: TwinChargingInput? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.security = security
        self.vehicleState = vehicleState
        self.charging = charging
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders (`StateHolderModel<LoadableState<…>>` from the KMP
/// `VehicleStore` / `SecurityStore` / `ChargingStore`); previews and tests use
/// `InMemoryDigitalTwinSource`. The view never talks to the network directly.
@MainActor
public protocol DigitalTwinSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (DigitalTwinUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `DigitalTwinSource`,
/// recomputes the `VehicleTwinState` projection via `TwinStateBuilder`, and
/// exposes a render `Phase` + freshness for SwiftUI to switch over.
@MainActor
@Observable
public final class DigitalTwinModel {
    /// The mutually-exclusive render branches (web shell loading / empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: TwinConnection = .live
    public private(set) var twin: VehicleTwinState = .empty
    public private(set) var vehicle: DigitalTwinWidgetTwinVehicle?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any DigitalTwinSource
    @ObservationIgnored private let telemetry: any DigitalTwinTelemetry
    @ObservationIgnored private var started = false

    public init(source: any DigitalTwinSource, telemetry: any DigitalTwinTelemetry = OSLogDigitalTwinTelemetry()) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: DigitalTwinWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a network refresh (cached value stays visible). Wired to the
    /// retry / refresh affordances.
    public func refresh() {
        source.refresh()
    }

    /// The freshness-aware twin size: the web promotes the illustration to `md`
    /// at 3+ columns or 5+ rows, else `sm`.
    public static func twinSize(for size: DashboardWidgetSize) -> TwinRenderSize {
        size.cols >= 3 || size.rows >= 5 ? .md : .sm
    }

    private func apply(_ update: DigitalTwinUpdate) {
        connection = update.connection
        vehicle = update.vehicle
        updatedAt = update.updatedAt
        twin = TwinStateBuilder.buildTwinState(
            security: update.security,
            vehicleState: update.vehicleState,
            charging: update.charging
        )
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web only shows the skeleton on the initial
    /// fetch and the empty state when there is no vehicle; whenever a vehicle is
    /// known the twin renders (cached values stay visible behind refresh/errors).
    private static func resolvePhase(_ update: DigitalTwinUpdate) -> Phase {
        let hasVehicle = update.vehicle != nil
        switch update.status {
        case .loading:
            return hasVehicle ? .content : .loading
        case .empty:
            return .empty
        case .loaded:
            return hasVehicle ? .content : .empty
        case let .failed(message):
            return hasVehicle ? .content : .error(message)
        }
    }
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryDigitalTwinSource: DigitalTwinSource {
    public var onUpdate: (@MainActor (DigitalTwinUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: DigitalTwinUpdate?

    public init(initial: DigitalTwinUpdate? = nil) {
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
    public func push(_ update: DigitalTwinUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (canonical: registry/vehicle.ts → "vehicle-twin")



// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "DigitalTwinWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum DigitalTwinStrings {
    public static let table = "DigitalTwinWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }

    public static func count(_ key: String, _ fallbackFormat: String, _ value: Int) -> String {
        String(format: string(key, fallbackFormat), value)
    }
}

// MARK: - Accessibility summary (testable seam)

/// One conditional twin state label (drive/charge/sentry/…) for the a11y summary.
private struct TwinStateFlag {
    let active: Bool
    let key: String
    let fallback: String
}

/// Builds the VoiceOver value spoken for the twin illustration. Pure + public so
/// the a11y label content can be unit-tested without rendering the view.
public enum DigitalTwinAccessibility {
    public static func summary(for state: VehicleTwinState) -> String {
        var parts = [lockPart(state), windowPart(state)]
        if state.openDoorCount > 0 {
            parts.append(DigitalTwinStrings.count("widget.doorsOpenCount", "%lld Doors Open", state.openDoorCount))
        }
        let flags = [
            TwinStateFlag(active: state.isDriving, key: "widget.driving", fallback: "Driving"),
            TwinStateFlag(active: state.isCharging, key: "widget.charging", fallback: "Charging"),
            TwinStateFlag(active: state.sentryMode == true, key: "widget.sentryOn", fallback: "Sentry"),
            TwinStateFlag(active: state.headlights == true, key: "widget.headlightsOn", fallback: "Lights On"),
            TwinStateFlag(active: state.hazards == true, key: "widget.hazardsOn", fallback: "Hazards"),
            TwinStateFlag(active: state.frunkOpen == true, key: "widget.frunkOpen", fallback: "Frunk Open"),
            TwinStateFlag(active: state.trunkOpen == true, key: "widget.trunkOpen", fallback: "Trunk Open")
        ]
        for flag in flags where flag.active {
            parts.append(DigitalTwinStrings.string(flag.key, flag.fallback))
        }
        return parts.joined(separator: ". ")
    }

    private static func lockPart(_ state: VehicleTwinState) -> String {
        switch state.locked {
        case true?: DigitalTwinStrings.string("widget.locked", "Locked")
        case false?: DigitalTwinStrings.string("widget.unlocked", "Unlocked")
        case nil: DigitalTwinStrings.string("widget.lockUnknown", "Lock Unknown")
        }
    }

    private static func windowPart(_ state: VehicleTwinState) -> String {
        if !state.hasWindowData {
            return DigitalTwinStrings.string("widget.windowsUnknown", "Windows Unknown")
        }
        if state.openWindowCount == 0 {
            return DigitalTwinStrings.string("widget.windowsClosed", "Windows Closed")
        }
        return DigitalTwinStrings.count("widget.windowsOpenCount", "%lld Open", state.openWindowCount)
    }
}
