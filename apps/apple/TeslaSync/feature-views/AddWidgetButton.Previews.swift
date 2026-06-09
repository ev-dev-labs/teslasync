//
//  AddWidgetButton.Previews.swift
//  TeslaSync — P4 feature view · 0121 · AddWidgetButton (Apple)
//
//  Xcode previews for the two branches the web source carries: the visible FAB
//  (light + dark, over a representative dashboard backdrop) and the edit-mode
//  hidden branch (`isEditing == true` renders nothing). DEBUG-only; skipped by
//  the release host gate.
//

import SwiftUI

#if DEBUG
    /// A silent telemetry sink so previews don't emit `view.opened` noise.
    private struct SilentAddWidgetButtonTelemetry: AddWidgetButtonTelemetry {
        func viewOpened(surface _: String) {}
    }

    private extension AddWidgetButton {
        /// Preview convenience: builds the FAB with the silent telemetry sink.
        static func preview(isEditing: Bool) -> AddWidgetButton {
            AddWidgetButton(
                isEditing: isEditing,
                action: {},
                telemetry: SilentAddWidgetButtonTelemetry()
            )
        }
    }

    #Preview("Visible") {
        ZStack {
            Color.TS.bg.ignoresSafeArea()
            AddWidgetButton.preview(isEditing: false)
        }
    }

    #Preview("Visible · dark") {
        ZStack {
            Color.TS.bg.ignoresSafeArea()
            AddWidgetButton.preview(isEditing: false)
        }
        .preferredColorScheme(.dark)
    }

    #Preview("Editing · hidden") {
        ZStack {
            Color.TS.bg.ignoresSafeArea()
            // isEditing == true → the FAB renders nothing (web `return null`); the
            // caption is preview-only scaffolding so the empty branch is legible.
            Text(verbatim: "isEditing = true → no FAB")
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            AddWidgetButton.preview(isEditing: true)
        }
    }
#endif
