//
//  HealthOverview.swift
//  TeslaSync — P4 feature view · 0155 · HealthOverview (Apple)
//
//  The composable Drivetrain Health "overview" summary surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthOverview.tsx. Renders every state from the
//  surface contract (loading skeleton / empty / error / stale / offline / content) for the status
//  banner (shown only when the drivetrain is not healthy) + the summary card (status icon,
//  headline, "Motor State: …" line, status badge, animated health-score percent), binding through
//  `HealthOverviewModel` (P1/S8). No networking lives here; the freshness chip + connectivity
//  banner + auto-refresh reflect the bound source's live-state (ADR-013).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension HealthOverviewStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - HealthOverview (the drivetrain-health overview surface)

/// The composable Drivetrain Health overview surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/HealthOverview.tsx`. Renders every state from the
/// web source and the conditional status banner + summary card, binding through
/// `HealthOverviewModel` (P1/S8). No networking lives here.
public struct HealthOverview: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HealthOverviewSurface.slug

    @State private var model: HealthOverviewModel

    public init(model: HealthOverviewModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if showsFreshnessChip {
                    freshnessHeader
                }
                if showsConnectivityBanner {
                    HealthOverviewConnectivityBanner(connection: model.connection)
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

    /// The cached-data banner appears only when the source is stale or offline, so the cached card
    /// is clearly labeled.
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }
}

// MARK: - Header

private extension HealthOverview {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            HealthOverviewFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
        }
    }
}

// MARK: - Content states

private extension HealthOverview {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            HealthOverviewLoadingState()
        case .empty:
            HealthOverviewEmptyState()
        case let .error(message):
            HealthOverviewErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                HealthOverviewContent(projection: projection)
            } else {
                HealthOverviewEmptyState()
            }
        }
    }
}
