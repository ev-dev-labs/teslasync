//
//  ScoreBadge.swift
//  TeslaSync — P4 shared surface · 0103 · ScoreBadge (Apple)
//
//  The score badge — the SwiftUI parity of `components/data-display/ScoreBadge.tsx`. Renders a
//  letter-grade glyph (A+ / A / B / C / D / F / —) tinted by the shared grade palette, binding through
//  `ScoreBadgeModel` (P1/S8); no networking lives in the view. Every state renders (no hidden
//  surface): the loading skeleton, the unavailable retry chip, and the resolved grade glyph — where
//  the ``ScoreBadgeGrade/unrated`` "—" glyph is the empty readout (never a blank box), with the stale
//  and offline markers decorating the cached glyph when the snapshot is past freshness / offline.
//

import SwiftUI

// MARK: - ScoreBadge (the shared surface)

/// The score badge — the SwiftUI parity of `components/data-display/ScoreBadge.tsx`. Renders every
/// state, binding through `ScoreBadgeModel`.
public struct ScoreBadge: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ScoreBadgeMeta.surfaceSlug

    @State private var model: ScoreBadgeModel

    public init(model: ScoreBadgeModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production score-backed feed — the parity of mounting
    /// `<ScoreBadge score={…} />` / `<ScoreBadge grade="B" />`. `input` is the host's current snapshot
    /// (the web `score` / `grade` props + the fetch lifecycle + freshness + connectivity); `config`
    /// carries the web non-data props (`size`, `ariaLabel`).
    public init(input: ScoreBadgeInput, config: ScoreBadgeConfig = .default) {
        _model = State(initialValue: ScoreBadgeModel(
            source: LiveScoreBadgeSource(input: input),
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
            ScoreBadgeLoadingSkeleton(size: model.config.size)
        case .unavailable:
            ScoreBadgeUnavailableChip { model.refresh() }
        case let .ready(readout):
            ScoreBadgeReadyView(
                readout: readout,
                stale: model.stale,
                offline: model.offline
            )
        }
    }
}
