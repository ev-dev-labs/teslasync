//
//  AuditPanel.Previews.swift
//  TeslaSync — P4 feature view · 0026 · AuditPanel (Apple)
//
//  Xcode previews for each surface state (content / stale / scoped-empty /
//  global-empty / loading / offline / error). DEBUG-only; skipped by the swiftc
//  host gate.
//

import Foundation
import SwiftUI

#if DEBUG
    private enum AuditPanelPreviewData {
        static func records() -> [AuditPanelDLQReplayRecord] {
            let now = Date()
            return [
                AuditPanelDLQReplayRecord(
                    id: 1,
                    replayedAt: now.addingTimeInterval(-45),
                    actor: "ada@fleet.io",
                    dlqId: 8841,
                    dstTopic: "telemetry/5YJ/v/VehicleSpeed",
                    result: .ok,
                    error: "",
                    traceId: "b1f0a9c2"
                ),
                AuditPanelDLQReplayRecord(
                    id: 2,
                    replayedAt: now.addingTimeInterval(-360),
                    actor: "grace@fleet.io",
                    dlqId: 8830,
                    dstTopic: "telemetry/5YJ/v/ChargeState",
                    result: .publishFailed,
                    error: "mqtt: connection refused",
                    traceId: "9d2c7e41"
                ),
                AuditPanelDLQReplayRecord(
                    id: 3,
                    replayedAt: now.addingTimeInterval(-5400),
                    actor: "linus@fleet.io",
                    dlqId: 8802,
                    dstTopic: "",
                    result: .unparseable,
                    error: "missing source topic",
                    traceId: ""
                ),
                AuditPanelDLQReplayRecord(
                    id: 4,
                    replayedAt: now.addingTimeInterval(-86400),
                    actor: "",
                    dlqId: 8771,
                    dstTopic: "telemetry/5YJ/v/Soc",
                    result: .rateLimited,
                    error: "per-actor limit",
                    traceId: "44aa1290"
                )
            ]
        }
    }

    @MainActor
    private func previewModel(
        _ state: AuditPanelLoadState<[AuditPanelDLQReplayRecord]>,
        scopedDlqId: Int? = nil
    ) -> AuditPanelModel {
        AuditPanelModel(previewState: state, scopedDlqId: scopedDlqId)
    }

    #Preview("Content · live") {
        AuditPanel(model: previewModel(.loaded(AuditPanelPreviewData.records(), stale: false)))
            .frame(width: 760, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Content · stale") {
        AuditPanel(model: previewModel(.loaded(AuditPanelPreviewData.records(), stale: true)))
            .frame(width: 760, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · scoped") {
        AuditPanel(model: previewModel(.empty(stale: false), scopedDlqId: 8841))
            .frame(width: 480, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Empty · global") {
        AuditPanel(model: previewModel(.empty(stale: false)))
            .frame(width: 480, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Loading") {
        AuditPanel(model: previewModel(.idle))
            .frame(width: 480, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · cached") {
        AuditPanel(model: previewModel(.failed(.offline, cached: AuditPanelPreviewData.records(), stale: true)))
            .frame(width: 760, height: 360)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline · no data") {
        AuditPanel(model: previewModel(.failed(.offline, cached: nil, stale: false)))
            .frame(width: 480, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Error") {
        AuditPanel(model: previewModel(.failed(.network(message: "boom"), cached: nil, stale: false)))
            .frame(width: 480, height: 320)
            .padding()
            .background(Color.TS.bg)
    }
#endif
