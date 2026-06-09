//
//  ToggleCommandTile.swift
//  TeslaSync — P4 feature view · 0260 · ToggleCommandTile (Apple)
//
//  The composable ToggleCommandTile surface — the SwiftUI parity of
//  features/system/components/ToggleCommandTile.tsx. A single Tesla toggle command
//  rendered in the Vehicle-Commands grid: a tappable glass panel with a favorite star, a
//  status dot, an icon that swaps to its off symbol when off and to a spinner while a
//  command is in flight, the command label, and an ON / OFF power line — all tinted with
//  the variant tone while on. It renders every state (off / on / executing / succeeded /
//  failed / stale / offline) through `ToggleCommandTileModel` (P1/S8). Activation turns
//  the command off (when on), opens the options dialog (when off + input-gated, web
//  `onRequestDialog`), or turns it on (web `onExecute`); the star toggles the favorite
//  seam (web `onToggleFavorite`). No networking lives here; the surface emits the P1/S11
//  `view.opened`.
//

import SwiftUI

/// The composable ToggleCommandTile surface. Binds through `ToggleCommandTileModel`,
/// renders the tile and all of its states, and emits the P1/S11 `view.opened` event on
/// appear.
public struct ToggleCommandTile: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        ToggleCommandTileSurface.slug
    }

    @State private var model: ToggleCommandTileModel

    /// Binds an explicitly constructed model (production wires it over the shared P1/S8
    /// holders; previews/tests inject in-memory seams).
    public init(model: ToggleCommandTileModel) {
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the toggle definition + the dispatch, bound
    /// state, and favorite seams (web `def` + `state` + `onExecute` / `onRequestDialog` /
    /// `onToggleFavorite`).
    public init(
        def: ToggleCommandTileDef,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        dispatcher: any ToggleCommandDispatching,
        stateSource: any ToggleStateObserving,
        favorites: any ToggleCommandFavoriteToggling,
        telemetry: any ToggleCommandTelemetry = OSLogToggleCommandTelemetry()
    ) {
        _model = State(
            initialValue: ToggleCommandTileModel(
                def: def,
                isFavorite: isFavorite,
                lastStatus: lastStatus,
                dispatcher: dispatcher,
                stateSource: stateSource,
                favorites: favorites,
                telemetry: telemetry
            )
        )
    }

    public var body: some View {
        ToggleCommandTileButton(model: model)
            .onAppear { model.start() }
    }
}
