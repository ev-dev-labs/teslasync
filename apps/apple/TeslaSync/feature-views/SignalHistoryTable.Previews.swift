//
//  SignalHistoryTable.Previews.swift
//  TeslaSync — P4 feature view · 0269 · SignalHistoryTable (Apple)
//
//  Xcode previews for each surface state (loading / data / empty / error / stale /
//  offline). DEBUG-only; compiled by the app targets and skipped by the shipped-surface
//  gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ input: SignalHistoryInput) -> SignalHistoryModel {
        let source = InMemorySignalHistorySource(initial: input)
        let model = SignalHistoryModel(source: source)
        model.start()
        return model
    }

    private let previewSelectedSignals = ["VehicleSpeed", "BatteryLevel", "ChargeState"]

    private let previewRows: [SignalLogInput] = [
        SignalLogInput(
            createdAt: "2026-01-05T15:04:05Z",
            signal: "VehicleSpeed",
            valueNum: 62.5
        ),
        SignalLogInput(
            createdAt: "2026-01-05T15:04:04Z",
            signal: "BatteryLevel",
            valueNum: 78
        ),
        SignalLogInput(
            createdAt: "2026-01-05T15:04:03Z",
            signal: "ChargeState",
            valueStr: "Charging"
        ),
        SignalLogInput(
            createdAt: "2026-01-05T15:04:02Z",
            signal: "SentryMode",
            valueBool: true
        ),
        SignalLogInput(
            createdAt: "2026-01-05T15:04:01Z",
            signal: "UnknownSignal",
            valueNum: nil,
            valueStr: nil,
            valueBool: nil
        )
    ]

    private func dataInput(connection: SignalHistoryConnection = .live) -> SignalHistoryInput {
        SignalHistoryInput(
            rows: previewRows,
            selectedSignals: previewSelectedSignals,
            page: 2,
            pageSize: 25,
            totalRows: 1342,
            connection: connection
        )
    }

    #Preview("Loading") {
        SignalHistoryTable(model: previewModel(SignalHistoryInput(isLoading: true)))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Data") {
        SignalHistoryTable(model: previewModel(dataInput()))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SignalHistoryTable(model: previewModel(
            SignalHistoryInput(selectedSignals: previewSelectedSignals, totalRows: 0)
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalHistoryTable(model: previewModel(
            SignalHistoryInput(errorMessage: "Tesla API returned 503 Service Unavailable")
        ))
        .frame(maxWidth: 560)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SignalHistoryTable(model: previewModel(dataInput(connection: .stale)))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        SignalHistoryTable(model: previewModel(dataInput(connection: .offline)))
            .frame(maxWidth: 560)
            .padding()
            .background(Color.TS.bg)
    }
#endif
