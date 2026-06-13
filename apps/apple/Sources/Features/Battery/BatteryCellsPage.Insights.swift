import SwiftUI

// The health-recommendations panel (web GlassPanel20 + the GlassPanel21 insight
// cards) and the summary-stat tiles (web GlassPanel22…27). Insights derive from the
// pack scalars; the tiles restate the headline numbers with threshold-colored values.

// MARK: - Recommendations (web GlassPanel20 — insight cards / empty)

/// The health-recommendations panel (web GlassPanel20): a grid of tinted insight
/// cards (web GlassPanel21) or the no-insights empty state.
struct BatteryCellsRecommendationsSection: View {
    let data: BatteryCellData

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var columns: [GridItem] {
        #if os(iOS)
            if horizontalSizeClass == .compact {
                return [GridItem(.flexible(), spacing: TSSpacing.md)]
            }
        #endif
        return [GridItem(.flexible(), spacing: TSSpacing.md), GridItem(.flexible(), spacing: TSSpacing.md)]
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                TSPanelTitle("battery.cells.recommendations")
                let insights = data.insightsForDisplay
                if insights.isEmpty {
                    TSEmptyState(title: "battery.cells.noInsights", systemImage: "info.circle")
                        .frame(maxWidth: .infinity)
                } else {
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                        ForEach(insights) { insight in
                            BatteryInsightCard(insight: insight)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One tinted recommendation card (web GlassPanel21): a leading status symbol, the
/// title, and the description (the critical-cell description interpolates its count).
struct BatteryInsightCard: View {
    let insight: BatteryCellInsight

    private var accent: Color {
        switch insight.level {
        case .good: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .critical: Color.TS.statusDanger
        }
    }

    private var descriptionText: Text {
        if let count = insight.descriptionCount {
            let format = NSLocalizedString(insight.descriptionKey, comment: "")
            return Text(verbatim: String(format: format, count))
        }
        return Text(LocalizedStringKey(insight.descriptionKey))
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            Image(systemName: insight.systemImage)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(accent)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(LocalizedStringKey(insight.titleKey))
                    .font(Font.TS.bodySm)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
                descriptionText
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(accent.opacity(0.06), in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(accent.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Summary stats (web GlassPanel22…27 — six headline tiles)

/// The six headline tiles (web GlassPanel22…27): total cells, pack voltage, average
/// cell voltage, voltage spread, temperature spread, and normal-cell tally. The two
/// spread tiles color their value by the same thresholds as the summary cards.
struct BatteryCellsSummaryStatsSection: View {
    let data: BatteryCellData
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.md)]

    private var spreadValue: String {
        BatteryCellsFormat.temperatureSpread(
            data.tempSpreadC,
            fahrenheit: units.temperature == "°F",
            unitLabel: units.temperature
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            tile("battery.cells.stat.totalCells", value: "\(data.totalCells)", color: Color.TS.accent)
            tile(
                "battery.cells.stat.packVoltage",
                value: BatteryCellsFormat.voltage(data.packVoltage, decimals: 1),
                color: Color.TS.statusSuccess
            )
            tile(
                "battery.cells.stat.avgVoltage",
                value: BatteryCellsFormat.voltage(data.avgVoltage, decimals: 4),
                color: Color.TS.textPrimary
            )
            tile(
                "battery.cells.stat.voltageSpread",
                value: BatteryCellsFormat.millivolts(data.imbalanceMv),
                color: BatteryCellsTone.imbalance(data.imbalanceMv).color
            )
            tile(
                "battery.cells.stat.tempSpread",
                value: spreadValue,
                color: BatteryCellsTone.tempSpread(data.tempSpreadC).color
            )
            tile(
                "battery.cells.stat.normalCells",
                value: "\(data.normalCellCount)/\(data.totalCells)",
                color: Color.TS.statusSuccess
            )
        }
    }

    private func tile(_ label: LocalizedStringKey, value: String, color: Color) -> some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.xs) {
                Text(label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(color)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }
}
