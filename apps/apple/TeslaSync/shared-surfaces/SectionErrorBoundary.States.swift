//
//  SectionErrorBoundary.States.swift
//  TeslaSync — P4 shared surface · 0138 · SectionErrorBoundary (Apple)
//
//  The P4 leaf-contract chrome composed by `SectionErrorBoundary` when the guarded section is not
//  rendering its content and has not caught a failure: the loading skeleton (the section's shape as
//  shimmer while the host resolves its health) and the empty state (the guarded section has nothing
//  to show — the friendly native parity, never a blank box). All copy resolves through the P1/S10
//  facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (host resolving the section's health)

/// The initial-fetch chrome — a skeleton that keeps the section's shape (icon + two text lines)
/// while the host resolves whether the guarded section is healthy.
struct SectionBoundaryLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 18, cornerRadius: TSRadius.sm)
            VStack(alignment: .leading, spacing: TSSpacing.sm) {
                TSSkeleton(width: 150, height: 12)
                TSSkeleton(height: 12)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.lg)
        .background(
            Color.TS.surfaceGlass,
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: SectionErrorBoundaryStrings.string(
            "errors.section.loadingA11y", "Checking section health"
        )))
    }
}

// MARK: - Empty (the guarded section has nothing to show)

/// The empty render — a friendly card stating the section has no content yet (improved to never
/// collapse to a blank box, per the P4 leaf contract).
struct SectionBoundaryEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(SectionErrorBoundaryStrings.string(
                    "errors.section.empty", "Nothing to show"
                )),
                message: LocalizedStringKey(SectionErrorBoundaryStrings.string(
                    "errors.section.emptyMessage",
                    "This section has no content yet. New data will appear here as it arrives."
                )),
                systemImage: "tray"
            )
        }
        .frame(maxWidth: .infinity)
    }
}
