//
//  SummaryStatsGrid.Views.swift
//  TeslaSync — P4 feature view · 0093 · SummaryStatsGrid (Apple)
//
//  The presentational subviews composed by `SummaryStatsGrid`: the responsive
//  two/three/six-column grid (web `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6`), the
//  summary card (web `<SummaryCard>` — uppercase label + bold value + optional unit
//  suffix inside a glass panel), and the per-card loading skeleton. All consume the
//  P1/S10 facade and the shared P1/S9 tokens / primitives (TSGlassPanel, TSSkeleton,
//  TSFadeIn) — no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Card value resolution (web `t()` at the display boundary)

extension SummaryStatsGridCard {
    /// The localised label (web `t(labelKey, fallback)`).
    var resolvedLabel: String {
        SSGStrings.string(labelKey, labelFallback)
    }

    /// The localised unit suffix, if any (web `unit` literal routed through i18n).
    var resolvedUnit: String? {
        guard let unit else { return nil }
        return SSGStrings.string(unit.key, unit.fallback)
    }

    /// The combined VoiceOver content — the label plus the value and unit, or a
    /// loading descriptor while the value is in flight (web `loading` branch).
    var accessibilityText: String {
        if let value {
            return SummaryStatsGridAccessibility.cardLabel(label: resolvedLabel, value: value, unit: resolvedUnit)
        }
        return SummaryStatsGridAccessibility.cardLabel(
            label: resolvedLabel,
            value: SSGStrings.string("charging.curve.loadingValueA11y", "Loading"),
            unit: nil
        )
    }
}

// MARK: - Summary card (web `<SummaryCard label value unit loading>`)

/// One resolved summary card — the SwiftUI parity of a single web `<SummaryCard>`:
/// the uppercase label over the bold value (with an optional small unit suffix),
/// inside the glass panel surface (web `GlassPanel p-4`). When the value is `nil`,
/// the value line is replaced by a redacted block (web `loading` skeleton).
struct SSGSummaryCard: View {
    let card: SummaryStatsGridCard

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                Text(verbatim: card.resolvedLabel)
                    .font(Font.TS.label)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if let value = card.value {
                    valueRow(value)
                } else {
                    TSSkeleton(width: 80, height: 28, cornerRadius: TSRadius.sm)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: card.accessibilityText))
    }

    /// The bold value with the optional small unit suffix (web `text-lg font-semibold`
    /// value + `text-xs` unit span). The value uses the primary text role; the unit
    /// uses the secondary role, baseline-aligned with the value.
    private func valueRow(_ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
            Text(verbatim: value)
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            if let unit = card.resolvedUnit {
                Text(verbatim: unit)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
            }
        }
    }
}

// MARK: - Responsive grid (web `grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4`)

/// A responsive grid that reflows its cells across two / three / six columns at the
/// web Tailwind breakpoints, measured with the iOS 18 / macOS 15 `onGeometryChange`
/// width seam so the column math (`SummaryStatsGridLayout`) stays pure + testable.
struct SSGResponsiveGrid<Item: Identifiable, Cell: View>: View {
    let items: [Item]
    @ViewBuilder let cell: (Item) -> Cell

    @State private var width: CGFloat = 0

    private var columns: [GridItem] {
        Array(
            repeating: GridItem(.flexible(), spacing: TSSpacing.lg, alignment: .top),
            count: SummaryStatsGridLayout.columnCount(forWidth: width)
        )
    }

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.lg) {
            ForEach(items) { item in
                cell(item)
            }
        }
        .onGeometryChange(for: CGFloat.self) { proxy in
            proxy.size.width
        } action: { newWidth in
            width = newWidth
        }
    }
}

// MARK: - Grid (web grid of six cards wrapped in `<FadeIn delay={0.05}>`)

/// The six-card responsive grid wrapped in the shared fade-in (web
/// `<FadeIn delay={0.05}>`). Renders both the resolved and the loading cards — each
/// card decides for itself whether to show its value or the skeleton.
struct SSGStatsGrid: View {
    let cards: [SummaryStatsGridCard]

    var body: some View {
        TSFadeIn(delay: 0.05) {
            SSGResponsiveGrid(items: cards) { card in
                SSGSummaryCard(card: card)
            }
        }
    }
}
