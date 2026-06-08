//
//  LiveSignalsTable.Previews.swift
//  TeslaSync — P4 feature view · 0036 · LiveSignalsTable (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: LiveSignalsTableUpdate) -> LiveSignalsTableModel {
        let source = InMemoryLiveSignalsTableSource(initial: update)
        let model = LiveSignalsTableModel(source: source)
        model.start()
        return model
    }

    private func previewISO(_ secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }

    private func previewEntries() -> [LiveSignalEntry] {
        [
            LiveSignalEntry(name: "vehicle_speed", payload: .envelope(value: .number(42), timestamp: previewISO(3))),
            LiveSignalEntry(
                name: "battery_level",
                payload: .envelope(value: .number(78.5), timestamp: previewISO(11))
            ),
            LiveSignalEntry(
                name: "charging_state",
                payload: .envelope(value: .string("Charging"), timestamp: previewISO(28))
            ),
            LiveSignalEntry(name: "locked", payload: .bare(.bool(true))),
            LiveSignalEntry(
                name: "est_battery_range",
                payload: .envelope(value: .compound("{\"km\":312,\"mi\":194}"), timestamp: previewISO(64))
            ),
            LiveSignalEntry(
                name: "tpms_pressure_fl",
                payload: .envelope(value: .null, timestamp: previewISO(6))
            )
        ]
    }

    private func previewContainer(_ model: LiveSignalsTableModel) -> some View {
        LiveSignalsTable(model: model)
            .padding(TSSpacing.lg)
            .frame(width: 480, height: 420, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewContainer(previewModel(
            LiveSignalsTableUpdate(status: .loaded, entries: previewEntries(), updatedAt: Date())
        ))
    }

    #Preview("Loading") {
        previewContainer(previewModel(LiveSignalsTableUpdate(status: .loading)))
    }

    #Preview("Empty") {
        previewContainer(previewModel(LiveSignalsTableUpdate(status: .loaded)))
    }

    #Preview("Error") {
        previewContainer(previewModel(LiveSignalsTableUpdate(status: .failed("Network unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            LiveSignalsTableUpdate(
                status: .loaded,
                connection: .stale,
                entries: previewEntries(),
                updatedAt: Date().addingTimeInterval(-120)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            LiveSignalsTableUpdate(
                status: .loaded,
                connection: .offline,
                entries: previewEntries(),
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }
#endif
