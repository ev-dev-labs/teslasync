//
//  ErrorDisplay.States.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  The P4 leaf-contract chrome composed by `ErrorDisplay` when the surface is not in its `.failure`
//  state: the loading skeleton (the failure tile's shape as shimmer, shown while the parent is still
//  resolving the operation) and the empty state (no error — web `ErrorDisplay` returns `null`; the P4
//  leaf contract renders a calm "all clear" card instead of a blank box). The loading skeleton honours
//  the `compact` density so an inline mutation error and a full-bleed banner keep their proportions
//  while loading. All copy resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (parent resolving the operation)

/// The initial-fetch chrome — a skeleton failure tile that keeps the surface's shape (icon box + two
/// text lines) while the parent resolves whether the operation failed. Density-aware so it matches the
/// `compact` banner's tighter padding when inline.
struct ErrorDisplayLoadingView: View {
    let density: ErrorDisplayDensity

    init(density: ErrorDisplayDensity = .comfortable) {
        self.density = density
    }

    private var iconSide: CGFloat {
        density == .compact ? 26 : 32
    }

    var body: some View {
        HStack(alignment: .top, spacing: density.rowSpacing) {
            TSSkeleton(width: iconSide, height: iconSide, cornerRadius: TSRadius.md)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 150, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(density.containerPadding)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: ErrorDisplayStrings.string(
            "error.loadingA11y", "Checking the request"
        )))
    }
}

// MARK: - Empty (no error)

/// The empty render — a friendly card stating there is nothing wrong, the native parity of the web
/// `ErrorDisplay` returning `null` when there is no error (improved to never collapse to a blank box,
/// per the P4 leaf contract).
struct ErrorDisplayEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(ErrorDisplayStrings.string(
                    "error.empty", "All clear"
                )),
                message: LocalizedStringKey(ErrorDisplayStrings.string(
                    "error.emptyMessage",
                    "No problems to report. Any errors with this action will appear here."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}
