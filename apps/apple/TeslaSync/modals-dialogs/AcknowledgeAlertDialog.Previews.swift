//
//  AcknowledgeAlertDialog.Previews.swift
//  TeslaSync — P4 modal/dialog · 0017 · AcknowledgeAlertDialog (Apple)
//
//  Xcode previews — one per state the surface produces: content (with + without the alert subtitle),
//  submitting (the in-flight Acknowledge), too-long (the note over the limit), loading (initial), empty
//  (no target), error (resolution failed → retry), and the stale / offline freshness variants. The
//  too-long preview seeds an over-limit note through a test affordance so the validation chrome renders.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAckAlertTelemetry: AckAlertTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't touch navigation.
    private struct SilentAckAlertController: AckAlertController {
        func complete() {}
        func cancel() {}
    }

    /// A canned acknowledge service so a preview submission resolves without a server.
    private struct StubAckAlertService: AckAlertService {
        let outcome: AckAlertSubmitOutcome
        func acknowledge(_: AckAlertSubmitBody) async -> AckAlertSubmitOutcome {
            outcome
        }
    }

    private enum AckAlertPreviewData {
        /// A resolved snapshot anchored to a fixed alert, live by default.
        static func update(
            status: AckAlertLoadStatus = .loaded,
            connection: AckAlertConnection = .live,
            title: String? = "Battery temperature high — Model Y",
            hasContext: Bool = true
        ) -> AckAlertUpdate {
            AckAlertUpdate(
                status: status,
                context: hasContext ? AckAlertContext(alertID: "alert-4192", title: title) : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func ackPreview(
        _ update: AckAlertUpdate,
        seedNote: String? = nil
    ) -> AcknowledgeAlertDialog {
        let model = AckAlertModel(
            source: InMemoryAckAlertSource(initial: update),
            telemetry: SilentAckAlertTelemetry(),
            service: StubAckAlertService(outcome: .success),
            controller: SilentAckAlertController()
        )
        if let seedNote { model.updateNote(seedNote) }
        return AcknowledgeAlertDialog(model: model)
    }

    #Preview("Content") {
        ScrollView { ackPreview(AckAlertPreviewData.update()).padding() }
    }

    #Preview("Content — no subtitle") {
        ScrollView { ackPreview(AckAlertPreviewData.update(title: nil)).padding() }
    }

    #Preview("Too long") {
        ScrollView {
            ackPreview(AckAlertPreviewData.update(), seedNote: String(repeating: "a", count: 1024)).padding()
        }
    }

    #Preview("Loading") {
        ackPreview(AckAlertPreviewData.update(status: .loading, hasContext: false)).padding()
    }

    #Preview("Empty") {
        ackPreview(AckAlertPreviewData.update(status: .loaded, hasContext: false)).padding()
    }

    #Preview("Error") {
        ackPreview(AckAlertPreviewData.update(status: .failed("Network timed out"), hasContext: false)).padding()
    }

    #Preview("Stale") {
        ScrollView { ackPreview(AckAlertPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { ackPreview(AckAlertPreviewData.update(connection: .offline)).padding() }
    }
#endif
