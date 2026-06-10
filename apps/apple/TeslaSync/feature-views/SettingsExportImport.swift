//
//  SettingsExportImport.swift
//  TeslaSync — P4 feature view · 0214 · SettingsExportImport (Apple)
//
//  The composed SettingsExportImport surface — the SwiftUI parity of
//  features/settings/components/SettingsExportImport.tsx. A single glass panel with two
//  flows: Export (fetch the bundle, save it to the user's Files, confirm with a toast)
//  and Import (pick / drag-drop a JSON bundle → validate locally → dry-run preview →
//  Apply through the SUDO step-up). It binds through `SettingsExportImportModel` (P1/S8);
//  no networking or transport lives in the view. On appear it emits the P1/S11
//  `view.opened` diagnostics event for the surface slug `SettingsExportImport`.
//
//  Every state renders (no hidden surface): the export idle / exporting; the import
//  dropzone idle / parsing; the inline parse-error banner; the dry-run preview with its
//  per-section diff; the applied summary; and the success / offline / failure toasts. The
//  panel never throws — a bad file renders an inline error and a "Choose a file" button;
//  an Apply failure keeps the preview visible so the user can retry without re-uploading.
//

import SwiftUI
import UniformTypeIdentifiers

public struct SettingsExportImport: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static var surfaceSlug: String {
        SettingsExportImportSurface.slug
    }

    @State private var model: SettingsExportImportModel
    @State private var showingImporter = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Binds an explicitly constructed model (production wires it over the shared P1/S8
    /// seams; previews/tests inject in-memory sources).
    public init(model: SettingsExportImportModel) {
        _model = State(initialValue: model)
    }

    /// Convenience: builds the model from the export + import seams (web
    /// `useSettingsBackup` mutations).
    public init(
        exporter: any SettingsBackupExporting,
        importer: any SettingsBackupImporting,
        telemetry: any SettingsExportImportTelemetry = OSLogSettingsExportImportTelemetry(),
        locale: Locale = .current
    ) {
        _model = State(initialValue: SettingsExportImportModel(
            exporter: exporter,
            importer: importer,
            telemetry: telemetry,
            locale: locale
        ))
    }

    public var body: some View {
        TSFadeIn {
            VStack(alignment: .leading, spacing: TSSpacing.xl) {
                SettingsBackupHeader()
                SettingsExportRow(model: model)
                SettingsImportRow(
                    model: model,
                    onChooseFile: { showingImporter = true },
                    onDropFile: loadAndIngest
                )
                if let toast = model.toast {
                    SettingsBackupToastView(toast: toast) { model.dismissToast() }
                        .animation(TSAnimation.standard(reduceMotion: reduceMotion), value: toast.id)
                }
            }
            .padding(TSSpacing.xl)
            .frame(maxWidth: .infinity, alignment: .leading)
            .tsGlassPanel()
        }
        .fileImporter(
            isPresented: $showingImporter,
            allowedContentTypes: [.json],
            allowsMultipleSelection: false
        ) { result in
            handleImport(result)
        }
        .onAppear { model.start() }
        .task(id: model.toast?.id) { await autoDismissToast() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: SettingsExportImportAccessibility.surfaceLabel(
            localize: SettingsExportImportStrings.string
        )))
        .accessibilityIdentifier(SettingsExportImportAccessibility.rootTestID)
    }

    // MARK: - File intake (web file picker / drag-drop → `ingestFile`)

    private func handleImport(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result, let url = urls.first else { return }
        loadAndIngest(url)
    }

    /// Reads the picked/dropped file off the main actor's critical path and hands the
    /// bytes to the model's `ingest` pipeline. A read failure passes `data: nil` so the
    /// model surfaces the web "Failed to read the file." branch. The size is read from the
    /// file's resource values so an oversized bundle trips the guard without being slurped
    /// into memory (web size check precedes `file.text()`).
    private func loadAndIngest(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let name = url.lastPathComponent
        let declaredSize = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? -1

        if declaredSize > maxImportFileBytes {
            Task { await model.ingest(filename: name, sizeBytes: declaredSize, data: nil) }
            return
        }

        let data = try? Data(contentsOf: url)
        let sizeBytes = declaredSize >= 0 ? declaredSize : (data?.count ?? 0)
        Task { await model.ingest(filename: name, sizeBytes: sizeBytes, data: data) }
    }

    /// Clears the toast after a short delay (web `useToast` auto-dismiss). Re-armed on each
    /// new toast via `.task(id:)`; cancellation (a newer toast) skips the clear.
    private func autoDismissToast() async {
        guard model.toast != nil else { return }
        try? await Task.sleep(for: .seconds(4))
        if !Task.isCancelled {
            model.dismissToast()
        }
    }
}
