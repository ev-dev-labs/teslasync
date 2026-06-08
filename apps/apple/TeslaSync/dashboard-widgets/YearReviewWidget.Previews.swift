//
//  YearReviewWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0118 · YearReviewWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / content) and each
//  layout (standard / wide). DEBUG-only; skipped by the host compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func yearReviewPreviewModel(_ update: YearReviewUpdate) -> YearReviewModel {
        let source = InMemoryYearReviewSource(initial: update)
        let model = YearReviewModel(source: source)
        model.start()
        return model
    }

    private let yearReviewSampleStats = YearReviewDTO(
        totalDrives: 487,
        totalDistanceKm: 18540,
        totalEnergyKwh: 3120.6,
        co2OffsetKg: 1840.2,
        totalDrivingMinutes: 21960,
        longestDriveKm: 642.8,
        fastestSpeedKmh: 168,
        monthlyStats: [
            YearReviewMonthlyStat(month: 1, drives: 28),
            YearReviewMonthlyStat(month: 2, drives: 31),
            YearReviewMonthlyStat(month: 3, drives: 39),
            YearReviewMonthlyStat(month: 4, drives: 44),
            YearReviewMonthlyStat(month: 5, drives: 47),
            YearReviewMonthlyStat(month: 6, drives: 52),
            YearReviewMonthlyStat(month: 7, drives: 61),
            YearReviewMonthlyStat(month: 8, drives: 55),
            YearReviewMonthlyStat(month: 9, drives: 43),
            YearReviewMonthlyStat(month: 10, drives: 35),
            YearReviewMonthlyStat(month: 11, drives: 29),
            YearReviewMonthlyStat(month: 12, drives: 23)
        ]
    )

    private let yearReviewSampleUnits = YearReviewUnitPrefs(
        distance: .miles,
        speed: .milesPerHour,
        localeIdentifier: "en_US"
    )

    #Preview("Standard (2×4)") {
        YearReviewWidget(
            model: yearReviewPreviewModel(
                YearReviewUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: yearReviewSampleStats,
                    units: yearReviewSampleUnits,
                    year: 2026,
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
        YearReviewWidget(
            model: yearReviewPreviewModel(
                YearReviewUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: yearReviewSampleStats,
                    units: yearReviewSampleUnits,
                    year: 2026,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onOpen: {}
        )
        .frame(width: 600, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        YearReviewWidget(
            model: yearReviewPreviewModel(YearReviewUpdate(status: .loading, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        YearReviewWidget(
            model: yearReviewPreviewModel(YearReviewUpdate(status: .loaded, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        YearReviewWidget(
            model: yearReviewPreviewModel(
                YearReviewUpdate(status: .failed("Network unavailable"), stats: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        YearReviewWidget(
            model: yearReviewPreviewModel(
                YearReviewUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: yearReviewSampleStats,
                    units: yearReviewSampleUnits,
                    year: 2026,
                    updatedAt: Date().addingTimeInterval(-900)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4),
            onOpen: {}
        )
        .frame(width: 600, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
