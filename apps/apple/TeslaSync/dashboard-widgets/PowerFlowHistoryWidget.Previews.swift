//
//  PowerFlowHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0073 · PowerFlowHistoryWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / no-data / no-site /
//  loading / error / offline / stale). DEBUG-only; compiled by the app targets and
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: PowerFlowUpdate) -> PowerFlowModel {
        let source = InMemoryPowerFlowSource(initial: update)
        let model = PowerFlowModel(source: source)
        model.start()
        return model
    }

    private let previewSite = PowerFlowSiteInput(energySiteID: 42)

    /// A day of synthetic routing samples: solar arcs up midday, the home load
    /// stays steady, the battery charges then discharges, and the grid trims.
    private func previewHistory(now: Date = Date()) -> [PowerFlowHistoryEntryInput] {
        func sample(
            _ hoursAgo: Double,
            solar: Double,
            battery: Double,
            grid: Double,
            load: Double
        ) -> PowerFlowHistoryEntryInput {
            PowerFlowHistoryEntryInput(
                timestamp: now.addingTimeInterval(-hoursAgo * 3600),
                solarPowerW: solar,
                batteryPowerW: battery,
                gridPowerW: grid,
                loadPowerW: load
            )
        }
        return [
            sample(24, solar: 0, battery: -200, grid: 600, load: 800),
            sample(22, solar: 0, battery: -150, grid: 700, load: 900),
            sample(20, solar: 200, battery: -100, grid: 500, load: 1100),
            sample(18, solar: 1400, battery: 600, grid: -300, load: 1400),
            sample(16, solar: 3200, battery: 1200, grid: -900, load: 2000),
            sample(14, solar: 4200, battery: 800, grid: -1200, load: 2600),
            sample(12, solar: 4600, battery: 200, grid: -1400, load: 3000),
            sample(10, solar: 3800, battery: -400, grid: -700, load: 2800),
            sample(8, solar: 2200, battery: -900, grid: 300, load: 2400),
            sample(6, solar: 700, battery: -700, grid: 900, load: 1700),
            sample(4, solar: 0, battery: -300, grid: 1200, load: 1300),
            sample(2, solar: 0, battery: -200, grid: 800, load: 900)
        ]
    }

    #Preview("Content (2×4)") {
        PowerFlowHistoryWidget(
            model: previewModel(
                PowerFlowUpdate(
                    status: .loaded,
                    connection: .live,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×4)") {
        PowerFlowHistoryWidget(
            model: previewModel(
                PowerFlowUpdate(status: .loaded, site: previewSite, history: previewHistory(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        PowerFlowHistoryWidget(
            model: previewModel(
                PowerFlowUpdate(status: .loaded, site: previewSite, history: previewHistory())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 200, height: 130)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No power flow data") {
        PowerFlowHistoryWidget(
            model: previewModel(PowerFlowUpdate(status: .loaded, site: previewSite, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("No site linked") {
        PowerFlowHistoryWidget(
            model: previewModel(PowerFlowUpdate(status: .loaded, site: nil, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        PowerFlowHistoryWidget(
            model: previewModel(PowerFlowUpdate(status: .loading, site: nil, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        PowerFlowHistoryWidget(
            model: previewModel(PowerFlowUpdate(status: .failed("Network unavailable"), site: nil, history: []))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        PowerFlowHistoryWidget(
            model: previewModel(
                PowerFlowUpdate(
                    status: .loaded,
                    connection: .offline,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        PowerFlowHistoryWidget(
            model: previewModel(
                PowerFlowUpdate(
                    status: .loaded,
                    connection: .stale,
                    site: previewSite,
                    history: previewHistory(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
