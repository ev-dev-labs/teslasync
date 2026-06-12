//
//  VehicleTwin.Legend.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The per-subsystem status-legend derivation — the native, always-visible, accessible peer of the
//  web `VehicleTwin` hover tooltips (`InteractiveHotspot` / `<title>`) and the port of its label
//  helpers (`windowLabel` / `stateLabel`, the security + charge labels). Pure value logic
//  (Foundation only); localized through the P1/S10 facade so the projection stays a pure function of
//  the bound `VehicleTwinState`. One chip per subsystem is always emitted — no subsystem is hidden
//  when its signal is unknown (P4 rule #6). The per-region detail rows live in
//  VehicleTwin.Regions.swift.
//

import Foundation

// MARK: - Resolved subsystem reading

/// A resolved subsystem reading — the chip value, its semantic tone, and its SF Symbol.
private struct VehicleTwinLegendValue {
    let value: String
    let tone: VehicleTwinTone
    let systemImage: String
}

// MARK: - Legend builder (thin facade over the file-scoped derivations)

/// Builds the localized status legend + the VoiceOver state summary for a `VehicleTwinState`.
enum VehicleTwinLegendBuilder {
    /// One chip per subsystem, in a stable head-to-tail order.
    static func items(for state: VehicleTwinState) -> [VehicleTwinLegendItem] {
        [
            item(.lock, "vehicles.twin.legend.lock", "Lock", twinLockValue(state)),
            item(.doors, "vehicles.twin.legend.doors", "Doors", twinDoorsValue(state)),
            item(.windows, "vehicles.twin.legend.windows", "Windows", twinWindowsValue(state)),
            item(.frunkTrunk, "vehicles.twin.legend.frunkTrunk", "Frunk / Trunk", twinFrunkTrunkValue(state)),
            item(.charge, "vehicles.twin.legend.charge", "Charge", twinChargeValue(state)),
            item(.lights, "vehicles.twin.legend.lights", "Lights", twinLightsValue(state)),
            item(.turnSignal, "vehicles.twin.legend.turnSignal", "Turn signal", twinTurnValue(state)),
            item(.sentry, "vehicles.twin.legend.sentry", "Sentry", twinSentryValue(state)),
            item(.seat, "vehicles.twin.legend.seat", "Driver seat", twinSeatValue(state)),
            item(.motion, "vehicles.twin.legend.motion", "Motion", twinMotionValue(state))
        ]
    }

    /// The localized VoiceOver summary — lock + windows + the active flags (web `aria` intent).
    static func summary(for state: VehicleTwinState) -> String {
        var parts: [String] = [twinLockValue(state).value, twinWindowsValue(state).value]
        if state.openDoorCount > 0 {
            parts.append(VehicleTwinStrings.format("vehicles.twin.value.doorsOpen", "%lld open", state.openDoorCount))
        }
        if state.isDriving { parts.append(VehicleTwinStrings.string("vehicles.twin.value.driving", "Driving")) }
        if state.isCharging { parts.append(VehicleTwinStrings.string("vehicles.twin.value.charging", "Charging")) }
        if state.sentryMode == true {
            parts.append(VehicleTwinStrings.string("vehicles.twin.sentry", "Sentry mode active"))
        }
        if state.headlights == true { parts.append(twinOnValue) }
        if state.hazards == true { parts.append(VehicleTwinStrings.string("vehicles.twin.value.hazardsOn", "Hazards")) }
        if state.frunkOpen == true { parts.append(VehicleTwinStrings.string(
            "vehicles.twin.value.frunkOpen",
            "Frunk open"
        )) }
        if state.trunkOpen == true { parts.append(VehicleTwinStrings.string(
            "vehicles.twin.value.trunkOpen",
            "Trunk open"
        )) }
        return parts.joined(separator: ". ")
    }

    private static func item(
        _ kind: VehicleTwinLegendItem.Kind,
        _ labelKey: String,
        _ labelFallback: String,
        _ resolved: VehicleTwinLegendValue
    ) -> VehicleTwinLegendItem {
        VehicleTwinLegendItem(
            kind: kind,
            label: VehicleTwinStrings.string(labelKey, labelFallback),
            value: resolved.value,
            tone: resolved.tone,
            systemImage: resolved.systemImage
        )
    }
}

// MARK: - Per-subsystem derivations (web `C`-intent labels)

private func twinLockValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    switch state.locked {
    case true?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.locked", "Locked"),
            tone: .success,
            systemImage: "lock.fill"
        )
    case false?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.unlocked", "Unlocked"),
            tone: .danger,
            systemImage: "lock.open.fill"
        )
    case nil:
        VehicleTwinLegendValue(value: twinUnknownValue, tone: .neutral, systemImage: "lock")
    }
}

private func twinDoorsValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    let known = state.sideDoorStates.contains { $0 != nil }
    guard known else {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.doorsUnknown", "Unknown"),
            tone: .neutral,
            systemImage: "car.side"
        )
    }
    let open = state.openDoorCount
    if open > 0 {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.format("vehicles.twin.value.doorsOpen", "%lld open", open),
            tone: .warning,
            systemImage: "car.side"
        )
    }
    return VehicleTwinLegendValue(
        value: VehicleTwinStrings.string("vehicles.twin.value.doorsAllClosed", "All closed"),
        tone: .success,
        systemImage: "car.side"
    )
}

private func twinWindowsValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    guard state.hasWindowData else {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.windowsUnknown", "Unknown"),
            tone: .neutral,
            systemImage: "window.vertical.closed"
        )
    }
    let open = state.openWindowCount
    if open > 0 {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.format("vehicles.twin.value.windowsOpen", "%lld open", open),
            tone: .warning,
            systemImage: "window.vertical.open"
        )
    }
    return VehicleTwinLegendValue(
        value: VehicleTwinStrings.string("vehicles.twin.value.windowsAllClosed", "All closed"),
        tone: .success,
        systemImage: "window.vertical.closed"
    )
}

private func twinFrunkTrunkValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    let frunk = state.frunkOpen == true
    let trunk = state.trunkOpen == true
    if frunk, trunk {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.frunkTrunkOpen", "Both open"),
            tone: .warning,
            systemImage: "shippingbox.fill"
        )
    }
    if frunk {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.frunkOpen", "Frunk open"),
            tone: .warning,
            systemImage: "shippingbox.fill"
        )
    }
    if trunk {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.trunkOpen", "Trunk open"),
            tone: .warning,
            systemImage: "shippingbox.fill"
        )
    }
    if state.frunkOpen == false || state.trunkOpen == false {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.frunkTrunkClosed", "Closed"),
            tone: .success,
            systemImage: "shippingbox"
        )
    }
    return VehicleTwinLegendValue(value: twinNoneValue, tone: .neutral, systemImage: "shippingbox")
}

private func twinChargeValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    if state.isCharging {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.charging", "Charging"),
            tone: .success,
            systemImage: "bolt.fill"
        )
    }
    if state.chargePortOpen == true {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.chargePortOpen", "Port open"),
            tone: .info,
            systemImage: "bolt"
        )
    }
    return VehicleTwinLegendValue(
        value: VehicleTwinStrings.string("vehicles.twin.value.chargeIdle", "Idle"),
        tone: .neutral,
        systemImage: "bolt.slash"
    )
}

private func twinLightsValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    if state.hazards == true {
        return VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.hazardsOn", "Hazards"),
            tone: .warning,
            systemImage: "exclamationmark.triangle.fill"
        )
    }
    switch state.headlights {
    case true?: return VehicleTwinLegendValue(value: twinOnValue, tone: .info, systemImage: "lightbulb.fill")
    case false?: return VehicleTwinLegendValue(value: twinOffValue, tone: .neutral, systemImage: "lightbulb")
    case nil: return VehicleTwinLegendValue(value: twinUnknownValue, tone: .neutral, systemImage: "lightbulb")
    }
}

private func twinTurnValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    switch state.turnSignal {
    case .left?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.turnLeft", "Left"),
            tone: .warning,
            systemImage: "arrow.left"
        )
    case .right?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.turnRight", "Right"),
            tone: .warning,
            systemImage: "arrow.right"
        )
    case .both?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.turnBoth", "Both"),
            tone: .warning,
            systemImage: "arrow.left.and.right"
        )
    case .off?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.turnOff", "Off"),
            tone: .neutral,
            systemImage: "minus"
        )
    case nil:
        VehicleTwinLegendValue(value: twinNoneValue, tone: .neutral, systemImage: "minus")
    }
}

private func twinSentryValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    switch state.sentryMode {
    case true?: VehicleTwinLegendValue(value: twinOnValue, tone: .danger, systemImage: "shield.lefthalf.filled")
    case false?: VehicleTwinLegendValue(value: twinOffValue, tone: .neutral, systemImage: "shield")
    case nil: VehicleTwinLegendValue(value: twinUnknownValue, tone: .neutral, systemImage: "shield")
    }
}

private func twinSeatValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    switch state.driverSeatOccupied {
    case true?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.seatOccupied", "Occupied"),
            tone: .info,
            systemImage: "person.fill"
        )
    case false?:
        VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.seatEmpty", "Empty"),
            tone: .neutral,
            systemImage: "person"
        )
    case nil:
        VehicleTwinLegendValue(value: twinUnknownValue, tone: .neutral, systemImage: "person")
    }
}

private func twinMotionValue(_ state: VehicleTwinState) -> VehicleTwinLegendValue {
    state.isDriving
        ? VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.driving", "Driving"),
            tone: .info,
            systemImage: "speedometer"
        )
        : VehicleTwinLegendValue(
            value: VehicleTwinStrings.string("vehicles.twin.value.parked", "Parked"),
            tone: .neutral,
            systemImage: "parkingsign"
        )
}

// MARK: - Shared value strings

var twinUnknownValue: String {
    VehicleTwinStrings.string("vehicles.twin.value.unknown", "Unknown")
}

private var twinNoneValue: String {
    VehicleTwinStrings.string("vehicles.twin.value.none", "—")
}

private var twinOnValue: String {
    VehicleTwinStrings.string("vehicles.twin.value.on", "On")
}

private var twinOffValue: String {
    VehicleTwinStrings.string("vehicles.twin.value.off", "Off")
}
