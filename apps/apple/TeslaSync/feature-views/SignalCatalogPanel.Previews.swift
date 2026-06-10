//
//  SignalCatalogPanel.Previews.swift
//  TeslaSync — P4 feature view · 0264 · SignalCatalogPanel (Apple)
//
//  Xcode previews for each surface state (content / loading / empty / error /
//  stale / offline / selection). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(
        _ update: SignalCatalogPanelUpdate,
        selection: SignalCatalogPanelSelectionConfig? = nil
    ) -> SignalCatalogPanelModel {
        let source = InMemorySignalCatalogPanelSource(initial: update)
        let model = SignalCatalogPanelModel(source: source, selection: selection)
        model.start()
        return model
    }

    private func previewISO(_ secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }

    private func previewEntries() -> [SignalCatalogPanelEntry] {
        [
            SignalCatalogPanelEntry(
                name: "vehicle_speed",
                payload: .envelope(value: .number(42), timestamp: previewISO(3))
            ),
            SignalCatalogPanelEntry(
                name: "battery_level",
                payload: .envelope(value: .number(78.5), timestamp: previewISO(45))
            ),
            SignalCatalogPanelEntry(
                name: "charging_state",
                payload: .envelope(value: .string("Charging"), timestamp: previewISO(12))
            ),
            SignalCatalogPanelEntry(
                name: "est_battery_range",
                payload: .envelope(value: .number(312), timestamp: previewISO(600))
            ),
            SignalCatalogPanelEntry(
                name: "outside_temp",
                payload: .envelope(value: .number(-3.5), timestamp: previewISO(120))
            ),
            SignalCatalogPanelEntry(name: "tpms_fl", payload: .envelope(value: .null, timestamp: previewISO(8))),
            SignalCatalogPanelEntry(name: "locked", payload: .bare(.bool(true))),
            SignalCatalogPanelEntry(name: "odometer", payload: .bare(.number(45120)))
        ]
    }

    @MainActor
    private func previewContainer(_ model: SignalCatalogPanelModel, title: String? = "Signal Catalog") -> some View {
        ScrollView {
            SignalCatalogPanel(model: model, title: title)
                .padding(TSSpacing.lg)
        }
        .frame(width: 640, height: 640)
        .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewContainer(previewModel(
            SignalCatalogPanelUpdate(status: .loaded, entries: previewEntries(), updatedAt: Date())
        ))
    }

    #Preview("Loading") {
        previewContainer(previewModel(SignalCatalogPanelUpdate(status: .loading)))
    }

    #Preview("Empty (no data)") {
        previewContainer(previewModel(SignalCatalogPanelUpdate(status: .loaded)))
    }

    #Preview("Error") {
        previewContainer(previewModel(SignalCatalogPanelUpdate(status: .failed("Network unavailable"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            SignalCatalogPanelUpdate(
                status: .loaded,
                connection: .stale,
                entries: previewEntries(),
                updatedAt: Date().addingTimeInterval(-90)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            SignalCatalogPanelUpdate(
                status: .loaded,
                connection: .offline,
                entries: previewEntries(),
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }

    #Preview("Selection") {
        previewContainer(
            previewModel(
                SignalCatalogPanelUpdate(status: .loaded, entries: previewEntries(), updatedAt: Date()),
                selection: SignalCatalogPanelSelectionConfig(selected: ["vehicle_speed"], max: 3)
            ),
            title: nil
        )
    }
#endif
