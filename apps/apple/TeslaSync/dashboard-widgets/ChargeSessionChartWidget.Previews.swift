//
//  ChargeSessionChartWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0019 · ChargeSessionChartWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + wide + narrow). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: 8 recent charge sessions newest-first (the order
    /// the API returns), with mixed charger types so every legend color renders.
    private enum ChargeSessionPreviewData {
        static func rows(now: Date = Date()) -> [ChargeSessionDTO] {
            let calendar = Calendar.current
            let samples: [(wh: Double, type: String?)] = [
                (47300, "Tesla Supercharger"),
                (11200, nil),
                (62500, "Supercharger"),
                (9800, "<invalid>"),
                (18400, "J1772"),
                (54100, "Tesla Supercharger"),
                (10500, ""),
                (21900, "CCS")
            ]
            return samples.enumerated().compactMap { index, sample in
                let date = calendar.date(byAdding: .day, value: -index, to: now)
                return ChargeSessionDTO(
                    id: 1000 + index,
                    startedAt: date,
                    totalEnergyAddedWh: sample.wh,
                    chargerType: sample.type
                )
            }
        }
    }

    @MainActor
    private func previewModel(_ update: ChargeSessionChartUpdate) -> ChargeSessionChartModel {
        let source = InMemoryChargeSessionChartSource(initial: update)
        let model = ChargeSessionChartModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = ChargeSessionVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        ChargeSessionChartWidget(
            model: previewModel(
                ChargeSessionChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: ChargeSessionPreviewData.rows(),
                    localeIdentifier: "en_US",
                    timeZoneIdentifier: "America/Los_Angeles",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        ChargeSessionChartWidget(
            model: previewModel(
                ChargeSessionChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: ChargeSessionPreviewData.rows(),
                    localeIdentifier: "en_US",
                    timeZoneIdentifier: "America/Los_Angeles",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 520, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChargeSessionChartWidget(model: previewModel(ChargeSessionChartUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        ChargeSessionChartWidget(
            model: previewModel(ChargeSessionChartUpdate(status: .loaded, vehicle: previewVehicle, rows: []))
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChargeSessionChartWidget(model: previewModel(ChargeSessionChartUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        ChargeSessionChartWidget(
            model: previewModel(
                ChargeSessionChartUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    rows: ChargeSessionPreviewData.rows(),
                    localeIdentifier: "en_US",
                    timeZoneIdentifier: "America/Los_Angeles",
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        ChargeSessionChartWidget(
            model: previewModel(
                ChargeSessionChartUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    rows: ChargeSessionPreviewData.rows(),
                    localeIdentifier: "en_US",
                    timeZoneIdentifier: "America/Los_Angeles",
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Narrow (1-col)") {
        ChargeSessionChartWidget(
            model: previewModel(
                ChargeSessionChartUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    rows: ChargeSessionPreviewData.rows(),
                    localeIdentifier: "en_US",
                    timeZoneIdentifier: "America/Los_Angeles",
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 180, height: 280)
        .padding()
        .background(Color.TS.bg)
    }
#endif
