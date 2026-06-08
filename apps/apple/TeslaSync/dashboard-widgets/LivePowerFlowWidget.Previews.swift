//
//  LivePowerFlowWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0056 · LivePowerFlowWidget (Apple)
//
//  Xcode previews for each surface state (loading / no-site / empty / error /
//  offline / content). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private func previewModel(_ update: LivePowerFlowUpdate) -> LivePowerFlowModel {
        let source = InMemoryLivePowerFlowSource(initial: update)
        let model = LivePowerFlowModel(source: source)
        model.start()
        return model
    }

    private let previewSite = PowerFlowSite(
        energySiteID: 42,
        siteName: "Home",
        hasSolar: true,
        hasBattery: true,
        hasGrid: true
    )

    /// Solar producing, charging the battery, exporting the surplus to the grid.
    private let previewLive = PowerFlowLiveStatus(
        solarPowerW: 4200,
        batteryPowerW: 1500,
        loadPowerW: 2000,
        gridPowerW: -700
    )

    #Preview("Content") {
        LivePowerFlowWidget(
            model: previewModel(
                LivePowerFlowUpdate(
                    status: .loaded,
                    connection: .live,
                    hasSites: true,
                    site: previewSite,
                    liveStatus: previewLive,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        LivePowerFlowWidget(model: previewModel(LivePowerFlowUpdate(status: .loading)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No site") {
        LivePowerFlowWidget(model: previewModel(LivePowerFlowUpdate(status: .loaded, hasSites: false)))
            .frame(width: 280, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No live data") {
        LivePowerFlowWidget(
            model: previewModel(
                LivePowerFlowUpdate(status: .loaded, hasSites: true, site: previewSite, liveStatus: nil)
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        LivePowerFlowWidget(
            model: previewModel(LivePowerFlowUpdate(status: .failed("Network unavailable"), hasSites: true))
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        LivePowerFlowWidget(
            model: previewModel(
                LivePowerFlowUpdate(
                    status: .loaded,
                    connection: .offline,
                    hasSites: true,
                    site: previewSite,
                    liveStatus: previewLive,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 280, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
