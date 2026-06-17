//
//  SmartChargeCostCards.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Cost cards
//
//  The three cost-comparison panels (web Cost Comparison grid → manifest panels
//  Charge-Now / Optimized-Cost / Savings). Each is a `StatCard`-style tile: an
//  accent metric icon, the headline currency value, an optional savings trend
//  chip, and a supporting sublabel — laid out responsively (one column on
//  compact iPhone, three across on macOS / iPad).
//

import SwiftUI

/// A savings trend chip descriptor (web StatCard `trend`).
struct SmartChargeTrend: Equatable {
    let text: String
    let positive: Bool
}

/// One cost tile (web `StatCard`): label · icon · value · trend · sublabel.
struct SmartChargeCostCard: View {
    let titleKey: String
    let titleFallback: String
    let value: String
    let icon: String
    let iconColor: Color
    let sublabel: String
    var trend: SmartChargeTrend?

    var body: some View {
        TSCard {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                HStack(alignment: .top) {
                    TSMetricLabel(SmartChargeStrings.key(titleKey))
                    Spacer(minLength: TSSpacing.sm)
                    Image(systemName: icon)
                        .font(Font.TS.panel)
                        .foregroundStyle(iconColor)
                        .accessibilityHidden(true)
                }
                TSMetricValue(value)
                if let trend {
                    trendChip(trend)
                }
                Text(verbatim: sublabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
    }

    private func trendChip(_ trend: SmartChargeTrend) -> some View {
        HStack(spacing: 2) {
            Image(systemName: trend.positive ? "arrow.down.right" : "minus")
                .font(.caption2)
            Text(verbatim: trend.text)
                .font(Font.TS.caption)
                .fontWeight(.medium)
        }
        .foregroundStyle(trend.positive ? Color.TS.statusSuccess : Color.TS.textMuted)
    }
}

/// The three cost cards built from the optimize result (web Cost Comparison grid).
struct SmartChargeCostCardsRow: View {
    let result: SmartChargeOptimization

    private var columns: [GridItem] {
        [GridItem(.adaptive(minimum: 200), spacing: TSSpacing.lg, alignment: .top)]
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            chargeNowCard
            optimizedCard
            savingsCard
        }
    }

    private var chargeNowCard: some View {
        SmartChargeCostCard(
            titleKey: "chargePlanner.chargeNowCost",
            titleFallback: "Charge Now",
            value: SmartChargeFormat.currency(result.comparison.chargeNowCost),
            icon: "dollarsign.circle.fill",
            iconColor: Color.TS.statusDanger,
            sublabel: SmartChargeStrings.text("chargePlanner.currentRate", "At current rates")
        )
    }

    private var optimizedCard: some View {
        SmartChargeCostCard(
            titleKey: "chargePlanner.optimizedCost",
            titleFallback: "Optimized Cost",
            value: SmartChargeFormat.currency(result.comparison.optimizedCost),
            icon: "chart.line.downtrend.xyaxis",
            iconColor: Color.TS.statusSuccess,
            sublabel: "\(result.schedule.rateTier) · \(SmartChargeFormat.centsPerKwh(result.schedule.rateCentsKwh))"
        )
    }

    private var savingsCard: some View {
        SmartChargeCostCard(
            titleKey: "chargePlanner.savings",
            titleFallback: "Savings",
            value: SmartChargeFormat.currency(result.comparison.savings),
            icon: "bolt.batteryblock.fill",
            iconColor: Color.TS.accent,
            sublabel: savingsSublabel,
            trend: savingsTrend
        )
    }

    private var savingsSublabel: String {
        let kwh = SmartChargeFormat.number(result.kwhNeeded, fractionDigits: 1)
        let hours = SmartChargeFormat.number(result.estimatedDurationHours, fractionDigits: 1)
        return "\(kwh) kWh · ~\(hours)h"
    }

    private var savingsTrend: SmartChargeTrend {
        SmartChargeTrend(
            text: SmartChargeFormat.percent(result.comparison.savingsPercent, fractionDigits: 0),
            positive: result.comparison.savings > 0
        )
    }
}
