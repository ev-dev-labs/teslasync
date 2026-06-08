//
//  LifetimeSummary.Tiles.swift
//  TeslaSync — P4 feature view · 0114 · LifetimeSummary (Apple)
//
//  The leaf tiles + their semantic mapping for the Lifetime Summary section: the
//  metric kind → i18n-label + unit-wrapper extensions (web `t(key, default)` labels +
//  the `kWh` / `min` / free-sessions value composition), the runtime stale / offline
//  `LSChip`, and the presentational `LSMetricTile` (web `LifetimeMetric`).
//

import SwiftUI

// MARK: - Metric kind → label (web `t(key, default)` keys)

extension LifetimeMetricKind {
    var labelKey: String {
        switch self {
        case .totalSpent: "costAnalysis.lifetime.totalSpent"
        case .totalEnergy: "costAnalysis.lifetime.totalEnergy"
        case .totalSessions: "costAnalysis.lifetime.totalSessions"
        case .avgSessionCost: "costAnalysis.lifetime.avgSessionCost"
        case .avgEnergy: "costAnalysis.lifetime.avgEnergy"
        case .avgDuration: "costAnalysis.lifetime.avgDuration"
        case .freeSessions: "costAnalysis.lifetime.freeSessions"
        }
    }

    var labelFallback: String {
        switch self {
        case .totalSpent: "Total Spent"
        case .totalEnergy: "Total Energy"
        case .totalSessions: "Total Sessions"
        case .avgSessionCost: "Avg Session Cost"
        case .avgEnergy: "Avg Energy / Session"
        case .avgDuration: "Avg Duration"
        case .freeSessions: "Free Sessions"
        }
    }

    /// Composes the final display value from the already number-formatted projection,
    /// wrapping the figure with the `kWh` / `min` unit (and the free-sessions
    /// `"{{count}} ({{energy}})"` shape) through the i18n facade. The web hardcodes
    /// these unit literals; the native states contract resolves them as strings.
    func displayValue(_ projection: LifetimeMetricProjection) -> String {
        switch self {
        case .totalSpent, .totalSessions, .avgSessionCost:
            projection.primaryText
        case .totalEnergy, .avgEnergy:
            LSStrings.format(
                "costAnalysis.lifetime.energyUnit", "{{value}} kWh", ["value": projection.primaryText]
            )
        case .avgDuration:
            LSStrings.format(
                "costAnalysis.lifetime.durationUnit", "{{value}} min", ["value": projection.primaryText]
            )
        case .freeSessions:
            LSStrings.format(
                "costAnalysis.lifetime.freeSessionsValue",
                "{{count}} ({{energy}})",
                [
                    "count": projection.primaryText,
                    "energy": LSStrings.format(
                        "costAnalysis.lifetime.energyUnit", "{{value}} kWh", ["value": projection.secondaryText ?? ""]
                    )
                ]
            )
        }
    }
}

// MARK: - Chip (stale / offline overlays)

/// A small tinted capsule mirroring the shared `TSBadge` styling, taking the runtime
/// string the `LocalizedStringKey`-only `TSBadge` cannot express. Backs the stale /
/// offline header chips (the P4 freshness + connectivity overlays).
struct LSChip: View {
    let text: String
    let systemImage: String
    var tone: TSTone = .neutral

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: systemImage).font(.caption2)
            Text(verbatim: text).font(Font.TS.caption).fontWeight(.medium)
        }
        .foregroundStyle(tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.color.opacity(0.15), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: text))
    }
}

// MARK: - Metric tile (web `LifetimeMetric`)

/// One lifetime-metric tile: a muted truncating label above the emphasised value, in a
/// glass tile — the native port of the web `LifetimeMetric` (`bg-[var(--surface-2)]`
/// card, `text-[10px]` muted label, `text-sm font-semibold` value). The kind drives the
/// i18n label and the unit wrapper.
struct LSMetricTile: View {
    let projection: LifetimeMetricProjection

    private var label: String {
        LSStrings.string(projection.kind.labelKey, projection.kind.labelFallback)
    }

    private var value: String {
        projection.kind.displayValue(projection)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(verbatim: value)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: LifetimeSummaryAccessibility.tileSummary(label: label, value: value)))
    }
}
