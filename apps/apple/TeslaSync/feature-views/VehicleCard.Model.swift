//
//  VehicleCard.Model.swift
//  TeslaSync — P4 feature view · 0302 · VehicleCard (Apple)
//
//  Surface identity (P1/S11 diagnostics slug), telemetry seam (P1/S11
//  `view.opened`), the i18n facade (P1/S10), and the pure input value types for
//  the SwiftUI parity of web/src/features/vehicles/components/VehicleCard.tsx.
//
//  The web card receives one `vehicle` (the S8 `useVehicles` row) and binds
//  `useVehicleState(vehicle.id)` for the live snapshot, plus `useUnits` for the
//  display formatting and `useTranslation('vehicles')` for copy. The native
//  surface mirrors that through the P1/S8 state-holder seam: a `VehicleCardSource`
//  (production-wired over the vehicles + vehicle-state holders) pushes a coalesced
//  `VehicleCardUpdate`; the view performs no networking. Keys arrive snake_case
//  from `GET /api/v1/vehicles` and `GET /api/v1/vehicles/{id}/state`; the value
//  types carry only the fields this card reads and keep distances/temps/energy in
//  SI (meters, °C, watts) — the display preference is applied at the render
//  boundary by the injected `VehicleCardUnitsFormatting`.
//

import Foundation
import OSLog

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// Stable, non-identifying identity for the `VehicleCard` feature view. The slug
/// is the value emitted with the P1/S11 `view.opened` diagnostics contract and is
/// referenced by both the view and its tests so the two never drift.
public enum VehicleCardSurface {
    /// The diagnostics slug emitted with the `view.opened` event.
    public static let slug = "VehicleCard"

    /// Reports the surface becoming visible. Factored out of the view's lifecycle
    /// so it is unit-testable without a rendering host.
    public static func reportOpen(to telemetry: any VehicleCardTelemetry) {
        telemetry.viewOpened(surface: slug)
    }
}

// MARK: - Telemetry seam (P1/S11 diagnostics contract)

/// Diagnostics seam for the P1/S11 `view.opened` contract. The model reports the
/// surface appearance through this protocol so production wiring, previews, and
/// tests can each supply their own sink. `Sendable` so emission needs no
/// main-actor hop.
public protocol VehicleCardTelemetry: Sendable {
    /// A surface became visible. `surface` is a stable, non-identifying slug.
    func viewOpened(surface: String)
}

/// Default sink: emits a redaction-safe `view.opened` `os_log` event. The slug is
/// a static, non-identifying constant logged verbatim; no display name, VIN, or
/// location is ever recorded.
public struct OSLogVehicleCardTelemetry: VehicleCardTelemetry {
    private let logger: Logger

    public init(subsystem: String = "io.teslasync.app", category: String = "diagnostics") {
        logger = Logger(subsystem: subsystem, category: category)
    }

    public func viewOpened(surface: String) {
        logger.info("view.opened surface=\(surface, privacy: .public)")
    }
}

// MARK: - Localization facade (P1/S10) — web `t(key, default)`

/// Resolves the surface's strings by key with the web English fallback so the
/// view holds no hardcoded literals. Keys live in the "VehicleCard" table, folded
/// into the app `Localizable.xcstrings` catalog at integration time. The web
/// source keys (`card.interior`, `card.charging`, `card.viewDetails`,
/// `card.removeVehicle`) and the FSM status keys (`vehicle.state.*`) are preserved
/// verbatim so a shared catalog resolves identically across web and native.
public enum VehicleCardStrings {
    public static let table = "VehicleCard"

    public static func string(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, tableName: table, bundle: .main, value: fallback, comment: "")
    }
}

/// A thin localization seam so the pure projections stay testable: production
/// passes the `VehicleCardStrings` facade (real catalog + English fallback), tests
/// and previews pass `.echo` (returns the fallback directly).
public struct VehicleCardLocalizer: Sendable {
    public let string: @Sendable (String, String) -> String

    public init(string: @escaping @Sendable (String, String) -> String) {
        self.string = string
    }

    /// Production localizer backed by the surface's `.strings` table.
    public static let bundle = VehicleCardLocalizer(string: VehicleCardStrings.string)

    /// Bundle-free localizer for previews/tests: yields the English fallback.
    public static let echo = VehicleCardLocalizer(string: { _, fallback in fallback })
}

// MARK: - Card identity input (web `props.vehicle` from `useVehicles`)

/// The vehicle identity the card renders (web `Vehicle` subset from `useVehicles`).
/// The parent maps the S8 row into this; the card never touches the network.
public struct VehicleCardVehicle: Equatable, Sendable, Identifiable {
    public let id: Int64
    public let displayName: String
    public let vin: String
    public let model: String
    public let trimBadging: String

    public init(
        id: Int64,
        displayName: String,
        vin: String,
        model: String,
        trimBadging: String = ""
    ) {
        self.id = id
        self.displayName = displayName
        self.vin = vin
        self.model = model
        self.trimBadging = trimBadging
    }
}

// MARK: - Live state input (web `useVehicleState(id).state`)

/// The live vehicle snapshot the card reads (web `VehicleState` subset). All
/// physical quantities are SI (meters, °C, watts, m/s); the display preference is
/// applied later by `VehicleCardUnitsFormatting`. Optional fields mirror the
/// web nullable coalescing (`?? 0`, `?? false`).
public struct VehicleCardLiveState: Equatable, Sendable {
    /// Raw FSM state string (web `state.state`, e.g. `online`/`asleep`).
    public let state: String
    /// State of charge percent 0…100 (web `battery_level`).
    public let batteryLevel: Int
    /// Rated range in meters, SI (web `rated_range`).
    public let ratedRangeMeters: Double
    /// Cabin temperature in °C, SI (web `inside_temp`).
    public let insideTempCelsius: Double
    /// Odometer in meters, SI (web `odometer`).
    public let odometerMeters: Double
    /// Charger power in watts, SI (web `charger_power`).
    public let chargerPowerWatts: Double
    /// Instantaneous speed in m/s, SI (web `speed`).
    public let speedMetersPerSecond: Double
    public let isCharging: Bool
    public let isLocked: Bool
    public let sentryMode: Bool

    public init(
        state: String,
        batteryLevel: Int,
        ratedRangeMeters: Double,
        insideTempCelsius: Double,
        odometerMeters: Double,
        chargerPowerWatts: Double,
        speedMetersPerSecond: Double = 0,
        isCharging: Bool = false,
        isLocked: Bool = true,
        sentryMode: Bool = false
    ) {
        self.state = state
        self.batteryLevel = batteryLevel
        self.ratedRangeMeters = ratedRangeMeters
        self.insideTempCelsius = insideTempCelsius
        self.odometerMeters = odometerMeters
        self.chargerPowerWatts = chargerPowerWatts
        self.speedMetersPerSecond = speedMetersPerSecond
        self.isCharging = isCharging
        self.isLocked = isLocked
        self.sentryMode = sentryMode
    }
}

// MARK: - Load + freshness (S8 query lifecycle + ADR-013 live stream)

/// The load lifecycle for the surface's vehicle query, mirroring the shared
/// `LoadableState` cases the production source projects (web TanStack Query
/// loading / resolved / empty / failure).
public enum VehicleCardLoadStatus: Sendable, Equatable {
    case loading
    case loaded
    case empty
    case failed(String)
}

/// Live-stream freshness (ADR-013). Drives the freshness chip + keeps the cached
/// card visible but clearly labeled while reconnecting (stale) or offline.
public enum VehicleCardConnection: Sendable, Equatable {
    case live
    case stale
    case offline
}

/// One coalesced snapshot pushed by a `VehicleCardSource`: the cached vehicle
/// identity, its optional live state, and the load + connection status. The model
/// turns this into the rendered `VehicleCardData`.
public struct VehicleCardUpdate: Sendable, Equatable {
    public var status: VehicleCardLoadStatus
    public var connection: VehicleCardConnection
    public var vehicle: VehicleCardVehicle?
    public var state: VehicleCardLiveState?
    public var updatedAt: Date?

    public init(
        status: VehicleCardLoadStatus = .loading,
        connection: VehicleCardConnection = .live,
        vehicle: VehicleCardVehicle? = nil,
        state: VehicleCardLiveState? = nil,
        updatedAt: Date? = nil
    ) {
        self.status = status
        self.connection = connection
        self.vehicle = vehicle
        self.state = state
        self.updatedAt = updatedAt
    }
}

/// The render branch the view switches over (web shell loading / content, plus
/// the resolved-with-no-vehicle empty state and the no-cached-data failure state).
public enum VehicleCardPhase: Sendable, Equatable {
    case loading
    case empty
    case error(String)
    case content
}

// MARK: - Action seam (web `<Link to=…>` + `onDelete`)

/// The callbacks the card invokes — the native port of the web card's navigation
/// `<Link to={`/vehicles/${id}`}>` (native has no router, so the resolved vehicle
/// id is handed to the parent) and the required `onDelete` prop, plus an optional
/// retry for the native error state. No mutation logic lives in the card: the
/// parent owns the store-backed effects, exactly like the web component.
public struct VehicleCardActions {
    public let onViewDetails: (Int64) -> Void
    public let onDelete: (VehicleCardVehicle) -> Void
    public let onRetry: () -> Void

    public init(
        onViewDetails: @escaping (Int64) -> Void,
        onDelete: @escaping (VehicleCardVehicle) -> Void,
        onRetry: @escaping () -> Void = {}
    ) {
        self.onViewDetails = onViewDetails
        self.onDelete = onDelete
        self.onRetry = onRetry
    }
}
