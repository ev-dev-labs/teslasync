//
//  WidgetStatGrid.Views.swift
//  TeslaSync — P4 widget primitive · 0010 · WidgetStatGrid (Apple)
//
//  The presentational pieces of the stat grid — the native peers of the web elements: the stat cell (the
//  native peer of the web `<StatCard>` the grid maps over — a label + optional icon, the bold value with
//  its optional unit affix, and an optional direction-aware trend chip), the responsive grid container
//  (the native peer of the web `<div className="grid …">`), and the friendly empty leaf (the native "never
//  a blank box" peer of the web `<EmptyState message="No stats available" />`). All chrome is token-driven
//  (P1/S9); no raw hex, no Tailwind ports. Each cell folds its label / value / unit / trend into a single
//  VoiceOver element; decorative icons and trend arrows are hidden from VoiceOver.
//

import SwiftUI

// MARK: - Axis → design tokens

extension StatTrendDirection {
    /// The trend chip tint — the theme-aware projection of the web `trend.positive ? green : flat ? muted :
    /// red`. Reads from the design system so it recolors across light / dark / high-contrast.
    var tint: Color {
        switch self {
        case .up: Color.TS.statusSuccess
        case .down: Color.TS.statusDanger
        case .flat: Color.TS.textMuted
        }
    }

    /// The SF Symbol for the arrow — the native peer of the web glyphs `↑` / `↓` / `—`. Decorative, so
    /// hidden from VoiceOver (the direction is spoken as a word instead).
    var systemName: String {
        switch self {
        case .up: "arrow.up"
        case .down: "arrow.down"
        case .flat: "minus"
        }
    }
}

extension StatValueTone {
    /// The value text color — the theme-aware projection of the web `valueColor?` className. Defaults to
    /// the primary text token (the web value inherits the card's default text color when no class is set).
    var color: Color {
        switch self {
        case .primary: Color.TS.textPrimary
        case .secondary: Color.TS.textSecondary
        case .muted: Color.TS.textMuted
        case .success: Color.TS.statusSuccess
        case .danger: Color.TS.statusDanger
        case .warning: Color.TS.statusWarning
        case .accent: Color.TS.accent
        }
    }
}

// MARK: - StatGridCell (web `<StatCard>`)

/// A single stat cell — the native peer of the web `<StatCard>`: a glass card holding the top row (the
/// muted, truncated label and an optional trailing icon), the bold value with its optional muted unit
/// affix, and an optional direction-aware trend chip (web `↑/↓/—` glyph + value, colored by direction). A
/// pure function of its ``StatGridItem``, so it composes in every branch for snapshot / preview / test.
/// The whole cell is one VoiceOver element reading "{label}, {value}{unit}[, {trend}]".
struct StatGridCell: View {
    let item: StatGridItem

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            valueLine
            if let trend = item.trend {
                trendChip(trend)
            }
        }
        .padding(TSSpacing.lg)
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
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    /// The top row — the muted, truncated label with an optional trailing icon (web `flex items-center
    /// justify-between`). The label is hidden from VoiceOver because it is spoken as part of the combined
    /// cell element; the icon is decorative and always hidden.
    private var header: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Text(verbatim: item.label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
                .accessibilityHidden(true)
            Spacer(minLength: TSSpacing.sm)
            if let icon = item.iconSystemName, !icon.isEmpty {
                Image(systemName: icon)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
        }
    }

    /// The bold headline value with its optional unit affix (web `text-2xl font-bold` + the `text-sm
    /// text-muted` unit span, baseline-aligned). The value color follows the cell's ``StatValueTone``.
    private var valueLine: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: item.value)
                .font(Font.TS.title)
                .foregroundStyle(item.valueTone.color)
            if let unit = item.unit, !unit.isEmpty {
                Text(verbatim: unit)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .lineLimit(1)
        .truncationMode(.tail)
    }

    /// The trend chip — the decorative arrow plus the formatted magnitude, colored by direction (web
    /// `flex items-center gap-1 text-xs` with the green / muted / red class). The arrow is hidden from
    /// VoiceOver; the direction is spoken as a word in the combined cell label.
    private func trendChip(_ trend: StatTrend) -> some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: trend.direction.systemName)
                .accessibilityHidden(true)
            Text(verbatim: trend.value)
        }
        .font(Font.TS.caption)
        .foregroundStyle(trend.direction.tint)
    }

    /// The combined VoiceOver reading — "{label}, {value}{unit}" plus the spoken trend when present.
    private var accessibilityLabel: String {
        let valueWithUnit = WidgetStatGridStrings.valueWithUnit(value: item.value, unit: item.unit)
        let base = WidgetStatGridStrings.cellAccessibilityLabel(label: item.label, value: valueWithUnit)
        guard let trend = item.trend else { return base }
        let reading = WidgetStatGridStrings.trendAccessibilityLabel(
            direction: trend.direction,
            value: trend.value
        )
        return WidgetStatGridStrings.cellWithTrend(base: base, trend: reading)
    }
}

// MARK: - StatGridLayoutView (web `<div className="grid …">`)

/// The responsive grid container — the native peer of the web `<div className={grid +
/// containerColsClass[cols]}>`. Lays the cells out in the resolved column count with the condensed or
/// standard gap (web `compact ? gap-2 : gap-3`). Flexible tracks let the cards share the available width
/// and wrap gracefully on a narrow host, the native analogue of the web container-query collapse.
struct StatGridLayoutView: View {
    let layout: StatGridLayout

    /// The inter-item gap — web `compact ? gap-2 (8) : gap-3 (12)`.
    private var gap: CGFloat {
        layout.isCompact ? TSSpacing.sm : TSSpacing.md
    }

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: gap, alignment: .top),
            count: max(1, layout.columns)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: gap) {
            ForEach(layout.cells) { cell in
                StatGridCell(item: cell.item)
            }
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - WidgetStatGridEmptyState (web `<EmptyState message="No stats available" />`)

/// The friendly empty leaf — the native "never a blank box" peer of the web `<EmptyState message="No stats
/// available" />`. A centered icon over the headline (the verbatim web copy) and a supporting hint,
/// combined into a single VoiceOver element. Token-driven (P1/S9); copy via the P1/S10 facade.
struct WidgetStatGridEmptyState: View {
    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "square.grid.2x2")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: WidgetStatGridStrings.emptyMessage)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            Text(verbatim: WidgetStatGridStrings.emptyHint)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(WidgetStatGridStrings.emptyMessage). \(WidgetStatGridStrings.emptyHint)")
        )
    }
}
