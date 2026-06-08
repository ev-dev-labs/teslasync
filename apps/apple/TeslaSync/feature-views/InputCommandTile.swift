//
//  InputCommandTile.swift
//  TeslaSync — P4 feature view · 0232 · InputCommandTile (Apple)
//
//  The vehicle-command input tile — the SwiftUI parity of
//  features/system/components/InputCommandTile.tsx. Renders the web source's
//  composition (the favorite star, the icon box, the label / sublabel / ✓-or-✗
//  status, and the tap-to-open-dialog affordance) plus the P4 leaf contract states.
//  Binds through `InputCommandTileModel` (P1/S8); no networking lives here.
//
//  States (every one renders — no hidden surface):
//    • loading  — initial fetch → skeleton tile that keeps the shape.
//    • empty    — no command bound (unsupported for the vehicle) → friendly
//                 "unavailable" tile, never a blank box.
//    • error    — parent query failure → retry affordance (web `QueryError` peer).
//    • data     — the full tile (icon / labels / status / favorite).
//    • stale / offline — the orthogonal `connection` axis → corner freshness chip,
//                 a one-shot auto-refresh on the stale transition, and a disabled
//                 tap while offline (a command is a remote actuation).
//

import SwiftUI

/// The vehicle-command input tile — the SwiftUI parity of
/// `features/system/components/InputCommandTile.tsx`. Renders every state from the
/// web source plus the P4 leaf freshness states, binding through
/// `InputCommandTileModel`.
public struct InputCommandTile: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = "InputCommandTile"

    @State private var model: InputCommandTileModel

    public init(model: InputCommandTileModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            InputCommandLoadingTile()
        case .empty:
            InputCommandUnavailableTile()
        case let .error(message):
            InputCommandErrorTile(message: message) { model.refresh() }
        case .data:
            if let def = model.resolved.def {
                InputCommandDataTile(
                    def: def,
                    state: model.resolved,
                    connection: model.connection,
                    onActivate: { model.requestDialog() },
                    onToggleFavorite: { model.toggleFavorite() }
                )
            }
        }
    }
}
