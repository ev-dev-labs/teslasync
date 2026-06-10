//
//  SignalSelector.Previews.swift
//  TeslaSync — P4 feature view · 0270 · SignalSelector (Apple)
//
//  Xcode previews for each surface state (content capped-with-help, content
//  uncapped, content with an override label, loading, empty, error, stale,
//  offline) so the always-present label + field and the layered candidate-list
//  chrome are exercised. DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SignalSelectorPreviewData {
        static let signals = [
            "VehicleSpeed",
            "BatteryLevel",
            "ChargeState",
            "OutsideTemp",
            "InsideTemp",
            "Odometer",
            "TpmsPressureFrontLeft",
            "EstBatteryRange"
        ]
    }

    @MainActor
    private func previewModel(
        _ update: SignalSelectorUpdate,
        max: Int? = 5,
        showsLayerHelp: Bool = true,
        labelOverride: String? = nil,
        initialSelection: [String] = []
    ) -> SignalSelectorModel {
        let source = InMemorySignalSelectorSource(initial: update)
        let model = SignalSelectorModel(
            source: source,
            max: max,
            showsLayerHelp: showsLayerHelp,
            labelOverride: labelOverride,
            initialSelection: initialSelection
        )
        model.start()
        return model
    }

    private func loadedUpdate(_ connection: SignalSelectorConnection = .live) -> SignalSelectorUpdate {
        SignalSelectorUpdate(
            status: .loaded,
            connection: connection,
            availableSignals: SignalSelectorPreviewData.signals,
            updatedAt: Date()
        )
    }

    #Preview("Content (capped, with help)") {
        SignalSelector(
            model: previewModel(
                loadedUpdate(),
                initialSelection: ["VehicleSpeed", "BatteryLevel"]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (uncapped)") {
        SignalSelector(
            model: previewModel(
                loadedUpdate(),
                max: nil,
                initialSelection: ["VehicleSpeed", "BatteryLevel", "ChargeState"]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (override label, no help)") {
        SignalSelector(
            model: previewModel(
                loadedUpdate(),
                showsLayerHelp: false,
                labelOverride: "Compare signals",
                initialSelection: ["Odometer"]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SignalSelector(
            model: previewModel(SignalSelectorUpdate(status: .loading))
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty (no signals)") {
        SignalSelector(
            model: previewModel(
                SignalSelectorUpdate(status: .loaded, connection: .live, availableSignals: [], updatedAt: Date())
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalSelector(
            model: previewModel(
                SignalSelectorUpdate(status: .failed("The signals endpoint timed out"))
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SignalSelector(
            model: previewModel(
                loadedUpdate(.stale),
                initialSelection: ["VehicleSpeed"]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SignalSelector(
            model: previewModel(
                loadedUpdate(.offline),
                initialSelection: ["VehicleSpeed", "BatteryLevel"]
            )
        )
        .frame(width: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
