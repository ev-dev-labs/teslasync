//
//  SpeedGearPanel.swift
//  TeslaSync — P4 feature view · 0174 · SpeedGearPanel (Apple)
//
//  The driving-dynamics "Speed & Gear" surface — the SwiftUI parity of
//  features/driving/components/driving-dynamics/SpeedGearPanel.tsx. Renders every state from the web
//  source (loading skeleton / empty / error / stale / offline / content) for the four cells (the gear
//  letter + "Shift State" badge, Motor Power, Avg Drive Speed, Top Drive Speed), binding through
//  `SpeedGearPanelModel` (P1/S8). No networking lives here; the freshness chip + auto-refresh reflect
//  the bound source's live-state.
//

import Foundation
import SwiftUI

// MARK: - i18n facade SwiftUI helper (P1/S10)

public extension SpeedGearPanelStrings {
    /// SwiftUI `Text` for a key with the web English fallback. Kept here (not in the model file) so
    /// the model/adapter stay SwiftUI-free.
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - SpeedGearPanel (the driving-dynamics surface)

/// The composable Speed & Gear surface — the SwiftUI parity of
/// `features/driving/components/driving-dynamics/SpeedGearPanel.tsx`. Renders every state from the
/// web source and the four cells, binding through `SpeedGearPanelModel` (P1/S8). No networking lives
/// here.
public struct SpeedGearPanel: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SpeedGearPanelSurface.slug

    @State private var model: SpeedGearPanelModel

    public init(model: SpeedGearPanelModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.15) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
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

// MARK: - Header (web `<h2>` Speed & Gear title + freshness chip)

private extension SpeedGearPanel {
    /// The always-visible panel header: the web `<h2>{t('dynamics.speedGear', …)}</h2>` rendered as
    /// a title-case section title with a leading speedometer glyph, with the freshness chip trailing
    /// while fetching or when the bound source is stale / offline.
    var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "speedometer")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .accessibilityHidden(true)
            SpeedGearPanelStrings.text("dynamics.speedGear", "Speed & Gear")
                .font(Font.TS.section)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            if showsFreshnessChip {
                SpeedGearFreshnessChip(connection: model.connection, isFetching: model.isFetching)
            }
        }
    }

    /// The chip appears only while fetching or when the bound source is stale / offline (the
    /// prompt's stale-chip / offline-chip states); when live + idle the header is just the title.
    var showsFreshnessChip: Bool {
        model.isFetching || model.connection != .live
    }
}

// MARK: - Content states

private extension SpeedGearPanel {
    @ViewBuilder
    var content: some View {
        switch model.phase {
        case .loading:
            SpeedGearLoadingGrid()
        case .empty:
            emptyState
        case let .error(message):
            errorState(message)
        case .content:
            if let projection = model.projection {
                SpeedGearContentGrid(projection: projection)
            } else {
                emptyState
            }
        }
    }

    /// The resolved-but-empty branch: no motor reading and no drives → a friendly empty state rather
    /// than a blank grid (the prompt's empty-state requirement).
    var emptyState: some View {
        TSEmptyState(
            title: LocalizedStringKey(
                SpeedGearPanelStrings.string("dynamics.speedGear.empty", "No speed or gear data yet")
            ),
            systemImage: "speedometer"
        )
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
    }

    /// Native failure branch (the web leaf has no error state of its own): a retryable QueryError
    /// equivalent with the bound source's message, mirroring the affordance the prompt requires.
    func errorState(_ message: String) -> some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 26))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            SpeedGearPanelStrings.text("dynamics.speedGear.errorTitle", "Couldn't load speed & gear")
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            TSButton(
                LocalizedStringKey(SpeedGearPanelStrings.string("dynamics.speedGear.retry", "Retry")),
                variant: .secondary,
                size: .small
            ) {
                model.refresh()
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, TSSpacing.lg)
        .accessibilityElement(children: .combine)
    }
}
