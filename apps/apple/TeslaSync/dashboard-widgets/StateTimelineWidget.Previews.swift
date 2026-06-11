//
//  StateTimelineWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0096 · StateTimelineWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / stale /
//  offline / content) across the compact (legend), standard (list), and wide
//  (+ 24h stripe) layouts. DEBUG-only; skipped by the swiftc host gate (the
//  #Preview macro needs Xcode's previews plugin).
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: STWUpdate) -> STWModel {
        let source = STWInMemoryStateTimelineSource(initial: update)
        let model = STWModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = StateTimelineVehicleRef(id: 1, displayName: "Model Y")

    /// A balanced day: ~5h 20m driving, ~2h 20m charging, ~10h asleep, ~3h idle.
    private let previewSummary: [StateSummaryEntry] = [
        StateSummaryEntry(state: "driving", totalMin: 320, count: 12),
        StateSummaryEntry(state: "charging", totalMin: 140, count: 4),
        StateSummaryEntry(state: "asleep", totalMin: 600, count: 3),
        StateSummaryEntry(state: "idle", totalMin: 180, count: 8)
    ]

    /// Chronological 24h transitions for the wide-layout stripe.
    private let previewTransitions: [StateTransitionEntry] = [
        StateTransitionEntry(state: "asleep", durationMin: 360),
        StateTransitionEntry(state: "driving", durationMin: 75),
        StateTransitionEntry(state: "charging", durationMin: 50),
        StateTransitionEntry(state: "idle", durationMin: 40),
        StateTransitionEntry(state: "driving", durationMin: 95),
        StateTransitionEntry(state: "offline", durationMin: 20)
    ]

    private func contentUpdate(
        connection: STWConnection = .live,
        status: STWLoadStatus = .loaded
    ) -> STWUpdate {
        STWUpdate(
            status: status,
            connection: connection,
            vehicle: previewVehicle,
            summary: previewSummary,
            transitions: previewTransitions,
            updatedAt: Date()
        )
    }

    #Preview("Content · standard") {
        StateTimelineWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · wide (stripe)") {
        StateTimelineWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 4, rows: 6),
            onOpen: {}
        )
        .frame(width: 560, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content · compact (legend)") {
        StateTimelineWidget(
            model: previewModel(contentUpdate()),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 170, height: 220)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        StateTimelineWidget(model: previewModel(STWUpdate(status: .loading)))
            .frame(width: 320, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        StateTimelineWidget(model: previewModel(STWUpdate(status: .loaded)))
            .frame(width: 320, height: 300)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        StateTimelineWidget(
            model: previewModel(STWUpdate(status: .failed("Network unavailable")))
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        StateTimelineWidget(
            model: previewModel(contentUpdate(connection: .stale)),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        StateTimelineWidget(
            model: previewModel(contentUpdate(connection: .offline, status: .failed("Offline"))),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 300)
        .padding()
        .background(Color.TS.bg)
    }
#endif
