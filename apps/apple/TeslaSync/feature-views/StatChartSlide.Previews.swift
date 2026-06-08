//
//  StatChartSlide.Previews.swift
//  TeslaSync — P4 feature view · 0067 · StatChartSlide (Apple)
//
//  Xcode previews for each surface state (content / stale / offline-cached / loading
//  / empty / error). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum StatChartSlidePreviewData {
        static func recap() -> StatChartSlideData {
            StatChartSlideData(
                totalDrives: 1284,
                avgDrivesPerWeek: 24.7,
                monthlyStats: [
                    StatChartSlideMonthStat(month: 1, drives: 92),
                    StatChartSlideMonthStat(month: 2, drives: 78),
                    StatChartSlideMonthStat(month: 3, drives: 110),
                    StatChartSlideMonthStat(month: 4, drives: 121),
                    StatChartSlideMonthStat(month: 5, drives: 134),
                    StatChartSlideMonthStat(month: 6, drives: 142),
                    StatChartSlideMonthStat(month: 7, drives: 156),
                    StatChartSlideMonthStat(month: 8, drives: 148),
                    StatChartSlideMonthStat(month: 9, drives: 119),
                    StatChartSlideMonthStat(month: 10, drives: 88),
                    StatChartSlideMonthStat(month: 11, drives: 51),
                    StatChartSlideMonthStat(month: 12, drives: 45)
                ]
            )
        }
    }

    @MainActor
    private func previewModel(_ state: StatChartSlideLoadState<StatChartSlideData>) -> StatChartSlideModel {
        StatChartSlideModel(previewState: state)
    }

    #Preview("Content · live") {
        StatChartSlide(model: previewModel(.loaded(StatChartSlidePreviewData.recap(), stale: false)))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        StatChartSlide(model: previewModel(.loaded(StatChartSlidePreviewData.recap(), stale: true)))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        StatChartSlide(model: previewModel(
            .failed(.offline, cached: StatChartSlidePreviewData.recap(), stale: true)
        ))
        .frame(width: 560, height: 520)
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        StatChartSlide(model: previewModel(.idle))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        StatChartSlide(model: previewModel(.empty(stale: false)))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        StatChartSlide(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        StatChartSlide(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 560, height: 520)
            .background(Color.TS.bg)
    }
#endif
