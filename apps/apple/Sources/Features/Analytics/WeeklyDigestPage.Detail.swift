import SwiftUI

// Weekly Digest composed sections (part 2) — the driving, charging, battery-health, and alerts
// sections. SwiftUI parity of `DrivingSection.tsx`, `ChargingSection.tsx`, `BatteryHealthSection.tsx`,
// and `AlertsSection.tsx`, each reproducing every web `GlassPanel` region in the same data + order.

// MARK: - Count chip (web dynamic-value `Badge`)

/// A small tinted count chip for dynamic numeric values (web `<Badge>{count}</Badge>` — alert totals,
/// per-severity counts, the energy-vs-last-week delta).
struct WeeklyDigestCountBadge: View {
    let text: String
    let tone: TSTone

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .fontWeight(.semibold)
            .monospacedDigit()
            .foregroundStyle(tone.color)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(tone.color.opacity(0.15), in: Capsule())
            .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
    }
}

// MARK: - Driving (web `DrivingSection`)

/// The driving section (web `DrivingSection`): a header, the daily-distance bar chart, four stat
/// tiles, and the top-drive card.
struct WeeklyDigestDrivingSection: View {
    let metrics: DigestMetrics
    let dailyDistance: [DigestDailyBar]

    /// Web: lower Wh/km is better → `avgEfficiency <= prevAvgEfficiency` shows a green down arrow.
    private var efficiencyImproved: Bool {
        metrics.avgEfficiency <= metrics.prevAvgEfficiency
    }

    private var efficiencyChangeValue: String {
        guard metrics.prevAvgEfficiency > 0 else { return WeeklyDigestFormat.emptyValue }
        let pct = DigestTrendCalculator.pctChange(current: metrics.avgEfficiency, previous: metrics.prevAvgEfficiency)
        return WeeklyDigestFormat.percent(pct, decimals: 1)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                WeeklyDigestSectionHeader(
                    systemImage: "car.fill",
                    tone: .accent,
                    titleKey: "analytics.weeklyDigest.drivingSection"
                )
                WeeklyDigestDailyBarChart(
                    titleKey: "analytics.weeklyDigest.dailyDistance",
                    titleText: "Daily Distance (km)",
                    bars: dailyDistance,
                    colorIndex: 0
                )
                WeeklyDigestGrid(minimum: 180) {
                    WeeklyDigestMiniStat(
                        systemImage: "chart.bar.fill",
                        labelKey: "analytics.weeklyDigest.avgEfficiency",
                        value: "\(WeeklyDigestFormat.number(metrics.avgEfficiency, decimals: 1)) Wh/km"
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "clock.fill",
                        labelKey: "analytics.weeklyDigest.totalDrivingTime",
                        value: WeeklyDigestFormat.drivingTime(minutes: metrics.totalDuration)
                    )
                    WeeklyDigestMiniStat(
                        systemImage: efficiencyImproved ? "arrow.down.right" : "arrow.up.right",
                        labelKey: "analytics.weeklyDigest.efficiencyChange",
                        value: efficiencyChangeValue,
                        iconTone: efficiencyImproved ? .success : .danger
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "waveform.path.ecg",
                        labelKey: "analytics.weeklyDigest.drivesCount",
                        value: WeeklyDigestFormat.int(Double(metrics.totalDrives))
                    )
                }
                WeeklyDigestTopDriveCard(topDrive: metrics.topDrive)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The longest-drive highlight (web `DrivingSection` top-drive `GlassPanel`): a badge + a date /
/// distance / duration / efficiency grid, or an empty state when the week has no drives.
struct WeeklyDigestTopDriveCard: View {
    let topDrive: DigestDrive?

    var body: some View {
        TSGlassPanel {
            if let drive = topDrive {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    TSBadge("analytics.weeklyDigest.topDrive", tone: .success)
                    WeeklyDigestGrid(minimum: 120) {
                        field("analytics.weeklyDigest.date", WeeklyDigestDateFormat.medium(drive.startDate))
                        field(
                            "analytics.weeklyDigest.distance",
                            "\(WeeklyDigestFormat.number(drive.distanceKm, decimals: 1)) km"
                        )
                        field(
                            "analytics.weeklyDigest.duration",
                            "\(WeeklyDigestFormat.int(drive.durationMin)) min"
                        )
                        field(
                            "analytics.weeklyDigest.efficiency",
                            "\(WeeklyDigestFormat.number(drive.efficiencyWhKm, decimals: 1)) Wh/km"
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                TSEmptyState(title: "analytics.weeklyDigest.noTopDrive", systemImage: "car")
                    .frame(maxWidth: .infinity, minHeight: 120)
            }
        }
    }

    private func field(_ labelKey: LocalizedStringKey, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(labelKey)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Charging (web `ChargingSection`)

/// The charging section (web `ChargingSection`): a header, the daily-energy bar chart, four stat
/// tiles, and the energy-vs-last-week delta row.
struct WeeklyDigestChargingSection: View {
    let metrics: DigestMetrics
    let dailyEnergy: [DigestDailyBar]

    private var energyUp: Bool {
        metrics.chargeEnergyAdded >= metrics.prevChargeEnergy
    }

    private var energyDeltaText: String {
        guard metrics.prevChargeEnergy > 0 else { return WeeklyDigestFormat.emptyValue }
        let pct = DigestTrendCalculator.pctChange(
            current: metrics.chargeEnergyAdded,
            previous: metrics.prevChargeEnergy
        )
        return WeeklyDigestFormat.percent(pct, decimals: 1)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                WeeklyDigestSectionHeader(
                    systemImage: "bolt.fill",
                    tone: .success,
                    titleKey: "analytics.weeklyDigest.chargingSection"
                )
                WeeklyDigestDailyBarChart(
                    titleKey: "analytics.weeklyDigest.dailyEnergyAdded",
                    titleText: "Daily Energy Added (kWh)",
                    bars: dailyEnergy,
                    colorIndex: 1
                )
                WeeklyDigestGrid(minimum: 180) {
                    WeeklyDigestMiniStat(
                        systemImage: "bolt.fill",
                        labelKey: "analytics.weeklyDigest.sessions",
                        value: WeeklyDigestFormat.int(Double(metrics.chargingSessionCount))
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "bolt.batteryblock.fill",
                        labelKey: "analytics.weeklyDigest.totalEnergyAdded",
                        value: "\(WeeklyDigestFormat.number(metrics.chargeEnergyAdded, decimals: 1)) kWh"
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "gauge.with.dots.needle.67percent",
                        labelKey: "analytics.weeklyDigest.avgChargeRate",
                        value: "\(WeeklyDigestFormat.number(metrics.avgChargeRate, decimals: 1)) kW"
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "fuelpump.fill",
                        labelKey: "analytics.weeklyDigest.totalCost",
                        value: WeeklyDigestFormat.currency(metrics.chargingCost, decimals: 2)
                    )
                }
                TSGlassPanel {
                    HStack(spacing: TSSpacing.md) {
                        Text("analytics.weeklyDigest.energyVsLastWeek")
                            .font(Font.TS.caption)
                            .foregroundStyle(Color.TS.textSecondary)
                        Spacer(minLength: TSSpacing.sm)
                        WeeklyDigestCountBadge(text: energyDeltaText, tone: energyUp ? .success : .warning)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Battery health (web `BatteryHealthSection`)

/// The battery-health section (web `BatteryHealthSection`): a header, two battery pills (avg start /
/// end), and three stat tiles (avg charge gain, charge sessions, est. range added).
struct WeeklyDigestBatterySection: View {
    let metrics: DigestMetrics

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                WeeklyDigestSectionHeader(
                    systemImage: "battery.100",
                    tone: .info,
                    titleKey: "analytics.weeklyDigest.batteryHealth"
                )
                WeeklyDigestGrid(minimum: 240) {
                    WeeklyDigestBatteryPill(
                        level: Int(metrics.batteryStart.rounded()),
                        labelKey: "analytics.weeklyDigest.avgBatteryStart"
                    )
                    WeeklyDigestBatteryPill(
                        level: Int(metrics.batteryEnd.rounded()),
                        labelKey: "analytics.weeklyDigest.avgBatteryEnd"
                    )
                }
                WeeklyDigestGrid(minimum: 160) {
                    WeeklyDigestMiniStat(
                        systemImage: "arrow.up.right",
                        labelKey: "analytics.weeklyDigest.avgChargeGain",
                        value: "\(WeeklyDigestFormat.number(metrics.batteryEnd - metrics.batteryStart, decimals: 1))%"
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "bolt.fill",
                        labelKey: "analytics.weeklyDigest.chargeSessions",
                        value: WeeklyDigestFormat.int(Double(metrics.chargingSessionCount))
                    )
                    WeeklyDigestMiniStat(
                        systemImage: "mappin.and.ellipse",
                        labelKey: "analytics.weeklyDigest.estRangeAdded",
                        value: "\(WeeklyDigestFormat.number(metrics.chargeEnergyAdded * 5.5, decimals: 0)) km"
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Alerts (web `AlertsSection`)

/// The alerts section (web `AlertsSection`): a header with the total badge, then either the empty
/// state (no alerts) or the severity breakdown rows beside the alert-distribution donut.
struct WeeklyDigestAlertsSection: View {
    let metrics: DigestMetrics
    let slices: [DigestAlertSlice]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color.TS.statusWarning)
                    Text("analytics.weeklyDigest.alertsSection")
                        .font(Font.TS.section)
                        .fontWeight(.bold)
                        .foregroundStyle(Color.TS.textPrimary)
                    if metrics.alertTotal > 0 {
                        WeeklyDigestCountBadge(
                            text: WeeklyDigestFormat.int(Double(metrics.alertTotal)),
                            tone: .warning
                        )
                    }
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)

                if metrics.alertTotal == 0 {
                    TSEmptyState(
                        title: "analytics.weeklyDigest.noAlerts",
                        systemImage: "exclamationmark.triangle"
                    )
                    .frame(maxWidth: .infinity, minHeight: 140)
                } else {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 280), spacing: TSSpacing.lg, alignment: .top)],
                        spacing: TSSpacing.lg
                    ) {
                        severityColumn
                        distributionColumn
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private var severityColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text("analytics.weeklyDigest.alertsBySeverity")
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            ForEach(slices) { slice in
                WeeklyDigestSeverityRow(slice: slice)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var distributionColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text("analytics.weeklyDigest.alertDistribution")
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            WeeklyDigestAlertPie(slices: slices)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One alert severity row (web per-severity `GlassPanel`): a severity-colored icon + name and the
/// count chip.
struct WeeklyDigestSeverityRow: View {
    let slice: DigestAlertSlice

    private var icon: String {
        switch slice.severity {
        case "critical": "exclamationmark.circle.fill"
        case "warning": "exclamationmark.triangle.fill"
        case "info": "info.circle.fill"
        default: "bell.fill"
        }
    }

    private var tone: TSTone {
        switch slice.severity {
        case "critical": .danger
        case "warning": .warning
        case "info": .info
        default: .neutral
        }
    }

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: icon)
                    .foregroundStyle(tone.color)
                Text(verbatim: slice.name)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer(minLength: TSSpacing.sm)
                WeeklyDigestCountBadge(text: WeeklyDigestFormat.int(Double(slice.value)), tone: tone)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Date formatting (web `formatDate`)

/// Localized medium date (web `formatDate` for the top-drive date).
enum WeeklyDigestDateFormat {
    static func medium(_ date: Date) -> String {
        date.formatted(date: .abbreviated, time: .omitted)
    }
}
