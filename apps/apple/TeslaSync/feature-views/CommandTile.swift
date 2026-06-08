//
//  CommandTile.swift
//  TeslaSync — P4 feature view · 0226 · CommandTile (Apple)
//
//  The composable CommandTile surface — the SwiftUI parity of
//  features/system/components/CommandTile.tsx. A single Tesla-command tile rendered in
//  the Vehicle-Commands grid: a tappable glass panel with a favorite star, an optional
//  danger badge, an icon that swaps to a spinner while a command is in flight, a
//  label/sublabel, and the last-status line. It renders every state (idle / executing /
//  succeeded / failed / stale / offline) through `CommandTileModel` (P1/S8). Activation
//  routes dangerous commands to the confirmation seam (web `onRequestDialog`) and
//  everything else to the dispatch seam (web `onExecute`); the star toggles the
//  favorite seam (web `onToggleFavorite`). No networking lives here; the surface emits
//  the P1/S11 `view.opened`.
//

import SwiftUI

/// The composable CommandTile surface. Binds through `CommandTileModel`, renders the
/// tile and all of its states, and emits the P1/S11 `view.opened` event on appear.
public struct CommandTile: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        CommandTileSurface.slug
    }

    @State private var model: CommandTileModel

    /// Binds an explicitly constructed model (production wires it over the shared
    /// P1/S8 holders; previews/tests inject in-memory seams).
    public init(model: CommandTileModel) {
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the command definition + the dispatch and
    /// favorite seams (web `def` + `onExecute`/`onRequestDialog`/`onToggleFavorite`).
    public init(
        def: CommandTileDef,
        isFavorite: Bool = false,
        lastStatus: String? = nil,
        dispatcher: any CommandDispatching,
        favorites: any CommandFavoriteToggling,
        telemetry: any CommandTileTelemetry = OSLogCommandTileTelemetry()
    ) {
        _model = State(
            initialValue: CommandTileModel(
                def: def,
                isFavorite: isFavorite,
                lastStatus: lastStatus,
                dispatcher: dispatcher,
                favorites: favorites,
                telemetry: telemetry
            )
        )
    }

    public var body: some View {
        CommandTileButton(model: model)
            .onAppear { model.start() }
    }
}
