//
//  FSMDistributionWidget.Previews.swift
//  TeslaSync — P4 dashboard widget · 0052 · FSMDistributionWidget (Apple)
//
//  Xcode previews for each surface state (loading/empty/error/stale/offline/
//  content + compact). DEBUG-only; skipped by the swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    /// Deterministic sample data: five states with mixed durations (so every
    /// legend color renders) + a recent transition log newest-first.
    private enum FSMDistributionPreviewData {
        static func durations() -> [FSMStateDuration] {
            [
                FSMStateDuration(state: "asleep", milliseconds: 8 * 3_600_000),
                FSMStateDuration(state: "driving", milliseconds: 2 * 3_600_000 + 5 * 60000),
                FSMStateDuration(state: "charging", milliseconds: 45 * 60000),
                FSMStateDuration(state: "idle", milliseconds: 30 * 60000),
                FSMStateDuration(state: "offline", milliseconds: 12 * 60000)
            ]
        }

        private struct Step {
            let id: Int
            let from: String
            let to: String
            let ago: TimeInterval
        }

        static func transitions(now: Date = Date()) -> [FSMStateTransitionDTO] {
            let steps = [
                Step(id: 5, from: "asleep", to: "idle", ago: 120),
                Step(id: 4, from: "idle", to: "driving", ago: 900),
                Step(id: 3, from: "driving", to: "idle", ago: 3600),
                Step(id: 2, from: "idle", to: "charging", ago: 7200),
                Step(id: 1, from: "charging", to: "asleep", ago: 10800)
            ]
            return steps.map { step in
                FSMStateTransitionDTO(
                    id: step.id,
                    fromState: step.from,
                    toState: step.to,
                    timestamp: now.addingTimeInterval(-step.ago)
                )
            }
        }
    }

    @MainActor
    private func previewModel(_ update: FSMDistributionUpdate) -> FSMDistributionModel {
        let source = InMemoryFSMDistributionSource(initial: update)
        let model = FSMDistributionModel(source: source)
        model.start()
        return model
    }

    private let previewVehicle = FSMVehicle(id: 1, displayName: "Model Y")

    #Preview("Content") {
        FSMDistributionWidget(
            model: previewModel(
                FSMDistributionUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    durations: FSMDistributionPreviewData.durations(),
                    transitions: FSMDistributionPreviewData.transitions(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6),
            onOpen: {}
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Content (wide)") {
        FSMDistributionWidget(
            model: previewModel(
                FSMDistributionUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    durations: FSMDistributionPreviewData.durations(),
                    transitions: FSMDistributionPreviewData.transitions(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 4, rows: 6)
        )
        .frame(width: 520, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Loading") {
        FSMDistributionWidget(model: previewModel(FSMDistributionUpdate(status: .loading)))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty") {
        FSMDistributionWidget(
            model: previewModel(FSMDistributionUpdate(status: .loaded, vehicle: previewVehicle, durations: []))
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Error") {
        FSMDistributionWidget(model: previewModel(FSMDistributionUpdate(status: .failed("Network unavailable"))))
            .frame(width: 320, height: 420)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Stale (cached)") {
        FSMDistributionWidget(
            model: previewModel(
                FSMDistributionUpdate(
                    status: .loaded,
                    connection: .stale,
                    vehicle: previewVehicle,
                    durations: FSMDistributionPreviewData.durations(),
                    transitions: FSMDistributionPreviewData.transitions(),
                    updatedAt: Date().addingTimeInterval(-300)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline (cached)") {
        FSMDistributionWidget(
            model: previewModel(
                FSMDistributionUpdate(
                    status: .failed("Offline"),
                    connection: .offline,
                    vehicle: previewVehicle,
                    durations: FSMDistributionPreviewData.durations(),
                    transitions: FSMDistributionPreviewData.transitions(),
                    updatedAt: Date().addingTimeInterval(-1800)
                )
            ),
            size: DashboardWidgetSize(cols: 2, rows: 6)
        )
        .frame(width: 320, height: 420)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Compact (1-col)") {
        FSMDistributionWidget(
            model: previewModel(
                FSMDistributionUpdate(
                    status: .loaded,
                    connection: .live,
                    vehicle: previewVehicle,
                    durations: FSMDistributionPreviewData.durations(),
                    transitions: FSMDistributionPreviewData.transitions(),
                    updatedAt: Date()
                )
            ),
            size: DashboardWidgetSize(cols: 1, rows: 4)
        )
        .frame(width: 170, height: 280)
        .padding()
        .background(Color.TS.bg)
    }
#endif
