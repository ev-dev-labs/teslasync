//
//  WidgetRankedList.States.swift
//  TeslaSync — P4 widget primitive · 0009 · WidgetRankedList (Apple)
//
//  The P4 leaf-contract chrome composed by ``WidgetRankedList`` when the surface is not showing its list:
//  the loading skeleton (ranked-row-shaped shimmer while the host's query resolves) and the error tile with
//  a retry affordance (web `QueryError` peer). The empty state is the shared `TSEmptyState` (web
//  `EmptyState`) and lives in the main surface file. All copy resolves through the P1/S10 facade; all colour
//  comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (items resolving)

/// The initial-fetch chrome — a small stack of skeleton rows that keep the ranked list's shape (a leading
/// rank chip, a label line, and a trailing value block) while the host resolves the data.
struct WidgetRankedListLoadingView: View {
    /// How many skeleton rows to show — matches a compact (3) vs full (5) list silhouette.
    let rowCount: Int

    init(rowCount: Int = 5) {
        self.rowCount = max(1, rowCount)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            ForEach(0 ..< rowCount, id: \.self) { _ in
                row
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: WidgetRankedListStrings.loadingAccessibility))
    }

    private var row: some View {
        HStack(spacing: TSSpacing.md) {
            TSSkeleton(width: 18, height: 12)
            TSSkeleton(height: 12)
            TSSkeleton(width: 48, height: 12)
        }
        .frame(minHeight: 44)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The data-failure state (web `QueryError` peer) — a compact error tile with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim; the title + retry resolve through the P1/S10
/// facade.
struct WidgetRankedListErrorView: View {
    let message: String
    let onRetry: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
    }

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: WidgetRankedListSymbols.error)
                .font(.system(size: 28))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Text(verbatim: WidgetRankedListStrings.errorTitle)
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
                Text(verbatim: WidgetRankedListStrings.retry)
            }
            .accessibilityLabel(Text(verbatim: WidgetRankedListStrings.retry))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.lg)
        .background(Color.TS.surfaceGlass, in: shape)
        .overlay(shape.strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}
