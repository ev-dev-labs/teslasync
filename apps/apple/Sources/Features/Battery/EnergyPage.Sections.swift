import SwiftUI

// The non-chart panels for the Energy surface (web Quick-Metrics strip, the Lifetime-Metrics
// panel, the two Cost-vs-Gas comparison cards, and the loading skeleton). Counts/currency
// format directly via `EnergyFormat`; absolute distance/energy convert through the shared SI
// `Units` facade at this boundary. The sessions table lives in `EnergyPage.Table.swift`; the
// gauges + charts in `EnergyPage.Charts.swift`.

// MARK: - Quick metrics strip (web 6 GlassPanels)

/// One quick-metric chip (web small GlassPanel): an uppercase label over a bold value, tinted
/// with a toned semantic colour (the web neon accents mapped to status/accent tokens).
struct EnergyMetricChip: View {
    let label: Text
    let value: String
    let color: Color

    var body: some View {
        TSGlassPanel {
            VStack(spacing: TSSpacing.xs) {
                label
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .multilineTextAlignment(.center)
                Text(verbatim: value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(color)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            .frame(maxWidth: .infinity)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The six quick-metric chips (web Cost-per-distance, Cost-per-kWh, Total-Distance, Sessions,
/// Monthly-Est, Yearly-Est) in an adaptive grid that reflows 6 → 4 → 2 across width.
struct EnergyMetricStripSection: View {
    let model: EnergyPageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.md)]

    private var costPerDistanceValue: String {
        let displayDistance = Units.convertDistance(model.totalDistanceM, units)
        let perUnit = displayDistance > 0 ? model.totalCost / displayDistance : 0
        return EnergyFormat.currency(perUnit)
    }

    private var totalDistanceValue: String {
        "\(EnergyFormat.integer(Units.convertDistance(model.totalDistanceM, units))) \(units.distance)"
    }

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            EnergyMetricChip(
                label: Text(verbatim: EnergyStrings.costPerDistance(units.distance)),
                value: costPerDistanceValue,
                color: Color.TS.accent
            )
            EnergyMetricChip(
                label: Text("energy.metric.costPerKwh"),
                value: EnergyFormat.currency(model.costPerKwh),
                color: Color.TS.statusSuccess
            )
            EnergyMetricChip(
                label: Text("energy.metric.totalDistance"),
                value: totalDistanceValue,
                color: Color.TS.textPrimary
            )
            EnergyMetricChip(
                label: Text("energy.metric.sessions"),
                value: "\(model.sessions.count)",
                color: Color.TS.chartSeriesPower
            )
            EnergyMetricChip(
                label: Text("energy.metric.monthlyEst"),
                value: EnergyFormat.currency(model.monthlyProjectedCost),
                color: Color.TS.statusWarning
            )
            EnergyMetricChip(
                label: Text("energy.metric.yearlyEst"),
                value: EnergyFormat.currency(model.yearlyProjectedCost),
                color: Color.TS.statusDanger
            )
        }
    }
}

// MARK: - Lifetime metrics (web Lifetime GlassPanel — 2 cards)

/// The Lifetime-Metrics panel (web Lifetime GlassPanel): the vehicle's reported lifetime kWh
/// (web `liveCharging.lifetime_energy_used`, an em dash when absent) and the selected-window
/// energy added, each with its description.
struct EnergyLifetimeSection: View {
    let model: EnergyPageModel
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 220), spacing: TSSpacing.md)]

    private var lifetimeValue: String? {
        model.telemetry?.lifetimeEnergyUsed.map { "\(EnergyFormat.number($0, decimals: 2)) kWh" }
    }

    private var periodValue: String {
        Units.formatEnergy(model.totalEnergyWh, units)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    Image(systemName: "bolt.fill")
                        .foregroundStyle(Color.TS.accent)
                        .accessibilityHidden(true)
                    TSSubhead("energy.lifetime.title")
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    EnergyLifetimeCard(
                        label: Text("energy.lifetime.energyUsed"),
                        value: lifetimeValue,
                        description: "energy.lifetime.energyUsedDesc",
                        tint: Color.TS.accent
                    )
                    EnergyLifetimeCard(
                        label: Text(verbatim: EnergyStrings.periodEnergyLabel(days: model.periodDays)),
                        value: periodValue,
                        description: "energy.lifetime.periodEnergyDesc",
                        tint: Color.TS.statusSuccess
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }
}

/// One lifetime sub-card (web inner panel): label, value (em dash when nil), description.
struct EnergyLifetimeCard: View {
    let label: Text
    let value: String?
    let description: LocalizedStringKey
    let tint: Color

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            label
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: value ?? EnergyFormat.emptyValue)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(value == nil ? Color.TS.textMuted : tint)
            Text(description)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Cost vs gas savings (web 2 CostComparisonCards)

/// The two Cost-vs-Gas comparison cards (web period-total + projected-annual), side by side on
/// regular width and stacked on compact.
struct EnergyCostComparisonSection: View {
    let model: EnergyPageModel

    private let columns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            EnergyCostComparisonCard(
                label: Text(verbatim: EnergyStrings.periodTotalLabel(days: model.periodDays)),
                systemImage: "fuelpump.fill",
                evCost: model.totalCost,
                gasCost: model.gasEquivalent
            )
            EnergyCostComparisonCard(
                label: Text("energy.cost_decimal.projectedAnnual"),
                systemImage: "leaf.fill",
                evCost: model.yearlyProjectedCost,
                gasCost: model.projectedAnnualGas
            )
        }
    }
}

/// One cost-comparison card (web `CostComparisonCard`): EV cost → gas-equivalent cost, with the
/// saving and the percentage less.
struct EnergyCostComparisonCard: View {
    let label: Text
    let systemImage: String
    let evCost: Double
    let gasCost: Double

    private var savings: Double { gasCost - evCost }
    private var savingsPct: Double { gasCost > 0 ? (savings / gasCost) * 100 : 0 }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                HStack(spacing: TSSpacing.sm) {
                    TSIconBox(systemName: systemImage, tone: .success)
                    label
                        .font(Font.TS.bodySm)
                        .fontWeight(.medium)
                        .foregroundStyle(Color.TS.textSecondary)
                }
                HStack(alignment: .center, spacing: TSSpacing.lg) {
                    costColumn(title: "energy.cost_decimal.evCost", value: evCost, tint: TSChartPalette.color(at: 4))
                    Image(systemName: "arrow.right")
                        .foregroundStyle(Color.TS.textMuted)
                        .accessibilityHidden(true)
                    costColumn(
                        title: "energy.cost_decimal.gasEquivalent",
                        value: gasCost,
                        tint: Color.TS.textSecondary
                    )
                }
                savingRow
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func costColumn(title: LocalizedStringKey, value: Double, tint: Color) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(title)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Text(verbatim: EnergyFormat.currency(value))
                .font(Font.TS.section)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(tint)
        }
    }

    private var savingRow: some View {
        let less = String(localized: "energy.cost_decimal.less", defaultValue: "less")
        let pct = EnergyFormat.percent(savingsPct, decimals: 0)
        return HStack(spacing: TSSpacing.sm) {
            (Text("energy.cost_decimal.saving") + Text(verbatim: " \(EnergyFormat.currency(savings))"))
                .font(Font.TS.bodySm)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.statusSuccess)
            TSBadge(LocalizedStringKey("\(pct) \(less)"), tone: .success)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Loading skeleton (web EnergyPageSkeleton)

/// Mirrors the Energy layout while data loads (web `EnergyPageSkeleton`): header → hero gauges
/// → 6-chip metric strip → lifetime panel → 2 cost cards → 2 chart panels → a wide chart.
struct EnergyPageSkeleton: View {
    private let chipColumns = [GridItem(.adaptive(minimum: 110), spacing: TSSpacing.md)]
    private let pairColumns = [GridItem(.adaptive(minimum: 260), spacing: TSSpacing.lg)]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            TSSkeleton(width: 220, height: 28)
            TSSkeleton(height: 150, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: chipColumns, spacing: TSSpacing.md) {
                ForEach(0 ..< 6, id: \.self) { _ in
                    TSSkeleton(height: 64, cornerRadius: TSRadius.lg)
                }
            }
            TSSkeleton(height: 140, cornerRadius: TSRadius.lg)
            LazyVGrid(columns: pairColumns, spacing: TSSpacing.lg) {
                TSSkeleton(height: 120, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 120, cornerRadius: TSRadius.lg)
            }
            LazyVGrid(columns: pairColumns, spacing: TSSpacing.lg) {
                TSSkeleton(height: 280, cornerRadius: TSRadius.lg)
                TSSkeleton(height: 280, cornerRadius: TSRadius.lg)
            }
            TSSkeleton(height: 300, cornerRadius: TSRadius.lg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityLabel(Text("loading"))
    }
}
