//
//  Modal.Previews.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  Xcode previews — one per state the surface produces (data, loading, empty, error, stale, offline),
//  one per width preset (sm / md / lg / full), and the anonymous `ariaLabel` (no-title) variant.
//  Preview-only; excluded from release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentModalTelemetry: ModalTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op controller so previews don't touch navigation.
    private struct SilentModalDismissController: ModalDismissController {
        func dismiss() {}
    }

    /// Representative body content for the `.data` phase (web `children`). Verbatim sample copy —
    /// preview scaffolding only (DEBUG), never shipped.
    private struct ModalSampleBody: View {
        var body: some View {
            VStack(alignment: .leading, spacing: TSSpacing.md) {
                Text(verbatim: "Confirm you want to apply these changes to your vehicle.")
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                TSButton(variant: .primary, size: .large, action: {}, label: {
                    Text(verbatim: "Apply")
                        .frame(maxWidth: .infinity)
                })
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private enum ModalPreviewData {
        static func update(
            status: ModalBodyStatus = .loaded,
            hasContent: Bool = true,
            connection: ModalConnection = .live
        ) -> ModalUpdate {
            ModalUpdate(status: status, hasContent: hasContent, connection: connection)
        }
    }

    @MainActor
    private func modalPreview(
        title: String? = "Modal title",
        ariaLabel: String? = nil,
        size: ModalSize = .medium,
        update: ModalUpdate = ModalPreviewData.update()
    ) -> some View {
        let model = ModalModel(
            title: title,
            ariaLabel: ariaLabel,
            size: size,
            source: InMemoryModalSource(initial: update),
            telemetry: SilentModalTelemetry(),
            controller: SilentModalDismissController()
        )
        return ModalSurfaceView(model: model) { ModalSampleBody() }
    }

    #Preview("Data") {
        modalPreview()
    }

    #Preview("Loading") {
        modalPreview(update: ModalPreviewData.update(status: .loading, hasContent: false))
    }

    #Preview("Empty") {
        modalPreview(update: ModalPreviewData.update(hasContent: false))
    }

    #Preview("Error") {
        modalPreview(update: ModalPreviewData.update(status: .failed("Couldn't load the content")))
    }

    #Preview("Stale") {
        modalPreview(update: ModalPreviewData.update(connection: .stale))
    }

    #Preview("Offline") {
        modalPreview(update: ModalPreviewData.update(connection: .offline))
    }

    #Preview("Size · sm") {
        modalPreview(size: .small)
    }

    #Preview("Size · lg") {
        modalPreview(size: .large)
    }

    #Preview("Size · full") {
        modalPreview(size: .full)
    }

    #Preview("Anonymous (ariaLabel)") {
        modalPreview(title: nil, ariaLabel: "Quick action")
    }
#endif
