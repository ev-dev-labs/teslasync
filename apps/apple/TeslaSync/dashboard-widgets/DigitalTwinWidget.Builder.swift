//
//  DigitalTwinWidget.Builder.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  Pure parsers + buildTwinState — the unit-tested cached→projection adapter, a faithful Swift port of web
//  lib/vehicleState.ts.
//

import Foundation

// MARK: - Domain: parsers + buildTwinState (faithful port of lib/vehicleState.ts)

/// Pure adapters that merge cached telemetry DTOs into a `VehicleTwinState`.
/// Mirrors the web `lib/vehicleState.ts` exactly so both platforms agree on the
/// projection. No SwiftUI / transport here — this is the unit-tested core.
public enum TwinStateBuilder {
    /// Parses the compound DoorState signal (web `parseDoorState`).
    public static func parseDoorState(_ signal: TwinDoorSignal) -> TwinDoorStates {
        switch signal {
        case let .fields(fields):
            TwinDoorStates(
                driverFront: boolField(fields, "DriverFront", "driver_front"),
                passengerFront: boolField(fields, "PassengerFront", "passenger_front"),
                driverRear: boolField(fields, "DriverRear", "driver_rear"),
                passengerRear: boolField(fields, "PassengerRear", "passenger_rear"),
                trunkFront: boolField(fields, "TrunkFront", "trunk_front"),
                trunkRear: boolField(fields, "TrunkRear", "trunk_rear")
            )
        case let .text(raw):
            parseDoorText(raw)
        case .absent:
            .unknown
        }
    }

    private static func parseDoorText(_ raw: String) -> TwinDoorStates {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .unknown }
        let lower = trimmed.lowercased()

        if ["closedall", "closed", "none", "[]", "0", "false"].contains(lower) {
            return TwinDoorStates(
                driverFront: false,
                passengerFront: false,
                driverRear: false,
                passengerRear: false,
                trunkFront: nil,
                trunkRear: nil
            )
        }

        if let object = jsonObject(trimmed) {
            return TwinDoorStates(
                driverFront: jsonBool(object, "DriverFront", "driver_front"),
                passengerFront: jsonBool(object, "PassengerFront", "passenger_front"),
                driverRear: jsonBool(object, "DriverRear", "driver_rear"),
                passengerRear: jsonBool(object, "PassengerRear", "passenger_rear"),
                trunkFront: jsonBool(object, "TrunkFront", "trunk_front"),
                trunkRear: jsonBool(object, "TrunkRear", "trunk_rear")
            )
        }

        // Descriptive value matching (e.g. "OpenDriverFront").
        let driverFront = lower.contains("driver") && lower.contains("front")
        let passengerFront = lower.contains("passenger") && lower.contains("front")
        let driverRear = (lower.contains("driver") && lower.contains("rear")) || lower.contains("driverrear")
        let passengerRear = (lower.contains("passenger") && lower.contains("rear")) || lower.contains("passengerrear")
        let frunk = lower.contains("frunk") || lower.contains("fronttrunk")
            || lower.contains("front_trunk") || lower.contains("trunkfront") || lower.contains("trunk_front")
        return TwinDoorStates(
            driverFront: driverFront ? true : nil,
            passengerFront: passengerFront ? true : nil,
            driverRear: driverRear ? true : nil,
            passengerRear: passengerRear ? true : nil,
            trunkFront: frunk ? true : nil,
            trunkRear: matchesTrunkRear(lower) ? true : nil
        )
    }

    private static func matchesTrunkRear(_ lower: String) -> Bool {
        let explicitRear = lower.contains("reartrunk") || lower.contains("rear_trunk")
            || lower.contains("trunkrear") || lower.contains("trunk_rear") || lower.contains("liftgate")
        let genericTrunk = lower.contains("trunk") && !lower.contains("frunk") && !lower.contains("front")
        return explicitRear || genericTrunk
    }

    /// Normalizes a Tesla window enum value to display state (web `parseWindowState`).
    public static func parseWindowState(_ raw: String?) -> TwinWindowState? {
        guard let value = nonEmpty(raw) else { return nil }
        let lower = value.lowercased()
        if lower.contains("closed") || lower == "0" { return .closed }
        if lower.contains("partial") || lower.contains("vent") { return .partial }
        if lower.contains("open") { return .open }
        return nil
    }

    /// Normalizes a turn-signal value (web `parseTurnSignal`).
    public static func parseTurnSignal(_ raw: String?) -> TwinTurnSignalState? {
        guard let value = nonEmpty(raw) else { return nil }
        let lower = value.lowercased().replacingOccurrences(of: "turnsignal", with: "")
        if lower.contains("both") { return .both }
        if lower.contains("left") { return .left }
        if lower.contains("right") { return .right }
        if lower.contains("off") || lower.isEmpty || lower == "0" { return .off }
        return nil
    }

    /// Merges SecurityEvent + VehicleState + ChargingTelemetry into a single
    /// projection (web `buildTwinState`).
    public static func buildTwinState(
        security: TwinSecurityInput?,
        vehicleState: TwinVehicleStateInput?,
        charging: TwinChargingInput?
    ) -> VehicleTwinState {
        if security == nil, vehicleState == nil, charging == nil { return .empty }

        let primaryDoors = security?.doorState ?? .absent
        let doorSignal = primaryDoors.isPresent ? primaryDoors : (security?.doorsOpen ?? .absent)
        let doors = parseDoorState(doorSignal)
        let chargingActive = isChargingActive(vehicleState, charging)
        let windowsOpen = security?.windowsOpen

        return VehicleTwinState(
            doors: doors,
            windowFD: parseWindowState(security?.fdWindow)
                ?? parseWindowOpenSummary(windowsOpen, ["fd", "front driver", "driver front", "driver_front"]),
            windowFP: parseWindowState(security?.fpWindow)
                ?? parseWindowOpenSummary(windowsOpen, ["fp", "front passenger", "passenger front", "passenger_front"]),
            windowRD: parseWindowState(security?.rdWindow)
                ?? parseWindowOpenSummary(windowsOpen, ["rd", "rear driver", "driver rear", "driver_rear"]),
            windowRP: parseWindowState(security?.rpWindow)
                ?? parseWindowOpenSummary(windowsOpen, ["rp", "rear passenger", "passenger rear", "passenger_rear"]),
            frunkOpen: doors.trunkFront,
            trunkOpen: doors.trunkRear,
            chargePortOpen: charging?.chargePortDoorOpen ?? (chargingActive ? true : nil),
            isCharging: chargingActive,
            isDriving: isVehicleDriving(vehicleState),
            locked: security?.locked ?? vehicleState?.isLocked,
            sentryMode: security?.sentryMode ?? vehicleState?.sentryMode,
            headlights: security?.lightsHighBeams,
            hazards: security?.lightsHazardsActive,
            turnSignal: parseTurnSignal(security?.lightsTurnSignal),
            driverSeatOccupied: security?.driverSeatOccupied,
            vehicleColor: "",
            lastUpdated: security?.createdAt
        )
    }

    // MARK: Private helpers

    private static func isVehicleDriving(_ state: TwinVehicleStateInput?) -> Bool {
        guard let state else { return false }
        if state.state?.lowercased() == "driving" { return true }
        return (state.speed ?? 0) > 0
    }

    private static func isChargingActive(_ state: TwinVehicleStateInput?, _ charging: TwinChargingInput?) -> Bool {
        let normalized = (charging?.chargingState ?? "")
            .lowercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
        if state?.isCharging == true { return true }
        if (state?.chargerPower ?? 0) > 0 { return true }
        if (charging?.chargerPowerKw ?? 0) > 0 { return true }
        return normalized == "charging" || normalized == "starting"
    }

    private static func parseWindowOpenSummary(_ windowsOpen: String?, _ aliases: [String]) -> TwinWindowState? {
        guard let value = nonEmpty(windowsOpen) else { return nil }
        let normalized = value.lowercased()
        if ["closed", "none", "[]", "false"].contains(normalized) { return .closed }
        return aliases.contains(where: { normalized.contains($0) }) ? .open : nil
    }

    private static func boolField(_ fields: [String: Bool], _ primary: String, _ secondary: String) -> Bool? {
        fields[primary] ?? fields[secondary]
    }

    private static func jsonBool(_ object: [String: Any], _ primary: String, _ secondary: String) -> Bool? {
        if let value = object[primary], !(value is NSNull) { return truthy(value) }
        if let value = object[secondary], !(value is NSNull) { return truthy(value) }
        return nil
    }

    private static func jsonObject(_ trimmed: String) -> [String: Any]? {
        guard trimmed.hasPrefix("{"), let data = trimmed.data(using: .utf8) else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    private static func truthy(_ value: Any) -> Bool {
        switch value {
        case let bool as Bool: bool
        case let number as NSNumber: number != 0
        case let string as String: !string.isEmpty
        default: true
        }
    }

    private static func nonEmpty(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
