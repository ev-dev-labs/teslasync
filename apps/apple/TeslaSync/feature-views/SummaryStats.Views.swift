//
//  SummaryStats.Views.swift
//  TeslaSync — P4 feature view · 0175 · SummaryStats (Apple)
//
//  The presentational subviews composed by `SummaryStats`: the responsive
//  two/three/six-column grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6`), the
//  summary tile (web `<StatCard>` — label + muted icon over the bold value with an
//  optional unit suffix, inside a glass card), and the per-tile loading skeleton. All
//  consume the P1/S10 facade and the shared P1/S9 tokens / primitives (TSFadeIn,
//  TSStaggerItem, TSSkeleton) — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Tile value resolution (web `t()` at the display boundary)

extension DynamicsSummaryStatsCard {
    /// The localised label (web `t(labelKey, fallback)`).
    var resolvedLabel: String {
        SSDStrings.string(labelKey, labelFallback)
    }

    /// The localised unit suffix, if any (web literal symbol routed through i18n).
    var resolvedUnit: String? {
        guard let unit else { return nil }
        return SSDStrings.string(unit.key, unit.fallback)
    }

    /// The localised em-dash sentinel (web temperature `: '—'`).
    var resolvedEmpty: String {
        SSDStrings.string("dynamics.noData", DynamicsSummaryStatsFormat.emptyValue)
    }

    /// The combined VoiceOver content — the label plus the value and unit, the em-dash
    /// for the no-data temperature branch, or a loading descriptor while in flight.
    var accessibilityText: String {
        switch value {
        case .loading:
            DynamicsSummaryStatsAccessibility.cardLabel(
                label: resolvedLabel,
                value: SSDStrings.string("dynamics.loadingValueA11y", "Loading"),
                unit: nil
            )
        case .empty:
            DynamicsSummaryStatsAccessibility.cardLabel(label: resolvedLabel, value: resolvedEmpty, unit: nil)
        case let .value(text):
            DynamicsSummaryStatsAccessibility.cardLabel(label: resolvedLabel, value: text, unit: resolvedUnit)
        }
    }
}

// MARK: - Summary tile (web `<StatCard label value icon>`)

/// One resolved summary tile — the SwiftUI parity of a single web `<StatCard>`: the
/// label with a trailing muted SF Symbol (web `justify-between` label row), over the
/// bold value with an optional smaller unit suffix, inside the glass card surface (web
/// `Card`). The value line renders the skeleton while loading and the em-dash for the
/// no-data temperature branch.
struct SSDStatCard: View {
    let card: DynamicsSummaryStatsCard

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            labelRow
            valueArea
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: card.accessibilityText))
    }

    /// The label over a trailing muted icon (web `<StatCard>` label row: label
    /// `text-[var(--text-muted)]` + the lucide glyph in the same muted color).
    private var labelRow: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: card.resolvedLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: TSSpacing.xs)
            Image(systemName: card.symbol)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
        }
    }

    /// The value branch: the skeleton (loading), the em-dash (no-data temperature), or
    /// the bold value with its optional unit suffix.
    @ViewBuilder
    private var valueArea: some View {
        switch card.value {
        case .loading:
            TSSkeleton(width: 80, height: 28, cornerRadius: TSRadius.sm)
        case .empty:
            Text(verbatim: card.resolvedEmpty)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
        case let .value(text):
            valueRow(text)
        }
    }

    /// The bold value with the optional smaller unit suffix (web `text-2xl font-bold`
    /// value + `text-sm` unit span). The value uses the primary text role; the unit uses
    /// the muted role, baseline-aligned with the value.
    private func valueRow(_ text: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: text)
                .font(Font.TS.title)
                .fontWeight(.bold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit = card.resolvedUnit {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Responsive grid (web `grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4`)

/// A responsive grid that reflows the six tiles across two / three / six columns at the
/// web Tailwind breakpoints, measured with the iOS 18 / macOS 15 `onGeometryChange`
/// width seam so the column math (`DynamicsSummaryStatsLayout`) stays pure + testable.
/// Each cell is wrapped in `TSStaggerItem` so the tiles cascade in (web `StaggerItem`).
struct SSDResponsiveGrid: View {
    let cards: [DynamicsSummaryStatsCard]

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
            count: DynamicsSummaryStatsLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(Array(cards.enumerated()), id: \.element.id) { index, card in
                TSStaggerItem(index: index) {
                    SSDStatCard(card: card)
                }
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Grid (web six tiles wrapped in `<FadeIn delay={0.4}>`)

/// The six-tile responsive grid wrapped in the shared fade-in (web
/// `<FadeIn delay={0.4}>` over the `<StaggerContainer>`). Renders both the resolved and
/// the loading tiles — each tile decides for itself whether to show its value, the
/// em-dash, or the skeleton.
struct SSDStatsGrid: View {
    let cards: [DynamicsSummaryStatsCard]

    var body: some View {
        TSFadeIn(delay: 0.4) {
            SSDResponsiveGrid(cards: cards)
        }
    }
}
