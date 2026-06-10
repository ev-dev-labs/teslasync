//
//  AIDriveCoaching.Previews.swift
//  TeslaSync — P4 shared surface · 0017 · AIDriveCoaching (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-drive,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: DriveCoachingInput) -> DriveCoachingModel {
        let source = InMemoryDriveCoachingSource(initial: input)
        let model = DriveCoachingModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleDriveID = "4821"

    private let sampleProse = """
    Solid drive — you averaged 244 Wh/mi, about 8% better than your trailing month on this route. \
    Regen did most of the work into the two downhill sections: you recovered ~1.6 kWh without \
    touching the friction brakes. The one place to tighten up is the 0–45 pull out of the highway \
    on-ramp near the 12-minute mark; easing that throttle ramp would shave a little of the spike \
    that shows up in the power trace. Nothing here changes the per-drive numbers above — this just \
    narrates them.
    """

    private func readyInput(
        stream: DriveCoachingStreamSnapshot,
        driveID: String? = sampleDriveID,
        connection: DriveCoachingConnection = .live
    ) -> DriveCoachingInput {
        DriveCoachingInput(
            availability: .resolved(enabled: true),
            driveID: driveID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIDriveCoaching(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIDriveCoaching(model: previewModel(
            readyInput(stream: DriveCoachingStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIDriveCoaching(model: previewModel(
            readyInput(stream: DriveCoachingStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIDriveCoaching(model: previewModel(
            readyInput(stream: DriveCoachingStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no drive") {
        AIDriveCoaching(model: previewModel(readyInput(stream: .idle, driveID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIDriveCoaching(model: previewModel(DriveCoachingInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIDriveCoaching(model: previewModel(
            DriveCoachingInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIDriveCoaching(model: previewModel(
            readyInput(stream: DriveCoachingStreamSnapshot(state: .done, text: sampleProse), connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIDriveCoaching(model: previewModel(
            readyInput(stream: DriveCoachingStreamSnapshot(state: .done, text: sampleProse), connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIDriveCoaching(model: previewModel(
            DriveCoachingInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
