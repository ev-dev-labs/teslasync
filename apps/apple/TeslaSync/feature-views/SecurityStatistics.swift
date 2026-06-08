//
//  SecurityStatistics.swift
//  TeslaSync — P4 feature view · 0045 · SecurityStatistics (Apple)
//
//  The composable SecurityStatistics feature view — the SwiftUI parity of
//  features/admin/components/security-access/SecurityStatistics.tsx. A glass panel
//  with a title and a responsive grid of security-event metric tiles, binding through
//  `SecurityStatisticsModel` (P1/S8). Renders every state (loading / loaded / empty /
//  error / stale / offline), auto-refreshes when stale, and emits the P1/S11
//  `view.opened` event. No networking lives here.
//

import SwiftUI

// MARK: - SecurityStatistics (the feature surface)

/// The composable SecurityStatistics surface — the SwiftUI parity of the web
/// `SecurityStatistics`. Wraps the panel in the shared `FadeIn` (web `FadeIn
/// delay={0.25}`) + `GlassPanel`, composes the header and state body, drives the
/// lifecycle through `SecurityStatisticsModel`, and emits the diagnostics
/// `view.opened` event with the surface slug `SecurityStatistics`.
public struct SecurityStatistics: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SecurityStatisticsSurface.slug
    }

    @State private var model: SecurityStatisticsModel
    private let autoRefreshInterval: Duration

    public init(model: SecurityStatisticsModel, autoRefreshInterval: Duration = .seconds(30)) {
        _model = State(initialValue: model)
        self.autoRefreshInterval = autoRefreshInterval
    }

    public var body: some View {
        TSFadeIn(delay: 0.25) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    SecurityStatisticsHeader(
                        connection: model.connection,
                        showsFreshness: model.showsFreshness
                    )
                    SecurityStatisticsBody(
                        phase: model.phase,
                        tiles: model.tiles,
                        connection: model.connection,
                        onRetry: { model.reload() },
                        onRefresh: { model.reload() }
                    )
                }
            }
        }
        .onAppear { model.start() }
        .task { await autoRefreshWhenStale() }
        .accessibilityElement(children: .contain)
    }

    /// Stale-state auto-refresh driver: periodically asks the model to reload when its
    /// loaded snapshot has aged past the freshness window. Cancellation-safe so the
    /// loop ends when the surface leaves the hierarchy.
    private func autoRefreshWhenStale() async {
        while !Task.isCancelled {
            try? await Task.sleep(for: autoRefreshInterval)
            if Task.isCancelled { break }
            model.reloadIfStale()
        }
    }
}
