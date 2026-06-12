//
//  SignalQueryControls.Previews.swift
//  TeslaSync — P4 shared surface · 0195 · SignalQueryControls (Apple)
//
//  Xcode previews for each surface state (idle / selection / available-loading / available-error /
//  no-signals / results / results-empty / results-loading / stale / offline). DEBUG-only; compiled by
//  the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        available: SignalQueryAvailableSnapshot,
        result: SignalQueryResultSnapshot? = nil,
        selected: [String] = [],
        maxSignals: Int? = nil
    ) -> SignalQueryControlsModel {
        let source = InMemorySignalQueryControlsSource(available: available, result: result)
        let model = SignalQueryControlsModel(
            vehicleID: 42, source: source, selected: selected, maxSignals: maxSignals
        )
        model.start()
        return model
    }

    private let sampleSignals = [
        "VehicleSpeed", "Soc", "InsideTemp", "Odometer", "ChargeState", "Gear", "Locked"
    ]

    private let sampleRows: [SignalLogEntry] = [
        SignalLogEntry(createdAt: "2026-05-13T01:04:51.177284Z", signal: "Odometer", valueNum: 43_343_694.999),
        SignalLogEntry(createdAt: "2026-05-13T01:05:40.191573Z", signal: "Gear", valueStr: "Drive"),
        SignalLogEntry(createdAt: "2026-05-13T01:06:12.004112Z", signal: "Locked", valueBool: true),
        SignalLogEntry(createdAt: "2026-05-13T01:07:02.500000Z", signal: "ChargeState", valueStr: "CHARGING")
    ]

    private func resultSnapshot(rows: [SignalLogEntry], total: Int, totalPages: Int) -> SignalQueryResultSnapshot {
        SignalQueryResultSnapshot(
            loading: false,
            rows: rows,
            pagination: SignalHistoryPagination(page: 1, perPage: 50, total: total, totalPages: totalPages)
        )
    }

    #Preview("Idle / loaded signals") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loaded, signals: sampleSignals)
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("With selection + results") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loaded, signals: sampleSignals),
                result: resultSnapshot(rows: sampleRows, total: 128, totalPages: 3),
                selected: ["Odometer", "Gear"]
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Available loading") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loading)
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Available error") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .error("Network request timed out"))
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("No signals") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loaded, signals: [])
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Results loading") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loaded, signals: sampleSignals),
                result: SignalQueryResultSnapshot(loading: true),
                selected: ["Odometer"]
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Results empty") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(state: .loaded, signals: sampleSignals),
                result: resultSnapshot(rows: [], total: 0, totalPages: 0),
                selected: ["Odometer"]
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(
                    state: .loaded, signals: sampleSignals, connection: .stale
                ),
                selected: ["Odometer"]
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        ScrollView {
            SignalQueryControls(model: previewModel(
                available: SignalQueryAvailableSnapshot(
                    state: .loaded, signals: sampleSignals, connection: .offline
                ),
                selected: ["Odometer"]
            ))
            .padding()
        }
        .background(Color.TS.bg)
    }
#endif
