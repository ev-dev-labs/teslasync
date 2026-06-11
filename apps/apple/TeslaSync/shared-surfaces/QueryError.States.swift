//
//  QueryError.States.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  The P4 leaf-contract chrome composed by `QueryError` when the surface is not in its `.failure`
//  state: the loading skeleton (the failure tile's shape as shimmer, shown while the parent is still
//  resolving the query) and the empty state (the query succeeded — web `QueryError` returns `null`;
//  the P4 leaf contract renders a calm "all clear" card instead of a blank box). All copy resolves
//  through the P1/S10 facade; all colour comes from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (parent resolving the query)

/// The initial-fetch chrome — a skeleton failure tile that keeps the surface's shape (icon box + two
/// text lines) while the parent resolves whether the query failed.
struct QueryErrorLoadingView: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            TSSkeleton(width: 32, height: 32, cornerRadius: TSRadius.md)
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
        .accessibilityLabel(Text(verbatim: QueryErrorStrings.string(
            "error.loadingA11y", "Checking the request"
        )))
    }
}

// MARK: - Empty (the query succeeded)

/// The empty render — a friendly card stating there is nothing wrong, the native parity of the web
/// `QueryError` returning `null` on a successful query (improved to never collapse to a blank box, per
/// the P4 leaf contract).
struct QueryErrorEmptyView: View {
    var body: some View {
        TSCard {
            TSEmptyState(
                title: LocalizedStringKey(QueryErrorStrings.string(
                    "error.empty", "All clear"
                )),
                message: LocalizedStringKey(QueryErrorStrings.string(
                    "error.emptyMessage",
                    "The request succeeded. Any problems loading this data will appear here."
                )),
                systemImage: "checkmark.seal"
            )
        }
        .frame(maxWidth: .infinity)
    }
}
