//
//  ImportPreviewModal.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The dashboard import modal — the SwiftUI parity of
//  features/dashboard/components/ImportPreviewModal.tsx. The web source is a `<Modal>` that lets the
//  user import a saved dashboard from a `.json` file (drag-drop / browse), pasted JSON, or a share
//  URL, validates it synchronously, and lifts the result into a preview screen (summary + mini-grid
//  thumbnail + widget-availability list) with an Import CTA. The native surface presents the same
//  capability as an Apple modal card: it fades in inside a solid bordered card, pins the title header
//  (changing between "Import Dashboard" and "Import Preview") with a close button, and switches over
//  the model's screen so every branch renders real chrome — the three input tabs, the parse-error
//  banner, the validation errors/warnings, the populated preview, and the "Cannot preview this
//  layout" empty state — never a blank box. Binds through `ImportPreviewModalModel` (P1/S8); the file
//  read + the dashboard apply are seams, not inline work.
//
//  States rendered (the web source's actual branches; it performs no async network fetch — its only
//  data dependency is `useTranslation` + synchronous local validation — so the generic remote
//  loading / stale / offline states do not exist here and are intentionally not fabricated):
//    • input · file  — drag-drop / browse a `.json` file
//    • input · paste — a JSON text editor + Validate
//    • input · url   — a share-URL field + Load
//    • input · parseError — the read / file-type / empty / url banners
//    • preview · valid   — dashboard summary + mini-grid + widget list + Import
//    • preview · invalid — validation errors/warnings + "Cannot preview this layout" empty state
//

import SwiftUI
import UniformTypeIdentifiers

/// The dashboard import modal surface, binding through `ImportPreviewModalModel` (P1/S8). `onClose`
/// is the host dismissal (the header close + a successful import); the presenting sheet dismisses
/// around it.
public struct ImportPreviewModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ImportPreviewModalSurface.slug

    @State private var model: ImportPreviewModalModel
    @State private var showingImporter = false
    private let onClose: () -> Void

    public init(model: ImportPreviewModalModel, onClose: @escaping () -> Void = {}) {
        _model = State(initialValue: model)
        self.onClose = onClose
    }

    public var body: some View {
        TSFadeIn(delay: 0.05) {
            VStack(alignment: .leading, spacing: 0) {
                ImportPreviewHeader(
                    title: model.title,
                    closeLabel: ImportPreviewAccessibility.closeLabel(localize: model.localize),
                    onClose: handleClose
                )
                .padding(.horizontal, TSSpacing.lg)
                .padding(.vertical, TSSpacing.md)

                Divider().overlay(Color.TS.border)

                ScrollView {
                    screen
                        .padding(TSSpacing.lg)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(maxWidth: 560, alignment: .leading)
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
        }
        .onAppear { model.start() }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            handlePicked(result)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: ImportPreviewAccessibility.dialogLabel(
            isPreview: model.isPreview,
            localize: model.localize
        )))
        .accessibilityAddTraits(.isModal)
    }

    /// The body under the header: the resolved screen rendered as real chrome (the input tabs or the
    /// populated/empty preview) so no state is hidden behind a blank panel.
    @ViewBuilder
    private var screen: some View {
        if model.isPreview {
            ImportPreviewPreviewScreen(model: model, onClose: handleClose)
        } else {
            ImportPreviewInputScreen(
                model: model,
                onBrowse: { showingImporter = true },
                onDropFile: handleDropped
            )
        }
    }

    // MARK: - Dismissal

    /// The header close (web Modal close → `handleClose` = `resetState` + `onClose`).
    private func handleClose() {
        model.reset()
        onClose()
    }

    // MARK: - File intake (web file picker / drag-drop → `file.text()` → `handleValidate`)

    /// Reads the file chosen via the system importer (web `handleFileChange`).
    private func handlePicked(_ result: Result<[URL], Error>) {
        switch result {
        case let .success(urls):
            guard let url = urls.first else { return }
            readAndValidate(url)
        case .failure:
            model.reportFileReadError()
        }
    }

    /// Handles a dropped URL, enforcing the web `.json`-only rule before reading (web `handleDrop`).
    private func handleDropped(_ url: URL) {
        guard url.isFileURL, url.pathExtension.lowercased() == "json" else {
            model.reportInvalidDropType()
            return
        }
        readAndValidate(url)
    }

    /// Reads the picked / dropped file off the security-scoped URL and hands the text to the model,
    /// surfacing the web "Failed to read file" branch on any failure.
    private func readAndValidate(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url), let text = String(data: data, encoding: .utf8) else {
            model.reportFileReadError()
            return
        }
        model.importFileText(text)
    }
}
