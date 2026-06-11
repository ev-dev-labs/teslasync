//
//  AISuggestNewGeofences.Previews.swift
//  TeslaSync — P4 shared surface · 0051 · AISuggestNewGeofences (Apple)
//
//  Xcode previews for each surface state (idle / current-label / streaming / proposal /
//  rejected proposal / stream-error / gate-loading / gate-error / stale / offline).
//  DEBUG-only; compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ input: SuggestGeofenceInput,
        configure: ((SuggestGeofenceModel, InMemorySuggestGeofenceSource) -> Void)? = nil
    ) -> SuggestGeofenceModel {
        let source = InMemorySuggestGeofenceSource(initial: input)
        let model = SuggestGeofenceModel(source: source, onApply: { _ in })
        model.start()
        configure?(model, source)
        return model
    }

    private let readyInput = SuggestGeofenceInput(gate: .on, locationID: 4242, currentName: "37.7749, -122.4194")

    #Preview("Idle / invite") {
        AISuggestNewGeofences(model: previewModel(readyInput))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Streaming") {
        AISuggestNewGeofences(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.streaming)
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (ok)") {
        AISuggestNewGeofences(model: previewModel(readyInput) { _, source in
            source.pushDraft(SuggestGeofenceDraft(
                locationID: 4242,
                vehicleID: 7,
                proposedName: "Ocean Beach Parking",
                radiusM: 85,
                centroidLat: 37.7594,
                centroidLon: -122.5107,
                status: "ok"
            ))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Proposal (rejected)") {
        AISuggestNewGeofences(model: previewModel(readyInput) { _, source in
            source.pushDraft(SuggestGeofenceDraft(
                locationID: 4242,
                vehicleID: 7,
                proposedName: "Home",
                radiusM: 12,
                centroidLat: 37.7749,
                centroidLon: -122.4194,
                status: "invalid",
                validationError: "Radius too small for a reliable geofence."
            ))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stream error") {
        AISuggestNewGeofences(model: previewModel(readyInput) { _, source in
            source.pushStreamState(.error("Helix is rate-limited. Try again in 30s."))
        })
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate loading") {
        AISuggestNewGeofences(model: previewModel(
            SuggestGeofenceInput(gate: .loading, locationID: 4242)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AISuggestNewGeofences(model: previewModel(
            SuggestGeofenceInput(gate: .loading, locationID: 4242, errorMessage: "Network request timed out")
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AISuggestNewGeofences(model: previewModel(
            SuggestGeofenceInput(gate: .on, locationID: 4242, currentName: "37.77, -122.41", connection: .stale)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AISuggestNewGeofences(model: previewModel(
            SuggestGeofenceInput(gate: .on, locationID: 4242, currentName: "37.77, -122.41", connection: .offline)
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
