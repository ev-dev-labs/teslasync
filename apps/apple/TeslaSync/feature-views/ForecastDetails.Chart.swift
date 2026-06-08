//
//  ForecastDetails.Chart.swift
//  TeslaSync — P4 feature view · 0113 · ForecastDetails (Apple)
//
//  The "Charging Breakdown" donut — the Swift Charts parity of the web Recharts
//  `<PieChart><Pie innerRadius=50 outerRadius=75>` with the two fixed cells
//  (`#22c55e` Home / `#f59e0b` Supercharger). A `SectorMark` per category, angled by
//  `pct`, with a per-slice VoiceOver value and a single combined chart summary so the
//  ring is never an opaque image. Colors come from the P1/S9 semantic tokens
//  (Home → statusSuccess, Supercharger → statusWarning) rather than hardcoded hex.
//  No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Category palette (web `<Cell fill="#22c55e" /> / "#f59e0b" />`)

/// Maps a breakdown category to its semantic token color. The web hardcodes
/// green-500 / amber-500 hex; the native side reads the equivalent
/// `statusSuccess` / `statusWarning` tokens so light/high-contrast themes keep
/// working.
enum ForecastPalette {
    static func color(for kind: ForecastCategoryKind) -> Color {
        switch kind {
        case .home: Color.TS.statusSuccess
        case .supercharger: Color.TS.statusWarning
        }
    }
}

// MARK: - Charging Breakdown donut (web `<PieChart>`)

/// The breakdown donut: one `SectorMark` per category, angled by `pct`, inner radius
/// ratio reproducing the web `innerRadius=50 outerRadius=75` ring. Each slice carries
/// a per-category VoiceOver label + value; the chart as a whole exposes one combined
/// summary.
struct ForecastBreakdownDonut: View {
    let slices: [ForecastBreakdownSlice]
    let localize: (String, String) -> String
    let formatting: any ForecastFormatting

    private var angleLabel: String {
        localize("costAnalysis.forecast.breakdown", "Charging Breakdown")
    }

    private func label(for kind: ForecastCategoryKind) -> String {
        localize(kind.labelKey.key, kind.labelKey.fallback)
    }

    private var perKwhWord: String {
        localize("costAnalysis.forecast.perKwh", "per kWh")
    }

    private var summary: String {
        ForecastAccessibility.donutSummary(
            title: angleLabel,
            slices: slices,
            label: label(for:),
            perKwhWord: perKwhWord,
            formatCurrency: { formatting.formatCurrency($0, decimals: 3) }
        )
    }

    var body: some View {
        Chart(slices) { slice in
            SectorMark(
                angle: .value(angleLabel, ForecastNumeric.safe(slice.pct)),
                innerRadius: .ratio(0.66),
                angularInset: 2
            )
            .cornerRadius(4)
            .foregroundStyle(ForecastPalette.color(for: slice.kind))
            .accessibilityLabel(Text(verbatim: label(for: slice.kind)))
            .accessibilityValue(
                Text(verbatim: "\(Int(ForecastNumeric.safe(slice.pct).rounded()))%")
            )
        }
        .chartLegend(.hidden)
        .frame(height: 180)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: summary))
    }
}
