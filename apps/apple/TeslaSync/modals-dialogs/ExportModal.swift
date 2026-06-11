//
//  ExportModal.swift
//  TeslaSync — P4 modal / dialog · 0023 · ExportModal (Apple)
//
//  The export-dashboard modal — the SwiftUI parity of features/dashboard/components/ExportModal.tsx. The
//  web source is a medium `Modal` titled "Export Dashboard" wrapping a summary (a mini grid preview, the
//  name, a widget-count / JSON-size badge pair, the "Updated {date}" line) over three export options
//  (download the pretty JSON file, copy that JSON, copy a self-contained share URL that is disabled with
//  a warning when over-length). The native surface reproduces that exactly as an Apple modal: a pinned
//  header (export glyph + title + freshness chip + close) over the body, switching over the model's
//  resolved phase so every prompt-required state renders (loading / empty / error / populated, plus the
//  stale / offline freshness) — never a blank box. Binds through `ExportModel` (P1/S8); no networking
//  lives here. Designed to be presented in a `.sheet`; the view owns dismissal, the model owns the copy /
//  download seams.
//

import SwiftUI

/// The export-dashboard surface, binding through `ExportModel` (P1/S8). Presented in a sheet by a host;
/// the header close dismisses (web `onClose`), and "Download JSON File" hands the file off then dismisses
/// (web `handleDownload`: `onDownload()` + `onClose()`). Dismissal funnels through the model's `didFinish`
/// signal.
public struct ExportModal: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = ExportSurface.slug

    @State private var model: ExportModel
    @Environment(\.dismiss) private var dismiss

    public init(model: ExportModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(spacing: 0) {
            ExportHeader(
                connection: model.connection,
                title: model.localize("export.title", "Export Dashboard"),
                closeLabel: model.localize("export.close", "Close"),
                onClose: model.close
            )
            Divider().overlay(Color.TS.border)
            body(for: model.phase)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(Color.TS.surface)
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .onChange(of: model.didFinish) { _, finished in
            if finished { dismiss() }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.accessibilityLabel))
    }

    /// The body under the header: the full export panel for `.populated`, else the loading / empty /
    /// error envelopes so no state is hidden behind a blank panel.
    @ViewBuilder
    private func body(for phase: ExportPhase) -> some View {
        switch phase {
        case .loading:
            ExportLoadingState()
        case .empty:
            ExportEmptyState()
        case let .error(message):
            ExportErrorState(message: message) { model.refresh() }
        case .populated:
            ExportPopulatedView(model: model)
        }
    }
}
