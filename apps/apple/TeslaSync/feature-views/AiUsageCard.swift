//
//  AiUsageCard.swift
//  TeslaSync — P4 feature view · 0237 · AiUsageCard (Apple)
//
//  The operator-grade per-call Helix (AI provider) spend + volume card — the SwiftUI parity of
//  features/system/components/status/AiUsageCard.tsx feeding the shared <UsageCard> primitive.
//  Renders the web bands + key/value details + optional top-list breakdowns plus the P4 leaf
//  contract states, bound through `AiUsageModel` (P1/S8). No networking lives here; the freshness
//  chip + banner reflect the bound source's live-state.
//
//  States (every non-gated one renders — no hidden surface):
//    • gated    — web `ai_mode === 'off'` → the surface is withdrawn entirely (renders nothing),
//                 reproducing ADR-015 §I4. This is NOT a hidden section: when AI is on but data is
//                 empty, the empty state renders.
//    • loading  — initial fetch → skeleton chrome (web `isLoading && !today`).
//    • empty    — resolved with no calls today → friendly message (web `!today || call_count===0`),
//                 never a blank box.
//    • error    — query failure → retry affordance (P4 leaf addition over the web).
//    • data     — three bands + four details + optional By-feature / Recent top-lists.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - AiUsageCard (the feature surface)

/// The operator-grade Helix usage card — the SwiftUI parity of
/// `features/system/components/status/AiUsageCard.tsx`. Renders every state from the web source
/// plus the P4 leaf freshness states, binding through `AiUsageModel`.
public struct AiUsageCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "AiUsageCard"

    @State private var model: AiUsageModel

    public init(model: AiUsageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        Group {
            if model.isGated {
                // Web ADR-015 §I4: AI fully off → the whole surface is withdrawn.
                EmptyView()
            } else {
                card
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension AiUsageCard {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                AiUsageConnectivityBanner(connection: model.connection)
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
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: AiUsageStrings.string("aiUsage.title", "Helix usage")))
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: AiUsageStrings.string("aiUsage.title", "Helix usage"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            AiUsageFreshnessChip(connection: model.connection)
            AiUsageRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension AiUsageCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .gated:
            EmptyView()
        case .loading:
            AiUsageLoadingView()
        case let .error(message):
            AiUsageErrorView(message: message) { model.refresh() }
        case let .empty(message):
            AiUsageEmptyView(message: message)
        case .data:
            dataBody
        }
    }

    var dataBody: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                AiUsageBandsView(bands: model.bands)
                AiUsageDetailsView(details: model.details)
                if !model.topLists.isEmpty {
                    AiUsageTopListsView(topLists: model.topLists)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
