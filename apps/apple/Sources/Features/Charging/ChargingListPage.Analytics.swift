import SwiftUI

// The conditional analytical sections (web's threshold-gated blocks): AC/DC overview,
// battery start-level distribution, efficiency, charger specs, and the cost optimizer. Each
// renders its full section once the window has enough sessions (web `THRESHOLD_*`), or its
// "needs N more sessions" threshold empty below it (web `EmptyStateThreshold`) — never a
// blank region.

struct ChargingAnalyticsSections: View {
    let model: ChargingListPageModel
    let isCompact: Bool

    var body: some View {
        let sessions = model.sessions
        if !sessions.isEmpty {
            VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
                acDcSection(sessions)
                batteryDistSection(sessions)
                ChargingEfficiencySection(sessions: sessions, symbol: model.currencySymbol)
                specsSection(sessions)
                optimizerSection(sessions)
            }
        }
    }

    // MARK: AC vs DC (web `AcDcStatsPanel`, threshold 1)

    @ViewBuilder
    private func acDcSection(_ sessions: [ChargingSession]) -> some View {
        if sessions.count >= ChargingThreshold.acDc {
            ChargingAcDcSection(sessions: sessions)
        }
    }

    // MARK: Battery start-level distribution (web `BatteryLevelChart`, threshold 5)

    @ViewBuilder
    private func batteryDistSection(_ sessions: [ChargingSession]) -> some View {
        if sessions.count >= ChargingThreshold.batteryDist {
            ChargingBatteryLevelSection(sessions: sessions)
        } else if !sessions.isEmpty {
            ChargingThresholdEmpty(
                section: "charging.section.batteryDist",
                description: "charging.section.batteryDistDesc",
                current: sessions.count,
                threshold: ChargingThreshold.batteryDist
            )
        }
    }

    // MARK: Charger specs (web `ChargerSpecsPanel`, threshold 5)

    @ViewBuilder
    private func specsSection(_ sessions: [ChargingSession]) -> some View {
        if sessions.count >= ChargingThreshold.specs {
            ChargingSpecsSection(sessions: sessions, symbol: model.currencySymbol)
        } else if !sessions.isEmpty {
            ChargingThresholdEmpty(
                section: "charging.section.specs",
                description: nil,
                current: sessions.count,
                threshold: ChargingThreshold.specs
            )
        }
    }

    // MARK: Optimizer (web `OptimizerSection`, threshold 10)

    @ViewBuilder
    private func optimizerSection(_ sessions: [ChargingSession]) -> some View {
        if let optimizer = model.optimizer, sessions.count >= ChargingThreshold.optimizer {
            ChargingOptimizerSection(optimizer: optimizer, symbol: model.currencySymbol)
        } else if !sessions.isEmpty {
            ChargingThresholdEmpty(
                section: "charging.section.optimizer",
                description: "charging.section.optimizerDesc",
                current: sessions.count,
                threshold: ChargingThreshold.optimizer
            )
        }
    }
}

// MARK: - Threshold empty (web `EmptyStateThreshold`)

/// The "needs N more sessions" empty (web `EmptyStateThreshold`): the section label, an
/// optional description, and a `current / threshold` progress caption using the item noun.
struct ChargingThresholdEmpty: View {
    let section: LocalizedStringKey
    let description: LocalizedStringKey?
    let current: Int
    let threshold: Int

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "hourglass").foregroundStyle(Color.TS.textMuted)
                    TSPanelTitle(section)
                }
                if let description {
                    Text(description).font(Font.TS.caption).foregroundStyle(Color.TS.textSecondary)
                }
                Text(verbatim: String(
                    format: String(localized: "charging.section.thresholdProgress"),
                    current, threshold, String(localized: "charging.itemNoun")
                ))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                TSMetricBar(fraction: Double(current) / Double(threshold), tone: .accent)
            }
        }
    }
}

// MARK: - AC vs DC (web `AcDcStatsPanel`)

/// AC vs DC split for the window (web `AcDcStatsPanel`): session counts and total energy for
/// home-AC vs. DC-fast charging.
struct ChargingAcDcSection: View {
    let sessions: [ChargingSession]

    private var acSessions: [ChargingSession] { sessions.filter { $0.category == .home || $0.category == .unknown } }
    private var dcSessions: [ChargingSession] {
        sessions.filter { $0.category == .supercharger || $0.category == .dc }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.section.acDc")
                HStack(spacing: TSSpacing.md) {
                    tile(label: "charging.acdc.ac", group: acSessions, tone: .success)
                    tile(label: "charging.acdc.dc", group: dcSessions, tone: .warning)
                }
            }
        }
    }

    private func tile(label: LocalizedStringKey, group: [ChargingSession], tone: TSTone) -> some View {
        let energy = group.reduce(0) { $0 + $1.energyAddedWh }
        return TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack {
                    TSMetricLabel(label)
                    Spacer()
                    TSIconBox(systemName: "bolt.fill", tone: tone)
                }
                TSMetricValue("\(group.count)")
                Text(verbatim: "\(ChargingListFormat.energyKwh(energy)) kWh")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Battery start-level distribution (web `BatteryLevelChart`)

/// Where the user typically starts charging (web `BatteryLevelChart`): a histogram of start
/// SoC across five 20-point buckets.
struct ChargingBatteryLevelSection: View {
    let sessions: [ChargingSession]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.section.batteryDist")
                TSBarChart(series: [series])
                    .frame(height: 180)
                    .accessibilityLabel(Text("charging.section.batteryDist"))
            }
        }
    }

    private var series: TSChartSeries {
        var buckets = [Int](repeating: 0, count: 5)
        for session in sessions {
            guard let soc = session.startSocPct else { continue }
            let index = min(4, max(0, Int(soc / 20)))
            buckets[index] += 1
        }
        let points = buckets.enumerated().map { index, count in
            TSChartPoint(x: Double(index * 20), y: Double(count), id: "soc-\(index)")
        }
        return TSChartSeries(
            id: "battery-dist",
            name: "charging.section.batteryDist",
            nameText: "Battery start level",
            points: points,
            colorIndex: 1
        )
    }
}

// MARK: - Efficiency (web `EfficiencyPanel`)

/// Lifetime efficiency stats for the window (web `EfficiencyPanel`): average cost per kWh,
/// average energy per session, and total energy.
struct ChargingEfficiencySection: View {
    let sessions: [ChargingSession]
    let symbol: String

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.section.efficiency")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
                    TSMetricCard(title: "charging.eff.avgCostPerKwh", value: avgCostPerKwh)
                    TSMetricCard(title: "charging.eff.avgPerSession", value: avgPerSession)
                    TSMetricCard(title: "charging.eff.totalEnergy", value: totalEnergy)
                }
            }
        }
    }

    private var avgCostPerKwh: String {
        let values = sessions.compactMap(\.costPerKwh)
        guard !values.isEmpty else { return ChargingListFormat.emptyValue }
        return ChargingListFormat.currency(values.reduce(0, +) / Double(values.count), symbol: symbol)
    }

    private var avgPerSession: String {
        guard !sessions.isEmpty else { return ChargingListFormat.emptyValue }
        let total = sessions.reduce(0) { $0 + $1.energyAddedWh }
        return "\(ChargingListFormat.number(total / 1000 / Double(sessions.count))) kWh"
    }

    private var totalEnergy: String {
        "\(ChargingListFormat.energyKwh(sessions.reduce(0) { $0 + $1.energyAddedWh })) kWh"
    }
}

// MARK: - Charger specs (web `ChargerSpecsPanel`)

/// Per-charger-category breakdown (web `ChargerSpecsPanel`): session count, average peak
/// power, and average cost per kWh for each category present in the window.
struct ChargingSpecsSection: View {
    let sessions: [ChargingSession]
    let symbol: String

    private var categories: [ChargerCategory] {
        ChargerCategory.allCases.filter { category in sessions.contains { $0.category == category } }
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.section.specs")
                ForEach(categories, id: \.rawValue) { category in
                    row(category)
                }
            }
        }
    }

    private func row(_ category: ChargerCategory) -> some View {
        let group = sessions.filter { $0.category == category }
        let peaks = group.compactMap(\.peakPowerW)
        let cpks = group.compactMap(\.costPerKwh)
        let avgPeak = peaks.isEmpty ? nil : peaks.reduce(0, +) / Double(peaks.count)
        let avgCpk = cpks.isEmpty ? nil : cpks.reduce(0, +) / Double(cpks.count)
        return HStack(spacing: TSSpacing.md) {
            Text(LocalizedStringKey(category.labelKeyForSpecs))
                .font(Font.TS.bodySm).foregroundStyle(Color.TS.textPrimary)
                .frame(maxWidth: .infinity, alignment: .leading)
            TSInlineMetric(label: "charging.specs.sessions", value: "\(group.count)")
            TSInlineMetric(label: "charging.specs.peakPower", value: "\(ChargingListFormat.powerKw(avgPeak)) kW")
            TSInlineMetric(
                label: "charging.specs.costPerKwh",
                value: avgCpk.map { ChargingListFormat.currency($0, symbol: symbol) } ?? ChargingListFormat.emptyValue
            )
        }
        .padding(.vertical, TSSpacing.xs)
    }
}

// MARK: - Optimizer (web `OptimizerSection`)

/// The cost-optimizer recommendation (web `OptimizerSection`): the best charging window, the
/// estimated monthly savings, and the current vs. optimal cost per kWh.
struct ChargingOptimizerSection: View {
    let optimizer: ChargingListOptimizer
    let symbol: String

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TSPanelTitle("charging.section.optimizer")
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)], spacing: TSSpacing.md) {
                    TSMetricCard(title: "charging.optimizer.bestWindow", value: optimizer.bestWindowLabel)
                    TSMetricCard(
                        title: "charging.optimizer.savings",
                        value: ChargingListFormat.currency(optimizer.estimatedMonthlySavings, symbol: symbol)
                    )
                    TSMetricCard(
                        title: "charging.optimizer.current",
                        value: ChargingListFormat.currency(optimizer.currentAvgCostPerKwh, symbol: symbol)
                    )
                    TSMetricCard(
                        title: "charging.optimizer.optimal",
                        value: ChargingListFormat.currency(optimizer.optimalAvgCostPerKwh, symbol: symbol)
                    )
                }
            }
        }
    }
}

private extension ChargerCategory {
    /// The charger-specs row label key for this category.
    var labelKeyForSpecs: String {
        switch self {
        case .home: "charging.coll.home"
        case .supercharger: "charging.coll.supercharger"
        case .dc: "charging.coll.dc"
        case .unknown: "charging.specs.other"
        }
    }
}
