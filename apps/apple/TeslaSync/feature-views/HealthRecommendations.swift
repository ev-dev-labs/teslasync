//
//  HealthRecommendations.swift
//  TeslaSync — P4 feature view · 0156 · HealthRecommendations (Apple)
//
//  The composable Drivetrain Health "recommendations" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthRecommendations.tsx. Renders every state from
//  the surface contract (loading skeleton / empty / error / stale / offline / content) for the
//  `GlassPanel` of prioritized maintenance tips (a shield-headed title over a staggered list of
//  priority-tinted recommendation cards), binding through `HealthRecommendationsModel` (P1/S8). No
//  networking lives here; the freshness chip + connectivity banner + auto-refresh reflect the bound
//  source's live-state (ADR-013).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension HealthRecommendationsStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - HealthRecommendations (the drivetrain-health recommendations surface)

/// The composable Drivetrain Health recommendations surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/HealthRecommendations.tsx`. Renders every state from
/// the web source and the staggered, priority-tinted recommendation list, binding through
/// `HealthRecommendationsModel` (P1/S8). No networking lives here.
public struct HealthRecommendations: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HealthRecommendationsSurface.slug

    @State private var model: HealthRecommendationsModel

    public init(model: HealthRecommendationsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.35) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if showsFreshnessChip {
                    freshnessHeader
                }
                if showsConnectivityBanner {
                    HealthRecommendationsConnectivityBanner(connection: model.connection)
                }
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
    }

    /// The freshness chip appears while fetching or whenever the bound source is not live (the
    /// prompt's stale-chip / offline-chip states).
    private var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }

    /// The cached-data banner appears only when the source is stale or offline, so the cached list is
    /// clearly labeled.
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }
}

// MARK: - Header

private extension HealthRecommendations {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            HealthRecommendationsFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
        }
    }
}

// MARK: - Content states

private extension HealthRecommendations {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            HealthRecommendationsLoadingState()
        case .empty:
            HealthRecommendationsEmptyState()
        case let .error(message):
            HealthRecommendationsErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection, !projection.isEmpty {
                HealthRecommendationsContent(projection: projection)
            } else {
                HealthRecommendationsEmptyState()
            }
        }
    }
}
