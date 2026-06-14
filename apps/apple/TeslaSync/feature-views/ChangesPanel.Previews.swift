//
//  ChangesPanel.Previews.swift
//  TeslaSync — P4 feature view · 0030 · ChangesPanel (Apple)
//
//  Xcode previews for each surface state (content / stale / scoped-empty /
//  global-empty / loading / offline / error). DEBUG-only; skipped by the swiftc
//  host gate and release builds.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum ChangesPanelPreviewData {
        static func changes() -> [ChangesPanelFlagChange] {
            let now = Date()
            return [
                ChangesPanelFlagChange(
                    id: 4,
                    changedAt: now.addingTimeInterval(-45),
                    actor: "ada@fleet.io",
                    flagKey: "beta_dashboard",
                    operation: .set,
                    oldValue: .bool(false),
                    newValue: .bool(true),
                    reason: "enable beta for internal cohort"
                ),
                ChangesPanelFlagChange(
                    id: 3,
                    changedAt: now.addingTimeInterval(-360),
                    actor: "grace@fleet.io",
                    flagKey: "rollout",
                    operation: .set,
                    oldValue: .object(["percent": .number(10)]),
                    newValue: .object(["percent": .number(25), "cohort": .string("internal")]),
                    reason: "bump rollout to 25%"
                ),
                ChangesPanelFlagChange(
                    id: 2,
                    changedAt: now.addingTimeInterval(-5400),
                    actor: "linus@fleet.io",
                    flagKey: "max_export_rows",
                    operation: .set,
                    oldValue: .number(5000),
                    newValue: .number(10000),
                    reason: ""
                ),
                ChangesPanelFlagChange(
                    id: 1,
                    changedAt: now.addingTimeInterval(-86400),
                    actor: "",
                    flagKey: "legacy_signal_path",
                    operation: .delete,
                    oldValue: .string("enabled"),
                    newValue: .null,
                    reason: "retired after phase-42"
                )
            ]
        }
    }

    @MainActor
    private func previewModel(
        _ state: ChangesPanelLoadState<[ChangesPanelFlagChange]>,
        scopedKey: String? = nil
    ) -> ChangesPanelModel {
        ChangesPanelModel(previewState: state, scopedKey: scopedKey)
    }

    #Preview("Content · live") {
        ChangesPanel(model: previewModel(.loaded(ChangesPanelPreviewData.changes(), stale: false)))
            .frame(width: 880, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        ChangesPanel(model: previewModel(.loaded(ChangesPanelPreviewData.changes(), stale: true)))
            .frame(width: 880, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · scoped") {
        ChangesPanel(model: previewModel(.empty(stale: false), scopedKey: "beta_dashboard"))
            .frame(width: 520, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · global") {
        ChangesPanel(model: previewModel(.empty(stale: false)))
            .frame(width: 520, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        ChangesPanel(model: previewModel(.idle))
            .frame(width: 520, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        ChangesPanel(model: previewModel(.failed(.offline, cached: ChangesPanelPreviewData.changes(), stale: true)))
            .frame(width: 880, height: 380)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        ChangesPanel(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 520, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        ChangesPanel(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 520, height: 320)
            .padding()
            .background(Color.TS.bg)
    }
#endif
