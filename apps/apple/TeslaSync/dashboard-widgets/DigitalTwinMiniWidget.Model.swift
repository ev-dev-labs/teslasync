import Foundation
import OSLog

// MARK: - Surface identity & diagnostics (P1/S11 contract)

/// Stable telemetry slug for the diagnostics `view.opened` event. Mirrors the
/// web registry id used for analytics (`digital-twin-mini`).
public enum DigitalTwinMiniSurface {
    public static let slug = "DigitalTwinMiniWidget"
}

/// Diagnostics seam. The default routes a structured `view.opened` (and any other
/// surface event) to the unified logging subsystem; tests inject a capturing
/// closure. No PII is logged — only the event name and surface slug.
public enum DigitalTwinMiniTelemetry {
    static let logger = Logger(subsystem: "io.teslasync.app", category: "diagnostics")

    public static let osLog: @Sendable (_ event: String, _ surface: String) -> Void = { event, surface in
        logger.info("event=\(event, privacy: .public) surface=\(surface, privacy: .public)")
    }
}

// MARK: - Projection model (native mirror of web `VehicleTwinState`)

/// Open / closed / partial state of a single window. `unknown` replaces the
/// web `null` so the glyph and accessibility layer always have a value.
public enum TwinWindowState: Equatable, Sendable {
    case open, closed, partial, unknown
}

/// Turn-signal state mirrored from the web `TurnSignalState`.
public enum TwinTurnSignal: Equatable, Sendable {
    case left, right, both, off, unknown
}

/// Per-door open booleans (`nil` == unknown), mirroring the web `DoorStates`.
public struct TwinDoorStates: Equatable, Sendable {
    public var driverFront: Bool?
    public var passengerFront: Bool?
    public var driverRear: Bool?
    public var passengerRear: Bool?
    public var trunkFront: Bool?
    public var trunkRear: Bool?

    public init(
        driverFront: Bool? = nil,
        passengerFront: Bool? = nil,
        driverRear: Bool? = nil,
        passengerRear: Bool? = nil,
        trunkFront: Bool? = nil,
        trunkRear: Bool? = nil
    ) {
        self.driverFront = driverFront
        self.passengerFront = passengerFront
        self.driverRear = driverRear
        self.passengerRear = passengerRear
        self.trunkFront = trunkFront
        self.trunkRear = trunkRear
    }

    /// All-unknown doors (web `UNKNOWN_DOORS`).
    public static let unknown = TwinDoorStates()
}

/// Combined digital-twin view-model (web `VehicleTwinState`), the projection the
/// glyph and badges render.
public struct DigitalTwinMiniData: Equatable, Sendable {
    public var doors: TwinDoorStates
    public var windowFD: TwinWindowState
    public var windowFP: TwinWindowState
    public var windowRD: TwinWindowState
    public var windowRP: TwinWindowState
    public var frunkOpen: Bool?
    public var trunkOpen: Bool?
    public var chargePortOpen: Bool?
    public var isCharging: Bool
    public var isDriving: Bool
    public var locked: Bool?
    public var sentryMode: Bool?
    public var headlights: Bool?
    public var hazards: Bool?
    public var turnSignal: TwinTurnSignal
    public var driverSeatOccupied: Bool?
    public var lastUpdated: Date?

    public init(
        doors: TwinDoorStates = .unknown,
        windowFD: TwinWindowState = .unknown,
        windowFP: TwinWindowState = .unknown,
        windowRD: TwinWindowState = .unknown,
        windowRP: TwinWindowState = .unknown,
        frunkOpen: Bool? = nil,
        trunkOpen: Bool? = nil,
        chargePortOpen: Bool? = nil,
        isCharging: Bool = false,
        isDriving: Bool = false,
        locked: Bool? = nil,
        sentryMode: Bool? = nil,
        headlights: Bool? = nil,
        hazards: Bool? = nil,
        turnSignal: TwinTurnSignal = .unknown,
        driverSeatOccupied: Bool? = nil,
        lastUpdated: Date? = nil
    ) {
        self.doors = doors
        self.windowFD = windowFD
        self.windowFP = windowFP
        self.windowRD = windowRD
        self.windowRP = windowRP
        self.frunkOpen = frunkOpen
        self.trunkOpen = trunkOpen
        self.chargePortOpen = chargePortOpen
        self.isCharging = isCharging
        self.isDriving = isDriving
        self.locked = locked
        self.sentryMode = sentryMode
        self.headlights = headlights
        self.hazards = hazards
        self.turnSignal = turnSignal
        self.driverSeatOccupied = driverSeatOccupied
        self.lastUpdated = lastUpdated
    }

    /// Whether any door, frunk, or trunk is reported open.
    public var anyDoorOpen: Bool {
        [
            doors.driverFront, doors.passengerFront,
            doors.driverRear, doors.passengerRear,
            doors.trunkFront, doors.trunkRear,
            frunkOpen, trunkOpen
        ].contains(true)
    }

    /// Whether any window is open or partially open.
    public var anyWindowOpen: Bool {
        [windowFD, windowFP, windowRD, windowRP].contains { $0 == .open || $0 == .partial }
    }

    /// Representative projection for previews and snapshot tests.
    public static let preview = DigitalTwinMiniData(
        doors: TwinDoorStates(driverFront: true),
        windowFD: .open,
        chargePortOpen: true,
        isCharging: true,
        locked: false,
        sentryMode: true,
        lastUpdated: Date(timeIntervalSince1970: 1_700_000_000)
    )
}
