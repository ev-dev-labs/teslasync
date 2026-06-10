//
//  AddAnnotationPopover.Previews.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  Xcode previews — one per state the surface produces: content (the form with a read-only
//  timestamp), editable (the form with the editable date picker), empty (no annotatable target),
//  loading (initial spinner), error (context failed → retry), and the stale / offline freshness
//  variants. Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentAddAnnotationTelemetry: AddAnnotationTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't mutate an annotation store.
    private struct SilentAddAnnotationController: AddAnnotationController {
        func submit(draft _: AddAnnotationDraft) {}
        func cancel() {}
    }

    private enum AddAnnotationPreviewData {
        /// A resolved snapshot anchored to a fixed timestamp (read-only date), live by default.
        static func update(
            status: AddAnnotationLoadStatus = .loaded,
            connection: AddAnnotationConnection = .live,
            editableDate: Bool = false,
            hasContext: Bool = true
        ) -> AddAnnotationUpdate {
            AddAnnotationUpdate(
                status: status,
                context: hasContext
                    ? AddAnnotationDraftContext(timestamp: "2024-05-18T14:30:00Z", editableDate: editableDate)
                    : nil,
                connection: connection
            )
        }
    }

    @MainActor
    private func addAnnotationPreview(_ update: AddAnnotationUpdate) -> AddAnnotationPopover {
        let model = AddAnnotationModel(
            source: InMemoryAddAnnotationSource(initial: update),
            telemetry: SilentAddAnnotationTelemetry(),
            controller: SilentAddAnnotationController()
        )
        return AddAnnotationPopover(model: model)
    }

    #Preview("Content") {
        ScrollView { addAnnotationPreview(AddAnnotationPreviewData.update()).padding() }
    }

    #Preview("Editable date") {
        ScrollView { addAnnotationPreview(AddAnnotationPreviewData.update(editableDate: true)).padding() }
    }

    #Preview("Empty") {
        addAnnotationPreview(AddAnnotationPreviewData.update(status: .loaded, hasContext: false)).padding()
    }

    #Preview("Loading") {
        addAnnotationPreview(AddAnnotationPreviewData.update(status: .loading, hasContext: false)).padding()
    }

    #Preview("Error") {
        addAnnotationPreview(
            AddAnnotationPreviewData.update(status: .failed("Couldn't reach the chart"), hasContext: false)
        )
        .padding()
    }

    #Preview("Stale") {
        ScrollView { addAnnotationPreview(AddAnnotationPreviewData.update(connection: .stale)).padding() }
    }

    #Preview("Offline") {
        ScrollView { addAnnotationPreview(AddAnnotationPreviewData.update(connection: .offline)).padding() }
    }
#endif
