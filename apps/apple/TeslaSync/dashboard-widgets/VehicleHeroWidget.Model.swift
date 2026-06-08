//
//  VehicleHeroWidget.Model.swift
//  TeslaSync — P4 dashboard widget · 0108 · VehicleHeroWidget (Apple)
//
//  State-holder seam (P1/S8) + telemetry seam (P1/S11) + registry + i18n facade
//  (P1/S10). The view binds through `VehicleHeroModel`; no networking lives in the
//  view. The production app wires a `VehicleHeroSource` over the shared vehicles /
//  vehicle-state / live / units / settings state holders; previews and tests use
//  `InMemoryVehicleHeroSource`.
//

import Foundation
import Observation
import OSLog
import SwiftUI

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Emits the `view.opened` product-analytics event for the surface. The default
/// implementation logs via `os.Logger`; the production app injects an adapter that
/// forwards to the shared core `Telemetry.track(.screenView(screen:…))` (ADR-016
/// §5), which is consent-gated and redacted there.
public protocol VehicleHeroTelemetry: Sendable {
    func viewOpened(surface: String)
}

/// `os.Logger`-backed default that records the surface open as a `view.opened`.
public struct OSLogVehicleHeroTelemetry: VehicleHeroTelemetry {
    private let logger: Logger

    public init() {
        logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - State-holder seam (P1/S8 layer)

/// The load lifecycle for the widget's vehicle/state data, mirroring the shared
/// `LoadableState` cases the production source projects from the `Resource<T>`
/// queries (web `useVehicles` / `useVehicleState`).
public enum VehicleHeroLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness, mirroring `LiveConnectionState` (ADR-013). Drives the
/// freshness chip + stale/offline banner; cached values stay visible.
public enum VehicleHeroConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// Cached vehicle identity (web dashboard `Vehicle`). Only the fields the hero
/// header + navigation need are carried across the seam.
public struct VehicleInput: Sendable, Equatable, Identifiable {
    public var id: Int64
    public var vin: String
    public var displayName: String
    public var model: String
    public var trimBadging: String
    public var updatedAt: Date?

    public init(
        id: Int64,
        vin: String,
        displayName: String,
        model: String,
        trimBadging: String,
        updatedAt: Date? = nil
    ) {
        self.id = id
        self.vin = vin
        self.displayName = displayName
        self.model = model
        self.trimBadging = trimBadging
        self.updatedAt = updatedAt
    }
}

/// Cached live vehicle state in **SI units** (web dashboard `VehicleState`): range
/// /odometer in meters, speed in m/s, temps in °C, power in kW, charge-rate in
/// meters/hour, time-to-full in hours. `nil` temps/charge-rate honor the web null
/// guards (`inside_temp != null`, `charge_rate ?? 0`). A `nil` state == "asleep".
public struct VehicleStateInput: Sendable, Equatable {
    public var state: String
    public var speedMps: Double
    public var powerKw: Double
    public var batteryLevel: Double
    public var ratedRangeM: Double
    public var idealRangeM: Double
    public var odometerM: Double
    public var insideTempC: Double?
    public var outsideTempC: Double?
    public var isCharging: Bool
    public var chargerPowerKw: Double
    public var chargeRateMph: Double?
    public var timeToFullChargeH: Double
    public var isLocked: Bool
    public var sentryMode: Bool
    public var softwareVersion: String?

    public init(
        state: String,
        speedMps: Double = 0,
        powerKw: Double = 0,
        batteryLevel: Double = 0,
        ratedRangeM: Double = 0,
        idealRangeM: Double = 0,
        odometerM: Double = 0,
        insideTempC: Double? = nil,
        outsideTempC: Double? = nil,
        isCharging: Bool = false,
        chargerPowerKw: Double = 0,
        chargeRateMph: Double? = nil,
        timeToFullChargeH: Double = 0,
        isLocked: Bool = false,
        sentryMode: Bool = false,
        softwareVersion: String? = nil
    ) {
        self.state = state
        self.speedMps = speedMps
        self.powerKw = powerKw
        self.batteryLevel = batteryLevel
        self.ratedRangeM = ratedRangeM
        self.idealRangeM = idealRangeM
        self.odometerM = odometerM
        self.insideTempC = insideTempC
        self.outsideTempC = outsideTempC
        self.isCharging = isCharging
        self.chargerPowerKw = chargerPowerKw
        self.chargeRateMph = chargeRateMph
        self.timeToFullChargeH = timeToFullChargeH
        self.isLocked = isLocked
        self.sentryMode = sentryMode
        self.softwareVersion = softwareVersion
    }
}

/// Display-unit preferences (web `useUnits` + `useSettings`). The SI values above
/// are converted to these units only at the render boundary (ADR-016).
public struct UnitDisplayPrefs: Sendable, Equatable {
    public var distanceUnit: String
    public var speedUnit: String
    public var tempUnit: String
    public var isFahrenheit: Bool
    public var locale: String?
    public var precision: Int

    public init(
        distanceUnit: String = "km",
        speedUnit: String = "km/h",
        tempUnit: String = "°C",
        isFahrenheit: Bool = false,
        locale: String? = nil,
        precision: Int = 2
    ) {
        self.distanceUnit = distanceUnit
        self.speedUnit = speedUnit
        self.tempUnit = tempUnit
        self.isFahrenheit = isFahrenheit
        self.locale = locale
        self.precision = precision
    }
}

/// One coalesced snapshot pushed by a `VehicleHeroSource`: the cached vehicle +
/// live state + the live firmware hints + unit prefs, plus the load/connection
/// status. The model turns this into the projection + render phase.
public struct VehicleHeroUpdate: Sendable, Equatable {
    public var status: VehicleHeroLoadStatus
    public var connection: VehicleHeroConnection
    public var vehicle: VehicleInput?
    public var state: VehicleStateInput?
    public var liveVersion: String?
    public var liveSwUpdateVersion: String?
    public var prefs: UnitDisplayPrefs
    public var updatedAt: Date?

    public init(
        status: VehicleHeroLoadStatus = .loading,
        connection: VehicleHeroConnection = .live,
        vehicle: VehicleInput? = nil,
        state: VehicleStateInput? = nil,
        liveVersion: String? = nil,
        liveSwUpdateVersion: String? = nil,
        prefs: UnitDisplayPrefs = UnitDisplayPrefs(),
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.state = state
        self.liveVersion = liveVersion
        self.liveSwUpdateVersion = liveSwUpdateVersion
        self.prefs = prefs
        self.updatedAt = updatedAt
    }
}

/// The seam the view binds through. The production app implements this over the
/// shared P1/S8 state holders; previews and tests use `InMemoryVehicleHeroSource`.
@MainActor
public protocol VehicleHeroSource: AnyObject {
    var onUpdate: (@MainActor (VehicleHeroUpdate) -> Void)? { get set }
    func start()
    func stop()
    func refresh()
}

/// The widget's observable view-model. Subscribes to a `VehicleHeroSource`,
/// recomputes the `VehicleHeroProjection`, and exposes a render `Phase` + freshness
/// for SwiftUI to switch over.
@MainActor
@Observable
public final class VehicleHeroModel {
    /// The mutually-exclusive render branches (web shell loading / content / empty).
    public enum Phase: Equatable {
        case loading
        case empty
        case error(String)
        case content
    }

    public private(set) var phase: Phase = .loading
    public private(set) var connection: VehicleHeroConnection = .live
    public private(set) var projection: VehicleHeroProjection?
    public private(set) var updatedAt: Date?

    @ObservationIgnored private let source: any VehicleHeroSource
    @ObservationIgnored private let telemetry: any VehicleHeroTelemetry
    @ObservationIgnored private var started = false

    public init(
        source: any VehicleHeroSource,
        telemetry: any VehicleHeroTelemetry = OSLogVehicleHeroTelemetry()
    ) {
        self.source = source
        self.telemetry = telemetry
        source.onUpdate = { [weak self] update in self?.apply(update) }
    }

    /// Begins observing and emits the `view.opened` diagnostics event. Idempotent.
    public func start() {
        guard !started else { return }
        started = true
        telemetry.viewOpened(surface: VehicleHeroWidget.surfaceSlug)
        source.start()
    }

    /// Stops observing the upstream feed.
    public func stop() {
        started = false
        source.stop()
    }

    /// Forces a refresh (cached value stays visible). Wired to retry / refresh.
    public func refresh() {
        source.refresh()
    }

    private func apply(_ update: VehicleHeroUpdate) {
        connection = update.connection
        updatedAt = update.updatedAt
        projection = update.vehicle.map { vehicle in
            VehicleHeroProjection.build(
                vehicle: vehicle,
                state: update.state,
                firmware: VehicleHeroFirmware.resolve(update),
                prefs: update.prefs,
                localize: VehicleHeroStrings.string
            )
        }
        phase = Self.resolvePhase(update)
    }

    /// Resolves the render phase. The web shell only shows the skeleton on the
    /// initial fetch (`loading={!vehicle}`); once a vehicle is known the widget
    /// renders (cached values stay visible behind refresh/errors, the freshness
    /// chip reflecting staleness/failure). A resolved-but-empty fleet renders the
    /// friendly empty state rather than a perpetual skeleton.
    public static func resolvePhase(_ update: VehicleHeroUpdate) -> Phase {
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
public final class InMemoryVehicleHeroSource: VehicleHeroSource {
    public var onUpdate: (@MainActor (VehicleHeroUpdate) -> Void)?
    public private(set) var startCount = 0
    public private(set) var stopCount = 0
    public private(set) var refreshCount = 0

    private let initial: VehicleHeroUpdate?

    public init(initial: VehicleHeroUpdate? = nil) {
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
    public func push(_ update: VehicleHeroUpdate) {
        onUpdate?(update)
    }
}

// MARK: - Registry metadata (web `WidgetDef`)

/// A grid size in dashboard columns × rows (web `WidgetSize`).
public struct DashboardWidgetSize: Sendable, Equatable {
    public var cols: Int
    public var rows: Int

    public init(cols: Int, rows: Int) {
        self.cols = cols
        self.rows = rows
    }
}

/// The dashboard registration for a draggable widget surface (web `WidgetDef`).
public struct DashboardWidgetRegistration: Sendable {
    public let id: String
    public let nameKey: String
    public let descriptionKey: String
    public let category: String
    public let defaultSize: DashboardWidgetSize
    public let minSize: DashboardWidgetSize
    public let maxSize: DashboardWidgetSize

    /// Clamps a requested grid size into the surface's `min…max` envelope, so the
    /// native grid honors the same constraints as the web registry.
    public func clamp(_ size: DashboardWidgetSize) -> DashboardWidgetSize {
        DashboardWidgetSize(
            cols: min(max(size.cols, minSize.cols), maxSize.cols),
            rows: min(max(size.rows, minSize.rows), maxSize.rows)
        )
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback, so the
/// view holds no hardcoded literals. Keys live in the "VehicleHeroWidget" table,
/// folded into the app `Localizable.xcstrings` catalog at integration time.
public enum VehicleHeroStrings {
    public static let table = "VehicleHeroWidget"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }

    public static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}
