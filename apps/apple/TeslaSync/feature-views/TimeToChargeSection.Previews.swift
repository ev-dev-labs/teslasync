//
//  TimeToChargeSection.Previews.swift
//  TeslaSync — P4 feature view · 0094 · TimeToChargeSection (Apple)
//
//  Xcode previews for each surface state (content · live / content · stale /
//  empty / loading / offline · cached / offline · no data / error). DEBUG-only;
//  skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum TimeToChargePreviewData {
        /// DC + AC fixtures that produce a full set of metrics: avg10to80 over the
        /// 8%→82% and 5%→85% sessions, avg20to80 adding the 15%→90% session, a
        /// fastest (≈91 kWh/h) and slowest (60 kWh/h) rate, and a two-year trend.
        static func sessions() -> [TimeToChargeSectionChargingSessionSummary] {
            [
                TimeToChargeSectionChargingSessionSummary(
                    id: 101,
                    startedAt: "2025-11-10T08:00:00Z",
                    endedAt: "2025-11-10T08:35:00Z",
                    startSocPct: 8,
                    endSocPct: 82,
                    totalEnergyAddedWh: 42000,
                    peakPowerW: 120_000,
                    chargerType: "Tesla"
                ),
                TimeToChargeSectionChargingSessionSummary(
                    id: 102,
                    startedAt: "2026-02-02T09:00:00Z",
                    endedAt: "2026-02-02T09:50:00Z",
                    startSocPct: 15,
                    endSocPct: 90,
                    totalEnergyAddedWh: 50000,
                    peakPowerW: 90000,
                    chargerType: "CCS"
                ),
                TimeToChargeSectionChargingSessionSummary(
                    id: 103,
                    startedAt: "2026-02-15T22:00:00Z",
                    endedAt: "2026-02-15T22:25:00Z",
                    startSocPct: 5,
                    endSocPct: 85,
                    totalEnergyAddedWh: 38000,
                    peakPowerW: 150_000,
                    chargerType: "Tesla"
                ),
                TimeToChargeSectionChargingSessionSummary(
                    id: 104,
                    startedAt: "2026-03-01T19:00:00Z",
                    endedAt: "2026-03-01T23:00:00Z",
                    startSocPct: 40,
                    endSocPct: 80,
                    totalEnergyAddedWh: 11000,
                    peakPowerW: 7000,
                    chargerType: nil
                )
            ]
        }
    }

    @MainActor
    private func previewModel(
        _ state: TimeToChargeLoadState<[TimeToChargeSectionChargingSessionSummary]>
    ) -> TimeToChargeModel {
        TimeToChargeModel(previewState: state, locale: Locale(identifier: "en_US"))
    }

    #Preview("Content · live") {
        TimeToChargeSection(model: previewModel(.loaded(TimeToChargePreviewData.sessions(), stale: false)))
            .frame(width: 760)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        TimeToChargeSection(model: previewModel(.loaded(TimeToChargePreviewData.sessions(), stale: true)))
            .frame(width: 760)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        TimeToChargeSection(model: previewModel(.empty(stale: false)))
            .frame(width: 480)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        TimeToChargeSection(model: previewModel(.idle))
            .frame(width: 760)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        TimeToChargeSection(model: previewModel(
            .failed(.offline, cached: TimeToChargePreviewData.sessions(), stale: true)
        ))
        .frame(width: 760)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        TimeToChargeSection(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 480)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        TimeToChargeSection(model: previewModel(
            .failed(.network(message: "boom"), cached: nil, stale: false)
        ))
        .frame(width: 480)
        .padding()
        .background(Color.TS.bg)
    }
#endif
