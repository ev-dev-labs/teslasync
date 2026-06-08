//
//  AlertMessageEditor.swift
//  TeslaSync — P4 feature view · 0180 · AlertMessageEditor (Apple)
//
//  The per-rule notification message-template editor — the SwiftUI parity of
//  features/notifications/components/AlertMessageEditor.tsx. Binds through `AlertMessageEditorModel`
//  (P1/S8); no networking lives here. Composes the include-title checkbox, the labelled template
//  field with its `{{`-trigger autocomplete, the live preview, and the preset-gallery sheet, with
//  the live-state freshness chip + connectivity banner so every prompt-required state renders —
//  never a blank box. Edits flow to the host via the model's `onTemplateChange` /
//  `onIncludeTitleChange` callbacks.
//

import SwiftUI

/// The message-template editor surface (web `AlertMessageEditor`). State lives in
/// `AlertMessageEditorModel`; the host supplies the controlled template / include-title / draft and
/// the change callbacks.
public struct AlertMessageEditor: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = AlertMessageEditorSurface.slug

    @State private var model: AlertMessageEditorModel

    public init(model: AlertMessageEditorModel) {
        _model = State(initialValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            header
            IncludeTitleRow(includeTitle: model.includeTitleBinding, disabled: model.disabled)
            if model.connection != .live {
                AlertEditorConnectivityBanner(connection: model.connection)
            }
            TemplateLabelRow(
                label: model.labelText,
                help: model.helpText,
                disabled: model.disabled,
                onPickPreset: { model.openPresetGallery() }
            )
            TemplateEditorField(model: model)
            TokenAutocompletePanel(model: model)
            AlertEditorPreviewPanel(
                phase: model.previewPhase,
                preview: model.preview,
                includeTitle: model.includeTitle,
                accessibilitySummary: model.previewAccessibilitySummary
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .sheet(isPresented: model.presetModalBinding) {
            PresetGallerySheet(model: model)
        }
        .onAppear { model.start() }
        .onDisappear { model.stop() }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: model.labelText))
    }

    /// The optional freshness chip header (ADR-013), trailing-aligned above the controls.
    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            AlertEditorFreshnessChip(connection: model.connection)
        }
    }
}
