import SwiftUI

// The hero / stat-card / summary / insights sections + the date-range control + the loading skeleton
// for the Efficiency surface (web Sections 1–7). The chart panels live in `EfficiencyPage.Charts.swift`
// and the temperature table in `EfficiencyPage.Table.swift`. Each value formats from raw SI via
// `EfficiencyPageFormat` at this display boundary; each section renders its own empty state (never a blank
// region — web `stats ? content : EmptyState`).

// MARK: - Date range control (web `RangePicker`)

/// The date-range filter (web `RangePicker`): native start/end `DatePicker`s that report the new window
/// back to the model. SwiftUI announces each selected date, so no redundant text label.
struct EfficiencyRangeControl: View {
    let startDate: Date
    let endDate: Date
    let onChange: (Date, Date) -> Void

    @State private var start: Date
    @State private var end: Date

    init(startDate: Date, endDate: Date, onChange: @escaping (Date, Date) -> Void) {
        self.startDate = startDate
        self.endDate = endDate
        self.onChange = onChange
        _start = State(initialValue: startDate)
        _end = State(initialValue: endDate)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "calendar")
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            DatePicker(selection: $start, in: ...end, displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: start) { _, newValue in onChange(newValue, end) }
            Text(verbatim: "–")
                .foregroundStyle(Color.TS.textMuted)
            DatePicker(selection: $end, in: start..., displayedComponents: .date) { EmptyView() }
                .labelsHidden()
                .onChange(of: end) { _, newValue in onChange(start, newValue) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("efficiency.col.date"))
    }
}

// MARK: - Shared chrome

/// A panel header (web `<h3><Icon/> {title}</h3>`): a tinted SF Symbol + a panel title.
struct EfficiencySectionHeader: View {
    let systemImage: String
    let title: LocalizedStringKey
    let tone: TSTone

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage)
                .font(.subheadline)
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            TSPanelTitle(title)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One value + label tile (web hero columns / energy-insight cells). The value is animated for the hero
/// (web `AnimatedNumber`) or statically tinted for the insights (web colored `<p>`).
struct EfficiencyStatTile: View {
    let value: String
    let label: LocalizedStringKey
    var unitSuffix: String?
    var tone: TSTone?
    var animated = false

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            if animated {
                TSAnimatedNumber(formatted: value)
            } else {
                Text(verbatim: value)
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(tone?.color ?? Color.TS.textPrimary)
                    .monospacedDigit()
            }
            HStack(spacing: 2) {
                TSMetricLabel(label)
                if let unitSuffix {
                    Text(verbatim: unitSuffix)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

/// One labeled proportion bar + caption (web summary `MetricBar` + value `<p>`).
struct EfficiencyMetricBarRow: View {
    let label: LocalizedStringKey
    let fraction: Double
    let tone: TSTone
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(label)
            TSMetricBar(fraction: fraction, tone: tone)
            Text(verbatim: caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Hero gauges (web Section 1 — GlassPanel1 + RadialGauge)

/// The hero panel (web GlassPanel1): the average-consumption `RadialGauge` plus the km/kWh, CO₂-saved,
/// and total-distance figures. Renders the noStats empty when the backend roll-up is absent.
struct EfficiencyHeroSection: View {
    let stats: EfficiencyStats?
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: count)
    }

    var body: some View {
        TSGlassPanel {
            if let stats {
                LazyVGrid(columns: columns, alignment: .center, spacing: TSSpacing.lg) {
                    EfficiencyGauge(whPerKm: stats.avgEfficiencyWhPerKm, units: units)
                        .frame(height: 140)
                    EfficiencyStatTile(
                        value: EfficiencyPageFormat.kmPerKwh(stats.avgEfficiencyWhPerKm),
                        label: "efficiency.kmPerKwh",
                        animated: true
                    )
                    EfficiencyStatTile(
                        value: EfficiencyPageFormat.integer(stats.co2SavedKg),
                        label: "efficiency.co2Saved",
                        tone: .success,
                        animated: true
                    )
                    EfficiencyStatTile(
                        value: EfficiencyPageFormat.integer(EfficiencyPageFormat.distanceValue(
                            stats.totalDistanceM,
                            units
                        )),
                        label: "efficiency.totalDistance",
                        unitSuffix: EfficiencyPageFormat.distanceUnit(units),
                        tone: .info,
                        animated: true
                    )
                }
            } else {
                TSEmptyState(title: "efficiency.noStats", systemImage: "bolt.slash")
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Stat cards (web Section 2 — GlassPanel2/3/4/5 + GlassPanel6 empty)

/// The four summary stat cards (web GlassPanel2/3/4/5): average consumption, average speed, estimated
/// cost/km, and drives analyzed. Renders the noStatCards empty (web GlassPanel6) when the roll-up is
/// absent — never collapsing the layout.
struct EfficiencyStatCardsSection: View {
    let stats: EfficiencyStats?
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 4
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        if let stats {
            LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                TSStatCard(
                    title: "efficiency.avgConsumption",
                    value: EfficiencyPageFormat.efficiency(stats.avgEfficiencyWhPerKm, units),
                    systemImage: "bolt.fill"
                )
                TSStatCard(
                    title: "efficiency.avgSpeed",
                    value: EfficiencyPageFormat.speed(stats.avgSpeedMps, units),
                    systemImage: "chart.line.uptrend.xyaxis"
                )
                TSStatCard(
                    title: "efficiency.costPerKm",
                    value: EfficiencyPageFormat.costPerKmCurrency(
                        avgWhPerKm: stats.avgEfficiencyWhPerKm,
                        totalDistanceM: stats.totalDistanceM
                    ),
                    systemImage: "fuelpump.fill"
                )
                TSStatCard(
                    title: "efficiency.drivesAnalyzed",
                    value: "\(stats.totalDrives)",
                    systemImage: "gauge.with.dots.needle.bottom.50percent"
                )
            }
        } else {
            TSGlassPanel {
                TSEmptyState(title: "efficiency.noStatCards", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity)
            }
        }
    }
}

// MARK: - Efficiency summary (web Section 6 — GlassPanel12 + MetricBars)

/// The efficiency-summary panel (web GlassPanel12): four labeled proportion bars (average consumption,
/// average speed, regen ratio, total drive time). Renders the noSummary empty when the roll-up is absent.
struct EfficiencySummarySection: View {
    let stats: EfficiencyStats?
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 1 : 2
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.lg), count: count)
    }

    var body: some View {
        TSGlassPanel {
            if let stats {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    EfficiencySectionHeader(systemImage: "bolt.fill", title: "efficiency.summary", tone: .warning)
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                        EfficiencyMetricBarRow(
                            label: "efficiency.avgConsumption",
                            fraction: EfficiencyPageFormat.efficiencyValue(stats.avgEfficiencyWhPerKm, units) / 300,
                            tone: .info,
                            caption: EfficiencyPageFormat.efficiency(stats.avgEfficiencyWhPerKm, units)
                        )
                        EfficiencyMetricBarRow(
                            label: "efficiency.avgSpeed",
                            fraction: EfficiencyPageFormat.speedValue(stats.avgSpeedMps, units) / 150,
                            tone: .success,
                            caption: EfficiencyPageFormat.speedInt(stats.avgSpeedMps, units)
                        )
                        EfficiencyMetricBarRow(
                            label: "efficiency.regenRatio",
                            fraction: stats.regenRatio,
                            tone: .accent,
                            caption: EfficiencyPageFormat.percent(stats.regenRatio, units)
                        )
                        EfficiencyMetricBarRow(
                            label: "efficiency.totalDriveTime",
                            fraction: stats.totalDurationS / max(stats.totalDurationS, 36000),
                            tone: .warning,
                            caption: EfficiencyPageFormat.duration(stats.totalDurationS, units)
                        )
                    }
                }
            } else {
                TSEmptyState(title: "efficiency.noSummary", systemImage: "bolt.slash")
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Energy insights (web Section 7 — GlassPanel13)

/// The energy-insights panel (web GlassPanel13): six tinted figures — total regen, regen ratio, CO₂
/// saved, total distance, top speed, and estimated cost/km. Renders the noInsights empty when the
/// roll-up is absent.
struct EfficiencyInsightsSection: View {
    let stats: EfficiencyStats?
    let units: UnitPreferences
    let isCompact: Bool

    private var columns: [GridItem] {
        let count = isCompact ? 2 : 6
        return Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: count)
    }

    var body: some View {
        TSGlassPanel {
            if let stats {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    EfficiencySectionHeader(
                        systemImage: "thermometer.medium",
                        title: "efficiency.insights",
                        tone: .warning
                    )
                    LazyVGrid(columns: columns, spacing: TSSpacing.lg) {
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.energy(stats.regenEnergyWh, units),
                            label: "efficiency.totalRegen",
                            tone: .success
                        )
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.percent(stats.regenRatio, units),
                            label: "efficiency.regenRatioLabel",
                            tone: .info
                        )
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.co2(stats.co2SavedKg),
                            label: "efficiency.co2Label",
                            tone: .success
                        )
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.distanceInt(stats.totalDistanceM, units),
                            label: "efficiency.totalDistLabel",
                            tone: .info
                        )
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.speedInt(stats.topSpeedMps, units),
                            label: "efficiency.topSpeed",
                            tone: .accent
                        )
                        EfficiencyStatTile(
                            value: EfficiencyPageFormat.costPerKmCurrency(
                                avgWhPerKm: stats.avgEfficiencyWhPerKm,
                                totalDistanceM: stats.totalDistanceM
                            ),
                            label: "efficiency.costPerKmLabel",
                            tone: .warning
                        )
                    }
                }
            } else {
                TSEmptyState(title: "efficiency.noInsights", systemImage: "thermometer.medium.slash")
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Loading skeleton (web PageContainer loading → Skeleton)

/// Mirrors the page layout while the sources load (web `loading` Skeleton): the hero, the stat cards,
/// the charts, the table, and the summaries, under SwiftUI redaction (the manifest's
/// `loading → redacted(reason:)`).
struct EfficiencySkeleton: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            skeletonBlock(height: 200)
            skeletonGrid(count: 4, minimum: 140)
            skeletonBlock(height: 280)
            skeletonBlock(height: 240)
            skeletonBlock(height: 200)
        }
        .efficiencyRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("efficiency.title"))
    }

    private func skeletonGrid(count: Int, minimum: CGFloat) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
            ForEach(0 ..< count, id: \.self) { _ in
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .fill(Color.TS.surfaceGlass)
                    .frame(height: 120)
            }
        }
    }

    private func skeletonBlock(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web Skeleton loading state
    /// (the manifest's `loading → redacted(reason:)` requirement).
    func efficiencyRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
