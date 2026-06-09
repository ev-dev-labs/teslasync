//
//  AnalyticsSummaryWidget.Tile.swift
//  TeslaSync — P4 dashboard widget · 0002 · AnalyticsSummaryWidget (Apple)
//
//  The leaf view the AnalyticsSummaryWidget surface composes: the per-stat cell (web `StatCard`
//  inside `WidgetStatGrid`) plus the accent → `Color.TS` token mapping. Kept in its own file so
//  the surface file stays within the house file-length limit.
//

import SwiftUI

// MARK: - Accent → token mapping (web `text-{color}-400` / `SPARKLINE_COLORS`)

extension AnalyticsSummaryAccent {
    /// The `Color.TS` token for this accent, matching the web stat-icon classes
    /// (`cyan-400` → accent, `emerald-400` → success, `amber-400` → warning,
    /// `purple-400` → the purple chart series).
    var color: Color {
        switch self {
        case .cyan: Color.TS.accent
        case .emerald: Color.TS.statusSuccess
        case .amber: Color.TS.statusWarning
        case .purple: Color.TS.chartSeriesPower
        }
    }
}

// MARK: - Stat tile (web `StatCard` within `WidgetStatGrid`)

/// One compact stat tile: a muted label with a tinted icon over a large value with an optional
/// unit suffix. The native parity of the web `StatCard` used inside `WidgetStatGrid` — the icon
/// carries the stat's semantic accent (cyan / emerald / amber / purple), matching the source.
struct AnalyticsSummaryStatTile: View {
    let item: AnalyticsSummaryStatItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: item.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
                Image(systemName: item.systemImage)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(item.accent.color)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(verbatim: item.value)
                    .font(Font.TS.panel)
                    .fontWeight(.bold)
                    .monospacedDigit()
                    .foregroundStyle(Color.TS.textPrimary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                if let unit = item.unit {
                    Text(verbatim: unit)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .padding(TSSpacing.sm)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: tileAccessibilityLabel))
    }

    private var tileAccessibilityLabel: String {
        if let unit = item.unit {
            return "\(item.label) \(item.value) \(unit)"
        }
        return "\(item.label) \(item.value)"
    }
}
