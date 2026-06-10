//
//  AIStateMachineDebuggerNarrator.Previews.swift
//  TeslaSync — P4 shared surface · 0050 · AIStateMachineDebuggerNarrator (Apple)
//
//  Xcode previews for each surface state (ready · idle / thinking / prose / stream-error / no-scope,
//  loading, gate error, stale, offline, gated). DEBUG-only; compiled by the app targets and skipped
//  by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: FSMNarratorInput) -> FSMNarratorModel {
        let source = InMemoryFSMNarratorSource(initial: input)
        let model = FSMNarratorModel(source: source, locale: Locale(identifier: "en_US"))
        model.start()
        return model
    }

    // A valid in-scope triple: a positive vehicle plus a 30-minute span of Unix seconds.
    private let sampleVehicle = 7
    private let sampleFromUnix = 1_717_000_000
    private let sampleToUnix = 1_717_001_800

    private let sampleProse = """
    Vehicle 7's FSM trace over the window is stable: 18 transitions across the drive, charge, and \
    park machines with zero flaps. The drive machine moved offline → online → driving once and \
    settled back to parked; the charge machine logged a single disconnected → charging → complete \
    cycle. The most-traversed edge was park→drive (4 times). Nothing in this window indicates a \
    reconciliation conflict — these are descriptive counts of the same transitions the table above \
    shows, not a root-cause claim.
    """

    private func readyInput(
        stream: FSMNarratorStreamSnapshot,
        vehicleID: Int? = sampleVehicle,
        fromUnix: Int? = sampleFromUnix,
        toUnix: Int? = sampleToUnix,
        connection: FSMNarratorConnection = .live
    ) -> FSMNarratorInput {
        FSMNarratorInput(
            availability: .resolved(enabled: true),
            vehicleID: vehicleID,
            fromUnix: fromUnix,
            toUnix: toUnix,
            connection: connection,
            stream: stream
        )
    }

    #Preview("Ready · idle") {
        AIStateMachineDebuggerNarrator(model: previewModel(readyInput(stream: .idle)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Ready · thinking") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(stream: FSMNarratorStreamSnapshot(state: .streaming, text: ""))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · prose") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(stream: FSMNarratorStreamSnapshot(state: .done, text: sampleProse))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · stream error") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(stream: FSMNarratorStreamSnapshot(state: .error, text: "", error: "stream_http_429"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Ready · no scope") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(stream: .idle, vehicleID: nil, fromUnix: nil, toUnix: nil)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            FSMNarratorInput(availability: .loading)
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gate error") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            FSMNarratorInput(availability: .failed("Network request timed out"))
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(
                stream: FSMNarratorStreamSnapshot(state: .done, text: sampleProse),
                connection: .stale
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            readyInput(
                stream: FSMNarratorStreamSnapshot(state: .done, text: sampleProse),
                connection: .offline
            )
        ))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Gated · AI off") {
        AIStateMachineDebuggerNarrator(model: previewModel(
            FSMNarratorInput(availability: .resolved(enabled: false))
        ))
        .padding()
        .background(Color.TS.bg)
    }
#endif
