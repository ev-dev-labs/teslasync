//
//  XRayFieldsTable.Previews.swift
//  TeslaSync — P4 feature view · 0034 · XRayFieldsTable (Apple)
//
//  Xcode previews for every surface state (content / loading / empty / error / stale / offline).
//  DEBUG-only; skipped by the host compile + format gates that exclude DEBUG previews from the
//  shipped surface set.
//

import SwiftUI

#if DEBUG
    @MainActor
    private func xrayPreviewModel(_ update: XRayFieldsUpdate) -> XRayFieldsModel {
        let source = InMemoryXRayFieldsSource(initial: update)
        let model = XRayFieldsModel(source: source)
        model.start()
        return model
    }

    private func xrayISO(minutesAgo: Double) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-minutesAgo * 60))
    }

    private var xraySampleRows: [XRayFieldStat] {
        [
            XRayFieldStat(
                field: "VehicleSpeed",
                sampleCount: 18234,
                lastSeenAt: xrayISO(minutesAgo: 0.2),
                valueKind: 6
            ),
            XRayFieldStat(field: "Soc", sampleCount: 9087, lastSeenAt: xrayISO(minutesAgo: 1), valueKind: 6),
            XRayFieldStat(field: "Gear", sampleCount: 4120, lastSeenAt: xrayISO(minutesAgo: 4), valueKind: 7),
            XRayFieldStat(field: "Location", sampleCount: 3877, lastSeenAt: xrayISO(minutesAgo: 12), valueKind: 10),
            XRayFieldStat(field: "DoorState", sampleCount: 612, lastSeenAt: xrayISO(minutesAgo: 95), valueKind: 1),
            XRayFieldStat(field: "ChargeState", sampleCount: 88, lastSeenAt: xrayISO(minutesAgo: 60 * 28), valueKind: 1)
        ]
    }

    #Preview("Content — regular") {
        XRayFieldsTable(
            model: xrayPreviewModel(
                XRayFieldsUpdate(status: .loaded, connection: .live, rows: xraySampleRows, updatedAt: Date())
            )
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — compact") {
        XRayFieldsTable(
            model: xrayPreviewModel(
                XRayFieldsUpdate(status: .loaded, connection: .live, rows: xraySampleRows, updatedAt: Date())
            )
        )
        .frame(width: 320, height: 520)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        XRayFieldsTable(model: xrayPreviewModel(XRayFieldsUpdate(status: .loading, rows: nil)))
            .frame(width: 560, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        XRayFieldsTable(model: xrayPreviewModel(XRayFieldsUpdate(status: .loaded, rows: [])))
            .frame(width: 560, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        XRayFieldsTable(
            model: xrayPreviewModel(XRayFieldsUpdate(status: .failed("Request timed out after 30s"), rows: nil))
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        XRayFieldsTable(
            model: xrayPreviewModel(
                XRayFieldsUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    rows: xraySampleRows,
                    updatedAt: Date().addingTimeInterval(-300)
                )
            )
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        XRayFieldsTable(
            model: xrayPreviewModel(
                XRayFieldsUpdate(
                    status: .loaded,
                    connection: .offline,
                    rows: xraySampleRows,
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            )
        )
        .frame(width: 560, height: 420)
        .padding()
        .background(Color.TS.bg)
    }
#endif
