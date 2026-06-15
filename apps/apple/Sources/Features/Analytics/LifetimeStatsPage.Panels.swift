import SwiftUI

// The Fun Facts, Savings-vs-Gasoline, and Environmental-Impact panels for the Lifetime Stats
// surface (web `LifetimeStatsPage.tsx` GlassPanel6/7/8). Each value formats from raw SI via
// `LifetimeStatsFormat`; each panel renders its own empty state (never a blank region), exactly as
// the web page's `stats ? … : <EmptyState>` branches do.

// MARK: - Fun Facts (web GlassPanel6)

/// The Fun Facts panel (web `GlassPanel`): four playful comparison cards, or the no-data empty.
struct LifetimeFunFactsSection: View {
    let stats: LifetimeStats?

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LifetimeSectionHeader(systemImage: "flame.fill", tone: .warning, title: "lifetime.funFacts")
                if let stats {
                    LazyVGrid(columns: columns, spacing: TSSpacing.md) {
                        LifetimeFunFactCard(
                            systemImage: "globe.americas.fill",
                            tone: .info,
                            value: LifetimeStatsFormat.percentValue(stats.earthProgressPercent, decimals: 1),
                            unit: Text(verbatim: "%"),
                            label: "lifetime.earthProgress"
                        )
                        LifetimeFunFactCard(
                            systemImage: "moon.fill",
                            tone: .neutral,
                            value: LifetimeStatsFormat.percentValue(stats.moonProgressPercent, decimals: 2),
                            unit: Text(verbatim: "%"),
                            label: "lifetime.moonProgress"
                        )
                        LifetimeFunFactCard(
                            systemImage: "tree.fill",
                            tone: .success,
                            value: LifetimeStatsFormat.integer(Double(stats.treesEquivalent)),
                            unit: nil,
                            label: "lifetime.treesPlanted"
                        )
                        LifetimeFunFactCard(
                            systemImage: "house.fill",
                            tone: .warning,
                            value: LifetimeStatsFormat.number(stats.homesEquivalentDays, decimals: 1),
                            unit: Text("lifetime.days"),
                            label: "lifetime.homesPowered"
                        )
                    }
                } else {
                    TSEmptyState(title: "lifetime.noData", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One fun-fact comparison (web inline card): a tinted glyph, a value with an optional unit, and a
/// caption label.
struct LifetimeFunFactCard: View {
    let systemImage: String
    let tone: TSTone
    let value: String
    var unit: Text?
    let label: LocalizedStringKey

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            Image(systemName: systemImage)
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(tone.color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                    Text(verbatim: value)
                        .font(Font.TS.section)
                        .fontWeight(.bold)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textPrimary)
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    if let unit {
                        unit
                            .font(Font.TS.bodySm)
                            .foregroundStyle(Color.TS.textMuted)
                    }
                }
                Text(label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Savings vs Gasoline (web GlassPanel7)

/// The Savings panel (web `GlassPanel`): the two-bar EV-vs-gas cost comparison + the headline
/// savings, or the no-savings empty when there is no gas-equivalent cost yet.
struct LifetimeSavingsSection: View {
    let savings: LifetimeSavingsBar?

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LifetimeSectionHeader(
                    systemImage: "dollarsign.circle.fill",
                    tone: .success,
                    title: "lifetime.savingsComparison"
                )
                if let savings {
                    LifetimeSavingsBarView(savings: savings)
                } else {
                    TSEmptyState(title: "lifetime.noSavingsData", systemImage: "dollarsign.circle")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// The EV-vs-gas comparison body (web `SavingsBar`): an electric-cost bar, a gasoline-cost bar, and
/// the savings + CO₂-avoided footer.
struct LifetimeSavingsBarView: View {
    let savings: LifetimeSavingsBar

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            costRow(
                label: "lifetime.electricCost",
                tone: .success,
                amount: savings.evCost,
                fraction: savings.evFraction
            )
            costRow(
                label: "lifetime.gasCost",
                tone: .danger,
                amount: savings.gasCost,
                fraction: savings.gasFraction
            )
            Divider().overlay(Color.TS.border)
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: TSSpacing.xs) {
                    Text("lifetime.youSaved")
                        .font(Font.TS.panel)
                        .foregroundStyle(Color.TS.statusSuccess)
                    Text(verbatim: LifetimeStatsFormat.currency(savings.savings, decimals: 2))
                        .font(Font.TS.panel)
                        .fontWeight(.semibold)
                        .foregroundStyle(Color.TS.statusSuccess)
                }
                Spacer(minLength: TSSpacing.md)
                HStack(spacing: TSSpacing.xs) {
                    Text(verbatim: LifetimeStatsFormat.co2Kg(savings.co2Kg) + " CO₂")
                    Text("lifetime.avoided")
                }
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            }
        }
    }

    private func costRow(label: LocalizedStringKey, tone: TSTone, amount: Double, fraction: Double) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Text(label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(tone.color)
                Spacer(minLength: TSSpacing.sm)
                Text(verbatim: LifetimeStatsFormat.currency(amount, decimals: 2))
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textSecondary)
            }
            TSMetricBar(fraction: fraction, tone: tone)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Environmental Impact (web GlassPanel8)

/// The Environmental Impact panel (web `GlassPanel`): a CO₂-offset ring, trees-equivalent, and
/// coffees-saved tiles, or the no-data empty.
struct LifetimeEnvironmentalSection: View {
    let stats: LifetimeStats?
    let isCompact: Bool

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                LifetimeSectionHeader(
                    systemImage: "leaf.fill",
                    tone: .success,
                    title: "lifetime.environmentalImpact"
                )
                if let stats {
                    let columns = LifetimeGrid.columns(isCompact ? 1 : 3)
                    LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
                        co2Tile(stats)
                        emojiTile(
                            emoji: "🌳",
                            value: LifetimeStatsFormat.integer(Double(stats.treesEquivalent)),
                            label: "lifetime.treesEquiv"
                        )
                        emojiTile(
                            emoji: "☕️",
                            value: LifetimeStatsFormat.integer(Double(stats.coffeesSaved)),
                            label: "lifetime.coffeesEquiv"
                        )
                    }
                } else {
                    TSEmptyState(title: "lifetime.noData", systemImage: "chart.bar")
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func co2Tile(_ stats: LifetimeStats) -> some View {
        HStack(spacing: TSSpacing.md) {
            TSProgressRing(progress: stats.co2RingFraction, lineWidth: 5, colorIndex: 2)
                .frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: LifetimeStatsFormat.co2KgAnimated(stats.co2OffsetKg))
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text("lifetime.co2Offset")
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    private func emojiTile(emoji: String, value: String, label: LocalizedStringKey) -> some View {
        HStack(spacing: TSSpacing.md) {
            Text(verbatim: emoji)
                .font(.system(size: 34))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: value)
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                Text(label)
                    .font(Font.TS.bodySm)
                    .foregroundStyle(Color.TS.textMuted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}
