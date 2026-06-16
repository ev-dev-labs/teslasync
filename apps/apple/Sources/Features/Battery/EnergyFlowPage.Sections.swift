import SwiftUI

// The summary + efficiency panels for the Energy-Flow surface (web Section 2 six MetricCards and
// Section 5 the Efficiency-Metrics GlassPanel with its three inner cards), plus the loading
// skeleton. SI watt-hours / metres convert to the user's units through the shared `Units` facade
// at this boundary (ADR-005); counts / mass format directly via `EnergyFormat`.

// MARK: - Summary cards (web Section 2 — 6 MetricCards)

/// The six summary cards (web Total-Energy, Total-Charged, Distance, Efficiency, CO₂-Saved,
/// Period) in an adaptive grid that reflows 6 → 3 → 2 across width.
struct EnergyFlowSummarySection: View {
    let stats: EnergyFlowStats
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]

    private var distanceValue: String {
        EnergyFormat.integer(Units.convertDistance(stats.totalDistanceM, units))
    }

    private var efficiencyValue: String {
        EnergyFormat.integer(avgEfficiencyDisplay)
    }

    private var avgEfficiencyDisplay: Double {
        EnergyFlowDerivations.avgEfficiencyDisplay(stats.avgEfficiencyWhPerM, distanceUnit: units.distance)
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TSMetricCard(title: "Total Energy", value: Units.formatEnergy(stats.totalEnergyUsedWh, units))
            TSMetricCard(title: "Total Charged", value: Units.formatEnergy(stats.totalEnergyChargedWh, units))
            TSMetricCard(title: "Distance", value: distanceValue, caption: LocalizedStringKey(units.distance))
            TSMetricCard(
                title: "Efficiency",
                value: efficiencyValue,
                caption: LocalizedStringKey(EnergyFormat.efficiencyUnit(units))
            )
            TSMetricCard(title: "CO₂ Saved", value: EnergyFormat.number(stats.co2SavedKg, decimals: 1), caption: "kg")
            TSMetricCard(title: "Period", value: "\(stats.periodDays)", caption: "days")
        }
    }
}

// MARK: - Efficiency metrics (web Section 5 — GlassPanel18 + 3 inner panels)

/// The Efficiency-Metrics panel (web Section 5 GlassPanel): a header over three inner cards —
/// average efficiency with its qualitative rating badge, CO₂ saved, and the average energy per day.
struct EnergyFlowEfficiencySection: View {
    let stats: EnergyFlowStats
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    private var avgEfficiencyDisplay: Double {
        EnergyFlowDerivations.avgEfficiencyDisplay(stats.avgEfficiencyWhPerM, distanceUnit: units.distance)
    }

    private var rating: EnergyFlowDerivations.EfficiencyRating {
        EnergyFlowDerivations.efficiencyRating(avgDisplay: avgEfficiencyDisplay, distanceUnit: units.distance)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "chart.line.uptrend.xyaxis")
                        .foregroundStyle(TSChartPalette.color(at: 1))
                        .accessibilityHidden(true)
                    TSSubhead("Efficiency Metrics")
                }
                LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                    EnergyFlowEfficiencyCard(
                        label: LocalizedStringKey(EnergyFormat.efficiencyUnit(units)),
                        value: EnergyFormat.integer(avgEfficiencyDisplay),
                        valueColorIndex: 0,
                        badge: Self.ratingBadge(rating)
                    )
                    EnergyFlowEfficiencyCard(
                        label: "CO₂ Saved",
                        value: EnergyFormat.number(stats.co2SavedKg, decimals: 1),
                        valueColorIndex: 1,
                        badge: (text: "kg CO₂", tone: .success)
                    )
                    EnergyFlowEfficiencyCard(
                        label: "Avg Energy/Day",
                        value: Units.formatEnergy(EnergyFlowDerivations.avgEnergyPerDayWh(stats), units),
                        valueColorIndex: 3,
                        badge: (text: "per day", tone: .info)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    /// Web badge ladder → label + tone.
    static func ratingBadge(
        _ rating: EnergyFlowDerivations.EfficiencyRating
    ) -> (text: LocalizedStringKey, tone: TSTone) {
        switch rating {
        case .noData: ("No Data", .neutral)
        case .excellent: ("Excellent", .success)
        case .good: ("Good", .warning)
        case .high: ("High", .danger)
        }
    }
}

/// One efficiency-metric inner card (web inner GlassPanel): a muted unit/label, a bold tinted
/// value, and a qualitative badge.
struct EnergyFlowEfficiencyCard: View {
    let label: LocalizedStringKey
    let value: String
    let valueColorIndex: Int
    let badge: (text: LocalizedStringKey, tone: TSTone)

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Text(label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(TSChartPalette.color(at: valueColorIndex))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            TSBadge(badge.text, tone: badge.tone)
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web EnergyFlowPage isLoading branch)

/// Mirrors the Energy-Flow layout while data loads (web loading skeleton grid): the flow diagram,
/// the six summary cards, the daily-energy chart, the two paired charts, the efficiency panel, and
/// the history table.
struct EnergyFlowPageSkeleton: View {
    private let cardColumns = [GridItem(.adaptive(minimum: 150), spacing: TSSpacing.md)]
    private let pairColumns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSSkeleton(height: 220, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: cardColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(height: 88, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 300, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: pairColumns, spacing: TSSpacing.lg) {
                TSSkeleton(height: 300, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 300, cornerRadius: TSRadius.lg)
            }
            TSSkeleton(height: 160, cornerRadius: TSRadius.lg)
            TSSkeleton(height: 240, cornerRadius: TSRadius.lg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text("loading"))
    }
}
