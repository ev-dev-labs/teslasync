//
//  FeedbackModal.Previews.swift
//  TeslaSync — P4 modal/dialog · 0004 · FeedbackModal (Apple)
//
//  Xcode previews — one per state the surface produces: content (the full form with a resolved
//  diagnostics context), context-loading (the auto-context panel gathering), context-empty (no
//  diagnostics to attach), context-error (gather failed → retry), and the stale / offline freshness
//  variants, plus the standalone submit-failure alert. Preview-only; excluded from release builds via
//  `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentFeedbackTelemetry: FeedbackTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op submitter so previews don't perform a network call.
    private struct SilentFeedbackSubmitter: FeedbackSubmitting {
        func submit(_: FeedbackSubmission) async throws {}
    }

    private enum FeedbackPreviewData {
        /// A realistic resolved diagnostics context (a route, an app version, a client-identity
        /// string, and a couple of captured errors).
        static let context = FeedbackContext(
            pageRoute: "/vehicles/3/battery",
            appVersion: "1.0.0 (42)",
            userAgent: "TeslaSync/1.0 iOS 18.0 (iPhone16,2)",
            recentErrors: [
                FeedbackErrorReport(
                    name: "TypeError",
                    message: "Cannot read properties of undefined",
                    route: "/vehicles/3/battery",
                    occurredAt: "2024-05-18T14:30:00Z"
                )
            ],
            consoleTail: "[14:30:01] [warn] battery widget received NaN"
        )

        static func update(
            status: FeedbackContextStatus = .loaded,
            connection: FeedbackConnection = .live,
            hasContext: Bool = true
        ) -> FeedbackContextUpdate {
            FeedbackContextUpdate(
                status: status,
                context: hasContext ? context : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func feedbackPreview(_ update: FeedbackContextUpdate) -> FeedbackModal {
        let model = FeedbackModel(
            source: InMemoryFeedbackContextSource(initial: update),
            telemetry: SilentFeedbackTelemetry(),
            submitter: SilentFeedbackSubmitter()
        )
        return FeedbackModal(model: model)
    }

    #Preview("Content") {
        ScrollView { feedbackPreview(FeedbackPreviewData.update()).padding() }
    }

    #Preview("Context loading") {
        ScrollView {
            feedbackPreview(FeedbackPreviewData.update(status: .loading, hasContext: false)).padding()
        }
    }

    #Preview("Context empty") {
        ScrollView {
            feedbackPreview(FeedbackPreviewData.update(status: .loaded, hasContext: false)).padding()
        }
    }

    #Preview("Context error") {
        ScrollView {
            feedbackPreview(
                FeedbackPreviewData.update(status: .failed("Couldn't reach diagnostics"), hasContext: false)
            )
            .padding()
        }
    }

    #Preview("Stale") {
        ScrollView { feedbackPreview(FeedbackPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { feedbackPreview(FeedbackPreviewData.update(connection: .offline)).padding() }
    }

    #Preview("Submit error alert") {
        FeedbackSubmitErrorAlert().padding()
    }
#endif
