//
//  SourceLayerBadge.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  The source-layer badge — the SwiftUI parity of `components/data-display/SourceLayerBadge.tsx`.
//  Renders the provenance of a signal value as a tiny tinted glyph plus a tooltip, binding through
//  `SourceLayerBadgeModel` (P1/S8); no networking lives in the view. Every state renders (no hidden
//  surface): the loading skeleton chip, the unavailable retry chip, and the resolved badge — the
//  l1 / l2 / log / stale / unknown layers (the unknown "—" glyph is the empty readout, never a blank
//  box), with the offline marker decorating the cached badge when the snapshot is offline.
//

import SwiftUI

// MARK: - SourceLayerBadge (the shared surface)

/// The source-layer badge — the SwiftUI parity of `components/data-display/SourceLayerBadge.tsx`.
/// Renders every state, binding through `SourceLayerBadgeModel`.
public struct SourceLayerBadge: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = SourceLayerBadgeMeta.surfaceSlug

    @State private var model: SourceLayerBadgeModel

    public init(model: SourceLayerBadgeModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production source-backed feed — the parity of mounting
    /// `<SourceLayerBadge source={…} ageMs={…} />`. `input` is the host's current snapshot (the web
    /// `source` / `ageMs` props + the fetch lifecycle + connectivity); `config` carries the web
    /// non-data props (`showLabel`).
    public init(input: SourceLayerBadgeInput, config: SourceLayerBadgeConfig = .default) {
        _model = State(initialValue: SourceLayerBadgeModel(
            source: LiveSourceLayerBadgeSource(input: input),
            config: config
        ))
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
            SourceLayerBadgeLoadingChip(showLabel: model.config.showLabel)
        case .unavailable:
            SourceLayerBadgeUnavailableChip { model.refresh() }
        case let .ready(readout):
            SourceLayerBadgeReadyView(
                readout: readout,
                showLabel: model.config.showLabel,
                offline: model.offline
            )
        }
    }
}
