//
//  MotorPerformanceWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0067 · MotorPerformanceWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade (P1/S10) + the
//  display-boundary projection (raw SI snapshot → render-ready values) and its testable accessibility
//  summary. No networking lives here; the view binds through `MotorPerformanceModel`.
//
//  Web source: features/dashboard/widgets/MotorPerformanceWidget.tsx (data: useMotorLatest / useVehicles /
//  useUnits). The widget reads SI off the API and converts at the render boundary, mirroring `useUnits()`
//  + `convertTempFromSI`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for a surface. The default implementation logs via
/// `os.Logger`; the production app injects an adapter that forwards to the shared diagnostics taxonomy
/// (ADR-016), which is consent-gated and redacted there.
public protocol MotorPerformanceTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened` event. Bridges 1:1 to the
/// shared `Telemetry.track(.screenView(screen: surface, …))` at the composition root.
public struct OSLogMotorPerformanceTelemetry: MotorPerformanceTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's data, mirroring the shared `LoadableState` cases the production
/// source projects from the `MotorStore` `Resource<MotorSnapshot>` (`useMotorLatest`).
public enum MotorPerformanceWidgetLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013): the freshness chip surfaces this.
public enum MotorPerformanceWidgetConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// The user's temperature display preference (web `useUnits().unitPrefs.temperature`). The conversion is the
/// SI → display boundary the web performs with `convertTempFromSI`; kept pure so it can be unit-tested.
public enum MotorPerformanceWidgetTemperatureUnit: String, Sendable, Equatable {
    case celsius
    case fahrenheit

    /// The unit suffix shown next to the value (web `tempUnit`).
    public var label: String {
        self == .celsius ? "°C" : "°F"
    }

    /// Converts a stored Celsius (SI) value into the display unit (web `convertTempFromSI`).
    public func convert(fromCelsius celsius: Double) -> Double {
        self == .celsius ? celsius : (celsius * 9 / 5) + 32
    }

    /// Resolves the unit from a shared `UnitPref` label (`"°C"` / `"°F"`), defaulting to Celsius.
    public static func from(label: String) -> MotorPerformanceWidgetTemperatureUnit {
        label.uppercased().contains("F") ? .fahrenheit : .celsius
    }
}

/// The raw `/motor/latest` snapshot the source hands the model, in SI. Field names mirror the web
/// `MotorSnapshot` wire keys (`di_torque`, `di_stator_temp`, `motor_temp_c_front`, `gear`, `shift_state`)
/// plus the drive-dynamics `lateral_accel` / `longitudinal_accel` the widget reads via the raw accessor.
public struct MotorPerformanceWidgetSnapshotInput: Sendable, Equatable {
    /// Drive-inverter torque in newton-meters (web `di_torque`).
    public var diTorque: Double?
    /// Stator temperature in degrees Celsius (web `di_stator_temp`).
    public var diStatorTemp: Double?
    /// Front-motor temperature in degrees Celsius — fallback for the stator readout (web `motor_temp_c_front`).
    public var motorTempCFront: Double?
    /// Gear / drive-inverter gear state (web `gear`).
    public var gear: String?
    /// Shift state — fallback for the gear readout (web `shift_state`).
    public var shiftState: String?
    /// Lateral acceleration in g (web `lateral_accel`).
    public var lateralAccel: Double?
    /// Longitudinal acceleration in g (web `longitudinal_accel`).
    public var longitudinalAccel: Double?

    public init(
        diTorque: Double? = nil,
        diStatorTemp: Double? = nil,
        motorTempCFront: Double? = nil,
        gear: String? = nil,
        shiftState: String? = nil,
        lateralAccel: Double? = nil,
        longitudinalAccel: Double? = nil
    ) {
        self.diTorque = diTorque
        self.diStatorTemp = diStatorTemp
        self.motorTempCFront = motorTempCFront
        self.gear = gear
        self.shiftState = shiftState
        self.lateralAccel = lateralAccel
        self.longitudinalAccel = longitudinalAccel
    }
}

/// One coalesced snapshot pushed by a `MotorPerformanceSource`: the cached DTO plus its load/connection
/// status, the user's temperature preference, and the formatting locale. The model turns it into the
/// `MotorProjection` the view renders.
public struct MotorUpdate: Sendable, Equatable {
    public var status: MotorPerformanceWidgetLoadStatus
    public var connection: MotorPerformanceWidgetConnection
    public var snapshot: MotorPerformanceWidgetSnapshotInput?
    public var temperatureUnit: MotorPerformanceWidgetTemperatureUnit
    public var localeIdentifier: String?
    public var updatedAt: Date?
    public var isFetching: Bool

    public init(
        status: MotorPerformanceWidgetLoadStatus = .loading,
        connection: MotorPerformanceWidgetConnection = .live,
        snapshot: MotorPerformanceWidgetSnapshotInput? = nil,
        temperatureUnit: MotorPerformanceWidgetTemperatureUnit = .celsius,
        localeIdentifier: String? = nil,
        updatedAt: Date? = nil,
        isFetching: Bool = false
    ) {
        self.status = status
        self.connection = connection
        self.snapshot = snapshot
        self.temperatureUnit = temperatureUnit
        self.localeIdentifier = localeIdentifier
        self.updatedAt = updatedAt
        self.isFetching = isFetching
    }
}

/// The seam the view binds through. The production app implements this over the shared P1/S8 state holders
/// (`StateHolderModel<LoadableState<MotorSnapshot>>` from the KMP `MotorStore`, scoped by the selected
/// vehicle from `VehicleStore`); previews and tests use `InMemoryMotorPerformanceSource`. The view never
/// talks to the network directly.
@MainActor
public protocol MotorPerformanceSource: AnyObject {
    /// Set by the model; invoked on the main actor for every coalesced snapshot.
    var onUpdate: (@MainActor (MotorUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// In-memory source for previews + unit/UI tests. Drive it with `push(_:)`.
@MainActor
public final class InMemoryMotorPerformanceSource: MotorPerformanceSource {
    public var onUpdate: (@MainActor (MotorUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: MotorUpdate?

    public init(initial: MotorUpdate? = nil) {
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
    public func push(_ update: MotorUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Observable model

/// The widget's observable view-model. Subscribes to a `MotorPerformanceSource`, recomputes the
/// `MotorProjection` at the display boundary, and exposes a render `Phase` + freshness for SwiftUI to
/// switch over.
@MainActor
@Observable
public final class MotorPerformanceModel {
    /// The mutually-exclusive render branches (web shell loading / error + body empty / shown).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: MotorPerformanceWidgetConnection = .live
    public private(set) var projection: MotorProjection = .empty
    public private(set) var updatedAt: Date?
    public private(set) var isFetching = false

    @ObservationIgnored private let source: any MotorPerformanceSource
    @ObservationIgnored private let telemetry: any MotorPerformanceTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any MotorPerformanceSource,
        telemetry: any MotorPerformanceTelemetry = OSLogMotorPerformanceTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: MotorPerformanceWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to the retry / refresh affordances and the
    /// stale auto-refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: MotorUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        isFetching = update.isFetching
        projection = MotorProjection.make(
            from: update.snapshot,
            temperatureUnit: update.temperatureUnit,
            locale: update.localeIdentifier.map(Locale.init(identifier:)) ?? .motorDefault
        )
        phase = Self.resolvePhase(update, hasData: projection.hasData)
    }

    /// Resolves the render phase. Mirrors the web `WidgetShell`: a hard failure shows the error screen, the
    /// initial fetch (no cache) shows the skeleton, and otherwise the body renders the data or its empty
    /// state. Cached values stay visible behind stale/offline freshness.
    static func resolvePhase(_ update: MotorUpdate, hasData: Bool) -> Phase {
        switch update.status {
        case let .failed(message):
            .error(message)
        case .loading:
            hasData ? .content : .loading
        case .empty:
            .empty
        case .loaded:
            hasData ? .content : .empty
        }
    }
}
