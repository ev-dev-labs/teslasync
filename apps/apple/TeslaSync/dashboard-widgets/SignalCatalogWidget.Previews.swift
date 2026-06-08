//
//  SignalCatalogWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0087 · SignalCatalogWidget (Apple)
//
//  Xcode previews for each surface state (content / wide / loading / empty / error
//  / stale / offline) plus the compact count summary. DEBUG-only; skipped by the
//  swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SignalCatalogUpdate) -> SignalCatalogModel {
        let source = InMemorySignalCatalogSource(initial: update)
        let model = SignalCatalogModel(source: source)
        model.start()
        return model
    }

    private let previewEntries: [SignalCatalogEntry] = [
        SignalCatalogEntry(
            name: "VehicleSpeed",
            sourceModule: "Drive",
            unit: "m/s",
            description: "Instantaneous road speed"
        ),
        SignalCatalogEntry(name: "Odometer", sourceModule: "Drive", unit: "m", description: "Lifetime distance"),
        SignalCatalogEntry(name: "Gear", sourceModule: "Drive", unit: nil, description: "Selected drive gear"),
        SignalCatalogEntry(name: "BatteryLevel", sourceModule: "Charging", unit: "%", description: "State of charge"),
        SignalCatalogEntry(
            name: "ChargeRate",
            sourceModule: "Charging",
            unit: "W",
            description: "Instantaneous charge power"
        ),
        SignalCatalogEntry(name: "InsideTemp", sourceModule: "Climate", unit: "°C", description: "Cabin temperature"),
        SignalCatalogEntry(
            name: "OutsideTemp",
            sourceModule: "Climate",
            unit: "°C",
            description: "Ambient temperature"
        ),
        SignalCatalogEntry(name: "RawCounter", sourceModule: nil, unit: nil, description: "Uncategorized counter")
    ]

    private let previewObservations: [String] = {
        var stream: [String] = []
        stream.append(contentsOf: Array(repeating: "VehicleSpeed", count: 412))
        stream.append(contentsOf: Array(repeating: "BatteryLevel", count: 87))
        stream.append(contentsOf: Array(repeating: "InsideTemp", count: 24))
        stream.append(contentsOf: Array(repeating: "ChargeRate", count: 5))
        return stream
    }()

    private func previewUpdate(
        status: CatalogLoadStatus = .loaded,
        connection: CatalogConnection = .live,
        isFetching: Bool = false,
        isError: Bool = false,
        updatedAt: Date? = Date()
    ) -> SignalCatalogUpdate {
        SignalCatalogUpdate(
            status: status,
            connection: connection,
            isFetching: isFetching,
            isError: isError,
            vehicleID: 1,
            entries: previewEntries,
            observations: previewObservations,
            updatedAt: updatedAt
        )
    }

    private let previewEmpty = SignalCatalogUpdate(status: .loaded, entries: [], observations: [])

    #Preview("Content") {
        SignalCatalogWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide") {
        SignalCatalogWidget(
            model: previewModel(previewUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 8)
        )
        .frame(width: 540, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SignalCatalogWidget(model: previewModel(previewUpdate(status: .loading, updatedAt: nil)))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SignalCatalogWidget(model: previewModel(previewEmpty))
            .frame(width: 300, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SignalCatalogWidget(
            model: previewModel(
                SignalCatalogUpdate(status: .failed("Network unavailable"), isError: true)
            )
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SignalCatalogWidget(
            model: previewModel(previewUpdate(connection: .stale, updatedAt: Date().addingTimeInterval(-240)))
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SignalCatalogWidget(
            model: previewModel(previewUpdate(connection: .offline, updatedAt: Date().addingTimeInterval(-600)))
        )
        .frame(width: 300, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact count") {
        SignalCatalogCountSummary(total: 128)
            .frame(width: 150, height: 150)
            .padding()
            .background(Color.TS.surface)
    }
#endif
