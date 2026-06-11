//
//  FreshnessIndicator.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  The freshness indicator — the SwiftUI parity of `components/data-display/FreshnessIndicator.tsx`.
//  Renders the age of a SPECIFIC datum as a small coloured dot plus an optional relative-time label,
//  binding through `FreshnessIndicatorModel` (P1/S8); no networking lives in the view. Every state
//  renders (no hidden surface): loading skeleton chrome, an unavailable retry chip, and the resolved
//  readout — fresh (pulsing green), stale (amber), offline (red), and the unknown/empty "—". A
//  periodic task re-derives the relative label every 10s (the web `setInterval` re-render).
//
//  NOT to be confused with the live-pipe indicator (`TSLiveIndicator`): this surface reflects how
//  recently one datum was sampled, regardless of transport health — the same distinction the web
//  source documents between `<FreshnessIndicator>` and `<LiveIndicator>`.
//

import Combine
import SwiftUI

// MARK: - FreshnessIndicator (the shared surface)

/// The freshness indicator — the SwiftUI parity of `components/data-display/FreshnessIndicator.tsx`.
/// Renders every state, binding through `FreshnessIndicatorModel` and re-deriving the relative-time
/// label on a 10s cadence.
public struct FreshnessIndicator: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = FreshnessIndicatorMeta.surfaceSlug

    @State private var model: FreshnessIndicatorModel

    /// The web component re-renders every 10s (a `setInterval`) so the relative label ("12s ago") stays
    /// current. The native parity ticks the model off a main-run-loop timer; `.onReceive`'s action is a
    /// main-actor, non-`@Sendable` closure, so it can call the `@MainActor` model directly (unlike a
    /// `.task` loop, whose `@Sendable` body cannot cross into the actor under strict concurrency). The
    /// publisher only fires while the view is subscribed.
    private let ticker = Timer
        .publish(every: FreshnessIndicatorMeta.tickIntervalSeconds, on: .main, in: .common)
        .autoconnect()

    public init(model: FreshnessIndicatorModel) {
        _model = State(initialValue: model)
    }

    /// Convenience initializer wiring the production timestamp-backed source — the parity of mounting
    /// `<FreshnessIndicator timestamp={…} />`. `input` is the host's current datum snapshot (the web
    /// `timestamp` prop + its fetch lifecycle); `config` carries the web non-data props (thresholds,
    /// `showLabel`, `size`).
    public init(input: FreshnessInput, config: FreshnessConfig = .default) {
        _model = State(initialValue: FreshnessIndicatorModel(
            source: LiveFreshnessIndicatorSource(input: input),
            config: config
        ))
    }

    public var body: some View {
        content
            .onAppear { model.start() }
            .onDisappear { model.stop() }
            .onReceive(ticker) { _ in model.tick() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            FreshnessLoadingChip(size: model.config.size)
        case .unavailable:
            FreshnessUnavailableChip { model.refresh() }
        case let .ready(readout):
            FreshnessReadyView(
                readout: readout,
                showLabel: model.config.showLabel,
                size: model.config.size
            )
        }
    }
}
