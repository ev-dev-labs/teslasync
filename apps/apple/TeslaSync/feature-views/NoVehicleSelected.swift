//
//  NoVehicleSelected.swift
//  TeslaSync — P4 feature view · 0193 · NoVehicleSelected (Apple)
//
//  The defensive "no vehicle selected" surface — the SwiftUI parity of
//  features/onboarding/components/NoVehicleSelected.tsx. The web component renders a
//  titled `PageContainer` over a `GlassPanel` holding an `EmptyState` (Car glyph, title,
//  message, and a "Set up TeslaSync" action that navigates to `/onboarding`). The native
//  surface reproduces that exactly in its `.empty` phase and widens it with the prompt's
//  state envelope (loading / content / error, plus the stale + offline freshness branches)
//  so the bound `useSelectedVehicle` feed is represented in every state — never a blank
//  box. Fades in on appear (web `<FadeIn>` motion), and binds through
//  `NoVehicleSelectedModel` (P1/S8); no networking lives here.
//

import SwiftUI

/// The defensive empty-state surface — the SwiftUI parity of the web `NoVehicleSelected`,
/// binding through `NoVehicleSelectedModel` (P1/S8). A titled header over a glass panel
/// that switches over the resolved selection phase.
public struct NoVehicleSelectedView: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = NoVehicleSelectedSurface.slug

    @State private var model: NoVehicleSelectedModel

    public init(model: NoVehicleSelectedModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                NoVehicleSelectedHeader(title: model.pageTitle, connection: model.connection)
                if model.connection != .live {
                    NoVehicleSelectedConnectivityBanner(connection: model.connection)
                }
                TSGlassPanel {
                    content
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The phase ladder: loading → empty (the web verdict) / content / error. Every branch
    /// renders real chrome so the panel is never blank.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            NoVehicleSelectedLoadingView(
                label: NoVehicleSelectedStrings.string("common.noVehicleSelected.loading", "Checking your garage…")
            )
        case .empty:
            NoVehicleSelectedEmptyView(
                title: model.emptyTitle,
                message: model.emptyDescription,
                actionLabel: model.actionLabel,
                onSetUp: { model.goToOnboarding() }
            )
        case .content:
            NoVehicleSelectedReadyView(
                vehicleName: model.selected?.displayName ?? model.emptyTitle,
                message: model.readyBody
            )
        case let .error(message):
            NoVehicleSelectedErrorView(
                title: NoVehicleSelectedStrings.string(
                    "common.noVehicleSelected.error.title", "Couldn't load your vehicles"
                ),
                message: message.isEmpty
                    ? NoVehicleSelectedStrings.string(
                        "common.noVehicleSelected.error.body", "We couldn't check your garage. Try again."
                    )
                    : message,
                retryLabel: NoVehicleSelectedStrings.string("common.noVehicleSelected.retry", "Try again"),
                onRetry: { model.refresh() }
            )
        }
    }
}
