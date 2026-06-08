//
//  HeroGauges.swift
//  TeslaSync — P4 feature view · 0058 · HeroGauges (Apple)
//
//  The composable "Hero Gauges" analytics surface — the SwiftUI parity of
//  features/analytics/components/analytics/HeroGauges.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content) for the six headline
//  metric gauges, binding through `HeroGaugesModel` (P1/S8). No networking lives here; the
//  freshness chip + auto-refresh reflect the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension HeroGaugesStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - HeroGauges (the analytics surface)

/// The composable Hero Gauges analytics surface — the SwiftUI parity of
/// `features/analytics/components/analytics/HeroGauges.tsx`. Renders every state from the web
/// source and the six-gauge responsive grid, binding through `HeroGaugesModel` (P1/S8). No
/// networking lives here.
public struct HeroGauges: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HeroGaugesSurface.slug

    @State private var model: HeroGaugesModel

    public init(model: HeroGaugesModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            if showsFreshnessChip {
                freshnessHeader
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }

    /// The web grid is chrome-free when live + idle; the freshness chip appears only while fetching
    /// or when the bound source is stale/offline (the prompt's stale-chip / offline-chip states).
    private var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Header

private extension HeroGauges {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            HeroGaugesFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
        }
    }
}

// MARK: - Content states

private extension HeroGauges {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            HeroGaugesLoadingGrid()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                HeroGaugesGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(HeroGaugesStrings.string("analytics.hero.empty", "No fleet metrics yet")),
            message: LocalizedStringKey(
                HeroGaugesStrings.string(
                    "analytics.hero.emptyHint",
                    "Drive and charge to build up your fleet metrics."
                )
            ),
            systemImage: "gauge.medium"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            HeroGaugesStrings.text("analytics.hero.errorTitle", "Couldn't load fleet metrics")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                model.refresh()
            } label: {
                HeroGaugesStrings.text("analytics.hero.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(HeroGaugesStrings.text("analytics.hero.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
