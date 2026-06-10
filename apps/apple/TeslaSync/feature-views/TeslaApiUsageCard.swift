//
//  TeslaApiUsageCard.swift
//  TeslaSync — P4 feature view · 0257 · TeslaApiUsageCard (Apple)
//
//  The operator-grade Tesla Fleet API spend + volume card — the SwiftUI parity of
//  features/system/components/status/TeslaApiUsageCard.tsx feeding the shared <UsageCard> primitive.
//  It combines the bare `/system/api-usage` snapshot (this-month total + cost) with the richer
//  `/api-logs/stats` payload (last-24h burn, avg latency, error rate, by-service / by-method splits)
//  to answer the operator's questions: am I burning faster than the monthly credit allows, when does
//  the billing window reset, what's eating the budget, and are recent calls healthy. Bound through
//  `TeslaApiUsageModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton chrome.
//    • empty    — resolved with no usage → friendly message (web `!apiUsage`), never a blank box.
//    • error    — query failure → retry affordance (P4 leaf addition over the web).
//    • data     — budget bar + three bands + four details + optional top-lists + over-budget banner
//                 + footer links.
//    • stale / offline — the orthogonal `connection` axis → header freshness chip + banner with a
//                 one-shot auto-refresh on the stale transition.
//

import SwiftUI

// MARK: - TeslaApiUsageCard (the feature surface)

/// The operator-grade Tesla Fleet API usage card — the SwiftUI parity of
/// `features/system/components/status/TeslaApiUsageCard.tsx`. Renders every state from the web
/// source plus the P4 leaf freshness states, binding through `TeslaApiUsageModel`.
public struct TeslaApiUsageCard: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "TeslaApiUsageCard"

    @State private var model: TeslaApiUsageModel

    public init(model: TeslaApiUsageModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        card
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }
}

// MARK: - Card chrome

private extension TeslaApiUsageCard {
    var card: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            header
            if model.connection != .live {
                TeslaApiUsageConnectivityBanner(connection: model.connection)
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
        .accessibilityLabel(Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.title", "Tesla API usage")))
    }

    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: TeslaApiUsageStrings.string("teslaApiUsage.title", "Tesla API usage"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            TeslaApiUsageFreshnessChip(connection: model.connection)
            TeslaApiUsageRefreshButton { model.refresh() }
        }
    }
}

// MARK: - Content states (web body + the P4 leaf contract)

private extension TeslaApiUsageCard {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            TeslaApiUsageLoadingView()
        case let .error(message):
            TeslaApiUsageErrorView(message: message) { model.refresh() }
        case let .empty(message):
            TeslaApiUsageEmptyView(message: message)
        case .data:
            dataBody
        }
    }

    var dataBody: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if let budget = model.budget {
                    TeslaApiUsageBudgetBar(budget: budget)
                }
                if !model.bands.isEmpty {
                    TeslaApiUsageBandsView(bands: model.bands)
                }
                if !model.details.isEmpty {
                    TeslaApiUsageDetailsView(details: model.details)
                }
                if !model.topLists.isEmpty {
                    TeslaApiUsageTopListsView(topLists: model.topLists)
                }
                if let banner = model.banner {
                    TeslaApiUsageBannerView(banner: banner)
                }
                if !model.footer.isEmpty {
                    TeslaApiUsageFooterView(links: model.footer) { route in
                        model.open(route: route)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}
