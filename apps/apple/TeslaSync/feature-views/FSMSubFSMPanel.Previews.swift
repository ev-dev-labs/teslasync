//
//  FSMSubFSMPanel.Previews.swift
//  TeslaSync — P4 feature view · 0230 · FSMSubFSMPanel (Apple)
//
//  Xcode previews for each surface state (data / empty / loading / error / stale / offline /
//  not-applicable). DEBUG-only; compiled by the app targets and skipped by the
//  shipped-surface gate scope.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum FSMSubFSMPreviewData {
        /// An ISO-8601 instant `secondsAgo` before now, so the relative timestamp renders
        /// as a live "Nm ago" in the preview.
        static func iso(secondsAgo: TimeInterval) -> String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime]
            return formatter.string(from: Date().addingTimeInterval(-secondsAgo))
        }

        static var activeSubs: [FSMSubFSMEntry] {
            [
                FSMSubFSMEntry(kind: .drive, state: "active", startTime: iso(secondsAgo: 320), driveID: 4821),
                FSMSubFSMEntry(kind: .charge, state: "completing", startTime: iso(secondsAgo: 5400), sessionID: 1190)
            ]
        }
    }

    @MainActor
    private func previewModel(_ input: FSMSubFSMInput) -> FSMSubFSMModel {
        let source = InMemoryFSMSubFSMSource(initial: input)
        let model = FSMSubFSMModel(source: source)
        model.start()
        return model
    }

    #Preview("Data") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(
            fsmType: "vehicle",
            activeSubs: FSMSubFSMPreviewData.activeSubs
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(fsmType: "all", activeSubs: [])))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(fsmType: "vehicle", isLoading: true)))
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(
            fsmType: "vehicle",
            errorMessage: "Network request timed out"
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Stale") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(
            fsmType: "vehicle",
            activeSubs: FSMSubFSMPreviewData.activeSubs,
            connection: .stale
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Offline") {
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(
            fsmType: "vehicle",
            activeSubs: FSMSubFSMPreviewData.activeSubs,
            connection: .offline
        )))
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Not applicable") {
        // Web `if (!isVehicleView) return null` — renders nothing for non-vehicle FSM types.
        FSMSubFSMPanel(model: previewModel(FSMSubFSMInput(
            fsmType: "telemetry_connection",
            activeSubs: FSMSubFSMPreviewData.activeSubs
        )))
        .padding()
        .background(Color.TS.bg)
    }
#endif
