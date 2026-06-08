import Foundation

// MARK: - Pure adapter (native mirror of web `buildTwinState` + parsers)

/// Folds the three live snapshots into one `DigitalTwinMiniData`. Pure and
/// synchronous so it is exhaustively unit-tested without any framework.
public enum DigitalTwinMiniAdapter {
    /// Returns the merged projection, or `nil` when every source is absent
    /// (web returns `EMPTY_TWIN_STATE`; the view treats `nil` as the empty state).
    public static func project(_ inputs: DigitalTwinMiniInputs) -> DigitalTwinMiniData? {
        let security = inputs.security
        let vehicleState = inputs.vehicleState
        let charging = inputs.charging
        if security == nil, vehicleState == nil, charging == nil { return nil }

        let doors = parseDoorState(security?.doorState ?? security?.doorsOpen)
        let chargingActive = isChargingActive(vehicleState, charging)
        let windowsOpen = security?.windowsOpen

        return DigitalTwinMiniData(
            doors: doors,
            windowFD: parseWindowState(security?.fdWindow)
                ?? windowSummary(windowsOpen, ["fd", "front driver", "driver front", "driver_front"]) ?? .unknown,
            windowFP: parseWindowState(security?.fpWindow)
                ?? windowSummary(windowsOpen, ["fp", "front passenger", "passenger front", "passenger_front"]) ??
                .unknown,
            windowRD: parseWindowState(security?.rdWindow)
                ?? windowSummary(windowsOpen, ["rd", "rear driver", "driver rear", "driver_rear"]) ?? .unknown,
            windowRP: parseWindowState(security?.rpWindow)
                ?? windowSummary(windowsOpen, ["rp", "rear passenger", "passenger rear", "passenger_rear"]) ?? .unknown,
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
            lastUpdated: security?.createdAt
        )
    }

    // MARK: Parsers

    static func parseDoorState(_ raw: String?) -> TwinDoorStates {
        guard let value = nonEmpty(raw) else { return .unknown }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return .unknown }
        let lower = trimmed.lowercased()

        if ["closedall", "closed", "none", "[]", "0", "false"].contains(lower) {
            return TwinDoorStates(driverFront: false, passengerFront: false, driverRear: false, passengerRear: false)
        }
        if trimmed.hasPrefix("{"), let parsed = parseDoorJSON(trimmed) { return parsed }

        func has(_ needle: String) -> Bool {
            lower.contains(needle)
        }
        return TwinDoorStates(
            driverFront: has("driver") && has("front") ? true : nil,
            passengerFront: has("passenger") && has("front") ? true : nil,
            driverRear: (has("driver") && has("rear")) || has("driverrear") ? true : nil,
            passengerRear: (has("passenger") && has("rear")) || has("passengerrear") ? true : nil,
            trunkFront: has("frunk") || has("fronttrunk") || has("front_trunk")
                || has("trunkfront") || has("trunk_front") ? true : nil,
            trunkRear: has("reartrunk") || has("rear_trunk") || has("trunkrear")
                || has("trunk_rear") || has("liftgate")
                || (has("trunk") && !has("frunk") && !has("front")) ? true : nil
        )
    }

    private static func parseDoorJSON(_ raw: String) -> TwinDoorStates? {
        guard
            let data = raw.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        func flag(_ camel: String, _ snake: String) -> Bool? {
            if let value = object[camel] { return truthy(value) }
            if let value = object[snake] { return truthy(value) }
            return nil
        }
        return TwinDoorStates(
            driverFront: flag("DriverFront", "driver_front"),
            passengerFront: flag("PassengerFront", "passenger_front"),
            driverRear: flag("DriverRear", "driver_rear"),
            passengerRear: flag("PassengerRear", "passenger_rear"),
            trunkFront: flag("TrunkFront", "trunk_front"),
            trunkRear: flag("TrunkRear", "trunk_rear")
        )
    }

    static func parseWindowState(_ raw: String?) -> TwinWindowState? {
        guard let value = nonEmpty(raw) else { return nil }
        let lower = value.lowercased()
        if lower.contains("partial") || lower.contains("vent") { return .partial }
        if lower.contains("close") || lower == "0" || lower == "false" { return .closed }
        if lower.contains("open") || lower == "true" { return .open }
        return nil
    }

    static func windowSummary(_ windowsOpen: String?, _ aliases: [String]) -> TwinWindowState? {
        guard let value = nonEmpty(windowsOpen) else { return nil }
        let normalized = value.lowercased()
        if ["closed", "none", "[]", "false"].contains(normalized) { return .closed }
        return aliases.contains(where: { normalized.contains($0) }) ? .open : nil
    }

    static func parseTurnSignal(_ raw: String?) -> TwinTurnSignal {
        guard let value = nonEmpty(raw) else { return .unknown }
        let lower = value.lowercased().replacingOccurrences(of: "turnsignal", with: "")
        if lower.contains("both") { return .both }
        if lower.contains("left") { return .left }
        if lower.contains("right") { return .right }
        if lower.contains("off") || lower.isEmpty || lower == "0" { return .off }
        return .unknown
    }

    static func isVehicleDriving(_ vehicleState: TwinVehicleStateSnapshot?) -> Bool {
        guard let vehicleState else { return false }
        return vehicleState.state?.lowercased() == "driving" || (vehicleState.speed ?? 0) > 0
    }

    static func isChargingActive(
        _ vehicleState: TwinVehicleStateSnapshot?,
        _ charging: TwinChargingSnapshot?
    ) -> Bool {
        let normalizedState = (charging?.chargingState?.lowercased() ?? "")
            .filter { !" _-".contains($0) }
        return vehicleState?.isCharging == true
            || (vehicleState?.chargerPower ?? 0) > 0
            || (charging?.chargerPowerKw ?? 0) > 0
            || normalizedState == "charging"
            || normalizedState == "starting"
    }

    private static func truthy(_ value: Any) -> Bool {
        switch value {
        case let flag as Bool: flag
        case let number as NSNumber: number.boolValue
        case let text as String: ["true", "1", "open", "yes"].contains(text.lowercased())
        default: false
        }
    }

    private static func nonEmpty(_ raw: String?) -> String? {
        guard let raw, !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return raw
    }
}
