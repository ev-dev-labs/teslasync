import SwiftUI

// Weekly Digest composed sections (part 1) — the week selector, the summary hero cards, and the
// week-over-week comparison. SwiftUI parity of `WeekSelector.tsx`, `SummaryHeroCards.tsx`, and
// `WeekOverWeekSummary.tsx`, each reproducing the web `GlassPanel` region with the same data + order.

// MARK: - Adaptive grid (web responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)

/// An adaptive card grid that reflows from one column on compact iPhone to as many as fit on
/// iPad/macOS (web responsive grid utilities).
struct WeeklyDigestGrid<Content: View>: View {
    var minimum: CGFloat = 160
    @ViewBuilder var content: () -> Content

    var body: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: minimum), spacing: TSSpacing.md, alignment: .top)],
            spacing: TSSpacing.md,
            content: content
        )
    }
}

// MARK: - Week selector (web `WeekSelector`)

/// The week navigation bar (web `WeekSelector`): a previous-week button, the centered calendar +
/// week-range label + `Current` badge, and a next-week button disabled on the current week.
struct WeeklyDigestWeekSelector: View {
    let weekLabel: String
    let isCurrentWeek: Bool
    let onPrev: () -> Void
    let onNext: () -> Void

    var body: some View {
        TSGlassPanel {
            HStack(spacing: TSSpacing.md) {
                TSButton(variant: .ghost, size: .small, action: onPrev) {
                    Label("analytics.weeklyDigest.prevWeek", systemImage: "chevron.left")
                }
                Spacer(minLength: TSSpacing.sm)
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "calendar")
                        .foregroundStyle(Color.TS.textSecondary)
                    Text(verbatim: weekLabel)
                        .font(Font.TS.bodySm)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.textPrimary)
                    if isCurrentWeek {
                        TSBadge("analytics.weeklyDigest.current", tone: .info)
                    }
                }
                Spacer(minLength: TSSpacing.sm)
                TSButton(variant: .ghost, size: .small, action: onNext) {
                    Label("analytics.weeklyDigest.nextWeek", systemImage: "chevron.right")
                }
                .disabled(isCurrentWeek)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Summary hero cards (web `SummaryHeroCards`)

/// The "Week Summary" surface (web `SummaryHeroCards`): a titled panel over a responsive grid of hero
/// cards — Total Distance, Total Drives, Energy Used, Charging Cost, CO₂ Saved, and an optional Fun
/// Fact — each with its week-over-week trend chip.
struct WeeklyDigestSummarySection: View {
    let metrics: DigestMetrics
    let funFact: DigestFunFact?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text("analytics.weeklyDigest.weekSummary")
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                WeeklyDigestGrid {
                    WeeklyDigestHighlightCard(
                        systemImage: "car.fill",
                        labelKey: "analytics.weeklyDigest.totalDistance",
                        value: "\(WeeklyDigestFormat.number(metrics.totalDistance, decimals: 1)) km",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.totalDistance,
                            previous: metrics.prevDistance
                        ),
                        accent: .cyan
                    )
                    WeeklyDigestHighlightCard(
                        systemImage: "waveform.path.ecg",
                        labelKey: "analytics.weeklyDigest.totalDrives",
                        value: WeeklyDigestFormat.int(Double(metrics.totalDrives)),
                        trend: DigestTrendCalculator.trend(
                            current: Double(metrics.totalDrives),
                            previous: Double(metrics.prevDriveCount)
                        ),
                        accent: .green
                    )
                    WeeklyDigestHighlightCard(
                        systemImage: "bolt.fill",
                        labelKey: "analytics.weeklyDigest.energyUsed",
                        value: "\(WeeklyDigestFormat.number(metrics.energyUsed, decimals: 1)) kWh",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.energyUsed,
                            previous: metrics.prevEnergy,
                            invertPositive: true
                        ),
                        accent: .purple
                    )
                    WeeklyDigestHighlightCard(
                        systemImage: "fuelpump.fill",
                        labelKey: "analytics.weeklyDigest.chargingCost",
                        value: WeeklyDigestFormat.currency(metrics.chargingCost, decimals: 2),
                        trend: DigestTrendCalculator.trend(
                            current: metrics.chargingCost,
                            previous: metrics.prevChargingCost,
                            invertPositive: true
                        ),
                        accent: .amber
                    )
                    WeeklyDigestHighlightCard(
                        systemImage: "leaf.fill",
                        labelKey: "analytics.weeklyDigest.co2Saved",
                        value: "\(WeeklyDigestFormat.number(metrics.co2Saved, decimals: 1)) kg",
                        trend: DigestTrendCalculator.trend(current: metrics.co2Saved, previous: metrics.prevCo2),
                        accent: .green
                    )
                    if let funFact {
                        WeeklyDigestHighlightCard(
                            systemImage: "mappin.and.ellipse",
                            labelKey: "analytics.weeklyDigest.funFact",
                            value: "\(funFact.times)×",
                            subtitle: "≈ \(funFact.times)× \(funFact.from) → \(funFact.to)",
                            accent: .cyan
                        )
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Week-over-week comparison (web `WeekOverWeekSummary`)

/// The week-over-week comparison (web `WeekOverWeekSummary`): a titled panel over a grid of six stat
/// cards (Distance, Drives, Energy, Cost, Efficiency, CO₂), each with its trend.
struct WeeklyDigestWeekOverWeekSection: View {
    let metrics: DigestMetrics

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                Text("analytics.weeklyDigest.weekOverWeek")
                    .font(Font.TS.section)
                    .fontWeight(.bold)
                    .foregroundStyle(Color.TS.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                WeeklyDigestGrid {
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.distance",
                        value: WeeklyDigestFormat.number(metrics.totalDistance, decimals: 1),
                        unit: "km",
                        systemImage: "car.fill",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.totalDistance,
                            previous: metrics.prevDistance
                        )
                    )
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.drives",
                        value: WeeklyDigestFormat.int(Double(metrics.totalDrives)),
                        systemImage: "waveform.path.ecg",
                        trend: DigestTrendCalculator.trend(
                            current: Double(metrics.totalDrives),
                            previous: Double(metrics.prevDriveCount)
                        )
                    )
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.energy",
                        value: WeeklyDigestFormat.number(metrics.energyUsed, decimals: 1),
                        unit: "kWh",
                        systemImage: "bolt.fill",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.energyUsed,
                            previous: metrics.prevEnergy,
                            invertPositive: true
                        )
                    )
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.cost",
                        value: WeeklyDigestFormat.currency(metrics.chargingCost, decimals: 2),
                        systemImage: "fuelpump.fill",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.chargingCost,
                            previous: metrics.prevChargingCost,
                            invertPositive: true
                        )
                    )
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.efficiency",
                        value: WeeklyDigestFormat.number(metrics.avgEfficiency, decimals: 1),
                        unit: "Wh/km",
                        systemImage: "chart.bar.fill",
                        trend: DigestTrendCalculator.trend(
                            current: metrics.avgEfficiency,
                            previous: metrics.prevAvgEfficiency,
                            invertPositive: true
                        )
                    )
                    WeeklyDigestStatCard(
                        labelKey: "analytics.weeklyDigest.co2",
                        value: WeeklyDigestFormat.number(metrics.co2Saved, decimals: 1),
                        unit: "kg",
                        systemImage: "leaf.fill",
                        trend: DigestTrendCalculator.trend(current: metrics.co2Saved, previous: metrics.prevCo2)
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}
