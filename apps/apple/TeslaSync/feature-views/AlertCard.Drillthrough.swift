//
//  AlertCard.Drillthrough.swift
//  TeslaSync — P4 feature view · 0179 · AlertCard (Apple)
//
//  The alert drill-through route resolution, split out of `AlertCard.Adapter.swift`
//  to keep each file focused (and under the lint file-length budget). A faithful
//  port of web `@/lib/alertDrillthrough` (`SIGNAL_TO_PAGE`, the fallback, and
//  `getAlertDrillthrough` / `getAlertDrillthroughHref`): the card resolves an
//  alert's rule signal to a destination context page and forwards the
//  `vehicle_id` / `t` / `signal` context the destination's `useAlertContext`
//  reads. No SwiftUI and no I/O — exercised directly by the XCTest suite.
//

import Foundation

// MARK: - Drill-through (web `getAlertDrillthroughHref` / `getAlertDrillthrough`)

/// One resolved query parameter for the drill-through target (ordered, so the
/// assembled href is deterministic — web builds `vehicle_id`, then `t`, then
/// `signal`).
public struct AlertDrillthroughParam: Equatable, Sendable {
    public let key: String
    public let value: String

    public init(key: String, value: String) {
        self.key = key
        self.value = value
    }
}

/// The resolved drill-through destination for an alert — the native port of the
/// web `getAlertDrillthrough(alert)`: a destination page path plus the
/// `vehicle_id` / `t` / `signal` context the destination's `useAlertContext`
/// reads. The card hands this to `onViewContext` (the web `<Link to={href}>`).
public struct AlertDrillthrough: Equatable, Sendable {
    public let path: String
    public let query: [AlertDrillthroughParam]

    public init(path: String, query: [AlertDrillthroughParam]) {
        self.path = path
        self.query = query
    }

    /// Generic fallback page when no signal-specific route is registered (web
    /// `SIGNAL_EXPLORER_FALLBACK`).
    public static let signalExplorerFallback = "/signal-explorer"

    /// Telemetry-signal → destination route map (web `SIGNAL_TO_PAGE`). Kept in
    /// step with the web source so a shared alert resolves to the same context page.
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

    /// Web `getAlertDrillthrough(alert)`: pick the destination page from the rule
    /// signal (falling back to the Signal Explorer) and forward the context as
    /// query params. `vehicle_id` is omitted when un-scoped (web treats 0 as none).
    public static func resolve(_ data: AlertCardData) -> AlertDrillthrough {
        let signal = data.ruleSignal.flatMap { $0.isEmpty ? nil : $0 }
        var query: [AlertDrillthroughParam] = []
        if data.vehicleID > 0 {
            query.append(AlertDrillthroughParam(key: "vehicle_id", value: String(data.vehicleID)))
        }
        if !data.createdAt.isEmpty {
            query.append(AlertDrillthroughParam(key: "t", value: data.createdAt))
        }
        if let signal {
            query.append(AlertDrillthroughParam(key: "signal", value: signal))
        }
        let path = signal.flatMap { signalToPage[$0] } ?? signalExplorerFallback
        return AlertDrillthrough(path: path, query: query)
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
