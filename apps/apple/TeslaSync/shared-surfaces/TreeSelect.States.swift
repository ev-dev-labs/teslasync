//
//  TreeSelect.States.swift
//  TeslaSync — P4 shared surface · 0161 · TreeSelect (Apple)
//
//  The P4 leaf-contract chrome composed by `TreeSelect` when the surface is not in its ready state: the
//  loading skeleton (a search-bar block over a few row-shaped blocks, so the surface keeps its footprint
//  while the catalog resolves) and the error tile with a retry affordance (the web `QueryError` peer, for
//  when the parent's catalog fetch fails). All copy resolves through the P1/S10 facade; all color comes
//  from the P1/S9 tokens.
//

import SwiftUI

// MARK: - Loading (the bound catalog's fetch in flight)

/// The initial-fetch chrome — a skeleton search bar over a few row-shaped skeleton blocks framed by the
/// tree's bordered surface, so the surface keeps the picker's footprint while the catalog resolves.
struct TreeSelectLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            TSSkeleton(height: 38, cornerRadius: TSRadius.md)
            VStack(spacing: TSSpacing.sm) {
                ForEach(0 ..< TreeSelectMeta.loadingRowCount, id: \.self) { _ in
                    TSSkeleton(height: 24, cornerRadius: TSRadius.sm)
                }
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: TreeSelectStrings.loadingA11y))
    }
}

// MARK: - Error (web `QueryError` peer)

/// The feed-failure state (web `QueryError` peer) — a compact error card with a retry affordance. The
/// message is the runtime failure reason, rendered verbatim.
struct TreeSelectErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        TSCard {
            VStack(spacing: TSSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(Color.TS.statusDanger)
                    .accessibilityHidden(true)
                Text(verbatim: TreeSelectStrings.errorTitle)
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
                    Text(verbatim: TreeSelectStrings.retry)
                }
                .accessibilityLabel(Text(verbatim: TreeSelectStrings.retry))
            }
            .frame(maxWidth: .infinity)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
