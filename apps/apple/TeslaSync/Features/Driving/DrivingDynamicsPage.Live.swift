//
//  DrivingDynamicsPage.Live.swift
//  TeslaSync — P4-APPLE P7 · page:driving/DrivingDynamics (Apple) — Live telemetry panels
//
//  The live cockpit sections of the page, each a HIG `GroupBox`-style glass panel:
//  the live-motor gauge row (web `LiveMotorStatus`), the G-force panel (web
//  `GForcePanel`), the pedal-usage gauges (web `PedalUsage`), the speed/gear panel
//  (web `SpeedGearPanel`), and the autopilot/cruise panel (web `AutopilotSection`).
//  Each reads the user's unit preference from the environment and converts SI
//  values at the render boundary; each renders its own empty state rather than
//  hiding when the live source is missing.
//

import SwiftUI

// MARK: - Live Motor Status (web `LiveMotorStatus`)

struct DDynLiveMotorSection: View {
    let motor: MotorSnapshot?
    @Environment(\.tsUnits) private var units

    private let gaugeColumns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionTitle(DDynStrings.text("dynamics.liveMotor", "Live Motor Status"))
                if let motor {
                    LazyVGrid(columns: gaugeColumns, spacing: TSSpacing.lg) {
                        torqueGauge(motor)
                        rpmGauge(motor)
                        temperatureGauge(motor)
                        shiftTile(motor)
                    }
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.noLiveMotor"),
                        systemImage: "speedometer"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func torqueGauge(_ motor: MotorSnapshot) -> some View {
        DrivingValueGauge(
            value: motor.torqueTotalNm,
            maxValue: 1000,
            valueText: DDynFormat.number(motor.torqueTotalNm, fractionDigits: 0),
            unit: "Nm",
            label: DDynStrings.text("dynamics.torque", "Torque"),
            color: Color.TS.accent
        )
    }

    private func rpmGauge(_ motor: MotorSnapshot) -> some View {
        DrivingValueGauge(
            value: motor.motorRpmFront ?? 0,
            maxValue: 18000,
            valueText: DDynFormat.number(motor.motorRpmFront ?? 0, fractionDigits: 0),
            unit: "RPM",
            label: DDynStrings.text("dynamics.rpmFront", "Front RPM"),
            color: Color.TS.chartSeriesPower
        )
    }

    @ViewBuilder
    private func temperatureGauge(_ motor: MotorSnapshot) -> some View {
        if let tempC = motor.maxMotorTempC {
            let display = Units.convertTemperature(tempC, units)
            DrivingValueGauge(
                value: display,
                maxValue: 200,
                valueText: DDynFormat.number(display, fractionDigits: 1),
                unit: units.temperature,
                label: DDynStrings.text("dynamics.motorTemp", "Motor"),
                color: Color.TS.statusWarning
            )
        } else {
            DrivingValueGauge(
                value: 0,
                maxValue: 200,
                valueText: DDynStrings.text("dynamics.awaiting", "Awaiting data"),
                unit: units.temperature,
                label: DDynStrings.text("dynamics.motorTemp", "Motor"),
                color: Color.TS.statusWarning
            )
        }
    }

    private func shiftTile(_ motor: MotorSnapshot) -> some View {
        VStack(spacing: TSSpacing.sm) {
            DDynValueBadge(
                text: motor.shiftState ?? DDynStrings.text("dynamics.unknown", "Unknown"),
                tone: motor.shiftState == "D" ? .success : .neutral
            )
            .font(Font.TS.title)
            .frame(height: 120)
            Text(verbatim: DDynStrings.text("dynamics.shiftState", "Shift State"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Acceleration G-Force (web `GForcePanel`)

struct DDynGForceSection: View {
    let snapshot: DriveDynamicsSnapshot?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionTitle(DDynStrings.text("dynamics.gForce", "Acceleration G-Force"))
                if let snapshot, snapshot.hasAcceleration {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        gCard("dynamics.lateral", "Lateral", snapshot.lateralAcceleration)
                        gCard("dynamics.longitudinal", "Longitudinal", snapshot.longitudinalAcceleration)
                        gCard("dynamics.combined", "Combined", snapshot.combinedMagnitude)
                    }
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.gForceNoData"),
                        systemImage: "gauge.with.dots.needle.bottom.50percent"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func gCard(_ key: String, _ fallback: String, _ value: Double?) -> some View {
        let text = value.map { "\(DDynFormat.number($0, fractionDigits: 2)) g" } ?? "—"
        return TSStatCard(
            title: DDynStrings.key(key),
            value: text,
            systemImage: "gauge.with.dots.needle.bottom.50percent"
        )
        .accessibilityLabel(Text(verbatim: DDynStrings.text(key, fallback)))
        .accessibilityValue(Text(verbatim: text))
    }
}

// MARK: - Pedal Usage (web `PedalUsage`)

struct DDynPedalSection: View {
    let snapshot: DriveDynamicsSnapshot?

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionTitle(DDynStrings.text("dynamics.pedalUsage", "Pedal Usage"))
                if let snapshot, snapshot.hasPedal {
                    LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                        throttleGauge(snapshot)
                        brakeGauge(snapshot)
                        brakeStatusTile(snapshot)
                    }
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.pedalNoData"),
                        systemImage: "pedal.accelerator"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func throttleGauge(_ snapshot: DriveDynamicsSnapshot) -> some View {
        DrivingValueGauge(
            value: snapshot.pedalPosition ?? 0,
            maxValue: 100,
            valueText: snapshot.pedalPosition.map { DDynFormat.number($0, fractionDigits: 0) } ?? "—",
            unit: snapshot.pedalPosition != nil ? "%" : "—",
            label: DDynStrings.text("dynamics.throttlePosition", "Throttle Position"),
            color: Color.TS.statusInfo,
            size: 140
        )
    }

    private func brakeGauge(_ snapshot: DriveDynamicsSnapshot) -> some View {
        DrivingValueGauge(
            value: snapshot.brakePedalPosition ?? 0,
            maxValue: 100,
            valueText: snapshot.brakePedalPosition.map { DDynFormat.number($0, fractionDigits: 0) } ?? "—",
            unit: snapshot.brakePedalPosition != nil ? "%" : "—",
            label: DDynStrings.text("dynamics.brakePedalPosition", "Brake Pedal Position"),
            color: Color.TS.statusDanger,
            size: 140
        )
    }

    private func brakeStatusTile(_ snapshot: DriveDynamicsSnapshot) -> some View {
        let active = snapshot.brakePedalActive ?? false
        return VStack(spacing: TSSpacing.md) {
            Image(systemName: "figure.walk.motion")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            TSBadge(
                active ? DDynStrings.key("dynamics.brakeActive") : DDynStrings.key("dynamics.brakeInactive"),
                tone: active ? .danger : .success
            )
            Text(verbatim: DDynStrings.text("dynamics.brakePedal", "Brake Pedal Status"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Speed & Gear (web `SpeedGearPanel`)

struct DDynSpeedGearSection: View {
    let motor: MotorSnapshot?
    let avgDriveSpeedMps: Double?
    let topDriveSpeedMps: Double?
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 130), spacing: TSSpacing.lg)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionTitle(DDynStrings.text("dynamics.speedGear", "Speed & Gear"))
                LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                    shiftCell
                    powerCell
                    avgSpeedCell
                    topSpeedCell
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var shiftCell: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(verbatim: motor?.shiftState ?? "—")
                .font(.system(size: 44, weight: .bold))
                .foregroundStyle(shiftColor(motor?.shiftState))
            DDynValueBadge(
                text: DDynStrings.text("dynamics.shiftState", "Shift State"),
                tone: shiftTone(motor?.shiftState)
            )
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }

    private var powerCell: some View {
        DDynStatTile(
            label: DDynStrings.text("dynamics.power", "Motor Power"),
            value: motor?.powerKw.map { DDynFormat.number($0, fractionDigits: 1) } ?? "—",
            unit: "kW"
        )
    }

    private var avgSpeedCell: some View {
        DDynStatTile(
            label: DDynStrings.text("dynamics.avgDriveSpeed", "Avg Drive Speed"),
            value: avgDriveSpeedMps.map { DDynFormat.number(Units.convertSpeed($0, units), fractionDigits: 0) } ?? "—",
            unit: units.speed
        )
    }

    private var topSpeedCell: some View {
        DDynStatTile(
            label: DDynStrings.text("dynamics.topDriveSpeed", "Top Drive Speed"),
            value: topDriveSpeedMps.map { DDynFormat.number(Units.convertSpeed($0, units), fractionDigits: 0) } ?? "—",
            unit: units.speed
        )
    }

    private func shiftColor(_ shift: String?) -> Color {
        switch shift {
        case "D": Color.TS.statusSuccess
        case "R": Color.TS.statusDanger
        case "N": Color.TS.statusWarning
        case "P": Color.TS.textMuted
        default: Color.TS.textSecondary
        }
    }

    private func shiftTone(_ shift: String?) -> TSTone {
        switch shift {
        case "D": .success
        case "R": .danger
        case "N": .warning
        default: .neutral
        }
    }
}

// MARK: - Autopilot & Cruise (web `AutopilotSection`)

struct DDynAutopilotSection: View {
    let snapshot: AutopilotSnapshot?
    @Environment(\.tsUnits) private var units

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                DrivingSectionTitle(DDynStrings.text("dynamics.autopilot", "Autopilot & Cruise"))
                if let snapshot, snapshot.hasData {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        speedCard(
                            "dynamics.currentSpeed",
                            "Current Speed",
                            snapshot.currentSpeedMps,
                            icon: "gauge.with.dots.needle.bottom.50percent"
                        )
                        speedCard(
                            "dynamics.cruiseSetSpeed",
                            "Cruise Set Speed",
                            snapshot.cruiseSetSpeedMps,
                            icon: "location.north.line.fill"
                        )
                        TSStatCard(
                            title: DDynStrings.key("dynamics.followDistance"),
                            value: snapshot.followDistance ?? "—",
                            systemImage: "arrow.left.and.right"
                        )
                    }
                } else {
                    TSEmptyState(
                        title: "common.noData",
                        message: DDynStrings.key("dynamics.autopilotNoData"),
                        systemImage: "steeringwheel"
                    )
                    .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func speedCard(_ key: String, _ fallback: String, _ mps: Double?, icon: String) -> some View {
        let text = mps.map { value in
            "\(DDynFormat.number(Units.convertSpeed(value, units), fractionDigits: 0)) \(units.speed)"
        } ?? "—"
        return TSStatCard(title: DDynStrings.key(key), value: text, systemImage: icon)
            .accessibilityLabel(Text(verbatim: DDynStrings.text(key, fallback)))
            .accessibilityValue(Text(verbatim: text))
    }
}
