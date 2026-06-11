//
//  KpiOverviewCard.States.swift
//  TeslaSync — P4 shared surface · 0093 · KpiOverviewCard (Apple)
//
//  The P4 leaf-contract chrome composed by `KpiOverviewCard` when the body region is not rendering the
//  KPI grid: the loading skeleton (a grid of shimmer tiles shaped like the rendered MetricCards while
//  the page computes its numbers), the friendly empty state (web `EmptyState` peer, shown when the
//  data resolved with no tiles), and the error tile with a retry affordance (web `QueryError` peer).
//  The header is rendered by `KpiOverviewCard` above all of these, so the shell keeps its frame. All
//  copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (numbers resolving)

/// The initial-fetch chrome — an adaptive grid of shimmer tiles matching the KPI grid's footprint, so
/// the card keeps its shape while the page computes its numbers. The shimmer honours Reduce Motion via
/// the shared `TSSkeleton`.
struct KpiOverviewLoadingView: View {
    /// The number of skeleton tiles to stage — a typical overview row.
    var tileCount = 6

    private let columns = [GridItem(.adaptive(minimum: 104), spacing: TSSpacing.md, alignment: .topLeading)]

    var body: some View {
        LazyVGrid(columns: columns, alignment: .leading, spacing: TSSpacing.md) {
            ForEach(0 ..< tileCount, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 56, height: 10)
                    TSSkeleton(width: 84, height: 22)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.md)
                .background(
                    Color.TS.surfaceGlass,
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
            }
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: KpiOverviewStrings.string(
            "kpiOverview.loadingA11y", "Loading metrics"
        )))
    }
}

// MARK: - Empty (web `EmptyState` peer)

/// The friendly empty state — the data resolved with no KPI tiles, so rather than a blank grid the
/// card shows a localized "no metrics for this range" message (web `EmptyState` parity).
struct KpiOverviewEmptyView: View {
    var body: some View {
        TSEmptyState(
            title: LocalizedStringKey(KpiOverviewStrings.string(
                "kpiOverview.empty.title", "No metrics yet"
            )),
            message: LocalizedStringKey(KpiOverviewStrings.string(
                "kpiOverview.empty.message", "There are no metrics for this period."
            )),
            systemImage: "chart.bar.xaxis"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityIdentifier("kpiOverview-empty")
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error tile with a retry affordance. The
/// message is the runtime failure reason, surfaced through the shared error display.
struct KpiOverviewErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSQueryError(
            message: message.isEmpty ? nil : LocalizedStringKey(message),
            onRetry: onRetry
        )
        .accessibilityIdentifier("kpiOverview-error")
    }
}
