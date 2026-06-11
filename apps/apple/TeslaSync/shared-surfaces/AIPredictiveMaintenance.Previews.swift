//
//  AIPredictiveMaintenance.Previews.swift
//  TeslaSync — P4 shared surface · 0039 · AIPredictiveMaintenance (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  no-vehicle, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets
//  and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: PredictiveMaintenanceInput) -> PredictiveMaintenanceModel {
        let source = InMemoryPredictiveMaintenanceSource(initial: input)
        let model = PredictiveMaintenanceModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7

    private let sampleProse = """
    No urgent maintenance is predicted in the next service window. Tire rotation is the nearest \
    scheduled item, due in roughly 1,800 km based on the current odometer trend, and the cabin air \
    filter is approaching its 2-year interval. Brake-pad wear is well within range — regenerative \
    braking has kept friction use low. The 12V auxiliary battery is over four years old, so a \
    proactive check is worth scheduling at the next visit. None of this changes the deterministic \
    reminders and status badges above; this is an informational summary of upcoming risks.
    """

    private func readyInput(
        stream: PredictiveMaintenanceStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        connection: PredictiveMaintenanceConnection = .live
    ) -> PredictiveMaintenanceInput {
        PredictiveMaintenanceInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIPredictiveMaintenance(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIPredictiveMaintenance(model: previewModel(
            readyInput(stream: PredictiveMaintenanceStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIPredictiveMaintenance(model: previewModel(
            readyInput(stream: PredictiveMaintenanceStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIPredictiveMaintenance(model: previewModel(
            readyInput(stream: PredictiveMaintenanceStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIPredictiveMaintenance(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIPredictiveMaintenance(model: previewModel(PredictiveMaintenanceInput(availability: .loading)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIPredictiveMaintenance(model: previewModel(
            PredictiveMaintenanceInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIPredictiveMaintenance(model: previewModel(
            readyInput(
                stream: PredictiveMaintenanceStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIPredictiveMaintenance(model: previewModel(
            readyInput(
                stream: PredictiveMaintenanceStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIPredictiveMaintenance(model: previewModel(
            PredictiveMaintenanceInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
