//
//  GeofenceDrawer.swift
//  TeslaSync — P4 modal/dialog · 0011 · GeofenceDrawer (Apple)
//
//  The geofence drawer — the SwiftUI parity of components/maps/GeofenceDrawer.tsx. The web source
//  is a passive `leaflet-draw` controller mounted inside a `MapContainer`; the native surface
//  presents the same capability as an Apple modal: it fades in inside a `TSGlassPanel`, shows the
//  always-on title header + freshness chip + Done, surfaces a cached-data banner when the bound
//  live-state is not fresh, and switches over the model's resolved phase so every prompt-required
//  state renders (loading / empty / error / content) — never a blank box. The map + draw toolbar
//  stay live through the empty + content phases so the first fence is always drawable. Binds through
//  `GeofenceDrawerModel` (P1/S8); no persistence access or geofence mutation lives here.
//

import SwiftUI

/// The geofence drawer surface, binding through `GeofenceDrawerModel` (P1/S8). `onClose` is the host
/// dismissal (the Done button) — the presenting sheet dismisses around it.
public struct GeofenceDrawer: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = GeofenceDrawerSurface.slug

    @State private var model: GeofenceDrawerModel
    private let onClose: () -> Void

    public init(model: GeofenceDrawerModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            TSGlassPanel {
                VStack(alignment: .leading, spacing: TSSpacing.lg) {
                    GeofenceDrawerHeader(connection: model.connection, onClose: onClose)
                    if model.connection != .live {
                        GeofenceConnectivityBanner(connection: model.connection)
                    }
                    body(for: model.phase)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
        .accessibilityAddTraits(.isModal)
    }

    /// The body under the header: the live map + toolbar surface for `.content` / `.empty`, else the
    /// loading / error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: GeofenceDrawerPhase) -> some View {
        switch phase {
        case .loading:
            GeofenceLoadingState()
        case let .error(message):
            GeofenceErrorState(message: message) { model.refresh() }
        case .empty:
            liveSurface(showList: false)
        case .content:
            liveSurface(showList: true)
        }
    }

    /// The always-live map + draw toolbar, with the saved-fences list (content) or the friendly
    /// empty hint (empty) beneath, plus the inline reload error when a refresh failed with cache.
    private func liveSurface(showList: Bool) -> some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            if let message = model.inlineErrorMessage {
                GeofenceInlineError(message: message)
            }
            GeofenceMapCanvas(model: model)
            GeofenceDrawToolbar(model: model)
            if showList {
                GeofenceFenceList(model: model)
            } else {
                GeofenceEmptyState()
            }
        }
    }
}
