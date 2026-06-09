//
//  EnergySiteInfoWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0047 · EnergySiteInfoWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty-no-site / empty-no-info / error / stale /
//  offline / content) and each layout (compact / full). DEBUG-only; skipped by the host compile +
//  format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func energySitePreviewModel(_ update: EnergySiteInfoUpdate) -> EnergySiteInfoModel {
        let source = InMemoryEnergySiteInfoSource(initial: update)
        let model = EnergySiteInfoModel(source: source)
        model.start()
        return model
    }

    private let energySiteSampleSites = [
        EnergySiteInfoSiteDTO(energySiteID: 429_177, siteName: "Home")
    ]

    private let energySiteSampleInfo = EnergySiteInfoDataDTO(
        nameplatePowerW: 9800,
        nameplateEnergyWh: 27000,
        batteryCount: 2,
        version: "23.44.0",
        installationTimeZone: "America/Los_Angeles"
    )

    #Preview("Content (2×4)") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(
                    status: .loaded,
                    connection: .live,
                    sites: energySiteSampleSites,
                    info: energySiteSampleInfo,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content compact (1×2)") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(
                    status: .loaded,
                    connection: .live,
                    sites: energySiteSampleSites,
                    info: energySiteSampleInfo,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 170, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — partial values") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(
                    status: .loaded,
                    connection: .live,
                    sites: energySiteSampleSites,
                    info: EnergySiteInfoDataDTO(
                        nameplatePowerW: nil,
                        nameplateEnergyWh: nil,
                        batteryCount: 0,
                        version: nil,
                        installationTimeZone: nil
                    ),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(EnergySiteInfoUpdate(status: .loading)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no site linked") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(status: .loaded, sites: [], info: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty — no site info") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(status: .loaded, sites: energySiteSampleSites, info: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(status: .failed("Network unavailable"), sites: energySiteSampleSites)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (auto-refresh)") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    sites: energySiteSampleSites,
                    info: energySiteSampleInfo,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        EnergySiteInfoWidget(
            model: energySitePreviewModel(
                EnergySiteInfoUpdate(
                    status: .loaded,
                    connection: .offline,
                    sites: energySiteSampleSites,
                    info: energySiteSampleInfo,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }
#endif
