//
//  FSMHealthPanel.Previews.swift
//  TeslaSync — P4 feature view · 0228 · FSMHealthPanel (Apple)
//
//  Xcode previews — one per state the surface produces: alerts (all three health alerts
//  firing), healthy (resolved, no alerts → the web all-clear row), loading (initial
//  skeleton chrome), error (fetch failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import Foundation
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFSMHealthPanelTelemetry: FSMHealthPanelTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Representative transition logs for the populated / healthy previews.
    private enum FSMHealthPreviewData {
        /// A log that fires all three alerts: a six-transition one-minute `vehicle` burst
        /// (flap), two session FSMs held in pending/active for hours (stuck), and two
        /// `recovered` targets (recovery).
        static func alerting(now: Date = Date()) -> [FSMHealthTransitionInput] {
            var rows: [FSMHealthTransitionInput] = []
            var nextID = 1
            for offset in stride(from: 0, through: 30, by: 6) {
                rows.append(FSMHealthTransitionInput(
                    id: nextID,
                    vehicleId: 1,
                    timestamp: now.addingTimeInterval(TimeInterval(-300 - offset)),
                    fsmName: "vehicle",
                    toState: offset.isMultiple(of: 12) ? "online" : "offline"
                ))
                nextID += 1
            }
            rows.append(FSMHealthTransitionInput(
                id: nextID, vehicleId: 1, timestamp: now.addingTimeInterval(-5 * 3600),
                fsmName: "drive_session", toState: "active"
            ))
            nextID += 1
            rows.append(FSMHealthTransitionInput(
                id: nextID, vehicleId: 2, timestamp: now.addingTimeInterval(-6 * 3600),
                fsmName: "charge_session", toState: "pending"
            ))
            nextID += 1
            rows.append(FSMHealthTransitionInput(
                id: nextID, vehicleId: 1, timestamp: now.addingTimeInterval(-120),
                fsmName: "vehicle", toState: "recovered"
            ))
            nextID += 1
            rows.append(FSMHealthTransitionInput(
                id: nextID, vehicleId: 2, timestamp: now.addingTimeInterval(-90),
                fsmName: "telemetry_connection", toState: "recovered"
            ))
            return rows
        }

        /// A calm log: no bursts, no stuck sessions, no recoveries → the all-clear row.
        static func healthy(now: Date = Date()) -> [FSMHealthTransitionInput] {
            [
                FSMHealthTransitionInput(
                    id: 1, vehicleId: 1, timestamp: now.addingTimeInterval(-3600),
                    fsmName: "vehicle", toState: "online"
                ),
                FSMHealthTransitionInput(
                    id: 2, vehicleId: 1, timestamp: now.addingTimeInterval(-1800),
                    fsmName: "drive_session", toState: "completed"
                )
            ]
        }
    }

    @MainActor
    private func fsmHealthPreview(_ update: FSMHealthPanelUpdate) -> FSMHealthPanel {
        FSMHealthPanel(
            model: FSMHealthPanelModel(
                source: InMemoryFSMHealthPanelSource(initial: update),
                telemetry: SilentFSMHealthPanelTelemetry()
            )
        )
    }

    #Preview("Alerts") {
        fsmHealthPreview(FSMHealthPanelUpdate(
            status: .loaded, transitions: FSMHealthPreviewData.alerting(), connection: .live
        ))
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Healthy") {
        fsmHealthPreview(FSMHealthPanelUpdate(
            status: .loaded, transitions: FSMHealthPreviewData.healthy(), connection: .live
        ))
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Loading") {
        fsmHealthPreview(FSMHealthPanelUpdate(status: .loading, connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Error") {
        fsmHealthPreview(FSMHealthPanelUpdate(status: .failed("Request timed out"), connection: .live))
            .padding()
            .frame(maxWidth: 560)
    }

    #Preview("Stale") {
        fsmHealthPreview(FSMHealthPanelUpdate(
            status: .loaded, transitions: FSMHealthPreviewData.alerting(), connection: .stale
        ))
        .padding()
        .frame(maxWidth: 560)
    }

    #Preview("Offline") {
        fsmHealthPreview(FSMHealthPanelUpdate(
            status: .loaded, transitions: FSMHealthPreviewData.healthy(), connection: .offline
        ))
        .padding()
        .frame(maxWidth: 560)
    }
#endif
