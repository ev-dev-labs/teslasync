//
//  HealthGaugeGrid.swift
//  TeslaSync — P4 feature view · 0154 · HealthGaugeGrid (Apple)
//
//  The composable Drivetrain Health "gauge grid" surface — the SwiftUI parity of
//  features/driving/components/drivetrain-health/HealthGaugeGrid.tsx. Renders every state from
//  the surface contract (loading skeleton / empty / error / stale / offline / content) for the
//  three-panel summary (health-score gauge · motor details · drive statistics), binding through
//  `HealthGaugeGridModel` (P1/S8). No networking lives here; the freshness chip + connectivity
//  banner + auto-refresh reflect the bound source's live-state (ADR-013).
//

import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension HealthGaugeGridStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file)
    /// so the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - HealthGaugeGrid (the drivetrain-health surface)

/// The composable Drivetrain Health gauge-grid surface — the SwiftUI parity of
/// `features/driving/components/drivetrain-health/HealthGaugeGrid.tsx`. Renders every state from
/// the web source and the responsive three-panel row, binding through `HealthGaugeGridModel`
/// (P1/S8). No networking lives here.
public struct HealthGaugeGrid: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = HealthGaugeGridSurface.slug

    @State private var model: HealthGaugeGridModel

    public init(model: HealthGaugeGridModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.1) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                if showsFreshnessChip {
                    freshnessHeader
                }
                if showsConnectivityBanner {
                    HealthGaugeConnectivityBanner(connection: model.connection)
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

    /// The cached-data banner appears only when the source is stale or offline, so cached panels
    /// are clearly labeled.
    private var showsConnectivityBanner: Bool {
        model.connection != .live
    }
}

// MARK: - Header

private extension HealthGaugeGrid {
    var freshnessHeader: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            HealthGaugeFreshnessChip(
                connection: model.connection,
                isFetching: model.isFetching,
                updatedAt: model.updatedAt
            )
        }
    }
}

// MARK: - Content states

private extension HealthGaugeGrid {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            HealthGaugeLoadingGrid()
        case .empty:
            HealthGaugeEmptyState()
        case let .error(message):
            HealthGaugeErrorState(message: message) { model.refresh() }
        case .content:
            if let projection = model.projection {
                HealthGaugeContent(projection: projection)
            } else {
                HealthGaugeEmptyState()
            }
        }
    }
}
