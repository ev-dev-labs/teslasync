//
//  WhyEndedPanel.Previews.swift
//  TeslaSync — P4 feature view · 0152 · WhyEndedPanel (Apple)
//
//  Xcode previews for each surface state (collapsed / content / FSM-empty /
//  signal-empty / loading / error / stale / offline). DEBUG-only; skipped by the
//  swiftc host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    @MainActor
    private func previewModel(_ update: WhyEndedPanelUpdate, expanded: Bool = true) -> WhyEndedPanelModel {
        let source = InMemoryWhyEndedPanelSource(initial: update, emitOnStart: true)
        let model = WhyEndedPanelModel(source: source)
        model.start()
        if expanded { model.setExpanded(true) }
        return model
    }

    private func previewISO(_ secondsAgo: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
    }

    private func previewTransitions() -> [DriveDiagnosticTransitionData] {
        [
            DriveDiagnosticTransitionData(
                id: 3,
                timestampRaw: previewISO(2),
                fsmName: "drive",
                fromState: "driving",
                toState: "parked",
                trigger: "shift_to_park"
            ),
            DriveDiagnosticTransitionData(
                id: 2,
                timestampRaw: previewISO(9),
                fsmName: "drive",
                fromState: "moving",
                toState: "driving",
                trigger: "speed_below_threshold"
            ),
            DriveDiagnosticTransitionData(
                id: 1,
                timestampRaw: previewISO(33),
                fsmName: "session",
                fromState: "active",
                toState: "idle",
                trigger: ""
            )
        ]
    }

    private func previewSignals(_ count: Int = 6) -> [DriveDiagnosticSignalData] {
        let fields = ["vehicle_speed", "shift_state", "drive_state", "power", "soc", "odometer"]
        return (0 ..< count).map { index in
            DriveDiagnosticSignalData(
                timestampRaw: previewISO(Double(index) * 4 + 1),
                field: fields[index % fields.count],
                value: index.isMultiple(of: 2) ? "\(index * 3)" : "P"
            )
        }
    }

    @MainActor
    private func previewContainer(_ model: WhyEndedPanelModel) -> some View {
        WhyEndedPanel(model: model)
            .padding(TSSpacing.lg)
            .frame(width: 520, alignment: .top)
            .background(Color.TS.bg)
    }

    #Preview("Content") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(
                status: .loaded,
                transitions: previewTransitions(),
                signals: previewSignals(),
                updatedAt: Date()
            )
        ))
    }

    #Preview("Collapsed") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(status: .loaded, transitions: previewTransitions(), signals: previewSignals()),
            expanded: false
        ))
    }

    #Preview("FSM empty") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(status: .loaded, transitions: [], signals: previewSignals(3))
        ))
    }

    #Preview("Signals empty") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(status: .loaded, transitions: previewTransitions(), signals: [])
        ))
    }

    #Preview("Both empty") {
        previewContainer(previewModel(WhyEndedPanelUpdate(status: .empty)))
    }

    #Preview("Loading") {
        previewContainer(previewModel(WhyEndedPanelUpdate(status: .loading)))
    }

    #Preview("Error") {
        previewContainer(previewModel(WhyEndedPanelUpdate(status: .failed("The request timed out"))))
    }

    #Preview("Stale") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(
                status: .loaded,
                connection: .stale,
                transitions: previewTransitions(),
                signals: previewSignals(),
                updatedAt: Date().addingTimeInterval(-180)
            )
        ))
    }

    #Preview("Offline (cached)") {
        previewContainer(previewModel(
            WhyEndedPanelUpdate(
                status: .loaded,
                connection: .offline,
                transitions: previewTransitions(),
                signals: previewSignals(),
                updatedAt: Date().addingTimeInterval(-900)
            )
        ))
    }
#endif
