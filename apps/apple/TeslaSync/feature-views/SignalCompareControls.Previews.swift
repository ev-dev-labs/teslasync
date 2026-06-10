//
//  SignalCompareControls.Previews.swift
//  TeslaSync — P4 feature view · 0267 · SignalCompareControls (Apple)
//
//  Xcode previews — one per state the surface produces: content (signals resolved),
//  active filter (a category + search applied), windows set (both `datetime-local`
//  fields populated), empty (no comparable signals), loading (initial skeleton), error
//  (fetch failed → retry), and the stale / offline freshness variants. Preview-only;
//  excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentSignalCompareTelemetry: SignalCompareTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op change sink so previews don't log selection edits.
    private struct SilentSignalCompareChangeSink: SignalCompareChangeSink {
        func selectionChanged(_: SignalCompareSelection) {}
    }

    /// Sample signal names spanning several categories, plus selection fixtures.
    private enum SignalComparePreviewData {
        static func signals() -> [String] {
            [
                "vehicle_speed", "battery_level", "charge_state", "cabin_temp",
                "tpms_front_left", "motor_rpm", "sentry_mode", "media_volume"
            ]
        }

        static func windows() -> SignalCompareSelection {
            SignalCompareSelection(
                atA: "2026-06-09T08:30",
                atB: "2026-06-09T09:45",
                search: "",
                category: nil
            )
        }

        static func activeFilter() -> SignalCompareSelection {
            SignalCompareSelection(
                atA: "2026-06-09T08:30",
                atB: "2026-06-09T09:45",
                search: "battery",
                category: "battery"
            )
        }

        static func update(
            status: SignalCompareLoadStatus = .loaded,
            connection: SignalCompareConnection = .live,
            empty: Bool = false,
            selection: SignalCompareSelection = SignalCompareSelection()
        ) -> SignalCompareUpdate {
            SignalCompareUpdate(
                status: status,
                selection: selection,
                availableSignals: empty ? [] : signals(),
                connection: connection
            )
        }
    }

    @MainActor
    private func signalComparePreview(_ update: SignalCompareUpdate) -> SignalCompareControls {
        let model = SignalCompareControlsModel(
            source: InMemorySignalCompareSource(initial: update),
            selection: update.selection,
            telemetry: SilentSignalCompareTelemetry(),
            changeSink: SilentSignalCompareChangeSink()
        )
        return SignalCompareControls(model: model)
    }

    #Preview("Content") {
        ScrollView { signalComparePreview(SignalComparePreviewData.update()).padding() }
    }

    #Preview("Windows set") {
        ScrollView {
            signalComparePreview(
                SignalComparePreviewData.update(selection: SignalComparePreviewData.windows())
            )
            .padding()
        }
    }

    #Preview("Active filter") {
        ScrollView {
            signalComparePreview(
                SignalComparePreviewData.update(selection: SignalComparePreviewData.activeFilter())
            )
            .padding()
        }
    }

    #Preview("Empty") {
        signalComparePreview(SignalComparePreviewData.update(empty: true)).padding()
    }

    #Preview("Loading") {
        signalComparePreview(
            SignalComparePreviewData.update(status: .loading, empty: true)
        )
        .padding()
    }

    #Preview("Error") {
        signalComparePreview(
            SignalComparePreviewData.update(status: .failed("Request timed out"), empty: true)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView {
            signalComparePreview(SignalComparePreviewData.update(connection: .stale)).padding()
        }
    }

    #Preview("Offline") {
        ScrollView {
            signalComparePreview(SignalComparePreviewData.update(connection: .offline)).padding()
        }
    }
#endif
