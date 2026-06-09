//
//  SafetyHistoryWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0084 · SafetyHistoryWidget (Apple)
//
//  Xcode previews for each surface state (loading / empty / error / offline / stale /
//  content / wide / compact). DEBUG-only; compiled by the app targets and skipped by
//  the shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: SafetyUpdate) -> SafetyModel {
        let source = InMemorySafetySource(initial: update)
        let model = SafetyModel(source: source)
        model.start()
        return model
    }

    private func previewEvents(now: Date = Date()) -> [SafetyEventInput] {
        [
            SafetyEventInput(
                id: 1,
                vehicleID: 7,
                createdAt: now.addingTimeInterval(-90),
                automaticEmergencyBrakingOff: true,
                pinToDriveEnabled: true
            ),
            SafetyEventInput(
                id: 2,
                vehicleID: 7,
                createdAt: now.addingTimeInterval(-1200),
                forwardCollisionWarning: .string("ForwardCollisionSensitivityHigh"),
                speedLimitWarning: .string("SpeedAssistLevelChime"),
                cruiseFollowDistance: .number(3)
            ),
            SafetyEventInput(
                id: 3,
                vehicleID: 7,
                createdAt: now.addingTimeInterval(-3600),
                laneDepartureAvoidance: .string("LaneAssistLevelWarning")
            ),
            SafetyEventInput(
                id: 4,
                vehicleID: 7,
                createdAt: now.addingTimeInterval(-7200),
                blindSpotCollisionWarning: true
            ),
            SafetyEventInput(id: 5, vehicleID: 7, createdAt: now.addingTimeInterval(-10800)),
            // Prior 30–60 day window → makes the trend "Increasing".
            SafetyEventInput(id: 6, vehicleID: 7, createdAt: now.addingTimeInterval(-45 * 24 * 60 * 60))
        ]
    }

    #Preview("Content (2×4)") {
        SafetyHistoryWidget(
            model: previewModel(
                SafetyUpdate(
                    status: .loaded,
                    connection: .live,
                    events: previewEvents(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Wide (4×6)") {
        SafetyHistoryWidget(
            model: previewModel(
                SafetyUpdate(status: .loaded, connection: .live, events: previewEvents(), updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 600, height: 460)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        SafetyHistoryWidget(model: previewModel(SafetyUpdate(status: .loaded, events: [])))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SafetyHistoryWidget(model: previewModel(SafetyUpdate(status: .loading, events: [])))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SafetyHistoryWidget(model: previewModel(SafetyUpdate(status: .failed("Network unavailable"), events: [])))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SafetyHistoryWidget(
            model: previewModel(
                SafetyUpdate(
                    status: .loaded,
                    connection: .offline,
                    events: previewEvents(),
                    updatedAt: Date().addingTimeInterval(-600)
                )
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SafetyHistoryWidget(
            model: previewModel(
                SafetyUpdate(
                    status: .loaded,
                    connection: .stale,
                    events: previewEvents(),
                    updatedAt: Date().addingTimeInterval(-180)
                )
            )
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    // The registry `minSize` clamps the surface to cols ≥ 2, so the compact summary
    // (web `CompactView`) is previewed directly to keep the parity branch verifiable.
    #Preview("Compact summary") {
        let stats = SafetyStatsBuilder.build(events: previewEvents(), localize: SafetyStrings.string)
        return SafetyCompactView(stats: stats)
            .padding(TSSpacing.md)
            .frame(width: 240, height: 80)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous))
            .padding()
            .background(Color.TS.bg)
    }
#endif
