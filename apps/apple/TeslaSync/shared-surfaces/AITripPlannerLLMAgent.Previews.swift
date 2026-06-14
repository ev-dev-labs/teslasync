//
//  AITripPlannerLLMAgent.Previews.swift
//  TeslaSync — P4 shared surface · 0055 · AITripPlannerLLMAgent (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error /
//  missing-inputs, loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app
//  targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: TripPlannerAgentInput) -> TripPlannerAgentModel {
        let source = InMemoryTripPlannerAgentSource(initial: input)
        let model = TripPlannerAgentModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicle = 7
    private let sampleOrigin = TripPlannerAgentLocation(lat: 37.7749, lng: -122.4194, name: "San Francisco")
    private let sampleDestination = TripPlannerAgentLocation(lat: 34.0522, lng: -118.2437, name: "Los Angeles")

    private let sampleProse = """
    Proposed corridor plan: San Francisco → Los Angeles, ~615 km. Two charging stops keep you above \
    your 20% arrival floor: Harris Ranch (Supercharger, ~18 min to 72%) and Tejon Ranch (~12 min to \
    64%), both chosen because your history shows reliable 250 kW sessions there. Departing at 80% and \
    holding the 1.0× speed factor, the plan arrives with ~24% to spare. Nothing is saved yet — review \
    the proposed plan and tap Plan in the form below to save it, or adjust the endpoints and re-draft.
    """

    private func readyInput(
        stream: TripPlannerAgentStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        origin: TripPlannerAgentLocation? = sampleOrigin,
        destination: TripPlannerAgentLocation? = sampleDestination,
        connection: TripPlannerAgentConnection = .live
    ) -> TripPlannerAgentInput {
        TripPlannerAgentInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            origin: origin,
            destination: destination,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AITripPlannerLLMAgent(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(stream: TripPlannerAgentStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(stream: TripPlannerAgentStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(stream: TripPlannerAgentStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · missing inputs") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(stream: .idle, origin: nil, destination: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AITripPlannerLLMAgent(model: previewModel(
            TripPlannerAgentInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AITripPlannerLLMAgent(model: previewModel(
            TripPlannerAgentInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(
                stream: TripPlannerAgentStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AITripPlannerLLMAgent(model: previewModel(
            readyInput(
                stream: TripPlannerAgentStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AITripPlannerLLMAgent(model: previewModel(
            TripPlannerAgentInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
