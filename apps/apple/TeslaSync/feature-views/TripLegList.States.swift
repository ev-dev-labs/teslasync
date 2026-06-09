//
//  TripLegList.States.swift
//  TeslaSync — P4 feature view · 0177 · TripLegList (Apple)
//
//  The P4 leaf-contract chrome composed by `TripLegList` when the surface is not in its
//  data state: the loading skeleton, the empty state, and the error state with a retry
//  affordance. Each keeps the titled glass panel (the shared `TripLegListPanel`) so the
//  "Route Breakdown" heading is always present and the surface never collapses to a
//  blank box — matching the web source, which renders the `h3` above the EmptyState as
//  well as the list. All copy resolves through the P1/S10 facade; all colour comes from
//  the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome — the titled panel over a couple of skeleton leg cards, so
/// the surface keeps its shape while the parent trip-plan query resolves.
struct TripLegListLoadingView: View {
    var body: some View {
        TripLegListPanel {
            VStack(spacing: TSSpacing.md) {
                TripLegSkeletonCard()
                TripLegSkeletonCard()
            }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: TripLegListStrings.string(
                "tripPlanner.legs.loadingA11y", "Loading route breakdown"
            )))
        }
    }
}

/// A single skeleton leg card — a header line over a two-row metric skeleton, matching
/// the resolved card's shape.
private struct TripLegSkeletonCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                TSSkeleton(width: 24, height: 24, cornerRadius: 12)
                TSSkeleton(width: 180, height: 12)
            }
            LazyVGrid(
                columns: [GridItem(.adaptive(minimum: 116), spacing: TSSpacing.md, alignment: .leading)],
                alignment: .leading,
                spacing: TSSpacing.sm
            ) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    VStack(alignment: .leading, spacing: TSSpacing.xs) {
                        TSSkeleton(width: 48, height: 9)
                        TSSkeleton(width: 64, height: 12)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            Color.TS.textPrimary.opacity(0.02),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityHidden(true)
    }
}

// MARK: - Empty (web `legItems.length === 0`)

/// The empty render (resolved with no legs) — the titled panel over the shared
/// `TSEmptyState` (web `<EmptyState message="Plan a trip…" />`), never a blank box.
struct TripLegListEmptyView: View {
    var body: some View {
        TripLegListPanel {
            TSEmptyState(
                title: TripLegListStrings.label(
                    "tripPlanner.legs.empty", "Plan a trip to see the route breakdown"
                ),
                systemImage: "map"
            )
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state (web `QueryError` peer) — the titled panel over a compact
/// error block with a retry affordance.
struct TripLegListErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TripLegListPanel {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                TripLegListStrings
                    .text("tripPlanner.legs.errorTitle", "Couldn't load the route breakdown")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                    .multilineTextAlignment(.center)
                if !message.isEmpty {
                    Text(verbatim: message)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                TSButton(
                    TripLegListStrings.label("tripPlanner.legs.retry", "Retry"),
                    variant: .secondary,
                    size: .small,
                    action: onRetry
                )
                .accessibilityLabel(Text(TripLegListStrings.label("tripPlanner.legs.retry", "Retry")))
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, TSSpacing.sm)
        }
        .accessibilityElement(children: .contain)
    }
}
