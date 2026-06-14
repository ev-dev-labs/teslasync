import SwiftUI

// The hero metric cards, the savings-breakdown panel, the no-data panel, and the loading skeleton
// for the True Cost surface (web 4 hero `GlassPanel`s, the Savings-Breakdown `GlassPanel`, the
// no-data `GlassPanel`, and the `PageContainer` loading state). Each value formats from raw SI /
// currency via `TrueCostFormat` at this display boundary. The three charts live in
// `TrueCostPage.Charts.swift`.

// MARK: - Hero card (web hero `GlassPanel`: inline icon + label, big value, sub-line)

/// One headline metric card (web hero `GlassPanel`): a small tinted inline icon + uppercase label,
/// the large value, and a muted supporting sub-line. Composes the shared `TSCard` + typography so
/// the per-card accent matches the web hue without neon body text.
struct TrueCostHeroCard: View {
    let title: LocalizedStringKey
    let value: String
    let caption: String
    let systemImage: String
    let tone: TSTone

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: systemImage)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(tone.color)
                        .accessibilityHidden(true)
                    TSMetricLabel(title)
                    Spacer(minLength: 0)
                }
                TSMetricValue(value)
                Text(verbatim: caption)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Hero cards (web GlassPanel1-4)

/// The four hero stat cards (web Total-EV-Cost, Equiv-Gas-Cost, Total-Savings, Monthly-Savings).
/// Reflows 2-up on compact iPhone and 4-up on regular width (web `grid-cols-2 lg:grid-cols-4`).
struct TrueCostHeroCardsSection: View {
    let breakdown: CostBreakdown
    let gasUnit: TrueCostGasUnit
    let currencySymbol: String
    let units: UnitPreferences

    private let columns = [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)]

    var body: some View {
        LazyVGrid(columns: columns, spacing: TSSpacing.md) {
            TrueCostHeroCard(
                title: "tco.totalEvCost",
                value: TrueCostFormat.currency(
                    breakdown.totalChargingCost,
                    decimals: TrueCostFormat.defaultDecimals(units),
                    symbol: currencySymbol
                ),
                caption: TrueCostFormat.energyAndSessions(
                    breakdown.totalEnergyWh,
                    sessions: breakdown.totalSessions,
                    units
                ),
                systemImage: "bolt.fill",
                tone: .accent
            )
            TrueCostHeroCard(
                title: "tco.equivGasCost",
                value: TrueCostFormat.currency(
                    breakdown.equivalentGasCost,
                    decimals: TrueCostFormat.defaultDecimals(units),
                    symbol: currencySymbol
                ),
                caption: TrueCostFormat.gasMeta(
                    gasPrice: breakdown.gasPrice,
                    gasUnit: gasUnit,
                    mpg: breakdown.gasEfficiencyMpg,
                    units,
                    symbol: currencySymbol
                ),
                systemImage: "fuelpump.fill",
                tone: .danger
            )
            TrueCostHeroCard(
                title: "tco.totalSavings",
                value: TrueCostFormat.currency(
                    breakdown.totalSavings,
                    decimals: TrueCostFormat.defaultDecimals(units),
                    symbol: currencySymbol
                ),
                caption: TrueCostFormat.overMonths(breakdown.monthsOfOwnership, units),
                systemImage: "leaf.fill",
                tone: .success
            )
            TrueCostHeroCard(
                title: "tco.monthlySavings",
                value: TrueCostFormat.currency(
                    breakdown.monthlySavings,
                    decimals: TrueCostFormat.defaultDecimals(units),
                    symbol: currencySymbol
                ),
                caption: String(localized: "tco.plusMaintenance", defaultValue: "+ ~$50/mo maintenance savings"),
                systemImage: "chart.line.uptrend.xyaxis",
                tone: .success
            )
        }
    }
}

// MARK: - Savings breakdown (web GlassPanel8 — title + 3 sub-cards)

/// The savings-breakdown panel (web GlassPanel8): a titled `GlassPanel` holding the Fuel-Savings,
/// Maintenance-Savings, and Total-Estimated-Savings sub-cards. Reflows 1-up on compact iPhone and
/// 3-up on regular width (web `sm:grid-cols-3`).
struct TrueCostSavingsBreakdownSection: View {
    let breakdown: CostBreakdown
    let currencySymbol: String
    let units: UnitPreferences

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    private var columns: [GridItem] {
        isCompact
            ? [GridItem(.flexible(), spacing: TSSpacing.md)]
            : Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: 3)
    }

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "dollarsign.circle")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.TS.statusSuccess)
                        .accessibilityHidden(true)
                    TSPanelTitle("tco.savingsBreakdown")
                }
                LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
                    TrueCostBreakdownCard(
                        title: "tco.fuelSavings",
                        value: currency(breakdown.totalSavings),
                        caption: String(localized: "tco.electricityVsGas", defaultValue: "Electricity vs gasoline")
                    )
                    TrueCostBreakdownCard(
                        title: "tco.maintenanceSavings",
                        value: currency(breakdown.maintenanceSavingsEstimate),
                        caption: String(localized: "tco.noOilChanges", defaultValue: "No oil changes, less brake wear")
                    )
                    TrueCostBreakdownCard(
                        title: "tco.totalEstSavings",
                        value: currency(breakdown.totalEstimatedSavings),
                        caption: TrueCostFormat.ownershipFootnote(
                            distanceM: breakdown.totalDistanceM,
                            firstDate: breakdown.firstDate,
                            lastDate: breakdown.lastDate,
                            units
                        )
                    )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
    }

    private func currency(_ amount: Double) -> String {
        TrueCostFormat.currency(amount, decimals: TrueCostFormat.defaultDecimals(units), symbol: currencySymbol)
    }
}

/// One savings-breakdown sub-card (web inner `rounded-xl` tile): uppercase label, value, footnote.
struct TrueCostBreakdownCard: View {
    let title: LocalizedStringKey
    let value: String
    let caption: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            TSMetricLabel(title)
            TSMetricValue(value)
            Text(verbatim: caption)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(2)
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

// MARK: - No-data panel (web GlassPanel9 — !isLoading no-data EmptyState)

/// The no-data panel (web GlassPanel9): shown when the breakdown source loaded but yielded nothing
/// (web `!tco && !isLoading`). Never a blank region — a `dollarsign.circle` empty state.
struct TrueCostNoDataPanel: View {
    var body: some View {
        TSGlassPanel {
            TSEmptyState(
                title: "tco.noData",
                systemImage: "dollarsign.circle"
            )
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Loading skeleton (web PageContainer loading state)

/// Mirrors the page layout while the breakdown source loads (web `PageContainer loading`): four
/// hero cards → the cumulative chart → the two-up cost/monthly charts → the breakdown panel, all
/// under SwiftUI redaction (the manifest's `loading → redacted(reason:)`).
struct TrueCostSkeleton: View {
    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var isCompact: Bool {
        #if os(iOS)
            horizontalSizeClass == .compact
        #else
            false
        #endif
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.x2xl) {
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 160), spacing: TSSpacing.md)],
                spacing: TSSpacing.md
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in block(height: 110) }
            }
            block(height: 300)
            if isCompact {
                block(height: 240)
                block(height: 240)
            } else {
                HStack(spacing: TSSpacing.lg) {
                    block(height: 260)
                    block(height: 260)
                }
            }
            block(height: 200)
        }
        .trueCostRedacted(while: true)
        .accessibilityElement()
        .accessibilityLabel(Text("tco.title"))
    }

    private func block(height: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            .fill(Color.TS.surfaceGlass)
            .frame(maxWidth: .infinity)
            .frame(height: height)
    }
}

// MARK: - Loading redaction (web Skeleton loading state)

extension View {
    /// Applies SwiftUI's skeleton redaction while `loading`, matching the web loading state (the
    /// manifest's `loading → redacted(reason:)` requirement).
    func trueCostRedacted(while loading: Bool) -> some View {
        let reasons: RedactionReasons = loading ? .placeholder : [] // parity:allow redaction API, not a stub
        return redacted(reason: reasons)
    }
}
