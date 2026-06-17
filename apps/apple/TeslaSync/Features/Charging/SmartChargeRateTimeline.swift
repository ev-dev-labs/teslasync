//
//  SmartChargeRateTimeline.swift
//  TeslaSync — P4-APPLE P7 · page:charging/SmartCharge (Apple) — Rate timeline
//
//  Native peer of `web/.../components/RateTimeline.tsx`: a 24-hour time-of-use
//  bar timeline with a tier legend, per-hour bars colored by tier (or accented
//  when inside the optimal charge window), and sparse hour labels. This is the
//  web's hand-rolled div bar chart — not a recharts surface — so it is rebuilt
//  with SwiftUI primitives + design tokens, never a Swift Charts plot (the
//  parity unit declares zero charts). Each bar is VoiceOver-labeled with its
//  hour, rate, and tier, and exposes a pointer tooltip on macOS.
//

import SwiftUI

struct SmartChargeRateTimeline: View {
    let rates: [SmartChargeHourlyRate]
    let chargeWindow: SmartChargeWindowHours?

    private let barAreaHeight: CGFloat = 96

    private var maxRate: Double {
        max(rates.map(\.rateCents).max() ?? 1, 1)
    }

    var body: some View {
        if rates.isEmpty {
            emptyView
        } else {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                legend
                bars
                hourLabels
            }
        }
    }

    // MARK: - Empty (web `rates.length === 0`)

    private var emptyView: some View {
        Text(verbatim: SmartChargeStrings.text("chargePlanner.noRateData", "No rate data available"))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textMuted)
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.x2xl)
    }

    // MARK: - Legend (web tier swatches)

    private var legend: some View {
        HStack(spacing: TSSpacing.lg) {
            legendItem(color: SmartChargeRateTier.offPeak.barColor, key: "chargePlanner.offPeak", fallback: "Off-Peak")
            legendItem(color: SmartChargeRateTier.midPeak.barColor, key: "chargePlanner.midPeak", fallback: "Mid-Peak")
            legendItem(color: SmartChargeRateTier.onPeak.barColor, key: "chargePlanner.onPeak", fallback: "On-Peak")
            if chargeWindow != nil {
                legendItem(
                    color: Color.TS.accent, key: "chargePlanner.chargeWindow", fallback: "Charge Window"
                )
            }
            Spacer(minLength: 0)
        }
    }

    private func legendItem(color: Color, key: String, fallback: String) -> some View {
        HStack(spacing: TSSpacing.xs) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(color)
                .frame(width: 12, height: 12)
            Text(verbatim: SmartChargeStrings.text(key, fallback))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: - Bars (web 24-hour bar chart)

    private var bars: some View {
        HStack(alignment: .bottom, spacing: 2) {
            ForEach(rates) { rate in
                bar(for: rate)
            }
        }
        .frame(height: barAreaHeight)
    }

    private func bar(for rate: SmartChargeHourlyRate) -> some View {
        let fraction = max(rate.rateCents / maxRate, 0.05)
        let inWindow = chargeWindow?.contains(hour: rate.hour) ?? false
        return RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(inWindow ? Color.TS.accent.opacity(0.75) : rate.rateTier.barColor)
            .frame(maxWidth: .infinity)
            .frame(height: fraction * barAreaHeight)
            .help(Text(verbatim: tooltip(for: rate)))
            .accessibilityLabel(Text(verbatim: tooltip(for: rate)))
    }

    private func tooltip(for rate: SmartChargeHourlyRate) -> String {
        "\(SmartChargeFormat.hourLabel(rate.hour)) · \(SmartChargeFormat.centsPerKwh(rate.rateCents))"
    }

    // MARK: - Hour labels (web every-3rd-hour ticks)

    private var hourLabels: some View {
        HStack(spacing: 2) {
            ForEach(rates) { rate in
                Text(verbatim: rate.hour % 3 == 0 ? SmartChargeFormat.hourLabel(rate.hour) : "")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityHidden(true)
    }
}
