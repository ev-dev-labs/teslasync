//
//  ChartTooltip.States.swift
//  TeslaSync — P4 shared surface · 0070 · ChartTooltip (Apple)
//
//  The P4 leaf-contract chrome composed by `ChartTooltip` when the surface is not in its data
//  state: the loading skeleton (the readout panel as shimmer), the empty state (no point under
//  the cursor yet — the web component renders nothing, here a friendly card so the surface never
//  collapses to a blank box), and the error tile with a retry affordance. All copy resolves
//  through the P1/S10 facade; all color comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — a skeleton label line over two skeleton rows shaped like the
/// readout panel, so the surface keeps its shape while the feed resolves.
struct ChartTooltipLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(width: 96, height: 10)
            ForEach(0 ..< 2, id: \.self) { _ in
                HStack(spacing: TSSpacing.sm) {
                    TSSkeleton(width: 10, height: 10, cornerRadius: TSRadius.sm)
                    TSSkeleton(width: 72, height: 12)
                    Spacer(minLength: TSSpacing.md)
                    TSSkeleton(width: 56, height: 12)
                }
            }
        }
        .padding(.horizontal, TSSpacing.lg)
        .padding(.vertical, TSSpacing.md)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ChartTooltipStrings.string(
            "chartTooltip.loadingA11y", "Loading chart readout"
        )))
    }
}

// MARK: - Empty (web "render nothing" — inactive cursor / empty payload)

/// The empty render — a friendly empty-state card with a chart glyph, never a blank box. The
/// native parity of the web component returning `null` while the cursor is off the plot or the
/// payload is empty.
struct ChartTooltipEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(ChartTooltipStrings.string(
                    "chartTooltip.empty", "No point selected"
                )),
                message: LocalizedStringKey(ChartTooltipStrings.string(
                    "chartTooltip.emptyMessage",
                    "Hover or focus a point on the chart to see its values here."
                )),
                systemImage: "chart.xyaxis.line"
            )
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance.
/// The message is the runtime failure reason, rendered verbatim.
struct ChartTooltipErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: ChartTooltipStrings.string(
                    "chartTooltip.errorTitle", "Couldn't load the readout"
                ))
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                TSButton(variant: .secondary, size: .small, action: onRetry) {
                    Text(verbatim: ChartTooltipStrings.string("chartTooltip.retry", "Retry"))
                }
                .accessibilityLabel(Text(verbatim: ChartTooltipStrings.string("chartTooltip.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
