//
//  LiveTelemetry.Panels.swift
//  TeslaSync — P4 feature view · 0127 · LiveTelemetry (Apple)
//
//  The drivetrain / climate / security telemetry panels — three of the six GlassPanel
//  surfaces composed by LiveTelemetryGrid. Shared primitives + chrome live in
//  LiveTelemetry.Views.swift; the remaining panels in LiveTelemetry.MorePanels.swift.
//

import SwiftUI

// MARK: - Drivetrain panel (web `DrivetrainPanel`)

/// The drivetrain panel — torque, motor temp, the gear badge, and peak g-force.
struct LiveDrivetrainPanel: View {
    let projection: DrivetrainProjection?

    var body: some View {
        LiveTelemetryPanel(
            icon: "gearshape.fill",
            tint: Color.TS.chartSeriesPower,
            title: LiveTelemetryStrings.string("telemetry.drivetrain", "Drivetrain"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.torque", "Torque"),
                        value: projection.torqueText
                    )
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.motorTemp", "Motor Temp"),
                        value: projection.motorTempText
                    )
                    gearRow(projection)
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.gforce", "G-Force"),
                        value: projection.gForceText
                    )
                }
            }
        }
    }

    private func gearRow(_ projection: DrivetrainProjection) -> some View {
        HStack {
            Text(verbatim: LiveTelemetryStrings.string("telemetry.gear", "Gear"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            if let gear = projection.gear {
                TSBadge("\(gear)", tone: projection.gearTone.badgeTone)
            } else {
                Text(verbatim: LiveTelemetryFormat.dash)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Climate panel (web `ClimatePanel`)

/// The climate panel — cabin / outside temps, HVAC power, the fan bar, and the active
/// mode chips.
struct LiveClimatePanel: View {
    let projection: ClimateProjection?

    var body: some View {
        LiveTelemetryPanel(
            icon: "thermometer.medium",
            tint: Color.TS.accent,
            title: LiveTelemetryStrings.string("telemetry.climate", "Climate"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.cabin", "Cabin"),
                        value: projection.cabinText
                    )
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.outside", "Outside"),
                        value: projection.outsideText
                    )
                    LiveTelemetryRow(
                        label: LiveTelemetryStrings.string("telemetry.hvac", "HVAC Power"),
                        value: projection.hvacText
                    )
                    fanRow(projection)
                    modeChips(projection)
                }
            }
        }
    }

    private func fanRow(_ projection: ClimateProjection) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(verbatim: LiveTelemetryStrings.string("telemetry.fan", "Fan"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: projection.fanText)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .monospacedDigit()
            }
            LiveTelemetryBar(
                fraction: projection.fanFraction,
                gradient: [Color.TS.accent, Color.TS.chartSeriesPower]
            )
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(
            label: LiveTelemetryStrings.string("telemetry.fan", "Fan"),
            value: projection.fanText
        )))
    }

    private func modeChips(_ projection: ClimateProjection) -> some View {
        HStack(spacing: TSSpacing.sm) {
            if projection.showDefrost {
                LiveTelemetryChip(
                    icon: "snowflake",
                    text: LiveTelemetryStrings.string("telemetry.defrost", "Defrost"),
                    tone: .info
                )
            }
            if projection.showBatteryHeater {
                LiveTelemetryChip(
                    icon: "bolt.fill",
                    text: LiveTelemetryStrings.string("telemetry.batHeater", "Bat Heater"),
                    tone: .warning
                )
            }
            if projection.showNoModes {
                LiveTelemetryMutedNote(text: LiveTelemetryStrings.string("telemetry.noModes", "No active modes"))
            }
        }
    }
}

// MARK: - Security panel (web `SecurityPanel`)

/// The security panel — lock, sentry, and the door / window open-count badges.
struct LiveSecurityPanel: View {
    let projection: SecurityProjection?

    var body: some View {
        LiveTelemetryPanel(
            icon: "shield.fill",
            tint: Color.TS.statusSuccess,
            title: LiveTelemetryStrings.string("telemetry.security", "Security"),
            showsContent: projection != nil
        ) {
            if let projection {
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    lockRow(projection)
                    sentryRow(projection)
                    countRow(
                        label: LiveTelemetryStrings.string("telemetry.doors", "Doors"),
                        allClear: projection.doorsAllClosed,
                        open: projection.openDoors
                    )
                    countRow(
                        label: LiveTelemetryStrings.string("telemetry.windows", "Windows"),
                        allClear: projection.windowsAllClosed,
                        open: projection.openWindows
                    )
                }
            }
        }
    }

    private func lockRow(_ projection: SecurityProjection) -> some View {
        let tone: LiveTelemetryTone = projection.locked ? .success : .danger
        let value = projection.locked
            ? LiveTelemetryStrings.string("telemetry.locked", "Locked")
            : LiveTelemetryStrings.string("telemetry.unlocked", "Unlocked")
        return HStack {
            Text(verbatim: LiveTelemetryStrings.string("telemetry.lock", "Lock"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Label {
                Text(verbatim: value)
            } icon: {
                Image(systemName: projection.locked ? "lock.fill" : "lock.open.fill")
            }
            .font(Font.TS.bodySm.weight(.bold))
            .foregroundStyle(tone.color)
            .labelStyle(.titleAndIcon)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(
            label: LiveTelemetryStrings.string("telemetry.lock", "Lock"),
            value: value
        )))
    }

    private func sentryRow(_ projection: SecurityProjection) -> some View {
        let tone: LiveTelemetryTone = projection.sentryMode ? .info : .muted
        let value = projection.sentryMode
            ? LiveTelemetryStrings.string("telemetry.active", "Active")
            : LiveTelemetryStrings.string("telemetry.off", "Off")
        return HStack {
            Text(verbatim: LiveTelemetryStrings.string("telemetry.sentry", "Sentry"))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            Label {
                Text(verbatim: value)
            } icon: {
                Image(systemName: "shield.lefthalf.filled")
            }
            .font(Font.TS.bodySm.weight(.bold))
            .foregroundStyle(tone.color)
            .labelStyle(.titleAndIcon)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(
            label: LiveTelemetryStrings.string("telemetry.sentry", "Sentry"),
            value: value
        )))
    }

    private func countRow(label: String, allClear: Bool, open: Int) -> some View {
        let text = allClear
            ? LiveTelemetryStrings.string("telemetry.allClosed", "All Closed")
            : "\(open) \(LiveTelemetryStrings.string("telemetry.open", "Open"))"
        return HStack {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.sm)
            TSBadge("\(text)", tone: allClear ? .success : .warning)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: LiveTelemetryAccessibility.row(label: label, value: text)))
    }
}
