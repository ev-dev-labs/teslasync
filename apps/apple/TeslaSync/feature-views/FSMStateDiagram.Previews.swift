//
//  FSMStateDiagram.Previews.swift
//  TeslaSync — P4 feature view · 0229 · FSMStateDiagram (Apple)
//
//  Xcode previews for the surface across every state: the populated vehicle diagram
//  (data), the unknown-FSM empty surface, the initial loading skeleton, the error +
//  retry state, and the stale / offline connectivity axis. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    private enum FSMStateDiagramPreviewData {
        /// A small vehicle transition history (latest `to_state` = `charging`), exercising
        /// state counts, edge counts, the current-state badge, and the edge summary.
        static let vehicle: [FSMTransition] = [
            transition(1, "2026-06-07T10:00:00Z", "offline", "online"),
            transition(2, "2026-06-07T10:05:00Z", "online", "driving"),
            transition(3, "2026-06-07T10:45:00Z", "driving", "parked"),
            transition(4, "2026-06-07T10:46:00Z", "parked", "charging"),
            transition(5, "2026-06-07T11:30:00Z", "charging", "parked"),
            transition(6, "2026-06-07T17:00:00Z", "parked", "driving"),
            transition(7, "2026-06-07T17:40:00Z", "driving", "parked"),
            transition(8, "2026-06-07T17:41:00Z", "parked", "charging")
        ]

        private static func transition(
            _ id: Int,
            _ ts: String,
            _ from: String,
            _ to: String
        ) -> FSMTransition {
            FSMTransition(
                id: id,
                vehicleID: 1,
                ts: ts,
                fsmName: "vehicle",
                fromState: from,
                toState: to,
                trigger: "preview"
            )
        }
    }

    #Preview("Data — vehicle") {
        ScrollView {
            FSMStateDiagram(fsmType: "vehicle", transitions: FSMStateDiagramPreviewData.vehicle)
                .padding()
        }
    }

    #Preview("Empty — unknown FSM") {
        FSMStateDiagram(fsmType: "all", transitions: [])
            .padding()
    }

    #Preview("Loading") {
        FSMStateDiagram(fsmType: "vehicle", transitions: [], isLoading: true)
            .padding()
    }

    #Preview("Error") {
        FSMStateDiagram(
            fsmType: "vehicle",
            transitions: [],
            errorMessage: "Network request failed"
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            FSMStateDiagram(
                fsmType: "vehicle",
                transitions: FSMStateDiagramPreviewData.vehicle,
                connection: .stale
            )
            .padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            FSMStateDiagram(
                fsmType: "command",
                transitions: [],
                connection: .offline
            )
            .padding()
        }
    }
#endif
