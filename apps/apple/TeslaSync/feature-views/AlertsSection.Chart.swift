//
//  AlertsSection.Chart.swift
//  TeslaSync — P4 feature view · 0071 · AlertsSection (Apple)
//
//  The "Alert Distribution" donut (web Recharts `PieChart` + `Legend` → native
//  `Chart { SectorMark }`) and its tappable legend, split out of
//  AlertsSection.Views.swift to keep each presentational file focused. Selecting a
//  legend row highlights the matching slice and swaps the donut center readout.
//  All copy resolves through the P1/S10 facade; colors come from `AlertsPalette`
//  (P1/S9). No networking lives here.
//

import Charts
import SwiftUI

// MARK: - Alert distribution (right column)

/// The "Alert Distribution" column: a labeled donut over a tappable legend (web
/// Recharts `PieChart` + `Legend`). Selecting a legend row highlights its slice and
/// swaps the donut center to that severity's count + share.
struct AlertDistribution: View {
    let data: [AlertSeverityDatum]
    @State private var selectedKey: String?

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            AlertsStrings.text("analytics.weeklyDigest.alertDistribution", "Alert Distribution")
                .font(Font.TS.bodySm)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.textSecondary)
            AlertDonutChart(data: data, selectedKey: selectedKey)
            AlertDistributionLegend(data: data, selectedKey: $selectedKey)
        }
        .frame(maxWidth: .infinity)
    }
}

/// The donut itself (web `<Pie innerRadius=55 outerRadius=90>`). A `SectorMark`
/// per severity, the non-selected slices dimmed while a selection is active, with a
/// center label (total, or the selected severity's count + share). Each slice
/// carries a per-severity VoiceOver value.
struct AlertDonutChart: View {
    let data: [AlertSeverityDatum]
    let selectedKey: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var valueLabel: String {
        AlertsStrings.string("analytics.weeklyDigest.alertDistribution", "Alert Distribution")
    }

    var body: some View {
        Chart(data) { datum in
            SectorMark(
                angle: .value(valueLabel, datum.count),
                innerRadius: .ratio(0.62),
                angularInset: 2
            )
            .cornerRadius(4)
            .foregroundStyle(AlertsPalette.color(for: datum.kind))
            .opacity(selectedKey == nil || selectedKey == datum.rawKey ? 1 : 0.3)
            .accessibilityLabel(Text(verbatim: datum.label(localize: AlertsStrings.string)))
            .accessibilityValue(Text(verbatim: AlertsFormat.count(datum.count)))
        }
        .chartLegend(.hidden)
        .frame(height: 200)
        .overlay {
            AlertDonutCenter(data: data, selectedKey: selectedKey)
        }
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.normalDuration), value: selectedKey)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(
            AlertsStrings.text(
                "analytics.weeklyDigest.distribution.a11y",
                "Donut chart of alert counts by severity"
            )
        )
    }
}

/// The donut center readout: the grand total + "Alerts" caption by default, or the
/// selected severity's count + percentage share when a legend row is selected.
struct AlertDonutCenter: View {
    let data: [AlertSeverityDatum]
    let selectedKey: String?

    private var selected: AlertSeverityDatum? {
        guard let selectedKey else { return nil }
        return data.first { $0.rawKey == selectedKey }
    }

    var body: some View {
        VStack(spacing: 2) {
            if let selected {
                Text(verbatim: AlertsFormat.count(selected.count))
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(AlertsPalette.color(for: selected.kind))
                Text(verbatim: percentText(for: selected))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            } else {
                Text(verbatim: AlertsFormat.count(AlertsProjection.total(data)))
                    .font(Font.TS.title)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                AlertsStrings.text("analytics.weeklyDigest.alertsSection", "Alerts")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .accessibilityHidden(true)
    }

    private func percentText(for datum: AlertSeverityDatum) -> String {
        let percent = Int((AlertsProjection.fraction(datum, of: data) * 100).rounded())
        return "\(percent)%"
    }
}

/// The tappable legend below the donut (web `<Legend>`): a swatch + severity label
/// + count per slice. Tapping a row toggles its selection, which highlights the
/// matching donut slice.
struct AlertDistributionLegend: View {
    let data: [AlertSeverityDatum]
    @Binding var selectedKey: String?

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ForEach(data) { datum in
                Button {
                    selectedKey = selectedKey == datum.rawKey ? nil : datum.rawKey
                } label: {
                    AlertLegendRow(datum: datum, isSelected: selectedKey == datum.rawKey)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(
                    Text(verbatim: AlertsAccessibility.rowLabel(datum, localize: AlertsStrings.string))
                )
                .accessibilityAddTraits(selectedKey == datum.rawKey ? [.isButton, .isSelected] : .isButton)
            }
        }
    }
}

/// One legend entry: a colored swatch, the severity label, and the count.
struct AlertLegendRow: View {
    let datum: AlertSeverityDatum
    let isSelected: Bool

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(AlertsPalette.color(for: datum.kind))
                .frame(width: 10, height: 10)
            Text(verbatim: datum.label(localize: AlertsStrings.string))
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            Text(verbatim: AlertsFormat.count(datum.count))
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(
            isSelected ? Color.TS.border.opacity(0.5) : Color.clear,
            in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
        )
        .contentShape(Rectangle())
    }
}
