//
//  AISoftwareUpdateChangelogSummarizer.Previews.swift
//  TeslaSync — P4 shared surface · 0048 · AISoftwareUpdateChangelogSummarizer (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SoftwareUpdateSummarizerInput) -> SoftwareUpdateSummarizerModel {
        let source = InMemorySoftwareUpdateSummarizerSource(initial: input)
        let model = SoftwareUpdateSummarizerModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicleID = 42

    private let sampleProse = """
    You are on 2024.20.7, installed 9 days ago. Over the past year your vehicle reported eight \
    over-the-air updates, landing roughly every six to seven weeks — a steady cadence with no long \
    gaps. The headline themes across the versions you installed were Autopilot visualization \
    refinements, Sentry Mode storage controls, and a charging-UI overhaul. This summary restates \
    only the deterministic update events your vehicle reported plus the public Tesla release notes \
    for the versions you actually installed; it does not claim features your build does not have.
    """

    private func readyInput(
        stream: SoftwareUpdateSummarizerStreamSnapshot,
        vehicleID: Int? = sampleVehicleID,
        connection: SoftwareUpdateSummarizerConnection = .live
    ) -> SoftwareUpdateSummarizerInput {
        SoftwareUpdateSummarizerInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            readyInput(stream: SoftwareUpdateSummarizerStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            readyInput(stream: SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            readyInput(stream: SoftwareUpdateSummarizerStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            SoftwareUpdateSummarizerInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            SoftwareUpdateSummarizerInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            readyInput(
                stream: SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            readyInput(
                stream: SoftwareUpdateSummarizerStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AISoftwareUpdateChangelogSummarizer(model: previewModel(
            SoftwareUpdateSummarizerInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
