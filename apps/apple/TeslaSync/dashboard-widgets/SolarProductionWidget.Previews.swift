//
//  SolarProductionWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0093 · SolarProductionWidget (Apple)
//
//  Xcode previews for each surface state (loading / no-site / empty / error /
//  stale / offline / content) across the compact + standard layouts. DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum SolarPreviewData {
        static let todayKey = "2026-06-07"

        static let site = SolarEnergySite(energySiteID: 42, siteName: "Home", hasSolar: true)

        /// 30 days of believable solar production ending today, plus a couple of
        /// cloudy zero days so the chart has texture.
        static let history: [SolarHistoryEntry] = {
            let base = 18000.0
            return (0 ..< 30).map { offset in
                let day = 30 - offset
                let iso = String(format: "2026-05-%02dT00:00:00Z", min(max(day, 1), 31))
                let wave = base + Double((offset * 37) % 9000) - 3500
                let wh = (offset % 9 == 0) ? 0 : max(wave, 1200)
                return SolarHistoryEntry(timestamp: iso, solarEnergyWh: wh)
            } + [SolarHistoryEntry(timestamp: "\(todayKey)T00:00:00Z", solarEnergyWh: 9400)]
        }()
    }

    @MainActor
    private func previewModel(_ update: SolarProductionUpdate) -> SolarProductionModel {
        let source = InMemorySolarProductionSource(initial: update)
        let model = SolarProductionModel(source: source)
        model.start()
        return model
    }

    private func loaded(
        freshness: SolarFreshness = .fresh,
        history: [SolarHistoryEntry] = SolarPreviewData.history,
        updatedAt: Date? = Date()
    ) -> SolarProductionUpdate {
        SolarProductionUpdate(
            status: .loaded,
            freshness: freshness,
            hasSites: true,
            site: SolarPreviewData.site,
            history: history,
            todayKey: SolarPreviewData.todayKey,
            updatedAt: updatedAt
        )
    }

    #Preview("Content · standard") {
        SolarProductionWidget(
            model: previewModel(loaded()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · wide") {
        SolarProductionWidget(
            model: previewModel(loaded()),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 460, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        SolarProductionWidget(
            model: previewModel(loaded()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SolarProductionWidget(model: previewModel(SolarProductionUpdate(status: .loading)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No site") {
        SolarProductionWidget(model: previewModel(SolarProductionUpdate(status: .loaded, hasSites: false)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No solar data") {
        SolarProductionWidget(
            model: previewModel(
                loaded(history: [SolarHistoryEntry(timestamp: "2026-06-01T00:00:00Z", solarEnergyWh: 0)])
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        SolarProductionWidget(
            model: previewModel(
                SolarProductionUpdate(status: .failed("The Internet connection appears to be offline."), hasSites: true)
            )
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        SolarProductionWidget(model: previewModel(loaded(freshness: .stale)))
            .frame(width: 300, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SolarProductionWidget(
            model: previewModel(loaded(freshness: .offline, updatedAt: Date().addingTimeInterval(-3600)))
        )
        .frame(width: 300, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
