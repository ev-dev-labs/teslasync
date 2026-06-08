//
//  TitleSlide.swift
//  TeslaSync — P4 feature view · 0070 · TitleSlide (Apple)
//
//  The composable "Year in Review" opening slide — the SwiftUI parity of
//  features/analytics/components/review/TitleSlide.tsx. Renders every state from the story shell
//  (loading / empty / error / stale / offline / content) and the animated hero (emoji + year +
//  title + vehicle name), binding through `TitleSlideModel` (P1/S8). No networking lives here; the
//  freshness chip + connectivity banner reflect the bound source's live-state and a stale stream
//  triggers a guarded auto-refresh.
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension TitleSlideStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - TitleSlide (the slide surface)

/// The composable Year-in-Review title slide — the SwiftUI parity of
/// `features/analytics/components/review/TitleSlide.tsx`, binding through `TitleSlideModel`
/// (P1/S8). No networking lives here.
public struct TitleSlide: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = TitleSlideSurface.slug

    @State private var model: TitleSlideModel

    public init(model: TitleSlideModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: TSSpacing.sm) {
            header
            content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (freshness + refresh)

extension TitleSlide {
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            TitleSlideFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
            refreshButton
        }
    }

    private var refreshButton: some View {
        Button {
            model.refresh()
        } label: {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 11, weight: .semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Color.TS.textMuted)
        .accessibilityLabel(TitleSlideStrings.text("titleSlide.refresh", "Refresh"))
    }
}

// MARK: - Content states

extension TitleSlide {
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TitleSlideLoadingChrome()
        case .empty:
            TitleSlideEmptyState()
        case let .error(message):
            TitleSlideErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                loadedContent(projection)
            } else {
                TitleSlideEmptyState()
            }
        }
    }

    private func loadedContent(_ projection: TitleSlideProjection) -> some View {
        VStack(spacing: TSSpacing.md) {
            if model.connection != .live {
                TitleSlideConnectivityBanner(connection: model.connection)
            }
            TitleSlideHero(projection: projection)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
