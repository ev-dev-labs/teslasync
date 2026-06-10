//
//  NotificationRow.Drillthrough.swift
//  TeslaSync — P4 feature view · 0191 · NotificationRow (Apple)
//
//  The "View context" drill-through route resolution, split out of the adapter to
//  keep each file focused. A faithful port of web `@/lib/alertDrillthrough`
//  (`SIGNAL_TO_PAGE`, the fallback, and `getAlertDrillthrough` /
//  `getAlertDrillthroughHref`) for the synthetic `Alert` the web row builds from its
//  `log` + `rule` + `vehicle`: it resolves the rule signal to a destination context
//  page and forwards the `vehicle_id` / `t` / `signal` context the destination's
//  `useAlertContext` reads. No SwiftUI and no I/O — exercised directly by XCTest.
//
//  Kept self-contained (the map is pinned to the web source) so this surface prompt
//  owns its own files, matching the repo's per-surface drill-through convention.
//

import Foundation

// MARK: - Drill-through param (web URLSearchParams entry)

/// One resolved query parameter for the drill-through target (ordered, so the
/// assembled href is deterministic — web builds `vehicle_id`, then `t`, then
/// `signal`).
public struct NotificationRowDrillthroughParam: Equatable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

// MARK: - Drill-through (web `getAlertDrillthrough` / `getAlertDrillthroughHref`)

/// The resolved drill-through destination for a notification row — the native port
/// of the web `getAlertDrillthrough(synthetic)`: a destination page path plus the
/// `vehicle_id` / `t` / `signal` context the destination's `useAlertContext` reads.
/// The row hands this to the navigation seam (the web `<Link to={href}>`).
public struct NotificationRowDrillthrough: Equatable, Sendable {
    public let path: String
    public let query: [NotificationRowDrillthroughParam]

    public init(path: String, query: [NotificationRowDrillthroughParam]) {
        self.path = path
        self.query = query
    }

    /// Generic fallback page when no signal-specific route is registered (web
    /// `SIGNAL_EXPLORER_FALLBACK`).
    public static let signalExplorerFallback = "/signal-explorer"

    /// Telemetry-signal → destination route map (web `SIGNAL_TO_PAGE`). Kept in step
    /// with the web source so a shared alert resolves to the same context page.
    public static let signalToPage: [String: String] = [
        // Battery
        "BatteryLevel": "/battery",
        "RatedRange": "/battery",
        "ChargeLimitSoc": "/battery",
        "EstBatteryRange": "/battery",
        "IdealBatteryRange": "/battery",
        // Charging
        "ChargeState": "/charging",
        "DetailedChargeState": "/charging",
        "DCChargingPower": "/charging",
        "ACChargingPower": "/charging",
        "ChargeAmps": "/charging",
        "ChargerVoltage": "/charging",
        "ChargerActualCurrent": "/charging",
        "ChargingCableType": "/charging",
        // Driving
        "Gear": "/drives",
        "VehicleSpeed": "/drives",
        "Power": "/drives",
        "Odometer": "/drives",
        // Climate
        "InsideTemp": "/climate-control",
        "OutsideTemp": "/climate-control",
        "HvacPower": "/climate-control",
        "ClimateKeeperMode": "/climate-control",
        // Tire pressure
        "TpmsPressureFl": "/tire-pressure",
        "TpmsPressureFr": "/tire-pressure",
        "TpmsPressureRl": "/tire-pressure",
        "TpmsPressureRr": "/tire-pressure",
        "TpmsHardWarnings": "/tire-pressure",
        "TpmsSoftWarnings": "/tire-pressure",
        "TpmsLastSeenPressureTimeFl": "/tire-pressure",
        "TpmsLastSeenPressureTimeFr": "/tire-pressure",
        "TpmsLastSeenPressureTimeRl": "/tire-pressure",
        "TpmsLastSeenPressureTimeRr": "/tire-pressure",
        // Security / access
        "Locked": "/security-access",
        "SentryMode": "/security-access",
        "DoorState": "/security-access",
        "WindowState": "/security-access",
        "SunroofInstalled": "/security-access",
        // Software
        "SoftwareUpdateVersion": "/software-updates",
        "SoftwareUpdateDownloadPercentComplete": "/software-updates",
        "SoftwareUpdateInstallationPercentComplete": "/software-updates",
        "SoftwareUpdateExpectedDurationMinutes": "/software-updates",
        // Location / navigation
        "LocatedAtHome": "/navigation",
        "LocatedAtWork": "/navigation",
        "LocatedAtFavorite": "/navigation",
        "DestinationName": "/navigation",
        "DestinationLocation": "/navigation"
    ]

    /// Web `getAlertDrillthrough(synthetic)`: pick the destination page from the rule
    /// signal (falling back to the Signal Explorer) and forward the context as query
    /// params. `vehicle_id` is omitted when un-scoped (web treats 0 as none); `t` is
    /// omitted when the created-at timestamp is empty.
    public static func resolve(
        signal rawSignal: String?,
        vehicleID: Int,
        createdAtISO: String
    ) -> NotificationRowDrillthrough {
        let signal = rawSignal.flatMap { $0.isEmpty ? nil : $0 }
        var query: [NotificationRowDrillthroughParam] = []
        if vehicleID > 0 {
            query.append(NotificationRowDrillthroughParam(key: "vehicle_id", value: String(vehicleID)))
        }
        if !createdAtISO.isEmpty {
            query.append(NotificationRowDrillthroughParam(key: "t", value: createdAtISO))
        }
        if let signal {
            query.append(NotificationRowDrillthroughParam(key: "signal", value: signal))
        }
        let path = signal.flatMap { signalToPage[$0] } ?? signalExplorerFallback
        return NotificationRowDrillthrough(path: path, query: query)
    }

    /// Web `getAlertDrillthroughHref`: a single navigable href string
    /// (`path?vehicle_id=…&t=…&signal=…`) with the query percent-encoded.
    public var href: String {
        guard !query.isEmpty else { return path }
        var components = URLComponents()
        components.path = path
        components.queryItems = query.map { URLQueryItem(name: $0.key, value: $0.value) }
        let search = components.percentEncodedQuery ?? ""
        return search.isEmpty ? path : "\(path)?\(search)"
    }
}
