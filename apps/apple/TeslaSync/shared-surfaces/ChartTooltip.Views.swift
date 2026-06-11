//
//  ChartTooltip.Views.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The presentational subviews composed by `ChartTooltip`: one series row (the web colored dot +
//  name + formatted value + unit), the floating readout panel (the web label header over the row
//  list), the data body, and the freshness chip (P4 connectivity axis). All consume the P1/S10
//  facade and the shared P1/S9 tokens — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Series row (web payload row: dot + name + value + unit)

/// One readout row — the index-stable palette dot (the native parity of the web `color || fill`
/// swatch with its `0 0 6px …60` glow), the series name, and the formatted value with an optional
/// dimmed unit suffix (web `opacity-60`). The whole row is one VoiceOver element reading
/// "name: value unit".
struct ChartTooltipSeriesRow: View {
    let series: ChartTooltipSeries

    private var swatch: Color {
        TSChartPalette.color(at: series.colorIndex)
    }

    private var valueText: String {
        ChartTooltipFormat.valueString(series.value, locale: .current)
    }

    private var accessibilityLabelText: String {
        ChartTooltipAccessibility.rowLabel(name: series.name, value: valueText, unit: series.unit)
    }

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Circle()
                .fill(swatch)
                .frame(width: 10, height: 10)
                .shadow(color: swatch.opacity(0.38), radius: 3)
                .accessibilityHidden(true)
            Text(verbatim: "\(series.name):")
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.md)
            HStack(spacing: 2) {
                Text(verbatim: valueText)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit = series.unit, !unit.isEmpty {
                    Text(verbatim: unit)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary.opacity(0.6))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}

// MARK: - Readout panel (web floating tooltip body)

/// The floating value readout — the formatted label header (hidden when the label is empty, the
/// web `labelFormatter(label)` of an absent label) over one `ChartTooltipSeriesRow` per series,
/// on a blurred elevated surface with a hairline border and a soft drop shadow (the native parity
/// of the web `backdrop-blur-xl` / `border-subtle` / `shadow-xl` panel). The panel is one
/// VoiceOver element labelled as a tooltip, mirroring the web `role="tooltip" aria-live="polite"`.
struct ChartTooltipPanel: View {
    let label: ChartTooltipLabel
    let series: [ChartTooltipSeries]

    private var labelText: String {
        ChartTooltipFormat.formatLabel(label, locale: .current, timeZone: .current)
    }

    private var accessibilityLabelText: String {
        let rows = series.map { entry in
            ChartTooltipAccessibility.rowLabel(
                name: entry.name,
                value: ChartTooltipFormat.valueString(entry.value, locale: .current),
                unit: entry.unit
            )
        }
        return ChartTooltipAccessibility.summary(label: labelText, rows: rows)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            if !labelText.isEmpty {
                Text(verbatim: labelText)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textSecondary)
                    .padding(.bottom, 2)
            }
            ForEach(series) { entry in
                ChartTooltipSeriesRow(series: entry)
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.3), radius: 16, x: 0, y: 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
        .accessibilityAddTraits(.isStaticText)
    }
}

// MARK: - Data body (the readout panel)

/// The data render — the readout panel wrapped in the shared fade-in for entrance polish, the
/// native parity of the web tooltip appearing as the cursor lands on a point.
struct ChartTooltipDataView: View {
    let resolved: ChartTooltipResolved

    var body: some View {
        TSFadeIn {
            ChartTooltipPanel(label: resolved.label, series: resolved.series)
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the body when the feed is not live — a colored dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// snapshot, with an explicit label.
struct ChartTooltipFreshnessChip: View {
    let connection: ChartTooltipConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ChartTooltipStrings.string("chartTooltip.live", "Live")
        case .stale: ChartTooltipStrings.string("chartTooltip.stale", "Stale")
        case .offline: ChartTooltipStrings.string("chartTooltip.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            ChartTooltipStrings.string("chartTooltip.staleA11y", "Stale — tap to refresh")
        case .offline:
            ChartTooltipStrings.string("chartTooltip.offlineA11y", "Offline — showing the last readout")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
