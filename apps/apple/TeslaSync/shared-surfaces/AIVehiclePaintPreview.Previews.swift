//
//  AIVehiclePaintPreview.Previews.swift
//  TeslaSync — P4 shared surface · 0058 · AIVehiclePaintPreview (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: PaintPreviewInput) -> PaintPreviewModel {
        let source = InMemoryPaintPreviewSource(initial: input)
        let model = PaintPreviewModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7
    private let sampleStyleHint = "studio"

    private let sampleProse = """
    Propose-only paint-color image prompt for the Model 3 Performance (current exterior: Pearl White \
    Multi-Coat): "A studio render of a Tesla Model 3 Performance finished in a deep midnight-blue \
    metallic with subtle violet flake, parked on a seamless light-grey cyclorama under soft top-down \
    key lighting, 35mm, photorealistic." Review the prompt, then use the Color setting below to apply \
    a new paint if you want to keep this direction. Nothing here changes the vehicle's saved color.
    """

    private func readyInput(
        stream: PaintPreviewStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        styleHint: String? = sampleStyleHint,
        connection: PaintPreviewConnection = .live
    ) -> PaintPreviewInput {
        PaintPreviewInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            styleHint: styleHint,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIVehiclePaintPreview(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(stream: PaintPreviewStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(stream: PaintPreviewStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(stream: PaintPreviewStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(stream: .idle, vehicleID: nil, styleHint: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIVehiclePaintPreview(model: previewModel(
            PaintPreviewInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIVehiclePaintPreview(model: previewModel(
            PaintPreviewInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(
                stream: PaintPreviewStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIVehiclePaintPreview(model: previewModel(
            readyInput(
                stream: PaintPreviewStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIVehiclePaintPreview(model: previewModel(
            PaintPreviewInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
