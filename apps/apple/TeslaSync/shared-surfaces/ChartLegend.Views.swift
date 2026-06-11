//
//  ChartLegend.Views.swift
//  TeslaSync — P4 shared surface · 0068 · ChartLegend (Apple)
//
//  The presentational subviews composed by `ChartLegend`, reproducing the web
//  `components/charts/ChartLegend.tsx` body: the per-series swatch + verbatim value label, the dimmed
//  + struck-through hidden entries, the tap-to-toggle interaction (web `onClick → resolved.toggle`),
//  and the passive (web `resolved == null`) static rendering — plus the P4 leaf chrome (loading
//  skeleton, friendly empty state, query-error retry, freshness chip). All copy arrives pre-localized
//  through the resolved model (P1/S10); all colour comes from the P1/S9 tokens (the per-series swatch
//  prefers the verbatim `entry.color` hex, falling back to the brand chart palette); the shared
//  `TSButton` / `TSSkeleton` / `TSFadeIn` primitives are reused. No networking, no Tailwind ports, no
//  raw chrome-colour literals.
//

import SwiftUI

// MARK: - Swatch colour (web `entry.color` → brand-palette fallback)

/// Resolves a series swatch colour — the verbatim `#rrggbb` (web `entry.color`) when present + valid,
/// otherwise the index-stable brand chart palette, ultimately the accent token. A dynamic,
/// data-driven colour applied at the SwiftUI boundary, decoded by the pure ``ChartLegendPalette``.
func chartLegendColor(hex: String?, paletteIndex: Int) -> Color {
    if let parts = ChartLegendPalette.components(forHex: hex) {
        return Color(.sRGB, red: parts.red, green: parts.green, blue: parts.blue, opacity: 1)
    }
    return TSChartPalette.color(at: paletteIndex)
}

// MARK: - Swatch (web legend series marker)

/// The small series colour marker (web legend icon). Decorative — the series name + visibility state
/// are spoken as the entry's accessibility label + value.
struct ChartLegendSwatch: View {
    let colorHex: String?
    let paletteIndex: Int

    var body: some View {
        Circle()
            .fill(chartLegendColor(hex: colorHex, paletteIndex: paletteIndex))
            .frame(width: 10, height: 10)
            .accessibilityHidden(true)
    }
}

// MARK: - Entry (web legend entry — swatch + value, dim + strike + toggle)

/// One legend entry — the swatch + the verbatim value label. When interactive (web toggle source
/// present) it is a button that toggles the series and renders dimmed + struck-through while hidden
/// (web `opacity 0.4` + `line-through`, `aria-pressed = isHidden`); when passive (web `resolved ==
/// null`) it is a static, non-dimmed label. VoiceOver reads the series name, its shown / hidden
/// state, and (interactive only) the toggle hint.
struct ChartLegendEntryView: View {
    let row: ChartLegendRow
    let onToggle: () -> Void

    @State private var hovering = false

    private var marker: some View {
        HStack(spacing: TSSpacing.xs) {
            ChartLegendSwatch(colorHex: row.colorHex, paletteIndex: row.paletteIndex)
            Text(verbatim: row.label)
                .font(Font.TS.caption)
                .foregroundStyle(row.isHidden ? Color.TS.textMuted : Color.TS.textSecondary)
                .strikethrough(row.isHidden)
                .lineLimit(1)
        }
        .opacity(row.isHidden ? 0.4 : 1)
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, TSSpacing.xs)
        .contentShape(Rectangle())
    }

    var body: some View {
        if row.isInteractive {
            Button(action: onToggle) {
                marker
                    .background(
                        hovering ? Color.TS.surfaceGlass : Color.clear,
                        in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    )
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
            .accessibilityValue(Text(verbatim: row.accessibilityValue))
            .accessibilityHint(Text(verbatim: row.accessibilityHint ?? ""))
            .accessibilityAddTraits(.isButton)
        } else {
            marker
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: row.accessibilityLabel))
        }
    }
}

// MARK: - Flow layout (wrapping legend row)

/// A lightweight wrapping layout — entries flow left-to-right and wrap to the next line, with each
/// line aligned per the web `align` prop. The Apple-idiomatic shape for a legend (wraps to fit the
/// container) versus a single clipped row.
struct ChartLegendFlowLayout: Layout {
    var horizontalSpacing: CGFloat = TSSpacing.md
    var verticalSpacing: CGFloat = TSSpacing.sm
    var alignment: ChartLegendAlignment = .center

    private struct Line {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func lines(maxWidth: CGFloat, sizes: [CGSize]) -> [Line] {
        var result: [Line] = []
        var current = Line()
        for (index, size) in sizes.enumerated() {
            let projected = current.indices.isEmpty
                ? size.width
                : current.width + horizontalSpacing + size.width
            if !current.indices.isEmpty, projected > maxWidth {
                result.append(current)
                current = Line(indices: [index], width: size.width, height: size.height)
            } else {
                current.width = projected
                current.height = max(current.height, size.height)
                current.indices.append(index)
            }
        }
        if !current.indices.isEmpty {
            result.append(current)
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout Void) -> CGSize {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let maxWidth = proposal.width ?? sizes.reduce(0) { $0 + $1.width }
        let computed = lines(maxWidth: maxWidth, sizes: sizes)
        let width = computed.map(\.width).max() ?? 0
        let height = computed.reduce(0) { $0 + $1.height }
            + CGFloat(max(0, computed.count - 1)) * verticalSpacing
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout Void) {
        let sizes = subviews.map { $0.sizeThatFits(.unspecified) }
        let computed = lines(maxWidth: bounds.width, sizes: sizes)
        var originY = bounds.minY
        for line in computed {
            let lineStart: CGFloat = switch alignment {
            case .leading:
                bounds.minX
            case .center:
                bounds.minX + max(0, (bounds.width - line.width) / 2)
            case .trailing:
                bounds.minX + max(0, bounds.width - line.width)
            }
            var originX = lineStart
            for index in line.indices {
                let size = sizes[index]
                subviews[index].place(
                    at: CGPoint(x: originX, y: originY + (line.height - size.height) / 2),
                    proposal: ProposedViewSize(size)
                )
                originX += size.width + horizontalSpacing
            }
            originY += line.height + verticalSpacing
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown above the entries when the snapshot is not live — a coloured dot + label
/// that re-requests the series on tap (stale / offline recovery). Warning tone for stale, muted tone
/// for offline.
struct ChartLegendFreshnessChip: View {
    let freshness: ChartLegendFreshness
    let onRefresh: () -> Void

    private var tone: Color {
        freshness.isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle()
                    .fill(tone)
                    .frame(width: 6, height: 6)
                Text(verbatim: freshness.label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(Color.TS.surface, in: Capsule())
            .overlay(Capsule().strokeBorder(tone.opacity(0.3), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: freshness.accessibilityLabel))
    }
}

// MARK: - Populated (web rendered legend)

/// The populated legend — the wrapping entries decorated with the P4 freshness chip. The native
/// parity of the web rendered `<Legend>`, aligned per `align`.
struct ChartLegendPopulatedView: View {
    let legendAccessibilityLabel: String
    let alignment: ChartLegendAlignment
    let freshness: ChartLegendFreshness?
    let rows: [ChartLegendRow]
    let onRefresh: () -> Void
    let onToggle: (String) -> Void

    var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                if let freshness {
                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        ChartLegendFreshnessChip(freshness: freshness, onRefresh: onRefresh)
                    }
                }
                ChartLegendFlowLayout(alignment: alignment) {
                    ForEach(rows) { row in
                        ChartLegendEntryView(row: row) { onToggle(row.id) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: legendAccessibilityLabel))
    }
}

// MARK: - Loading (parent series fetch → skeleton)

/// The skeleton chrome shown while the series resolve — a row of swatch + label shimmers that mirror
/// the populated entries. Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct ChartLegendLoadingView: View {
    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(0 ..< 4, id: \.self) { _ in
                HStack(spacing: TSSpacing.xs) {
                    TSSkeleton(width: 10, height: 10, cornerRadius: TSRadius.pill)
                    TSSkeleton(width: 48, height: 12)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ChartLegendStrings.string(
            "chartLegend.loadingA11y",
            "Loading chart legend"
        )))
    }
}

// MARK: - Empty (P4 "never a blank box")

/// The friendly empty state shown when the legend resolves with no series under the `.emptyState`
/// policy — the P4 stand-in for the Recharts empty-payload collapse, so the standalone surface is
/// never blank.
struct ChartLegendEmptyView: View {
    let content: ChartLegendEmpty

    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: content.title)
            } icon: {
                Image(systemName: "chart.xyaxis.line")
            }
        } description: {
            Text(verbatim: content.message)
        }
    }
}

// MARK: - Error (web `QueryError` peer)

/// The query-failure state shown when the series fetch fails — an inline error with a retry
/// affordance (the native peer of the web `QueryError`). Never a blank box (P4).
struct ChartLegendErrorView: View {
    let content: ChartLegendErrorContent
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: content.message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: ChartLegendStrings.string("chartLegend.error.retry", "Retry"))
            }
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: content.accessibilityLabel))
    }
}
