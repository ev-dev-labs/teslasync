//
//  ResultPanel.Previews.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  Xcode previews for each surface state (content / loading / idle / error / stale /
//  offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: ResultPanelUpdate) -> ResultPanelModel {
        let source = InMemoryResultPanelSource(initial: update)
        let model = ResultPanelModel(source: source, initialTitle: update.input.title)
        model.start()
        return model
    }

    private let sampleJSON = """
    {"status":"ok","code":200,"vehicle":{"id":1,"name":"Model 3","battery_percent":87},"warnings":[]}
    """

    private func previewInput(_ title: String, _ outcome: ResultOutcome) -> ResultPanelInput {
        ResultPanelInput(title: title, outcome: outcome)
    }

    #Preview("Content") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .success(rawJSON: sampleJSON)),
            connection: .live,
            updatedAt: Date()
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .running)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Idle") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .idle(message: nil))
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Idle · custom message") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .idle(message: "Run the request to see a response."))
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .failure(message: "HTTP 500 — upstream timeout"))
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .success(rawJSON: sampleJSON)),
            connection: .stale,
            updatedAt: Date().addingTimeInterval(-180)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ResultPanelView(model: previewModel(ResultPanelUpdate(
            input: previewInput("Response", .success(rawJSON: sampleJSON)),
            connection: .offline,
            updatedAt: Date().addingTimeInterval(-900)
        )))
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
