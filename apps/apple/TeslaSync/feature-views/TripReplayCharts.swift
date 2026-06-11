//
//  TripReplayCharts.swift
//  TeslaSync — P4 feature view · 0273 · TripReplayCharts (Apple)
//
//  The composable "Speed & Power Timeline" trip-replay surface — the SwiftUI parity of
//  features/trips/components/TripReplayCharts.tsx. Renders inside a glass card fading in
//  on appear (web `ChartContainer`) and switches over the bound model's phase so every
//  prompt-required state renders (loading / empty / error / stale / offline / content) —
//  never a blank box. Binds through `TripReplayChartsModel` (P1/S8); no networking lives
//  here. Scrubbing / tapping the chart seeks the replay through the model's `onSeek`
//  callback (web `onSeekToIndex`).
//

import SwiftUI

/// The composable trip-replay speed & power timeline — the SwiftUI parity of the web
/// `TripReplayCharts`, binding through `TripReplayChartsModel` (P1/S8).
public struct TripReplayCharts: View {
    @State private var model: TripReplayChartsModel

    public init(model: TripReplayChartsModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        TSFadeIn(delay: 0.2) {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TripReplayChartsHeader(connection: model.connection)
                if model.connection != .live {
                    TripReplayChartsConnectivityBanner(connection: model.connection)
                }
                content
            }
            .padding(TSSpacing.lg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilitySummary))
    }

    /// The web `data.length > 0` overlay branch, widened to the full load envelope
    /// (loading / error / empty / content) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var content: some View {
        switch model.phase {
        case .loading:
            TripReplayChartsLoading()
        case let .error(message):
            TripReplayChartsError(message: message) { model.refresh() }
        case .empty:
            TripReplayChartsEmpty()
        case .content:
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                TripReplayTimelineChart(
                    samples: model.samples,
                    speedUnit: model.speedUnit,
                    currentPosition: model.currentIndex,
                    onScrub: { time in model.scrub(toTime: time) },
                    locale: model.displayLocale
                )
                TripReplayChartsLegend(speedUnit: model.speedUnit)
            }
        }
    }
}
