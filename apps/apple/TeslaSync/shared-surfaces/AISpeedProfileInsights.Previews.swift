//
//  AISpeedProfileInsights.Previews.swift
//  TeslaSync — P4 shared surface · 0049 · AISpeedProfileInsights (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-drive,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SpeedProfileInsightsInput) -> SpeedProfileInsightsModel {
        let source = InMemorySpeedProfileInsightsSource(initial: input)
        let model = SpeedProfileInsightsModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleDriveID = "7"

    private let sampleProse = """
    This drive skews highway-heavy: about 62% of the distance sat in the 55-75 mph band, with a \
    secondary suburban cluster near 35-45 mph (27%) and a thin city tail below 25 mph (8%). The \
    speed envelope is tighter than your typical drive — fewer hard accel/decel outliers — though \
    two brief spikes near 80 mph stand out against your usual ceiling. Overall it reads as a \
    steady highway run with light stop-and-go at each end, in line with the per-drive aggregates \
    charted above.
    """

    private func readyInput(
        stream: SpeedProfileInsightsStreamSnapshot,
        driveID: String? = sampleDriveID,
        connection: SpeedProfileInsightsConnection = .live
    ) -> SpeedProfileInsightsInput {
        SpeedProfileInsightsInput(
            availability: .resolved(enabled: true),
            driveID: driveID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AISpeedProfileInsights(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AISpeedProfileInsights(model: previewModel(
            readyInput(stream: SpeedProfileInsightsStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AISpeedProfileInsights(model: previewModel(
            readyInput(stream: SpeedProfileInsightsStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AISpeedProfileInsights(model: previewModel(
            readyInput(stream: SpeedProfileInsightsStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no drive") {
        AISpeedProfileInsights(model: previewModel(readyInput(stream: .idle, driveID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AISpeedProfileInsights(model: previewModel(
            SpeedProfileInsightsInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISpeedProfileInsights(model: previewModel(
            SpeedProfileInsightsInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISpeedProfileInsights(model: previewModel(
            readyInput(
                stream: SpeedProfileInsightsStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISpeedProfileInsights(model: previewModel(
            readyInput(
                stream: SpeedProfileInsightsStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AISpeedProfileInsights(model: previewModel(
            SpeedProfileInsightsInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
