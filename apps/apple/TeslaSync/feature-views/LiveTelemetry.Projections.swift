//
//  LiveTelemetry.Projections.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The pure projection builders — one per web panel — mapping each telemetry input to
//  its view-ready projection. Ports of the web per-panel render branches
//  (numberFormat.ts + cleanNil.ts + unitConversion.ts). Unit tested in isolation.
//

import Foundation

// MARK: - Projection builders (one per web panel)

/// Builds the six per-panel projections from their telemetry inputs — the native port
/// of the web component's per-panel render branches. Each is a pure function of its
/// data + the display units, so every formatting / tone / count branch is unit tested.
public enum LiveTelemetryProjections {
    /// Web `DrivetrainPanel`: torque (raw `${value} Nm`), motor temp (`fmtInt` + unit),
    /// the gear badge (cleaned + tinted), and the max-axis g-force (`fmtNumber(…, 2)g`).
    public static func drivetrain(
        _ data: MotorTelemetry,
        units: LiveTelemetryUnits,
        locale: Locale = .current
    ) -> DrivetrainProjection {
        let torqueText = data.torque.map { "\(LiveTelemetryFormat.plain($0)) \(LiveUnitSymbol.torque)" }
            ?? LiveTelemetryFormat.dash

        let motorTempText = data.statorTemp.map {
            LiveTelemetryFormat.int(units.temperature.convert($0), locale: locale) + units.temperature.label
        } ?? LiveTelemetryFormat.dash

        let gear = LiveTelemetryFormat.cleanNil(data.gear)
        let gearTone: LiveTelemetryTone = switch data.gear {
        case "D": .success
        case "R": .danger
        default: .neutral
        }

        let gForceText: String
        if data.lateralAccel != nil || data.longitudinalAccel != nil {
            let peak = max(abs(data.lateralAccel ?? 0), abs(data.longitudinalAccel ?? 0))
            gForceText = LiveTelemetryFormat.number(peak, decimals: 2, locale: locale) + LiveUnitSymbol.gForce
        } else {
            gForceText = LiveTelemetryFormat.dash
        }

        return DrivetrainProjection(
            torqueText: torqueText,
            motorTempText: motorTempText,
            gear: gear,
            gearTone: gearTone,
            gForceText: gForceText
        )
    }

    /// Web `ClimatePanel`: cabin / outside temps (`fmtInt` + unit), HVAC power
    /// (`fmtNumber(…, 1) kW`), the 0…6 fan step + bar, and the defrost / heater / none
    /// mode chips.
    public static func climate(
        _ data: ClimateTelemetry,
        units: LiveTelemetryUnits,
        locale: Locale = .current
    ) -> ClimateProjection {
        let cabinText = data.insideTemp.map {
            LiveTelemetryFormat.int(units.temperature.convert($0), locale: locale) + units.temperature.label
        } ?? LiveTelemetryFormat.dash

        let outsideText = data.outsideTemp.map {
            LiveTelemetryFormat.int(units.temperature.convert($0), locale: locale) + units.temperature.label
        } ?? LiveTelemetryFormat.dash

        let hvacText = data.hvacPower.map {
            LiveTelemetryFormat.number($0, decimals: 1, locale: locale) + " \(LiveUnitSymbol.power)"
        } ?? LiveTelemetryFormat.dash

        let fanMax = 6
        let fanSpeed = data.fanSpeed ?? 0
        let defrostActive = (LiveTelemetryFormat.cleanNil(data.defrostMode).map { $0 != "Off" }) ?? false
        let heaterActive = data.batteryHeaterOn

        return ClimateProjection(
            cabinText: cabinText,
            outsideText: outsideText,
            hvacText: hvacText,
            fanSpeed: fanSpeed,
            fanMax: fanMax,
            fanText: "\(fanSpeed)/\(fanMax)",
            fanFraction: fanMax > 0 ? Double(fanSpeed) / Double(fanMax) : 0,
            showDefrost: defrostActive,
            showBatteryHeater: heaterActive,
            showNoModes: !defrostActive && !heaterActive
        )
    }

    /// Web `SecurityPanel`: the lock / sentry booleans, the open-door count (the
    /// comma-split `door_state` entries containing "open"), and the open-window count
    /// (the four corners not equal to "closed").
    public static func security(_ data: LiveSecurityTelemetry) -> SecurityProjection {
        let doorStates = data.doorState
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        let openDoors = doorStates.count(where: { $0.lowercased().contains("open") })

        let windows = [
            data.frontDriverWindow,
            data.frontPassengerWindow,
            data.rearDriverWindow,
            data.rearPassengerWindow
        ]
        let openWindows = windows.count(where: { value in
            guard let value, !value.isEmpty else { return false }
            return value.lowercased() != "closed"
        })

        return SecurityProjection(
            locked: data.locked,
            sentryMode: data.sentryMode,
            openDoors: openDoors,
            openWindows: openWindows,
            doorsAllClosed: openDoors == 0,
            windowsAllClosed: openWindows == 0
        )
    }

    /// Web `TirePressurePanel`: the four corners (`fmtNumber(toPressureDisplay(v), 1)`
    /// + tone from the raw bar value) and the fleet "all normal" flag.
    public static func tire(
        _ data: LiveTirePressureTelemetry,
        units: LiveTelemetryUnits,
        locale: Locale = .current
    ) -> TireProjection {
        let raw: [(id: String, value: Double?)] = [
            ("FL", data.frontLeft),
            ("FR", data.frontRight),
            ("RL", data.rearLeft),
            ("RR", data.rearRight)
        ]
        let corners = raw.map { corner in
            TireProjection.Corner(
                id: corner.id,
                valueText: corner.value.map {
                    LiveTelemetryFormat.number(units.pressure.convert($0), decimals: 1, locale: locale)
                } ?? LiveTelemetryFormat.dash,
                tone: LiveTirePressure.tone(corner.value)
            )
        }
        return TireProjection(
            corners: corners,
            unitLabel: units.pressure.label,
            allNormal: raw.allSatisfy { LiveTirePressure.isNormal($0.value) }
        )
    }

    /// Web `MediaPanel`: the cleaned title / artist / status, the status tone
    /// (Playing ⇒ success, Paused ⇒ warning, else neutral), and the volume label +
    /// bar fraction.
    public static func media(_ data: MediaTelemetry) -> MediaProjection {
        let title = LiveTelemetryFormat.cleanNil(data.nowPlayingTitle) ?? LiveTelemetryFormat.dash
        let artist = LiveTelemetryFormat.cleanNil(data.nowPlayingArtist)
        let status = LiveTelemetryFormat.cleanNil(data.playbackStatus)

        let statusTone: LiveTelemetryTone = switch status {
        case "Playing": .success
        case "Paused": .warning
        default: .neutral
        }

        let volumeText: String
        if let volume = data.audioVolume {
            let maxText = data.audioVolumeMax.map { "/\(LiveTelemetryFormat.plain($0))" } ?? ""
            volumeText = LiveTelemetryFormat.plain(volume) + maxText
        } else {
            volumeText = LiveTelemetryFormat.dash
        }

        let volumeFraction = mediaVolumeFraction(data)

        return MediaProjection(
            title: title,
            artist: artist,
            status: status ?? LiveTelemetryFormat.dash,
            statusTone: statusTone,
            volumeText: volumeText,
            volumeFraction: volumeFraction
        )
    }

    /// Web volume fraction: `audio_volume / audio_volume_max` when both are present
    /// and the max is positive, else 0.
    private static func mediaVolumeFraction(_ data: MediaTelemetry) -> Double {
        guard let volume = data.audioVolume, let maxVolume = data.audioVolumeMax, maxVolume > 0 else {
            return 0
        }
        return volume / maxVolume
    }

    /// Web `NavigationPanel`: the destination (`name || '—'`), distance
    /// (`fmtNumber(toDistanceDisplay(km), 1)` + unit), ETA (`fmtInt(min) min`), and the
    /// home / work / favorite / none chips.
    public static func navigation(
        _ data: NavigationTelemetry,
        units: LiveTelemetryUnits,
        locale: Locale = .current
    ) -> NavigationProjection {
        let destination = (data.destinationName?.isEmpty == false)
            ? (data.destinationName ?? LiveTelemetryFormat.dash)
            : LiveTelemetryFormat.dash

        let distanceText = data.distanceToArrival.map {
            LiveTelemetryFormat.number(units.distance.convert($0), decimals: 1, locale: locale)
                + " " + units.distance.label
        } ?? LiveTelemetryFormat.dash

        let etaText = data.minutesToArrival.map {
            LiveTelemetryFormat.int($0, locale: locale) + " \(LiveUnitSymbol.minutes)"
        } ?? LiveTelemetryFormat.dash

        let none = !data.locatedAtHome && !data.locatedAtWork && !data.locatedAtFavorite
        return NavigationProjection(
            destination: destination,
            distanceText: distanceText,
            etaText: etaText,
            showHome: data.locatedAtHome,
            showWork: data.locatedAtWork,
            showFavorite: data.locatedAtFavorite,
            showNoLocation: none
        )
    }
}
