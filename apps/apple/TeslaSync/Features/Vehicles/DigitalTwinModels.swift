//
//  DigitalTwinModels.swift
//  TeslaSync — P4-APPLE P7 · page:vehicles/DigitalTwin (Apple) — Value types
//
//  Native value types for the DigitalTwin parity unit (web
//  `web/src/features/vehicles/pages/DigitalTwinPage.tsx`). The page merges three live
//  per-vehicle feeds into one `VehicleTwinState` (the module port of `lib/vehicleState.ts`,
//  reused verbatim) and renders three read-only KV detail panels plus a status badge. This
//  file owns the page-local view types the module's twin domain does not provide:
//    • `DigitalTwinVehicleStatus` — the web `deriveVehicleStatus` + the page's badge override
//      (web `badgeStatus`), with the FSM dot tone and the localized state label.
//    • `DigitalTwinDetailRows` — the door / window / security KV rows (web `doorItems` /
//      `windowItems` / `securityItems`), every value resolved through the i18n catalog.
//  No non-SI values are stored — these are boolean / enum physical-state primitives, formatted
//  only at the render boundary. The display strings resolve from `Localizable.xcstrings` with
//  the web key names; the Swift sources hold no English prose beyond the catalog fallbacks.
//

import SwiftUI

// MARK: - Localization facade (web `t(key, default)`)

/// Resolves the page's catalog VALUE strings by key with the web English fallback, so the row
/// values carry no hardcoded prose. The keys are the verbatim web i18n keys (`common.*`,
/// `digitalTwin.*`), prefixed `translation.` to match the app catalog. When the catalog table is
/// absent (preview / test bundles) `NSLocalizedString` returns the `value:` fallback, keeping the
/// projection deterministic. The em-dash is the universal "unknown" marker the web page uses.
enum DigitalTwinCopy {
    /// The "unknown / no value" marker (web `'—'`).
    static let dash = "—"

    static func value(_ key: String, _ fallback: String) -> String {
        NSLocalizedString(key, value: fallback, comment: "")
    }

    /// web `value ? t('common.open') : t('common.closed')`, `null → '—'`.
    static func openClosed(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag ? value("translation.common.open", "Open") : value("translation.common.closed", "Closed")
    }

    /// web `value ? t('common.yes') : t('common.no')`, `null → '—'`.
    static func yesNo(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag ? value("translation.common.yes", "Yes") : value("translation.common.no", "No")
    }

    /// web `value ? t('common.active') : t('common.inactive')`, `null → '—'`.
    static func activeInactive(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag ? value("translation.common.active", "Active") : value("translation.common.inactive", "Inactive")
    }

    /// web `value ? t('common.active') : t('common.off')`, `null → '—'` (hazards).
    static func activeOff(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag ? value("translation.common.active", "Active") : value("translation.common.off", "Off")
    }

    /// web `value ? t('common.on') : t('common.off')`, `null → '—'` (headlights).
    static func onOff(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag ? value("translation.common.on", "On") : value("translation.common.off", "Off")
    }

    /// web `value ? t('digitalTwin.occupied') : t('digitalTwin.empty')`, `null → '—'` (driver seat).
    static func occupiedEmpty(_ flag: Bool?) -> String {
        guard let flag else { return dash }
        return flag
            ? value("translation.digitalTwin.occupied", "Occupied")
            : value("translation.digitalTwin.empty", "Empty")
    }

    /// web `windowLabel(state)`: open/closed/partial/null → localized label / '—'.
    static func windowLabel(_ state: DigitalTwinWidgetTwinWindowState?) -> String {
        switch state {
        case .open: return value("translation.common.open", "Open")
        case .closed: return value("translation.common.closed", "Closed")
        case .partial: return value("translation.digitalTwin.windowPartial", "Partial")
        case nil: return dash
        }
    }

    /// web charge-port value: charging → 'Charging', else open/closed/'—'.
    static func chargePort(isCharging: Bool, portOpen: Bool?) -> String {
        if isCharging { return value("translation.digitalTwin.charging", "Charging") }
        return openClosed(portOpen)
    }
}

// MARK: - Vehicle status (web `deriveVehicleStatus` + page `badgeStatus`)

/// The single source-of-truth vehicle status the page badge renders (web `VehicleStatus`). Mirrors
/// the web `deriveVehicleStatus` priority and the page's `badgeStatus` override exactly: charging /
/// driving from the merged twin win first; otherwise the `/vehicles/{id}/state` status; otherwise a
/// live signal collapses "offline" to "online". The dot tone reproduces the web FSM `badgeDot` intent.
enum DigitalTwinVehicleStatus: String, Sendable, Equatable, CaseIterable {
    case online
    case driving
    case charging
    case parked
    case updating
    case asleep
    case offline

    /// web `deriveVehicleStatus(state)`: no state → offline; charging flag wins; speed → driving;
    /// a known FSM state passes through; otherwise online.
    static func fromVehicleState(_ state: TwinVehicleStateInput?) -> DigitalTwinVehicleStatus {
        guard let state else { return .offline }
        if state.isCharging == true { return .charging }
        if (state.speed ?? 0) > 0 { return .driving }
        let raw = (state.state ?? "").lowercased()
        return DigitalTwinVehicleStatus(rawValue: raw) ?? .online
    }

    /// web page `badgeStatus`: twin charging/driving first; then the derived state; then a live
    /// signal (state.live OR security OR charging present) collapses offline → online.
    static func badge(
        twin: VehicleTwinState,
        vehicleState: TwinVehicleStateInput?,
        hasLiveSignal: Bool
    ) -> DigitalTwinVehicleStatus {
        if twin.isCharging { return .charging }
        if twin.isDriving { return .driving }
        let derived = fromVehicleState(vehicleState)
        if derived != .offline { return derived }
        return hasLiveSignal ? .online : .offline
    }

    /// Localized state label (web `StatusBadge` renders the status word). Resolves a
    /// `vehicle.state.*` key with the English fallback so absent translations still read correctly.
    var label: String {
        NSLocalizedString("translation.vehicle.state.\(rawValue)", value: fallback, comment: "")
    }

    private var fallback: String {
        switch self {
        case .online: "Online"
        case .driving: "Driving"
        case .charging: "Charging"
        case .parked: "Parked"
        case .updating: "Updating"
        case .asleep: "Asleep"
        case .offline: "Offline"
        }
    }

    /// The status-dot tone (web FSM `badgeDot` intent, mapped to the shared status tokens).
    var tone: TSTone {
        switch self {
        case .online: .success
        case .driving: .info
        case .charging: .warning
        case .parked: .accent
        case .updating: .info
        case .asleep: .neutral
        case .offline: .neutral
        }
    }
}

// MARK: - Detail rows (web `doorItems` / `windowItems` / `securityItems`)

/// Builds the three KV detail panels' rows from the merged twin state — the native peer of the web
/// `doorItems` / `windowItems` / `securityItems` memos. Each row is a `(localized label, resolved
/// value)` pair; the label keys are the verbatim web `digitalTwin.*` keys and the values resolve
/// through `DigitalTwinCopy`, so the panels carry zero hardcoded prose.
enum DigitalTwinDetailRows {
    /// web `doorItems` (6 rows): the four cabin doors plus frunk + trunk.
    static func doors(_ twin: VehicleTwinState) -> [TSKVRow] {
        [
            row("doorDriverFront", "translation.digitalTwin.doorDriverFront",
                DigitalTwinCopy.openClosed(twin.doors.driverFront)),
            row("doorPassengerFront", "translation.digitalTwin.doorPassengerFront",
                DigitalTwinCopy.openClosed(twin.doors.passengerFront)),
            row("doorDriverRear", "translation.digitalTwin.doorDriverRear",
                DigitalTwinCopy.openClosed(twin.doors.driverRear)),
            row("doorPassengerRear", "translation.digitalTwin.doorPassengerRear",
                DigitalTwinCopy.openClosed(twin.doors.passengerRear)),
            row("frunk", "translation.digitalTwin.frunk", DigitalTwinCopy.openClosed(twin.frunkOpen)),
            row("trunk", "translation.digitalTwin.trunk", DigitalTwinCopy.openClosed(twin.trunkOpen))
        ]
    }

    /// web `windowItems` (4 rows): the four side windows.
    static func windows(_ twin: VehicleTwinState) -> [TSKVRow] {
        [
            row("windowFD", "translation.digitalTwin.windowFD", DigitalTwinCopy.windowLabel(twin.windowFD)),
            row("windowFP", "translation.digitalTwin.windowFP", DigitalTwinCopy.windowLabel(twin.windowFP)),
            row("windowRD", "translation.digitalTwin.windowRD", DigitalTwinCopy.windowLabel(twin.windowRD)),
            row("windowRP", "translation.digitalTwin.windowRP", DigitalTwinCopy.windowLabel(twin.windowRP))
        ]
    }

    /// web `securityItems` (8 rows): lock, driving, charging, sentry, charge port, seat, lights.
    static func security(_ twin: VehicleTwinState) -> [TSKVRow] {
        [
            row("locked", "translation.digitalTwin.locked", DigitalTwinCopy.yesNo(twin.locked)),
            row("driving", "translation.digitalTwin.driving", DigitalTwinCopy.yesNo(twin.isDriving)),
            row("charging", "translation.digitalTwin.charging", DigitalTwinCopy.yesNo(twin.isCharging)),
            row("sentryMode", "translation.digitalTwin.sentryMode", DigitalTwinCopy.activeInactive(twin.sentryMode)),
            row("chargePort", "translation.digitalTwin.chargePort",
                DigitalTwinCopy.chargePort(isCharging: twin.isCharging, portOpen: twin.chargePortOpen)),
            row("driverSeat", "translation.digitalTwin.driverSeat",
                DigitalTwinCopy.occupiedEmpty(twin.driverSeatOccupied)),
            row("headlights", "translation.digitalTwin.headlights", DigitalTwinCopy.onOff(twin.headlights)),
            row("hazards", "translation.digitalTwin.hazards", DigitalTwinCopy.activeOff(twin.hazards))
        ]
    }

    private static func row(_ id: String, _ key: LocalizedStringKey, _ value: String) -> TSKVRow {
        TSKVRow(id: id, key: key, value: value)
    }
}
