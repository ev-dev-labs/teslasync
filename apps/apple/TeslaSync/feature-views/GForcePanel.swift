//
//  GForcePanel.swift
//  TeslaSync — P4 feature view · 0169 · GForcePanel (Apple)
//
//  The composable driving-dynamics "Acceleration G-Force" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/GForcePanel.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content) for the live lateral and
//  longitudinal acceleration plus the combined magnitude, binding through `GForcePanelModel`
//  (P1/S8). No networking lives here; the freshness chip + auto-refresh reflect the bound source's
//  live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension GForcePanelStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - GForcePanel (the driving-dynamics surface)

/// The composable Acceleration G-Force surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/GForcePanel.tsx`. Renders every state from the web
/// source and the responsive 3-up stat row (Lateral / Longitudinal / Combined), binding through
/// `GForcePanelModel` (P1/S8). No networking lives here.
public struct GForcePanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = GForcePanelSurface.slug

    @State private var model: GForcePanelModel

    public init(model: GForcePanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.md) {
                    header
                    content
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear {
            model.start()
            model.autoRefreshIfStale()
        }
        .onDisappear { model.stop() }
        .onChange(of: model.connection) { _, _ in model.autoRefreshIfStale() }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Header (web `<h2>` title + freshness chip)

private extension GForcePanel {
    /// The always-visible panel header: the web `<h2>{t('dynamics.gForce', …)}</h2>` title with the
    /// freshness chip trailing while fetching or when the bound source is stale/offline.
    var header: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            GForcePanelStrings.text("dynamics.gForce", "Acceleration G-Force")
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                GForceFreshnessChip(
                    connection: model.connection,
                    isFetching: model.isFetching,
                    updatedAt: model.updatedAt
                )
            }
        }
    }

    /// The freshness chip appears only while fetching or when the bound source is stale/offline (the
    /// prompt's stale-chip / offline-chip states); when live + idle the header is just the title.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Content states

private extension GForcePanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            GForceLoadingGrid()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                GForceStatGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    /// The web empty branch: `<EmptyState message={t('dynamics.gForceNoData', 'No G-force telemetry
    /// received yet')} />`.
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                GForcePanelStrings.string("dynamics.gForceNoData", "No G-force telemetry received yet")
            ),
            systemImage: "gauge.with.dots.needle.bottom.50percent"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable error with the
    /// bound source's message, mirroring the QueryError affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            GForcePanelStrings.text("dynamics.gForce.errorTitle", "Couldn't load G-force telemetry")
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
                GForcePanelStrings.text("dynamics.gForce.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(GForcePanelStrings.text("dynamics.gForce.retry", "Retry"))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
