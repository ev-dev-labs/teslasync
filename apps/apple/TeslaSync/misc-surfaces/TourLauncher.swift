//
//  TourLauncher.swift
//  TeslaSync — P4 misc surface · 0001 · TourLauncher (Apple)
//
//  The tour launcher — the SwiftUI parity of features/onboarding/TourLauncher.tsx. The web source
//  is a `Modal` listing every tour in the registry: a sparkle-titled header with a close "×", an
//  intro subtitle, one row per tour (completed-check / play glyph, title, "Recommended for this
//  page" + "Completed" chips, description, Start / Replay), and a footer with "Reset all tours" +
//  "Close". The native surface presents that same composition as HIG sheet content (web `Modal`
//  → native sheet): it fades in inside a `TSGlassPanel`, shows the always-on header + subtitle +
//  freshness chip, surfaces a cached-data banner when the bound live-state is not fresh, and
//  switches over the model's resolved phase so every prompt-required state renders (loading /
//  empty / error / content) — never a blank box. Binds through `TourLauncherModel` (P1/S8); no
//  persistence access or tour-engine wiring lives here.
//

import SwiftUI

/// The tour-launcher surface, binding through `TourLauncherModel` (P1/S8). `onClose` is the web
/// `Modal` `onClose` — the presenting host (the sheet that shows this surface) dismisses around
/// it; starting a tour closes the launcher first, then promotes the tour (web `setOpen(false)`
/// then `dispatchTourStart`).
public struct TourLauncher: View {
    @State private var model: TourLauncherModel
    private let onClose: () -> Void

    public init(model: TourLauncherModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    TourLauncherHeader(connection: model.connection, onClose: onClose)
                    TourLauncherSubtitle()
                    if model.connection != .live {
                        TourLauncherConnectivityBanner(connection: model.connection)
                    }
                    body(for: model.phase)
                    TourLauncherFooter(onResetAll: { model.resetAllTours() }, onClose: onClose)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web modal body between the subtitle and the footer: the populated tour list for
    /// `.content`, else the loading / empty / error envelopes so no state is hidden behind a
    /// blank panel.
    @ViewBuilder
    private func body(for phase: TourLauncherPhase) -> some View {
        switch phase {
        case .loading:
            TourLauncherLoadingState()
        case .empty:
            TourLauncherEmptyState()
        case let .error(message):
            TourLauncherErrorState(message: message) { model.refresh() }
        case .content:
            TourLauncherList(model: model) { id in
                onClose()
                model.startTour(id)
            }
        }
    }
}

// MARK: - Surface identity

public extension TourLauncher {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    static var surfaceSlug: String {
        TourLauncherSurface.slug
    }
}
