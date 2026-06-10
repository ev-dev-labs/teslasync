//
//  EnergyStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0048 · EnergyStatsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content) across the compact + standard + wide layouts. DEBUG-only;
//  skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum EnergyStatsPreviewData {
        /// 30 days of believable daily energy usage, plus a couple of idle zero
        /// days so the chart has texture.
        static let dailyBreakdown: [EnergyDailyEntry] = (0 ..< 30).map { offset in
            let day = offset + 1
            let iso = String(format: "2026-05-%02d", min(day, 31))
            let wave = 14000.0 + Double((offset * 53) % 11000) - 4000
            let wh = (offset % 8 == 0) ? 0 : max(wave, 1500)
            return EnergyDailyEntry(
                date: iso,
                energyWh: wh,
                distanceM: wh / 0.18,
                efficiencyWhPerM: 0.18
            )
        }

        static let data = EnergyStatsData(
            totalEnergyUsedWh: 312_000,
            totalEnergyChargedWh: 358_000,
            totalWh: 312_000,
            avgEfficiencyWhPerM: 0.172,
            totalDistanceM: 1_814_000,
            totalCost: 84.36,
            co2SavedKg: 141.7,
            dailyBreakdown: dailyBreakdown
        )
    }

    @MainActor
    private func previewModel(_ update: EnergyStatsUpdate) -> EnergyStatsModel {
        let source = InMemoryEnergyStatsSource(initial: update)
        let model = EnergyStatsModel(source: source)
        model.start()
        return model
    }

    private func loaded(
        freshness: EnergyStatsFreshness = .fresh,
        prefs: EnergyStatsUnitPrefs = .metric,
        updatedAt: Date? = Date()
    ) -> EnergyStatsUpdate {
        EnergyStatsUpdate(
            status: .loaded,
            freshness: freshness,
            data: EnergyStatsPreviewData.data,
            prefs: prefs,
            updatedAt: updatedAt
        )
    }

    #Preview("Content · standard") {
        EnergyStatsWidget(
            model: previewModel(loaded()),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · wide (imperial)") {
        EnergyStatsWidget(
            model: previewModel(loaded(prefs: .imperial)),
            size: DashboardWidgetSize(cols: 3, rows: 6)
        )
        .frame(width: 480, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        EnergyStatsWidget(
            model: previewModel(loaded()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 150)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        EnergyStatsWidget(model: previewModel(EnergyStatsUpdate(status: .loading)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty (no data)") {
        EnergyStatsWidget(model: previewModel(EnergyStatsUpdate(status: .empty)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        EnergyStatsWidget(
            model: previewModel(
                EnergyStatsUpdate(status: .failed("The Internet connection appears to be offline."))
            )
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        EnergyStatsWidget(model: previewModel(loaded(freshness: .stale)))
            .frame(width: 320, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        EnergyStatsWidget(
            model: previewModel(loaded(freshness: .offline, updatedAt: Date().addingTimeInterval(-3600)))
        )
        .frame(width: 320, height: 380)
        .padding()
        .background(Color.TS.bg)
    }
#endif
