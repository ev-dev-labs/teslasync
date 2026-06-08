//
//  AlertMessageEditor.Preview.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The live message preview (web `PreviewPanel` inside a `GlassPanel`): the eye-iconed "Preview"
//  header and the phase-switched body (error / loading / empty / rendered title+body). The title only
//  shows when include-title is on and the renderer produced one; an empty body falls back to the
//  "(no body — title carries the alert)" hint. Token-driven (P1/S9); copy via the P1/S10 facade.
//

import SwiftUI

/// The live preview panel — switched over the model's preview phase so every branch renders and the
/// panel is never blank.
struct AlertEditorPreviewPanel: View {
    let phase: PreviewPhase
    let preview: AlertMessagePreviewResultDTO?
    let includeTitle: Bool
    let accessibilitySummary: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            header
            content
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .tsGlassPanel(cornerRadius: TSRadius.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    private var header: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "eye")
                .font(.system(size: 11))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            AlertMessageEditorStrings.text("alertEditor.previewLabel", "Preview")
                .font(Font.TS.label)
                .textCase(.uppercase)
                .foregroundStyle(Color.TS.textMuted)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case let .error(message):
            PreviewErrorRow(message: message)
        case .loading:
            PreviewLoadingRow()
        case .empty:
            PreviewEmptyRow()
        case .content:
            renderedContent
        }
    }

    private var renderedContent: some View {
        VStack(alignment: .leading, spacing: 2) {
            if includeTitle, let title = preview?.title, !title.isEmpty {
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            renderedBody
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private var renderedBody: some View {
        if let body = preview?.body, !body.isEmpty {
            Text(verbatim: body)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            AlertMessageEditorStrings.text(
                "alertEditor.previewEmptyBody",
                "(no body — title carries the alert)"
            )
            .font(Font.TS.caption)
            .italic()
            .foregroundStyle(Color.TS.textMuted)
        }
    }
}
