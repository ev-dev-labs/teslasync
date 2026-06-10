//
//  LiveTelemetryPanels.MorePanels.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  The remaining four Foundation-only panel projections — Vehicle State
//  (`VehicleStatePanel`), Tire Pressure (`TirePressurePanel`), Energy & Charging
//  (`EnergyChargingPanel`), Media & Navigation (`MediaNavigationPanel`) — plus the
//  aggregate `LiveTelemetryPanelsProjector` that fans an update out to all seven panels.
//  Continues LiveTelemetryPanels.Panels.swift; reproduces each web panel VERBATIM.
//

import Foundation

// MARK: - Vehicle State (web `VehicleStatePanel`)

/// Vehicle-state projection: the lights / driver / access signal rows (grouped into the
/// three web divider sections) + the SSE live indicator. Always renders (web has no null
/// guard on `live`).
public struct LTPVehicleStateProjection: Equatable, Sendable {
    public let title: String
    public let liveLabel: String
    public let sseConnected: Bool
    public let lightsRows: [LTPInfoRow]
    public let driverRows: [LTPInfoRow]
    public let accessRows: [LTPInfoRow]

    static func project(
        _ live: LTPVehicleStateLive,
        sseConnected: Bool,
        _ units: LTPUnitPrefs
    ) -> LTPVehicleStateProjection {
        LTPVehicleStateProjection(
            title: ltpStr("telemetry.vehicleState", "Vehicle State"),
            liveLabel: ltpStr("liveTelemetry.live", "Live"),
            sseConnected: sseConnected,
            lightsRows: lightsRows(live),
            driverRows: driverRows(live),
            accessRows: accessRows(live, units)
        )
    }

    private static func lightsRows(_ live: LTPVehicleStateLive) -> [LTPInfoRow] {
        let on = ltpStr("common.on", "On")
        let off = ltpStr("common.off", "Off")
        let turnRaw = LTPClean.cleanNil(live.lightsTurnSignal)
        let turnActive = turnRaw != nil && turnRaw != "Off"
        return [
            LTPInfoRow(
                id: "highBeams",
                label: ltpStr("telemetry.highBeams", "High Beams"),
                value: live.lightsHighBeams ? on : off,
                valueTone: live.lightsHighBeams ? .accent : .neutral,
                icon: "lightbulb.fill"
            ),
            LTPInfoRow(
                id: "turnSignal",
                label: ltpStr("telemetry.turnSignal", "Turn Signal"),
                value: turnRaw ?? off,
                valueTone: turnActive ? .warning : .neutral,
                icon: "arrow.triangle.turn.up.right.diamond.fill"
            ),
            LTPInfoRow(
                id: "hazards",
                label: ltpStr("telemetry.hazards", "Hazards"),
                value: live.lightsHazards ? ltpStr("common.active", "Active") : off,
                valueTone: live.lightsHazards ? .danger : .neutral,
                icon: "exclamationmark.triangle.fill"
            )
        ]
    }

    private static func driverRows(_ live: LTPVehicleStateLive) -> [LTPInfoRow] {
        let occupied = live.driverSeatOccupied
        return [
            LTPInfoRow(
                id: "driverSeat",
                label: ltpStr("telemetry.driverSeat", "Driver Seat"),
                value: occupied ? ltpStr("telemetry.occupied", "Occupied") : ltpStr("telemetry.empty", "Empty"),
                valueTone: occupied ? .success : .neutral,
                icon: "person.fill"
            ),
            LTPInfoRow(
                id: "pairedKeys",
                label: ltpStr("telemetry.pairedKeys", "Paired Keys"),
                value: LTPClean.cleanNil(live.pairedKeyCount) ?? LTPUnits.emptyDisplay,
                icon: "key.fill"
            )
        ]
    }

    private static func accessRows(_ live: LTPVehicleStateLive, _ units: LTPUnitPrefs) -> [LTPInfoRow] {
        let off = ltpStr("common.off", "Off")
        let dash = LTPUnits.emptyDisplay
        return [
            LTPInfoRow(
                id: "valet",
                label: ltpStr("telemetry.valetMode", "Valet Mode"),
                value: live.valetMode ? ltpStr("common.enabled", "Enabled") : off,
                valueTone: live.valetMode ? .purple : .neutral,
                icon: "car.fill"
            ),
            LTPInfoRow(
                id: "service",
                label: ltpStr("telemetry.serviceMode", "Service Mode"),
                value: live.serviceMode ? ltpStr("common.active", "Active") : off,
                valueTone: live.serviceMode ? .warning : .neutral,
                icon: "gearshape.fill"
            ),
            LTPInfoRow(
                id: "speedLimit",
                label: ltpStr("telemetry.speedLimit", "Speed Limit"),
                value: live.speedLimitMode ? LTPUnits.formatSpeed(live.currentSpeedLimit, units) : off,
                valueTone: live.speedLimitMode ? .accent : .neutral,
                icon: "gauge.with.dots.needle.bottom.50percent"
            ),
            LTPInfoRow(
                id: "centerDisplay",
                label: ltpStr("telemetry.centerDisplay", "Center Display"),
                value: LTPClean.cleanNil(live.centerDisplay) ?? dash,
                icon: "display"
            ),
            LTPInfoRow(
                id: "homelink",
                label: ltpStr("telemetry.homelinkDevices", "HomeLink Devices"),
                value: LTPClean.cleanNil(live.homelinkDeviceCount) ?? dash,
                icon: "mappin.and.ellipse"
            )
        ]
    }
}

// MARK: - Tire pressure (web `TirePressurePanel`)

/// One corner reading (web FL / FR / RL / RR tile).
public struct LTPTireCorner: Identifiable, Equatable, Sendable {
    public let id: String
    public let label: String
    public let value: String
    public let tone: LTPTone
}

/// Tire-pressure projection: the four corner tiles + the overall status chip.
public struct LTPTireProjection: Equatable, Sendable {
    public let title: String
    public let hasData: Bool
    public let corners: [LTPTireCorner]
    public let statusChip: LTPChip
    public let emptyMessage: String

    private struct Slot {
        let id: String
        let label: String
        let pa: Double?
    }

    static func project(_ tire: LTPTire?, _ units: LTPUnitPrefs) -> LTPTireProjection {
        let slots = [
            Slot(id: "fl", label: ltpStr("telemetry.tireFL", "FL"), pa: tire?.frontLeft),
            Slot(id: "fr", label: ltpStr("telemetry.tireFR", "FR"), pa: tire?.frontRight),
            Slot(id: "rl", label: ltpStr("telemetry.tireRL", "RL"), pa: tire?.rearLeft),
            Slot(id: "rr", label: ltpStr("telemetry.tireRR", "RR"), pa: tire?.rearRight)
        ]
        let corners = slots.map {
            LTPTireCorner(
                id: $0.id,
                label: $0.label,
                value: LTPUnits.formatPressure(LTPTirePressure.paToKpa($0.pa), units),
                tone: LTPTirePressure.cornerTone($0.pa)
            )
        }
        return LTPTireProjection(
            title: ltpStr("common.tirePressure", "Tire Pressure"),
            hasData: tire != nil,
            corners: corners,
            statusChip: statusChip(slots.map(\.pa)),
            emptyMessage: ltpStr("telemetry.noTireData", "No tire pressure data available")
        )
    }

    /// Web overall status: all-in-soft-band → All Normal; any-outside-critical → Attention;
    /// otherwise → Check Pressure.
    private static func statusChip(_ pressures: [Double?]) -> LTPChip {
        let allGood = pressures.allSatisfy { pa in
            guard let pa else { return false }
            return pa >= LTPTirePressure.lowWarning && pa <= LTPTirePressure.highWarning
        }
        let anyBad = pressures.contains { pa in
            guard let pa else { return false }
            return pa < LTPTirePressure.lowCritical || pa > LTPTirePressure.highCritical
        }
        if allGood {
            return LTPChip(
                id: "tireStatus",
                text: "✓ " + ltpStr("telemetry.tireAllNormal", "All Normal"),
                tone: .success
            )
        }
        if anyBad {
            return LTPChip(
                id: "tireStatus",
                text: "✗ " + ltpStr("telemetry.tireAttention", "Attention Needed"),
                tone: .danger
            )
        }
        return LTPChip(id: "tireStatus", text: "⚠ " + ltpStr("telemetry.tireCheck", "Check Pressure"), tone: .warning)
    }
}

// MARK: - Energy & charging (web `EnergyChargingPanel`)

/// Energy & charging projection: voltage / current tiles, the charger-power / energy-added
/// rows, the charging-state chip, the battery level, and the charge rate. Power + energy
/// reproduce web `fmtWithUnit(raw_w, 'kW')` / `fmtWithUnit(raw_wh, 'kWh')` VERBATIM (the
/// web slaps the unit token on the raw SI magnitude).
public struct LTPEnergyChargingProjection: Equatable, Sendable {
    public let title: String
    public let chargingStateLabel: String
    public let hasData: Bool
    public let voltageTile: LTPMetricTile
    public let currentTile: LTPMetricTile
    public let chargerPowerRow: LTPInfoRow
    public let energyAddedRow: LTPInfoRow
    public let chargingStateChip: LTPChip
    public let batteryLevelRow: LTPInfoRow
    public let chargeRateRow: LTPInfoRow
    public let emptyMessage: String

    static func project(_ charging: LTPCharging?, _ units: LTPUnitPrefs) -> LTPEnergyChargingProjection {
        let kw = ltpStr("telemetry.kilowattUnit", "kW")
        let kwh = ltpStr("telemetry.kilowattHourUnit", "kWh")
        let dash = LTPUnits.emptyDisplay
        return LTPEnergyChargingProjection(
            title: ltpStr("telemetry.energyCharging", "Energy & Charging"),
            chargingStateLabel: ltpStr("telemetry.chargingState", "Charging State"),
            hasData: charging != nil,
            voltageTile: LTPMetricTile(
                id: "voltage",
                label: ltpStr("telemetry.chargerVoltage", "Charger Voltage"),
                value: LTPFormat.numberOrDash(charging?.chargerVoltage, units),
                unit: ltpStr("telemetry.voltUnit", "V")
            ),
            currentTile: LTPMetricTile(
                id: "current",
                label: ltpStr("telemetry.chargerCurrent", "Charger Current"),
                value: LTPFormat.numberOrDash(charging?.chargerActualCurrent, units),
                unit: ltpStr("telemetry.ampUnit", "A")
            ),
            chargerPowerRow: LTPInfoRow(
                id: "chargerPower",
                label: ltpStr("telemetry.chargerPower", "Charger Power"),
                value: charging?.chargerPowerW.map { LTPFormat.fmtWithUnit($0, kw, units) } ?? dash
            ),
            energyAddedRow: LTPInfoRow(
                id: "energyAdded",
                label: ltpStr("telemetry.energyAdded", "Energy Added"),
                value: charging?.chargeEnergyAddedWh.map { LTPFormat.fmtWithUnit($0, kwh, units) } ?? dash
            ),
            chargingStateChip: chargingStateChip(charging?.chargingState),
            batteryLevelRow: LTPInfoRow(
                id: "batteryLevel",
                label: ltpStr("telemetry.batteryLevel", "Battery Level"),
                value: charging?.batteryLevel.map { LTPFormat.fmtNumber($0, units) + "%" } ?? dash
            ),
            chargeRateRow: LTPInfoRow(
                id: "chargeRate",
                label: ltpStr("telemetry.chargeRate", "Charge Rate"),
                value: charging?.rangeAddedMetersPerHour.map { LTPUnits.formatSpeed($0 / 3600, units) } ?? dash,
                icon: "bolt.fill"
            ),
            emptyMessage: ltpStr("telemetry.noChargingTelemetry", "No charging telemetry available")
        )
    }

    private static func chargingStateChip(_ raw: String?) -> LTPChip {
        let tone: LTPTone = switch raw {
        case "Charging": .accent
        case "Complete": .success
        default: .neutral
        }
        return LTPChip(id: "chargingState", text: raw ?? ltpStr("common.unknown", "Unknown"), tone: tone)
    }
}

// MARK: - Media & navigation (web `MediaNavigationPanel`)

/// Media & navigation projection: the now-playing block (title / artist / source / status)
/// and the navigation block (destination, distance + ETA, place chips). Always renders;
/// each sub-block has its own empty copy (web has no top-level null guard).
public struct LTPMediaNavProjection: Equatable, Sendable {
    public let title: String
    public let nowPlayingLabel: String
    public let navigationLabel: String
    public let hasMedia: Bool
    public let mediaTitle: String
    public let mediaArtist: String
    public let sourceChip: LTPChip?
    public let statusChip: LTPChip?
    public let mediaEmpty: String
    public let hasLocation: Bool
    public let destinationName: String?
    public let distanceText: String?
    public let etaText: String?
    public let placeChips: [LTPChip]
    public let noDestination: String
    public let locationEmpty: String

    static func project(_ media: LTPMedia?, _ location: LTPLocation?, _ units: LTPUnitPrefs) -> LTPMediaNavProjection {
        LTPMediaNavProjection(
            title: ltpStr("telemetry.mediaNav", "Media & Navigation"),
            nowPlayingLabel: ltpStr("telemetry.nowPlaying", "Now Playing"),
            navigationLabel: ltpStr("telemetry.navigation", "Navigation"),
            hasMedia: media != nil,
            mediaTitle: LTPClean.cleanNil(media?.nowPlayingTitle) ?? ltpStr(
                "telemetry.nothingPlaying",
                "Nothing playing"
            ),
            mediaArtist: LTPClean.cleanNil(media?.nowPlayingArtist) ?? ltpStr(
                "telemetry.unknownArtist",
                "Unknown artist"
            ),
            sourceChip: sourceChip(media?.playbackSource),
            statusChip: statusChip(media?.playbackStatus),
            mediaEmpty: ltpStr("telemetry.noMediaData", "No media data"),
            hasLocation: location != nil,
            destinationName: LTPClean.cleanNil(location?.destinationName),
            distanceText: distanceText(location?.metresToArrival, units),
            etaText: location?.minutesToArrival.map { LTPFormat.fmtInt($0, units) + " " + ltpStr(
                "common.minShort",
                "min"
            ) },
            placeChips: placeChips(location),
            noDestination: ltpStr("telemetry.noActiveDestination", "No active destination"),
            locationEmpty: ltpStr("telemetry.noLocationData", "No location data")
        )
    }

    private static func sourceChip(_ source: String?) -> LTPChip? {
        LTPClean.cleanNil(source).map { LTPChip(id: "playbackSource", text: $0, tone: .neutral, filled: false) }
    }

    private static func statusChip(_ status: String?) -> LTPChip? {
        LTPClean.cleanNil(status).map { value in
            let tone: LTPTone = switch value {
            case "Playing": .success
            case "Paused": .warning
            default: .neutral
            }
            return LTPChip(id: "playbackStatus", text: value, tone: tone)
        }
    }

    private static func distanceText(_ metres: Double?, _ units: LTPUnitPrefs) -> String? {
        metres
            .map { LTPFormat.fmtNumber(LTPUnits.distanceFromSI($0, to: units.distance), units) + " " + units.distance }
    }

    private static func placeChips(_ location: LTPLocation?) -> [LTPChip] {
        var chips: [LTPChip] = []
        if location?.locatedAtHome == true {
            chips.append(LTPChip(id: "home", text: "🏠 " + ltpStr("telemetry.placeHome", "Home"), tone: .success))
        }
        if location?.locatedAtWork == true {
            chips.append(LTPChip(id: "work", text: "🏢 " + ltpStr("telemetry.placeWork", "Work"), tone: .info))
        }
        if location?.locatedAtFavorite == true {
            chips.append(LTPChip(
                id: "favorite",
                text: "⭐ " + ltpStr("telemetry.placeFavorite", "Favorite"),
                tone: .purple
            ))
        }
        return chips
    }
}
