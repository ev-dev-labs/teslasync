//
//  StatusHeader.swift
//  TeslaSync — P4 feature view · 0028 · StatusHeader (Apple)
//
//  The composable DLQ-Inspector "status header" feature view — the SwiftUI parity of
//  web/src/features/admin/components/dlq-inspector/StatusHeader.tsx. Renders every state from
//  the web shell (loading / empty / error / stale / offline / content) around the three summary
//  cards (Total entries, Replayable, Replay mode) plus the `replay_enabled == false` warning
//  banner, bound through `StatusHeaderModel` (P1/S8). No networking lives here; the freshness
//  chip + connectivity banner reflect the bound source's live-state.
//

import SwiftUI

/// The composable DLQ status-header surface — the SwiftUI parity of
/// `features/admin/components/dlq-inspector/StatusHeader.tsx`, binding through
/// `StatusHeaderModel` (P1/S8). No networking lives here.
public struct StatusHeader: View {
    @State private var model: StatusHeaderModel

    public init(model: StatusHeaderModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            header
            if model.connection != .live {
                StatusHeaderConnectivityBanner(connection: model.connection)
            }
            content
            if model.disabledBannerVisible {
                StatusHeaderDisabledBanner()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header

private extension StatusHeader {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            StatusHeaderFreshnessChip(connection: model.connection)
        }
    }
}

// MARK: - Content (phase switch)

private extension StatusHeader {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            StatusHeaderSkeleton()
        case .empty:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                StatusHeaderGrid(cards: model.cards)
                StatusHeaderEmptyHint()
            }
        case let .error(message):
            StatusHeaderErrorState(message: message) { model.refresh() }
        case .content:
            StatusHeaderGrid(cards: model.cards)
        }
    }
}
