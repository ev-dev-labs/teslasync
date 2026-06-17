import SwiftUI

// Drivetrain Health panels — part 1 (web sections 1–3): the health-overview banner + status panel
// (`HealthOverview`), the health-score / motor-details / drive-statistics gauge grid (`HealthGaugeGrid`),
// and the four temperature gauges (`TemperatureGauges`). Each value formats from raw SI via
// `DrivetrainHealthPageFormat` at this display boundary; each panel renders its own empty state where the
// web does (never a blank region).

// MARK: - Section 1 — Health overview (web `HealthOverview`)

/// The condition banner (shown only when not healthy) plus the status panel: a state icon, the
/// drivetrain-condition headline, the motor state, the grade badge, and the animated health score.
struct DrivetrainHealthOverviewSection: View {
    let grade: DrivetrainHealthGrade
    let score: Int
    let motorStatus: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if grade != .good {
                TSAlertBanner(
                    tone: grade.alertTone,
                    systemImage: "exclamationmark.triangle.fill",
                    title: DrivetrainHealthPageStrings.key(alertTitleKey),
                    message: DrivetrainHealthPageStrings.key(alertMessageKey)
                )
            }
            TSGlassPanel {
                HStack(alignment: .center, spacing: TSSpacing.lg) {
                    Image(systemName: grade == .good ? "checkmark.seal.fill" : "exclamationmark.triangle.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(grade.tone.color)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSectionTitle(DrivetrainHealthPageStrings.key(headlineKey))
                        Text(verbatim: motorStateLine)
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                    Spacer(minLength: TSSpacing.md)
                    VStack(alignment: .trailing, spacing: TSSpacing.xs) {
                        TSBadge(
                            DrivetrainHealthPageStrings.key("drivetrain.health.\(grade.rawValue)"),
                            tone: grade.tone
                        )
                        TSAnimatedNumber(formatted: "\(score)%")
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }

    private var motorStateLine: String {
        "\(DrivetrainHealthPageStrings.text("drivetrain.motorState", "Motor State")): \(motorStatus)"
    }

    private var alertTitleKey: String {
        grade == .critical ? "drivetrain.alert.criticalTitle" : "drivetrain.alert.warningTitle"
    }

    private var alertMessageKey: String {
        grade == .critical ? "drivetrain.alert.criticalMsg" : "drivetrain.alert.warningMsg"
    }

    private var headlineKey: String {
        switch grade {
        case .good: "drivetrain.healthGood"
        case .warning: "drivetrain.healthWarn"
        case .critical: "drivetrain.healthCrit"
        }
    }
}

// MARK: - Section 2 — Health / motor / drive gauge grid (web `HealthGaugeGrid`)

/// The three-up grid: the health-score radial gauge, the motor-details key/value list, and the
/// drive-statistics key/value list (its own loading skeleton when the backend roll-up is absent).
struct DrivetrainHealthGaugeGridSection: View {
    let grade: DrivetrainHealthGrade
    let score: Int
    let motorStatus: String
    let activeSensors: Int
    let stats: DrivetrainDrivingStats?
    let units: UnitPreferences
    let isCompact: Bool

    var body: some View {
        LazyVGrid(columns: DrivetrainGrid.columns(isCompact ? 1 : 3), spacing: TSSpacing.md) {
            scoreCard
            motorDetailsCard
            driveStatsCard
        }
    }

    private var scoreCard: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.md) {
                TSRadialGauge(
                    value: Double(score) / 100,
                    label: DrivetrainHealthPageStrings.key("drivetrain.healthScore"),
                    colorIndex: grade.paletteIndex
                )
                Text(DrivetrainHealthPageStrings.key("drivetrain.healthScoreDesc"))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var motorDetailsCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(DrivetrainHealthPageStrings.key("drivetrain.motorDetails"))
                TSKVList(rows: [
                    row("drivetrain.motorStatus", motorStatus),
                    row("drivetrain.overallHealth", grade.rawValue.capitalized),
                    row("drivetrain.healthScoreLabel", "\(score)%"),
                    row("drivetrain.sensorCount", DrivetrainHealthPageFormat.integer(Double(activeSensors)))
                ])
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "waveform.path.ecg")
                        .font(.caption)
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    Text(DrivetrainHealthPageStrings.key("drivetrain.realTime"))
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder
    private var driveStatsCard: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle(DrivetrainHealthPageStrings.key("drivetrain.driveStats"))
                if let stats {
                    TSKVList(rows: [
                        row("drivetrain.totalDrives", DrivetrainHealthPageFormat.integer(Double(stats.totalDrives))),
                        row(
                            "drivetrain.totalDistance",
                            DrivetrainHealthPageFormat.distanceInt(stats.totalDistanceM, units)
                        ),
                        row("drivetrain.avgSpeed", DrivetrainHealthPageFormat.speed(stats.avgSpeedMps, units)),
                        row("drivetrain.topSpeed", DrivetrainHealthPageFormat.speed(stats.topSpeedMps, units))
                    ])
                } else {
                    statsSkeleton
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Web `<Skeleton lines={4} />` shown while the driving roll-up is unavailable.
    private var statsSkeleton: some View {
        TSKVList(rows: [
            row("drivetrain.totalDrives", "00"),
            row("drivetrain.totalDistance", "000"),
            row("drivetrain.avgSpeed", "00"),
            row("drivetrain.topSpeed", "00")
        ])
        .redacted(reason: .placeholder) // parity:allow native skeleton for the unavailable drive roll-up
        .accessibilityLabel(Text(DrivetrainHealthPageStrings.key("drivetrain.driveStats")))
    }

    private func row(_ key: String, _ value: String) -> TSKVRow {
        TSKVRow(id: key, key: DrivetrainHealthPageStrings.key(key), value: value)
    }
}

// MARK: - Section 3 — Temperature gauges (web `TemperatureGauges`)

/// The four radial temperature gauges (front motor / rear motor / inverter / battery), each tinted by
/// its thermal severity and captioned with the converted critical ceiling.
struct DrivetrainTemperatureGaugesSection: View {
    let sensors: [DrivetrainTempSensor]
    let units: UnitPreferences

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                DrivetrainSectionHeader(systemImage: "thermometer.medium", titleKey: "drivetrain.tempGauges")
                if sensors.isEmpty {
                    TSEmptyState(
                        title: DrivetrainHealthPageStrings.key("drivetrain.tempGauges"),
                        message: DrivetrainHealthPageStrings.key("drivetrain.noData"),
                        systemImage: "thermometer.medium"
                    )
                    .frame(maxWidth: .infinity, minHeight: 120)
                } else {
                    LazyVGrid(columns: DrivetrainGrid.columns(columnCount), spacing: TSSpacing.lg) {
                        ForEach(sensors) { sensor in
                            DrivetrainGaugeCell(sensor: sensor, units: units)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var columnCount: Int {
        #if os(iOS)
            horizontalSizeClass == .compact ? 2 : 4
        #else
            4
        #endif
    }
}
