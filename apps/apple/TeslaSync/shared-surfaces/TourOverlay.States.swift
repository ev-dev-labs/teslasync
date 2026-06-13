//
//  TourOverlay.States.swift
//  TeslaSync — P4 shared surface · 0145 · TourOverlay (Apple)
//
//  The P4 leaf-contract chrome composed by `TourOverlay` when the surface is not in its data (spotlight)
//  state: the loading skeleton (the tooltip card shape as shimmer while the tour resolves), the empty
//  state (the tour is active but its target element cannot be anchored — the friendly native
//  improvement over the web `return null`, never a blank box), and the error tile with a retry
//  affordance (web `QueryError` peer). All copy resolves through the P1/S10 facade; all colour comes
//  from the P1/S9 tokens. Each is presented over the dimmed scrim by the parent surface.
//

import SwiftUI

// MARK: - Loading (tour resolving / initial measure)

/// The initial-resolve chrome — a skeleton tooltip that keeps the surface's shape (counter + title +
/// description + an action row + progress dots) while the tour state and the target geometry resolve.
struct TourOverlayLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TSSkeleton(width: 48, height: 10)
            TSSkeleton(width: 180, height: 14)
            TSSkeleton(height: 12)
            TSSkeleton(width: 220, height: 12)
            HStack {
                TSSkeleton(width: 64, height: 12)
                Spacer(minLength: 0)
                TSSkeleton(width: 72, height: 28, cornerRadius: TSRadius.md)
            }
            HStack(spacing: TSSpacing.xs) {
                ForEach(0 ..< 4, id: \.self) { _ in
                    TSSkeleton(width: 12, height: 4, cornerRadius: TSRadius.sm)
                }
            }
            .frame(maxWidth: .infinity)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 360, alignment: .leading)
        .background(
            Color.TS.surface,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TourOverlayStrings.string(
            "tour.loadingA11y", "Loading tour"
        )))
    }
}

// MARK: - Empty (tour active, no anchor)

/// The empty render — a friendly card stating the highlighted area is not available, the native
/// improvement over the web `return null` when `targetRect` is missing (per the P4 leaf contract, the
/// surface never collapses to a blank box). Offers a Skip affordance so the user is never trapped.
struct TourOverlayEmptyView: View {
    let onSkip: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.md) {
                TSEmptyState(
                    title: LocalizedStringKey(TourOverlayStrings.string(
                        "tour.empty", "Nothing to highlight"
                    )),
                    message: LocalizedStringKey(TourOverlayStrings.string(
                        "tour.emptyMessage",
                        "This step's area isn't on screen right now. You can skip the tour and try again later."
                    )),
                    systemImage: "scope"
                )
                TSButton(variant: .secondary, size: .small, action: onSkip) {
                    Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour"))
                }
                .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour")))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 360)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The failure state (web `QueryError` peer) — a compact error card with a retry affordance plus a Skip
/// escape hatch. The message is the runtime failure reason, rendered verbatim.
struct TourOverlayErrorView: View {
    let message: String
    let onRetry: () -> Void
    let onSkip: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: TourOverlayStrings.string("tour.errorTitle", "Couldn't load the tour"))
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
                HStack(spacing: TSSpacing.sm) {
                    TSButton(variant: .ghost, size: .small, action: onSkip) {
                        Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour"))
                    }
                    .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.skip", "Skip tour")))
                    TSButton(variant: .secondary, size: .small, action: onRetry) {
                        Text(verbatim: TourOverlayStrings.string("tour.retry", "Retry"))
                    }
                    .accessibilityLabel(Text(verbatim: TourOverlayStrings.string("tour.retry", "Retry")))
                }
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: 360)
        .accessibilityElement(children: .combine)
    }
}
