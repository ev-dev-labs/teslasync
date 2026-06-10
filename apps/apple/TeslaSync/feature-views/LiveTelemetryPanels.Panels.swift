//
//  LiveTelemetryPanels.Panels.swift
//  TeslaSync — P4 feature view · 0281 · LiveTelemetryPanels (Apple)
//
//  Three of the seven Foundation-only panel projections the web `LiveTelemetryPanels`
//  composes — Powertrain (`PowertrainPanel`), Climate (`ClimatePanel`), and Security
//  (`SecurityPanel`). Each `project(...)` reproduces its web panel's render branches +
//  formatting VERBATIM. The remaining four panels + the aggregate projector live in
//  LiveTelemetryPanels.MorePanels.swift. SwiftUI-free; the panels render these structs in
//  LiveTelemetryPanels.PanelViews.swift.
//

import Foundation

// MARK: - i18n shorthand

func ltpStr(_ key: String, _ fallback: String) -> String {
    LiveTelemetryPanelsStrings.string(key, fallback)
}

// MARK: - Powertrain (web `PowertrainPanel`)

/// Drivetrain projection: shift-state chip, the −300…+300 kW power bar, the rpm + torque
/// tiles, the peak-motor / inverter temps, and regen.
public struct LTPPowertrainProjection: Equatable, Sendable {
    public let title: String
    public let shiftLabel: String
    public let powerLabel: String
    public let hasData: Bool
    public let shiftChip: LTPChip
    public let powerValue: String
    public let powerKnown: Bool
    public let powerPositive: Bool
    public let powerFillFraction: Double
    public let rpmFront: LTPMetricTile
    public let rpmRear: LTPMetricTile
    public let torqueFront: LTPMetricTile
    public let torqueRear: LTPMetricTile
    public let motorTempRow: LTPInfoRow
    public let inverterTempRow: LTPInfoRow
    public let regenRow: LTPInfoRow
    public let emptyMessage: String

    static func project(_ motor: LTPMotor?, _ units: LTPUnitPrefs) -> LTPPowertrainProjection {
        let kw = ltpStr("telemetry.kilowattUnit", "kW")
        let power = motor?.powerKw
        let tiles = powertrainTiles(motor, units)
        let temps = tempRows(motor, units)
        return LTPPowertrainProjection(
            title: ltpStr("common.powertrain", "Powertrain"),
            shiftLabel: ltpStr("telemetry.shiftState", "Shift State"),
            powerLabel: ltpStr("telemetry.power", "Power"),
            hasData: motor != nil,
            shiftChip: shiftChip(motor?.shiftState),
            powerValue: LTPFormat.numberOrDash(power, units) + " " + kw,
            powerKnown: power != nil,
            powerPositive: (power ?? 0) >= 0,
            powerFillFraction: min(abs(power ?? 0) / 300, 1),
            rpmFront: tiles[0],
            rpmRear: tiles[1],
            torqueFront: tiles[2],
            torqueRear: tiles[3],
            motorTempRow: temps.0,
            inverterTempRow: temps.1,
            regenRow: regenRow(motor?.regenKw, units, kw),
            emptyMessage: ltpStr("telemetry.noMotorData", "No motor data available")
        )
    }

    /// Web shift-state badge: D → success, R → danger, N → warning, else neutral.
    private static func shiftChip(_ raw: String?) -> LTPChip {
        let tone: LTPTone = switch raw {
        case "D": .success
        case "R": .danger
        case "N": .warning
        default: .neutral
        }
        return LTPChip(
            id: "shift",
            text: raw ?? ltpStr("common.unknown", "Unknown"),
            tone: tone,
            icon: "smallcircle.filled.circle"
        )
    }

    /// The rpm + torque MetricCard tiles, in web render order.
    private static func powertrainTiles(_ motor: LTPMotor?, _ units: LTPUnitPrefs) -> [LTPMetricTile] {
        let rpm = ltpStr("telemetry.rpmUnit", "RPM")
        let nm = ltpStr("telemetry.torqueUnit", "Nm")
        return [
            LTPMetricTile(
                id: "rpmF",
                label: ltpStr("telemetry.rpmFront", "Front RPM"),
                value: LTPFormat.intOrDash(motor?.motorRpmFront, units),
                unit: rpm
            ),
            LTPMetricTile(
                id: "rpmR",
                label: ltpStr("telemetry.rpmRear", "Rear RPM"),
                value: LTPFormat.intOrDash(motor?.motorRpmRear, units),
                unit: rpm
            ),
            LTPMetricTile(
                id: "trqF",
                label: ltpStr("telemetry.torqueFront", "Front Torque"),
                value: LTPFormat.numberOrDash(motor?.torqueNmFront, units),
                unit: nm
            ),
            LTPMetricTile(
                id: "trqR",
                label: ltpStr("telemetry.torqueRear", "Rear Torque"),
                value: LTPFormat.numberOrDash(motor?.torqueNmRear, units),
                unit: nm
            )
        ]
    }

    /// The peak-motor + inverter temperature rows (web `Math.max(front, rear)` peak with the
    /// >80 °C danger tint, then the inverter temp).
    private static func tempRows(_ motor: LTPMotor?, _ units: LTPUnitPrefs) -> (LTPInfoRow, LTPInfoRow) {
        let peak = maxMotorTemp(motor)
        let motorTemp = LTPInfoRow(
            id: "motorTemp",
            label: ltpStr("telemetry.motorTemp", "Motor Temp (peak)"),
            value: LTPUnits.formatTemperature(peak, units),
            valueTone: (peak.map { $0 > 80 } ?? false) ? .danger : .neutral
        )
        let inverter = LTPInfoRow(
            id: "inverterTemp",
            label: ltpStr("telemetry.inverterTemp", "Inverter Temp"),
            value: LTPUnits.formatTemperature(motor?.inverterTempC, units)
        )
        return (motorTemp, inverter)
    }

    private static func regenRow(_ regenKw: Double?, _ units: LTPUnitPrefs, _ kw: String) -> LTPInfoRow {
        LTPInfoRow(
            id: "regen",
            label: ltpStr("telemetry.regen", "Regen"),
            value: regenKw.map { LTPFormat.fmtNumber($0, units) + " " + kw } ?? LTPUnits.emptyDisplay,
            valueTone: .success
        )
    }

    /// Web `Math.max(front ?? -Infinity, rear ?? -Infinity)`, then the `isFinite` guard.
    private static func maxMotorTemp(_ motor: LTPMotor?) -> Double? {
        guard let motor else { return nil }
        let candidate = max(motor.motorTempCFront ?? -.infinity, motor.motorTempCRear ?? -.infinity)
        return candidate.isFinite ? candidate : nil
    }
}

// MARK: - Climate (web `ClimatePanel`)

/// Climate projection: cabin / outside tiles, setpoint + HVAC rows, the 6-bar fan meter,
/// and the defrost / climate / precondition mode chips.
public struct LTPClimateProjection: Equatable, Sendable {
    public let title: String
    public let fanLabel: String
    public let hasData: Bool
    public let cabinTile: LTPMetricTile
    public let outsideTile: LTPMetricTile
    public let driverRow: LTPInfoRow
    public let passengerRow: LTPInfoRow
    public let hvacRow: LTPInfoRow
    public let fanLevel: Int
    public let fanValue: String
    public let chips: [LTPChip]
    public let emptyMessage: String

    static func project(_ climate: LTPClimate?, _ units: LTPUnitPrefs) -> LTPClimateProjection {
        LTPClimateProjection(
            title: ltpStr("common.climate", "Climate"),
            fanLabel: ltpStr("telemetry.fanSpeed", "Fan Speed"),
            hasData: climate != nil,
            cabinTile: tempTile("cabin", ltpStr("common.insideTemp", "Cabin"), climate?.insideTempC, units),
            outsideTile: tempTile("outside", ltpStr("common.outsideTemp", "Outside"), climate?.outsideTempC, units),
            driverRow: tempRow(
                "driverSet",
                ltpStr("telemetry.driverSetpoint", "Driver Setpoint"),
                climate?.driverSetpointC,
                units
            ),
            passengerRow: tempRow(
                "passengerSet",
                ltpStr("telemetry.passengerSetpoint", "Passenger Setpoint"),
                climate?.passengerSetpointC,
                units
            ),
            hvacRow: LTPInfoRow(
                id: "hvac",
                label: ltpStr("telemetry.hvacState", "HVAC State"),
                value: climate?.hvacState ?? LTPUnits.emptyDisplay
            ),
            fanLevel: max(0, min(6, climate?.fanStatus ?? 0)),
            fanValue: String(climate?.fanStatus ?? 0),
            chips: chips(climate),
            emptyMessage: ltpStr("telemetry.noClimateData", "No climate data available")
        )
    }

    private static func tempTile(
        _ id: String,
        _ label: String,
        _ celsius: Double?,
        _ units: LTPUnitPrefs
    ) -> LTPMetricTile {
        LTPMetricTile(id: id, label: label, value: LTPUnits.formatTemperature(celsius, units))
    }

    private static func tempRow(
        _ id: String,
        _ label: String,
        _ celsius: Double?,
        _ units: LTPUnitPrefs
    ) -> LTPInfoRow {
        LTPInfoRow(id: id, label: label, value: LTPUnits.formatTemperature(celsius, units))
    }

    /// The defrost / climate / precondition mode chips (web active-state tinting).
    private static func chips(_ climate: LTPClimate?) -> [LTPChip] {
        let on = ltpStr("common.on", "On")
        let off = ltpStr("common.off", "Off")
        let defrostActive = (climate?.defrostMode).map { !$0.isEmpty && $0 != "Off" } ?? false
        let climateOn = climate?.isClimateOn ?? false
        let preconditioning = climate?.isPreconditioning ?? false
        return [
            LTPChip(
                id: "defrost",
                text: ltpStr("telemetry.defrost", "Defrost") + " " +
                    (defrostActive ? (climate?.defrostMode ?? off) : off),
                tone: defrostActive ? .info : .neutral,
                icon: "snowflake"
            ),
            LTPChip(
                id: "climateOn",
                text: ltpStr("telemetry.climate", "Climate") + " " + (climateOn ? on : off),
                tone: climateOn ? .success : .neutral,
                icon: "bolt.fill"
            ),
            LTPChip(
                id: "precondition",
                text: ltpStr("telemetry.precondition", "Precondition") + " " + (preconditioning ? on : off),
                tone: preconditioning ? .warning : .neutral
            )
        ]
    }
}

// MARK: - Security (web `SecurityPanel`)

/// Security projection: the lock block, sentry chip, door / window / user-present rows, the
/// optional detail line, and the remote-start access row.
public struct LTPSecurityProjection: Equatable, Sendable {
    public let title: String
    public let sentryLabel: String
    public let hasData: Bool
    public let hasSecurity: Bool
    public let lockText: String
    public let lockTone: LTPTone
    public let lockIcon: String
    public let lockSubLabel: String
    public let sentryChip: LTPChip
    public let doorsRow: LTPInfoRow
    public let windowsRow: LTPInfoRow
    public let userPresentRow: LTPInfoRow
    public let detail: String?
    public let remoteStartRow: LTPInfoRow
    public let emptyMessage: String

    static func project(_ security: LTPSecurity?, remoteStartEnabled: Bool?, _: LTPUnitPrefs) -> LTPSecurityProjection {
        let closed = ltpStr("common.closed", "Closed")
        let locked = security?.locked ?? false
        let present = security?.userPresent ?? false
        return LTPSecurityProjection(
            title: ltpStr("common.security", "Security"),
            sentryLabel: ltpStr("telemetry.sentryMode", "Sentry Mode"),
            hasData: security != nil || remoteStartEnabled != nil,
            hasSecurity: security != nil,
            lockText: locked ? ltpStr("common.locked", "Locked") : ltpStr("common.unlocked", "Unlocked"),
            lockTone: locked ? .success : .warning,
            lockIcon: locked ? "lock.fill" : "lock.open.fill",
            lockSubLabel: ltpStr("telemetry.lockStatus", "Vehicle lock status"),
            sentryChip: sentryChip(security?.sentryMode ?? false),
            doorsRow: LTPInfoRow(
                id: "doors",
                label: ltpStr("telemetry.doors", "Doors"),
                value: security?.doorsOpen ?? closed,
                icon: "door.left.hand.closed"
            ),
            windowsRow: LTPInfoRow(
                id: "windows",
                label: ltpStr("telemetry.windows", "Windows"),
                value: security?.windowsOpen ?? closed
            ),
            userPresentRow: userPresentRow(present),
            detail: LTPClean.cleanNil(security?.detail),
            remoteStartRow: remoteStartRow(remoteStartEnabled),
            emptyMessage: ltpStr("telemetry.noSecurityData", "No security data available")
        )
    }

    private static func sentryChip(_ on: Bool) -> LTPChip {
        LTPChip(
            id: "sentry",
            text: on ? ltpStr("common.active", "Active") : ltpStr("common.inactive", "Inactive"),
            tone: on ? .danger : .neutral,
            icon: "exclamationmark.shield.fill"
        )
    }

    private static func userPresentRow(_ present: Bool) -> LTPInfoRow {
        LTPInfoRow(
            id: "userPresent",
            label: ltpStr("telemetry.userPresent", "User Present"),
            value: present ? ltpStr("common.yes", "Yes") : ltpStr("common.no", "No"),
            valueTone: present ? .success : .neutral,
            icon: "person.fill"
        )
    }

    /// Web remote-start access: `null` → "—", else Enabled / Disabled.
    private static func remoteStartRow(_ enabled: Bool?) -> LTPInfoRow {
        LTPInfoRow(
            id: "remoteStart",
            label: ltpStr("telemetry.remoteStart", "Remote Start"),
            value: remoteStartValue(enabled),
            valueTone: (enabled ?? false) ? .success : .neutral,
            icon: "key.radiowaves.forward.fill"
        )
    }

    private static func remoteStartValue(_ enabled: Bool?) -> String {
        guard let enabled else { return LTPUnits.emptyDisplay }
        return enabled ? ltpStr("common.enabled", "Enabled") : ltpStr("common.disabled", "Disabled")
    }
}
