//
//  DashboardStatsWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0033 · DashboardStatsWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale / offline / content) and
//  each layout (compact / standard / wide-with-transitions). DEBUG-only; skipped by the host
//  compile + format gates.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func dashboardStatsPreviewModel(_ update: DashboardStatsUpdate) -> DashboardStatsModel {
        let source = InMemoryDashboardStatsSource(initial: update)
        let model = DashboardStatsModel(source: source)
        model.start()
        return model
    }

    /// ISO timestamp `secondsAgo` before now, for transition `startedAt` preview rows.
    private func dashboardStatsISO(secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }

    private let dashboardStatsSample = DashboardStatsDTO(
        totalVehicles: 2,
        totalTrips: 1284,
        totalChargingSessions: 312
    )

    private var dashboardStatsTransitions: [DashboardTransitionDTO] {
        [
            DashboardTransitionDTO(state: "driving", startedAt: dashboardStatsISO(secondsAgo: 90)),
            DashboardTransitionDTO(state: "parked", startedAt: dashboardStatsISO(secondsAgo: 1800)),
            DashboardTransitionDTO(state: "charging", startedAt: dashboardStatsISO(secondsAgo: 9000)),
            DashboardTransitionDTO(state: "asleep", startedAt: dashboardStatsISO(secondsAgo: 180_000)),
            DashboardTransitionDTO(state: "online", startedAt: dashboardStatsISO(secondsAgo: 400_000))
        ]
    }

    #Preview("Standard (2×2)") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: dashboardStatsSample,
                    fsmState: "driving",
                    transitions: dashboardStatsTransitions,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1×2)") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: dashboardStatsSample,
                    fsmState: "driving",
                    transitions: dashboardStatsTransitions,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 180, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×3 · transitions)") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(
                    status: .loaded,
                    connection: .live,
                    stats: dashboardStatsSample,
                    fsmState: "charging",
                    transitions: dashboardStatsTransitions,
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 680, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(DashboardStatsUpdate(status: .loading, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(DashboardStatsUpdate(status: .loaded, stats: nil)),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(status: .failed("Network unavailable"), stats: nil)
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2)
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(
                    status: .loaded,
                    connection: .stale,
                    isFetching: true,
                    stats: dashboardStatsSample,
                    fsmState: "parked",
                    transitions: dashboardStatsTransitions,
                    updatedAt: Date().addingTimeInterval(-120)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 2),
            onOpen: {}
        )
        .frame(width: 340, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        DashboardStatsWidget(
            model: dashboardStatsPreviewModel(
                DashboardStatsUpdate(
                    status: .loaded,
                    connection: .offline,
                    stats: dashboardStatsSample,
                    fsmState: "asleep",
                    transitions: dashboardStatsTransitions,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 3),
            onOpen: {}
        )
        .frame(width: 680, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
