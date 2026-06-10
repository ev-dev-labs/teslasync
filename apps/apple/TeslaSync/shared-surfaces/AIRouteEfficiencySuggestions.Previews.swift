//
//  AIRouteEfficiencySuggestions.Previews.swift
//  TeslaSync — P4 shared surface · 0044 · AIRouteEfficiencySuggestions (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-vehicle,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: RouteEfficiencySuggestionsInput) -> RouteEfficiencySuggestionsModel {
        let source = InMemoryRouteEfficiencySuggestionsSource(initial: input)
        let model = RouteEfficiencySuggestionsModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    private let sampleVehicleID = "7"

    private let sampleProse = """
    Your dominant route — the daily commute on US-101 — runs about 268 Wh/mi (≈166 kWh/100mi), \
    roughly 11% thirstier than your weekend hill loop at 241 Wh/mi. Most of that gap is steady \
    70-mph cruising, where aero load dominates: two short, non-mutating ideas to try yourself are \
    setting cruise a touch lower on the flat middle section, and pre-conditioning while still \
    plugged in so the first few miles don't spend pack energy warming the cabin. Nothing here \
    changes your stored routes — it just reads the figures already shown above.
    """

    private func readyInput(
        stream: RouteEfficiencySuggestionsStreamSnapshot,
        vehicleID: String? = sampleVehicleID,
        connection: RouteEfficiencySuggestionsConnection = .live
    ) -> RouteEfficiencySuggestionsInput {
        RouteEfficiencySuggestionsInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIRouteEfficiencySuggestions(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIRouteEfficiencySuggestions(model: previewModel(
            readyInput(stream: RouteEfficiencySuggestionsStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIRouteEfficiencySuggestions(model: previewModel(
            readyInput(stream: RouteEfficiencySuggestionsStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIRouteEfficiencySuggestions(model: previewModel(
            readyInput(stream: RouteEfficiencySuggestionsStreamSnapshot(
                state: .error,
                text: "",
                error: "stream_http_429"
            ))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no vehicle") {
        AIRouteEfficiencySuggestions(model: previewModel(readyInput(stream: .idle, vehicleID: nil)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIRouteEfficiencySuggestions(model: previewModel(
            RouteEfficiencySuggestionsInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIRouteEfficiencySuggestions(model: previewModel(
            RouteEfficiencySuggestionsInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIRouteEfficiencySuggestions(model: previewModel(
            readyInput(
                stream: RouteEfficiencySuggestionsStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIRouteEfficiencySuggestions(model: previewModel(
            readyInput(
                stream: RouteEfficiencySuggestionsStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIRouteEfficiencySuggestions(model: previewModel(
            RouteEfficiencySuggestionsInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
