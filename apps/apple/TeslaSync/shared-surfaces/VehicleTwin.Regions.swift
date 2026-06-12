//
//  VehicleTwin.Regions.swift
//  TeslaSync — P4 shared surface · 0235 · VehicleTwin (Apple)
//
//  The per-region detail rows — the native peer of the web `VehicleTwin` hover tooltips
//  (`InteractiveHotspot` / `<title>`): one labelled row per window / door / frunk / trunk / charge
//  port + lock + sentry, reproducing the web `windowLabel` / `stateLabel` / security / charge label
//  helpers. Pure value logic (Foundation only), localized through the P1/S10 facade. Shown beneath
//  the legend when the surface is `interactive` (matching the web `interactive` prop, which gates the
//  hover labels) and always exposed to VoiceOver.
//

import Foundation

// MARK: - Regions builder

/// Builds the localized per-region detail rows for a `VehicleTwinState`.
enum VehicleTwinRegionsBuilder {
    static func rows(for state: VehicleTwinState) -> [VehicleTwinRegionRow] {
        VehicleTwinRegion.allCases.map { region in
            VehicleTwinRegionRow(id: region.rawValue, label: region.label, value: region.value(for: state))
        }
    }
}

// MARK: - Region descriptor

/// One twin region (web hotspot). `label` is its localized name; `value` is its localized state.
private enum VehicleTwinRegion: String, CaseIterable {
    case lock
    case sentry
    case windowFrontDriver
    case windowFrontPassenger
    case windowRearDriver
    case windowRearPassenger
    case doorDriverFront
    case doorPassengerFront
    case doorDriverRear
    case doorPassengerRear
    case frunk
    case trunk
    case chargePort

    var label: String {
        switch self {
        case .lock: VehicleTwinStrings.string("vehicles.twin.legend.lock", "Lock")
        case .sentry: VehicleTwinStrings.string("vehicles.twin.legend.sentry", "Sentry")
        case .windowFrontDriver:
            VehicleTwinStrings.string("vehicles.twin.region.windowFrontDriver", "Front driver window")
        case .windowFrontPassenger:
            VehicleTwinStrings.string("vehicles.twin.region.windowFrontPassenger", "Front passenger window")
        case .windowRearDriver:
            VehicleTwinStrings.string("vehicles.twin.region.windowRearDriver", "Rear driver window")
        case .windowRearPassenger:
            VehicleTwinStrings.string("vehicles.twin.region.windowRearPassenger", "Rear passenger window")
        case .doorDriverFront: VehicleTwinStrings.string("vehicles.twin.region.doorDriverFront", "Driver Front")
        case .doorPassengerFront:
            VehicleTwinStrings.string("vehicles.twin.region.doorPassengerFront", "Passenger Front")
        case .doorDriverRear: VehicleTwinStrings.string("vehicles.twin.region.doorDriverRear", "Driver Rear")
        case .doorPassengerRear:
            VehicleTwinStrings.string("vehicles.twin.region.doorPassengerRear", "Passenger Rear")
        case .frunk: VehicleTwinStrings.string("vehicles.twin.region.frunk", "Frunk")
        case .trunk: VehicleTwinStrings.string("vehicles.twin.region.trunk", "Trunk")
        case .chargePort: VehicleTwinStrings.string("vehicles.twin.region.chargePort", "Charge port")
        }
    }

    func value(for state: VehicleTwinState) -> String {
        switch self {
        case .windowFrontDriver, .windowFrontPassenger, .windowRearDriver, .windowRearPassenger:
            windowValue(for: state)
        case .doorDriverFront, .doorPassengerFront, .doorDriverRear, .doorPassengerRear:
            doorValue(for: state)
        case .lock: twinLockText(state)
        case .sentry: twinSentryText(state)
        case .frunk: twinBoolStateLabel(state.frunkOpen)
        case .trunk: twinBoolStateLabel(state.trunkOpen)
        case .chargePort: twinChargePortText(state)
        }
    }

    private func windowValue(for state: VehicleTwinState) -> String {
        switch self {
        case .windowFrontDriver: twinWindowLabel(state.windowFD)
        case .windowFrontPassenger: twinWindowLabel(state.windowFP)
        case .windowRearDriver: twinWindowLabel(state.windowRD)
        default: twinWindowLabel(state.windowRP)
        }
    }

    private func doorValue(for state: VehicleTwinState) -> String {
        switch self {
        case .doorDriverFront: twinBoolStateLabel(state.doors.driverFront)
        case .doorPassengerFront: twinBoolStateLabel(state.doors.passengerFront)
        case .doorDriverRear: twinBoolStateLabel(state.doors.driverRear)
        default: twinBoolStateLabel(state.doors.passengerRear)
        }
    }
}

// MARK: - Per-region labels (web `windowLabel` / `stateLabel` + security / charge)

private func twinWindowLabel(_ state: DigitalTwinWidgetTwinWindowState?) -> String {
    switch state {
    case .open?: VehicleTwinStrings.string("vehicles.twin.window.open", "Open")
    case .closed?: VehicleTwinStrings.string("vehicles.twin.window.closed", "Closed")
    case .partial?: VehicleTwinStrings.string("vehicles.twin.window.partial", "Partially open")
    case nil: VehicleTwinStrings.string("vehicles.twin.window.unknown", "Unknown")
    }
}

private func twinBoolStateLabel(_ value: Bool?) -> String {
    switch value {
    case true?: VehicleTwinStrings.string("vehicles.twin.state.open", "Open")
    case false?: VehicleTwinStrings.string("vehicles.twin.state.closed", "Closed")
    case nil: VehicleTwinStrings.string("vehicles.twin.state.unknown", "Unknown")
    }
}

private func twinLockText(_ state: VehicleTwinState) -> String {
    switch state.locked {
    case true?: VehicleTwinStrings.string("vehicles.twin.locked", "Locked")
    case false?: VehicleTwinStrings.string("vehicles.twin.unlocked", "Unlocked")
    case nil: VehicleTwinStrings.string("vehicles.twin.lockUnknown", "Lock unknown")
    }
}

private func twinSentryText(_ state: VehicleTwinState) -> String {
    switch state.sentryMode {
    case true?: VehicleTwinStrings.string("vehicles.twin.sentry", "Sentry mode active")
    case false?: VehicleTwinStrings.string("vehicles.twin.sentryOff", "Sentry off")
    case nil: twinUnknownValue
    }
}

private func twinChargePortText(_ state: VehicleTwinState) -> String {
    if state.isCharging {
        return VehicleTwinStrings.string("vehicles.twin.region.charging", "Charging")
    }
    return twinBoolStateLabel(state.chargePortOpen)
}
