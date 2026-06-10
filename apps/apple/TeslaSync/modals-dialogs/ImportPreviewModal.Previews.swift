//
//  ImportPreviewModal.Previews.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  Xcode previews — one per state the surface produces: the three input tabs (file / paste / url),
//  the parse-error banner, the valid preview (with + without skipped widgets), and the invalid
//  preview that resolves to the "Cannot preview this layout" empty state. Preview-only; excluded from
//  release builds via `#if DEBUG`.
//

#if DEBUG
    import SwiftUI

    /// A no-op telemetry sink so previews don't emit diagnostics.
    private struct SilentImportPreviewTelemetry: ImportPreviewModalTelemetry {
        func viewOpened(surface _: String) {}
    }

    /// A no-op confirm action so previews don't touch persistence.
    private struct SilentImportPreviewConfirmAction: ImportPreviewConfirmAction {
        func confirm(_: ImportPreviewDashboard) {}
    }

    /// Sample import payloads exercised by the previews.
    private enum ImportPreviewPreviewData {
        /// Two registry widgets with an `lg` layout — a clean valid import.
        static let valid = #"""
        {
          "name": "Road-Trip Dashboard",
          "widgets": [
            { "id": "w1", "widgetId": "battery-gauge" },
            { "id": "w2", "widgetId": "range-bar" }
          ],
          "layouts": {
            "lg": [
              { "i": "w1", "x": 0, "y": 0, "w": 1, "h": 2 },
              { "i": "w2", "x": 1, "y": 0, "w": 2, "h": 2 }
            ]
          }
        }
        """#

        /// Two registry widgets plus one unknown — produces the skipped warning + a missing row.
        static let withSkipped = #"""
        {
          "name": "Imported Layout",
          "widgets": [
            { "id": "w1", "widgetId": "battery-gauge" },
            { "id": "w2", "widgetId": "speed-profile" },
            { "id": "w3", "widgetId": "legacy-mystery-widget" }
          ],
          "layouts": {
            "lg": [
              { "i": "w1", "x": 0, "y": 0, "w": 2, "h": 2 },
              { "i": "w2", "x": 2, "y": 0, "w": 2, "h": 4 }
            ]
          }
        }
        """#

        /// Only an unknown widget — no compatible widgets, so the preview resolves to the empty state.
        static let incompatible = #"""
        {
          "name": "Unsupported Export",
          "widgets": [{ "id": "w1", "widgetId": "legacy-mystery-widget" }],
          "layouts": {}
        }
        """#
    }

    @MainActor
    private func importPreviewModel(initialJSON: String? = nil) -> ImportPreviewModalModel {
        ImportPreviewModalModel(
            initialJSON: initialJSON,
            telemetry: SilentImportPreviewTelemetry(),
            confirmAction: SilentImportPreviewConfirmAction(),
            localize: { _, fallback in fallback }
        )
    }

    @MainActor
    private func importPreviewChrome(_ model: ImportPreviewModalModel) -> some View {
        ImportPreviewModal(model: model)
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.TS.bg)
    }

    #Preview("Input · file") {
        importPreviewChrome(importPreviewModel())
    }

    #Preview("Input · paste") {
        let model = importPreviewModel()
        model.selectTab(.paste)
        model.pastedJSON = #"{ "name": "Draft", "widgets": [], "layouts": {} }"#
        return importPreviewChrome(model)
    }

    #Preview("Input · url") {
        let model = importPreviewModel()
        model.selectTab(.url)
        model.importURL = "https://teslasync.example.com/dashboard#import=eyJuYW1lIjoiRGVtbyJ9"
        return importPreviewChrome(model)
    }

    #Preview("Input · parse error") {
        let model = importPreviewModel()
        model.reportInvalidDropType()
        return importPreviewChrome(model)
    }

    #Preview("Preview · valid") {
        importPreviewChrome(importPreviewModel(initialJSON: ImportPreviewPreviewData.valid))
    }

    #Preview("Preview · with skipped") {
        importPreviewChrome(importPreviewModel(initialJSON: ImportPreviewPreviewData.withSkipped))
    }

    #Preview("Preview · cannot preview") {
        importPreviewChrome(importPreviewModel(initialJSON: ImportPreviewPreviewData.incompatible))
    }
#endif
