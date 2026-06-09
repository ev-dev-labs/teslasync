//
//  DrivingCoachSection.Previews.swift
//  TeslaSync — P4 feature view · 0167 · DrivingCoachSection (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum DrivingCoachPreviewData {
        static let sample = DrivingCoachData(
            overallScore: 82,
            efficiencyWhKm: 152.4,
            bestEfficiencyWhKm: 131.0,
            totalDrivesAnalyzed: 48,
            styleBreakdown: DrivingCoachStyleBreakdown(efficient: 30, moderate: 14, aggressive: 4),
            patterns: DrivingCoachPatterns(
                hardAccelPct: 18,
                hardBrakePct: 22,
                highwayPct: 61,
                shortTripPct: 35,
                coldStartPct: 12
            ),
            weeklyTrend: [
                DrivingCoachWeeklyPoint(week: "W14", score: 74, efficiency: 160, drives: 9),
                DrivingCoachWeeklyPoint(week: "W15", score: 79, efficiency: 155, drives: 11),
                DrivingCoachWeeklyPoint(week: "W16", score: 81, efficiency: 150, drives: 12),
                DrivingCoachWeeklyPoint(week: "W17", score: 85, efficiency: 146, drives: 16)
            ],
            recommendations: [
                DrivingCoachRecommendation(
                    id: 0, category: "braking", impact: .high,
                    tip: "Ease off the brake earlier to recover more regen energy."
                ),
                DrivingCoachRecommendation(
                    id: 1, category: "climate", impact: .medium,
                    tip: "Precondition while plugged in to cut cold-start draw."
                ),
                DrivingCoachRecommendation(
                    id: 2, category: "routing", impact: .low,
                    tip: "Favor steady highway speeds under 110 km/h."
                )
            ],
            perDriveScores: [
                DrivingCoachDriveScore(
                    id: 901, date: "2026-04-04T08:12:00Z", score: 88, style: .efficient,
                    efficiency: 142, distance: 23.4
                ),
                DrivingCoachDriveScore(
                    id: 902, date: "2026-04-05T17:40:00Z", score: 63, style: .moderate,
                    efficiency: 168, distance: 12.1
                ),
                DrivingCoachDriveScore(
                    id: 903, date: "2026-04-06T09:02:00Z", score: 41, style: .aggressive,
                    efficiency: 205, distance: 8.7
                )
            ]
        )
    }

    @MainActor
    private func drivingCoachPreviewModel(_ update: DrivingCoachSectionUpdate) -> DrivingCoachSectionModel {
        let source = InMemoryDrivingCoachSectionSource(initial: update)
        let model = DrivingCoachSectionModel(
            source: source,
            copy: .fallback,
            locale: Locale(identifier: "en_US")
        )
        model.start()
        return model
    }

    @MainActor
    private func drivingCoachPreview(_ model: DrivingCoachSectionModel) -> some View {
        ScrollView {
            DrivingCoachSection(model: model)
                .padding()
        }
        .background(Color.TS.bg)
    }

    #Preview("Data") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(
            status: .loaded,
            data: DrivingCoachPreviewData.sample
        )))
    }

    #Preview("Empty") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(
            status: .loaded,
            data: nil
        )))
    }

    #Preview("Loading") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(status: .loading)))
    }

    #Preview("Error") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(
            status: .failed("Network request timed out")
        )))
    }

    #Preview("Stale") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(
            status: .loaded,
            data: DrivingCoachPreviewData.sample,
            connection: .stale
        )))
    }

    #Preview("Offline") {
        drivingCoachPreview(drivingCoachPreviewModel(DrivingCoachSectionUpdate(
            status: .loaded,
            data: DrivingCoachPreviewData.sample,
            connection: .offline
        )))
    }
#endif
