//
//  AIUsageCard.swift
//  TeslaSync — P4 feature view · 0203 · AIUsageCard (Apple)
//
//  The lightweight Helix "Usage today" settings card — the SwiftUI parity of
//  features/settings/components/AIUsageCard.tsx. Renders the web source's bordered section
//  (title subhead + three-up token / cost grid + footer caption) plus the P4 leaf contract
//  states, bound through `AIUsageModel` (P1/S8). No networking lives here; the freshness chip +
//  banner reflect the bound source's live-state.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton grid + caption bar (web `isLoading`).
//    • empty    — resolved with no calls today → zeroed cells + hint caption (web
//                 all-zeroes rendering), never a blank box.
//    • error    — query failure → retry affordance (web `isError`, upgraded to `QueryError`).
//    • data     — the three-up grid with live numbers + "{N} Helix calls today." caption.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with
//                 a one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AIUsageCard (the feature surface)

/// The Helix "Usage today" settings card — the SwiftUI parity of
/// `features/settings/components/AIUsageCard.tsx`. Renders every state from the web source plus
/// the P4 leaf freshness states, binding through `AIUsageModel`.
public struct AIUsageCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AIUsageCard"

    @State private var model: AIUsageModel

    public init(model: AIUsageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            if model.connection != .live {
                AIUsageConnectivityBanner(connection: model.connection)
            }
            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: AIUsageStrings.string("ai.settings.usage.title", "Usage today")))
    }
}

// MARK: - Header (web `<Subhead>` + freshness chrome)

private extension AIUsageCard {
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: AIUsageStrings.string("ai.settings.usage.title", "Usage today"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            AIUsageFreshnessChip(connection: model.connection)
            AIUsageRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web grid + the P4 leaf contract)

private extension AIUsageCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            AIUsageLoadingView()
        case let .error(message):
            AIUsageErrorView(message: message) { model.refresh() }
        case .empty, .data:
            AIUsageContent(metrics: model.metrics, caption: model.caption)
        }
    }
}
