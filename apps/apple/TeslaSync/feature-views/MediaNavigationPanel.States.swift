//
//  MediaNavigationPanel.States.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  The P4 leaf-contract chrome for the Media & Navigation panel: the loading
//  skeleton, the panel-level empty state, and the fetch-error state with retry. These
//  back the `loading` / `empty` / `error` phases the parent query drives (the web
//  `isLoading` / `EmptyState` / `QueryError` peers); the `data` phase body lives in
//  `MediaNavigationPanel.Views.swift`. All consume the P1/S10 facade + shared P1/S9
//  tokens and components (`TSSkeleton` / `TSButton`) — no networking, no raw hex.
//

import SwiftUI

// MARK: - Loading (web parent `isLoading`)

/// The initial-fetch chrome: skeleton section labels over skeleton cards, so the
/// panel keeps its shape while the parent query resolves.
struct MediaNavLoadingView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xl) {
            ForEach(0 ..< 2, id: \.self) { _ in
                VStack(alignment: .leading, spacing: TSSpacing.sm) {
                    TSSkeleton(width: 90, height: 10)
                    TSSkeleton(height: 64, cornerRadius: TSRadius.md)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: MediaNavStrings.string(
            "mediaNav.loadingA11y", "Loading media and navigation"
        )))
    }
}

// MARK: - Empty (web `EmptyState` peer)

/// The panel-level empty render: a friendly state when neither snapshot resolved,
/// never a blank panel.
struct MediaNavEmptyView: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Text(verbatim: MediaNavStrings.string("mediaNav.empty", "No media or navigation data"))
            } icon: {
                Image(systemName: "music.note.list")
            }
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Error (web `QueryError` peer)

/// The fetch-failure state with a retry affordance.
struct MediaNavErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
            Text(verbatim: MediaNavStrings.string(
                "mediaNav.errorTitle",
                "Couldn't load media & navigation"
            ))
            .font(Font.TS.panel)
            .foregroundStyle(Color.TS.textPrimary)
            .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(variant: .secondary, size: .small, action: onRetry) {
                Text(verbatim: MediaNavStrings.string("mediaNav.retry", "Retry"))
            }
            .accessibilityLabel(Text(verbatim: MediaNavStrings.string("mediaNav.retry", "Retry")))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.md)
        .accessibilityElement(children: .combine)
    }
}
