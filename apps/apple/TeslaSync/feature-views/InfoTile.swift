//
//  InfoTile.swift
//  TeslaSync — P4 feature view · 0280 · InfoTile (Apple)
//
//  The composable InfoTile surface — the SwiftUI parity of
//  features/vehicles/components/telemetry-panels/InfoTile.tsx. A labelled glass tile
//  that shows a single telemetry value: a leading icon + muted label, the value (tinted
//  by the semantic `color`), and an optional sub line. It is a pure presentational leaf
//  (the web component fetches nothing), so it renders every branch the source has — the
//  value-type projection (boolean → "Yes"/"No", otherwise verbatim), a graceful
//  em-dash for blank values so the tile is never blank, the optional sub, and the value
//  tint — and emits the P1/S11 `view.opened` on appear. No networking lives here.
//

import SwiftUI

/// The composable InfoTile surface. Binds through `InfoTileModel`, renders the tile,
/// and emits the P1/S11 `view.opened` event on appear.
public struct InfoTile: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        InfoTileSurface.slug
    }

    @State private var model: InfoTileModel

    /// Binds an explicitly constructed model (previews/tests inject an in-memory
    /// telemetry spy; production uses the default).
    public init(model: InfoTileModel) {
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the presentational inputs (web props
    /// `icon` / `label` / `value` / `color` / `sub`).
    public init(
        systemImage: String,
        label: String,
        value: InfoTileValue,
        valueColor: InfoTileValueColor = .primary,
        sub: String? = nil,
        telemetry: any InfoTileTelemetry = OSLogInfoTileTelemetry()
    ) {
        _model = State(
            initialValue: InfoTileModel(
                systemImage: systemImage,
                label: label,
                value: value,
                valueColor: valueColor,
                sub: sub,
                telemetry: telemetry
            )
        )
    }

    public var body: some View {
        InfoTilePanel(model: model)
            .onAppear { model.start() }
    }
}
