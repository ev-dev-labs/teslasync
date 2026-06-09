//
//  SafetyFeaturesWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0083 · SafetyFeaturesWidget (Apple)
//
//  Xcode previews for each surface state (content 2-col / content 4-col wide /
//  compact hero / loading / empty / error / offline / stale). DEBUG-only;
//  compiled by the app targets and skipped by the shipped-surface gate scope.
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

    /// A car with the full ADAS suite engaged — every feature reads Active.
    private let engagedInput = SafetyLatestInput(
        forwardCollisionWarning: .text("ForwardCollisionSensitivityMedium"),
        automaticEmergencyBrakingOff: false,
        laneDepartureAvoidance: .text("LaneAssistLevelWarning"),
        emergencyLaneDepartureAvoidance: true,
        automaticBlindSpotCamera: true,
        blindSpotCollisionWarning: true,
        speedLimitWarning: .text("SpeedAssistLevelDisplay"),
        cruiseFollowDistance: .number(3)
    )

    /// A car with several driver-assist features dialed down or unknown.
    private let mixedInput = SafetyLatestInput(
        forwardCollisionWarning: .boolean(false),
        automaticEmergencyBrakingOff: true,
        laneDepartureAvoidance: .text("LaneAssistLevelNone"),
        emergencyLaneDepartureAvoidance: false,
        automaticBlindSpotCamera: nil,
        blindSpotCollisionWarning: true,
        speedLimitWarning: .text("SpeedAssistLevelNone"),
        cruiseFollowDistance: .number(1)
    )

    #Preview("Content — 2×4 (engaged)") {
        SafetyFeaturesWidget(
            model: previewModel(
                SafetyUpdate(status: .loaded, connection: .live, latest: engagedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4),
            onOpen: {}
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content — 4×4 wide (mixed)") {
        SafetyFeaturesWidget(
            model: previewModel(
                SafetyUpdate(status: .loaded, connection: .live, latest: mixedInput, updatedAt: Date())
            ),
            size: DashboardWidgetSize(cols: 4, rows: 4)
        )
        .frame(width: 560, height: 240)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact hero (1×2)") {
        SafetyFeaturesWidget(
            model: previewModel(SafetyUpdate(status: .loaded, latest: engagedInput, updatedAt: Date())),
            size: DashboardWidgetSize(cols: 1, rows: 2)
        )
        .frame(width: 170, height: 180)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        SafetyFeaturesWidget(model: previewModel(SafetyUpdate(status: .loading, latest: nil)))
            .frame(width: 320, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("No safety data") {
        SafetyFeaturesWidget(model: previewModel(SafetyUpdate(status: .loaded, latest: nil)))
            .frame(width: 320, height: 280)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        SafetyFeaturesWidget(
            model: previewModel(SafetyUpdate(status: .failed("Network unavailable"), latest: nil))
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        SafetyFeaturesWidget(
            model: previewModel(
                SafetyUpdate(
                    status: .loaded,
                    connection: .offline,
                    latest: engagedInput,
                    updatedAt: Date().addingTimeInterval(-600)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        SafetyFeaturesWidget(
            model: previewModel(
                SafetyUpdate(
                    status: .loaded,
                    connection: .stale,
                    latest: mixedInput,
                    updatedAt: Date().addingTimeInterval(-180)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 4)
        )
        .frame(width: 320, height: 280)
        .padding()
        .background(Color.TS.bg)
    }
#endif
