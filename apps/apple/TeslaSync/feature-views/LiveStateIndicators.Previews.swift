//
//  LiveStateIndicators.Previews.swift
//  TeslaSync — P4 feature view · 0292 · LiveStateIndicators (Apple)
//
//  Xcode previews for each surface state (data / data-imperial / empty / loading /
//  error / stale / offline). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum LiveStateIndicatorsPreviewData {
        /// A moving, secured reading: 22.352 m/s (50 mph / 80 km/h), locked, Sentry
        /// armed, climate on, charging — exercising the success / warning / info tones.
        static let active = LiveStateReading(
            speedMetersPerSecond: 22.352,
            isLocked: true,
            sentryMode: true,
            isClimateOn: true,
            isCharging: true
        )

        /// A parked, resting reading: stopped, unlocked, Sentry off, climate off, not
        /// charging — exercising the neutral / danger tones.
        static let resting = LiveStateReading(
            speedMetersPerSecond: 0,
            isLocked: false,
            sentryMode: false,
            isClimateOn: false,
            isCharging: false
        )
    }

    @MainActor
    private func liveStateIndicatorsPreviewModel(_ input: LiveStateIndicatorsInput) -> LiveStateIndicatorsModel {
        let source = InMemoryLiveStateIndicatorsSource(initial: input)
        let model = LiveStateIndicatorsModel(source: source)
        model.start()
        return model
    }

    #Preview("Data — active") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(
            LiveStateIndicatorsInput(reading: LiveStateIndicatorsPreviewData.active)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Data — resting (imperial)") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(
            LiveStateIndicatorsInput(reading: LiveStateIndicatorsPreviewData.resting, units: .imperial)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(LiveStateIndicatorsInput(reading: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(LiveStateIndicatorsInput(isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(
            LiveStateIndicatorsInput(errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(
            LiveStateIndicatorsInput(reading: LiveStateIndicatorsPreviewData.active, connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        LiveStateIndicators(model: liveStateIndicatorsPreviewModel(
            LiveStateIndicatorsInput(reading: LiveStateIndicatorsPreviewData.active, connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
