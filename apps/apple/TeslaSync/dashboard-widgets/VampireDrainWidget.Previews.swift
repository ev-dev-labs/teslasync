//
//  VampireDrainWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0105 · VampireDrainWidget (Apple)
//
//  Xcode previews for each surface state (standard/wide/compact/loading/empty/
//  error/offline). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: VampireDrainUpdate) -> VampireDrainModel {
        let source = InMemoryVampireDrainSource(initial: update)
        let model = VampireDrainModel(source: source)
        model.start()
        return model
    }

    private let previewStats = VampireDrainStatsInput(
        avgDrainRatePerHour: 0.09,
        eventCount: 12,
        totalHours: 142
    )

    private let previewEvents: [VampireDrainEventInput] = [
        VampireDrainEventInput(
            id: 1,
            batteryLost: 3.2,
            durationHours: 14,
            drainRatePerHour: 0.23,
            sentryMode: true,
            startDate: Date().addingTimeInterval(-2 * 3600)
        ),
        VampireDrainEventInput(
            id: 2,
            batteryLost: 1.1,
            durationHours: 9.5,
            drainRatePerHour: 0.12,
            sentryMode: false,
            startDate: Date().addingTimeInterval(-26 * 3600)
        ),
        VampireDrainEventInput(
            id: 3,
            batteryLost: 0.6,
            durationHours: 16,
            drainRatePerHour: 0.04,
            sentryMode: false,
            startDate: Date().addingTimeInterval(-50 * 3600)
        ),
        VampireDrainEventInput(
            id: 4,
            batteryLost: 0.4,
            durationHours: 0.5,
            drainRatePerHour: 0.8,
            sentryMode: true,
            startDate: Date().addingTimeInterval(-74 * 3600)
        ),
        VampireDrainEventInput(
            id: 5,
            batteryLost: 0.9,
            durationHours: 11,
            drainRatePerHour: 0.08,
            sentryMode: false,
            startDate: Date().addingTimeInterval(-98 * 3600)
        )
    ]

    private func loaded(_ connection: VampireDrainConnection = .live) -> VampireDrainUpdate {
        VampireDrainUpdate(
            status: .loaded,
            connection: connection,
            stats: previewStats,
            events: previewEvents,
            updatedAt: Date()
        )
    }

    #Preview("Standard") {
        VampireDrainWidget(model: previewModel(loaded()), size: DashboardWidgetSize(cols: 2, rows: 4))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Wide (sparkline)") {
        VampireDrainWidget(model: previewModel(loaded()), size: DashboardWidgetSize(cols: 3, rows: 5))
            .frame(width: 440, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Compact") {
        VampireDrainWidget(model: previewModel(loaded()), size: DashboardWidgetSize(cols: 1, rows: 2))
            .frame(width: 180, height: 120)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        VampireDrainWidget(model: previewModel(VampireDrainUpdate(status: .loading)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        VampireDrainWidget(model: previewModel(VampireDrainUpdate(status: .loaded)))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        VampireDrainWidget(model: previewModel(VampireDrainUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        VampireDrainWidget(model: previewModel(loaded(.offline)), size: DashboardWidgetSize(cols: 2, rows: 4))
            .frame(width: 320, height: 320)
            .padding()
            .background(Color.TS.bg)
    }
#endif
