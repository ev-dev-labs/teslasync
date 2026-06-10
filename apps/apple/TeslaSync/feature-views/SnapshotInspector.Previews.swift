//
//  SnapshotInspector.Previews.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  Xcode previews — one per state the surface produces: the populated snapshot (with diff
//  mode off), the no-selection empty, the outside-window jump affordance, the loading
//  message, the error envelope, and the stale + offline freshness variants. A fixed clock
//  keeps the relative time deterministic. DEBUG-only; excluded from release builds.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSnapshotInspectorTelemetry: SnapshotInspectorTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// Sample inspector payloads anchored to a fixed "now" so the relative time is stable.
    private enum SnapshotInspectorPreviewData {
        static let now = Date(timeIntervalSince1970: 1_717_000_000)

        static var transition: SnapshotTransition {
            SnapshotTransition(
                id: 4821,
                vehicleID: 1,
                ts: "2024-05-29T18:24:00Z",
                fsmName: "vehicle",
                fromState: "online",
                toState: "driving",
                trigger: "shift_state=D",
                details: .object([SnapshotMember("duration_in_state_ms", .number(842_137))])
            )
        }

        static var snapshot: SnapshotSignalSet {
            SnapshotSignalSet(
                vehicleID: 1,
                at: "2024-05-29T18:24:00Z",
                signals: [
                    "battery_level": SnapshotSignalEntry(value: .number(82), source: .l1, ageMs: 240),
                    "charging_state": SnapshotSignalEntry(value: .string("Disconnected"), source: .l2, ageMs: 5400),
                    "shift_state": SnapshotSignalEntry(value: .string("D"), source: .l1, ageMs: 120),
                    "vehicle_speed": SnapshotSignalEntry(value: .number(34.5), source: .stale, ageMs: 180_000),
                    "sentry_mode": SnapshotSignalEntry(value: .bool(false), source: .log, ageMs: 96000)
                ]
            )
        }

        static var previousSnapshot: SnapshotSignalSet {
            SnapshotSignalSet(
                vehicleID: 1,
                at: "2024-05-29T18:23:30Z",
                signals: [
                    "battery_level": SnapshotSignalEntry(value: .number(82), source: .l1),
                    "charging_state": SnapshotSignalEntry(value: .string("Disconnected"), source: .l2),
                    "shift_state": SnapshotSignalEntry(value: .string("P"), source: .l1),
                    "vehicle_speed": SnapshotSignalEntry(value: .number(0), source: .l1),
                    "sentry_mode": SnapshotSignalEntry(value: .bool(true), source: .log)
                ]
            )
        }

        static var lastTransition: SnapshotTransition {
            SnapshotTransition(
                id: 4822,
                vehicleID: 1,
                ts: "2024-05-29T18:18:00Z",
                fsmName: "vehicle",
                fromState: "asleep",
                toState: "online",
                trigger: "wake_up",
                details: nil
            )
        }
    }

    @MainActor
    private func snapshotInspectorPreview(_ update: SnapshotInspectorUpdate) -> SnapshotInspector {
        let model = SnapshotInspectorModel(
            source: InMemorySnapshotInspectorSource(initial: update),
            telemetry: SilentSnapshotInspectorTelemetry(),
            now: { SnapshotInspectorPreviewData.now }
        )
        return SnapshotInspector(model: model)
    }

    private struct SnapshotInspectorPreviewGallery: View {
        var body: some View {
            ScrollView {
                VStack(spacing: TSSpacing.lg) {
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .loaded,
                            input: SnapshotInspectorInput(
                                fsmType: "vehicle",
                                transition: SnapshotInspectorPreviewData.transition,
                                snapshot: SnapshotInspectorPreviewData.snapshot,
                                previousSnapshot: SnapshotInspectorPreviewData.previousSnapshot,
                                inWindowCount: 6
                            )
                        )
                    )
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .loaded,
                            input: SnapshotInspectorInput(fsmType: "vehicle", inWindowCount: 6)
                        )
                    )
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .loaded,
                            input: SnapshotInspectorInput(
                                fsmType: "vehicle",
                                lastTransition: SnapshotInspectorPreviewData.lastTransition,
                                inWindowCount: 0
                            )
                        )
                    )
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .loading,
                            input: SnapshotInspectorInput(fsmType: "vehicle")
                        )
                    )
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .failed("Request timed out"),
                            input: SnapshotInspectorInput(fsmType: "vehicle")
                        )
                    )
                    snapshotInspectorPreview(
                        SnapshotInspectorUpdate(
                            status: .loaded,
                            input: SnapshotInspectorInput(
                                fsmType: "vehicle",
                                transition: SnapshotInspectorPreviewData.transition,
                                snapshot: SnapshotInspectorPreviewData.snapshot,
                                previousSnapshot: SnapshotInspectorPreviewData.previousSnapshot,
                                inWindowCount: 6
                            ),
                            connection: .offline
                        )
                    )
                }
                .padding(TSSpacing.lg)
                .frame(maxWidth: 460)
            }
            .background(Color.TS.bg)
        }
    }

    #Preview("States · Dark") {
        SnapshotInspectorPreviewGallery()
            .preferredColorScheme(.dark)
    }

    #Preview("States · Light") {
        SnapshotInspectorPreviewGallery()
            .preferredColorScheme(.light)
    }

    #Preview("Dynamic Type · XXL") {
        SnapshotInspectorPreviewGallery()
            .preferredColorScheme(.dark)
            .environment(\.dynamicTypeSize, .accessibility2)
    }
#endif
