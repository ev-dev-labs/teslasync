//
//  DrivingCoachWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0043 · DrivingCoachWidget (Apple)
//
//  Xcode previews for each surface state (content / compact / loading / empty / error /
//  stale / offline / no-tips). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: DrivingCoachUpdate) -> DrivingCoachModel {
        let source = InMemoryDrivingCoachSource(initial: update)
        let model = DrivingCoachModel(source: source)
        model.start()
        return model
    }

    private func previewCoach(recommendations: [CoachRecommendationInput]? = nil) -> DrivingCoachInput {
        DrivingCoachInput(
            overallScore: 82,
            efficiencyWhKm: 168,
            bestEfficiencyWhKm: 148,
            recommendations: recommendations ?? [
                CoachRecommendationInput(
                    id: 0,
                    category: "Smooth acceleration",
                    tip: "Ease off the pedal on launches — gentle starts add up to real range over a week.",
                    impact: .high
                ),
                CoachRecommendationInput(
                    id: 1,
                    category: "Highway speed",
                    tip: "Holding 105 km/h instead of 120 km/h cuts aero drag noticeably on long trips.",
                    impact: .medium
                ),
                CoachRecommendationInput(
                    id: 2,
                    category: "Preconditioning",
                    tip: "Precondition while plugged in so cabin heating doesn't draw from the pack.",
                    impact: .low
                )
            ]
        )
    }

    #Preview("Content (2×4)") {
        DrivingCoachWidget(
            model: previewModel(
                DrivingCoachUpdate(status: .loaded, connection: .live, coach: previewCoach(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        DrivingCoachWidget(
            model: previewModel(
                DrivingCoachUpdate(status: .loaded, connection: .live, coach: previewCoach(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 150, height: 180)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DrivingCoachWidget(model: previewModel(DrivingCoachUpdate(status: .loading, coach: nil)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty (no coach)") {
        DrivingCoachWidget(model: previewModel(DrivingCoachUpdate(status: .loaded, coach: nil)))
            .frame(width: 320, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No tips (content)") {
        DrivingCoachWidget(
            model: previewModel(
                DrivingCoachUpdate(
                    status: .loaded,
                    connection: .live,
                    coach: previewCoach(recommendations: []),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DrivingCoachWidget(
            model: previewModel(DrivingCoachUpdate(status: .failed("Network unavailable"), coach: nil))
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DrivingCoachWidget(
            model: previewModel(
                DrivingCoachUpdate(
                    status: .loaded,
                    connection: .stale,
                    coach: previewCoach(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DrivingCoachWidget(
            model: previewModel(
                DrivingCoachUpdate(
                    status: .loaded,
                    connection: .offline,
                    coach: previewCoach(),
                    updatedAt: Date().addingTimeInterval(-900)
                )
            )
        )
        .frame(width: 320, height: 360)
        .padding()
        .background(Color.TS.bg)
    }
#endif
