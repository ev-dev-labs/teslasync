//
//  ImportPreviewModal.Views.swift
//  TeslaSync — P4 modal / dialog · 0024 · ImportPreviewModal (Apple)
//
//  The input screen + chrome for `ImportPreviewModal`: the modal header (import glyph + title +
//  close), the three-source tab bar (web `<Tabs>` — From File / Paste JSON / From URL), and the three
//  input panels — the drag-drop / browse dropzone (web dashed `onDrop` div + `<input type=file>`),
//  the JSON text editor + Validate button (web `<Textarea>` + Validate & Preview), and the share-URL
//  field + Load button (web `<Input icon>` + Load from URL). All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No web Tailwind ports live here.
//

import SwiftUI

// MARK: - Header (web Modal title + close)

/// The dialog header: an import glyph, the active title ("Import Dashboard" / "Import Preview"), and
/// the trailing close button that dismisses the surface.
struct ImportPreviewHeader: View {
    let title: String
    let closeLabel: String
    let onClose: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.md) {
            Image(systemName: "square.and.arrow.down")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.TS.accent)
                .frame(width: 32, height: 32)
                .background(Color.TS.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.md))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md)
                        .strokeBorder(Color.TS.accent.opacity(0.20), lineWidth: 1)
                )
                .accessibilityHidden(true)
            Text(verbatim: title)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: TSSpacing.sm)
            Button(action: onClose) {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.TS.textMuted)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: closeLabel))
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Tab bar (web `<Tabs>`)

/// The three-segment import-source tab bar (web `<Tabs tabs activeTab onChange>`).
struct ImportPreviewTabBar: View {
    @Bindable var model: ImportPreviewModalModel

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(model.tabs) { tab in
                let selected = tab == model.activeTab
                Button { model.selectTab(tab) } label: {
                    Text(verbatim: model.tabLabel(tab))
                        .font(Font.TS.bodySm)
                        .fontWeight(selected ? .semibold : .regular)
                        .foregroundStyle(selected ? Color.white : Color.TS.textSecondary)
                        .padding(.horizontal, TSSpacing.md)
                        .padding(.vertical, TSSpacing.sm)
                        .background(selected ? Color.TS.accent : Color.clear, in: Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: model.tabLabel(tab)))
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
            }
        }
    }
}

// MARK: - Input screen (web tab body + parse-error banner)

/// The input screen: the tab bar, the active source panel (faded in like the web `<FadeIn>`), and
/// the parse-error banner when a read / file-type / empty / URL failure occurred.
struct ImportPreviewInputScreen: View {
    @Bindable var model: ImportPreviewModalModel
    let onBrowse: () -> Void
    let onDropFile: (URL) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.lg) {
            ImportPreviewTabBar(model: model)
            TSFadeIn {
                panel
            }
            if let parseError = model.parseError {
                ImportPreviewBanner(
                    tone: .danger,
                    systemImage: "exclamationmark.triangle.fill",
                    messages: [parseError]
                )
            }
        }
    }

    @ViewBuilder
    private var panel: some View {
        switch model.activeTab {
        case .file:
            ImportPreviewFilePanel(model: model, onBrowse: onBrowse, onDropFile: onDropFile)
        case .paste:
            ImportPreviewPastePanel(model: model)
        case .url:
            ImportPreviewURLPanel(model: model)
        }
    }
}

// MARK: - File panel (web dashed dropzone + browse)

/// The drag-drop / browse panel (web dashed `onDrop` div + hidden `<input type=file accept=.json>`).
struct ImportPreviewFilePanel: View {
    let model: ImportPreviewModalModel
    let onBrowse: () -> Void
    let onDropFile: (URL) -> Void

    @State private var isTargeted = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 26, weight: .regular))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: model.localize("import.dropFile", "Drop a .json file here or click to browse"))
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .multilineTextAlignment(.center)
            TSButton(variant: .ghost, size: .medium, action: onBrowse) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "doc.badge.plus").font(.system(size: 12, weight: .semibold))
                    Text(verbatim: model.localize("import.browse", "Browse Files"))
                }
            }
            .accessibilityLabel(Text(verbatim: model.localize("import.fileInput", "Dashboard JSON file")))
        }
        .frame(maxWidth: .infinity)
        .padding(TSSpacing.x3xl)
        .background(
            isTargeted ? Color.TS.accent.opacity(0.06) : Color.clear,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(
                    isTargeted ? Color.TS.accent : Color.TS.border,
                    style: StrokeStyle(lineWidth: isTargeted ? 2 : 1.5, dash: [6, 4])
                )
        )
        .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isTargeted)
        .contentShape(RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
        .dropDestination(for: URL.self) { urls, _ in
            guard let url = urls.first else { return false }
            onDropFile(url)
            return true
        } isTargeted: { targeted in
            isTargeted = targeted
        }
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Paste panel (web `<Textarea>` + Validate)

/// The paste-JSON panel (web monospace `<Textarea>` + "Validate & Preview").
struct ImportPreviewPastePanel: View {
    @Bindable var model: ImportPreviewModalModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            TextEditor(text: $model.pastedJSON)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 180)
                .padding(TSSpacing.sm)
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
                .overlay(alignment: .topLeading) {
                    if model.pastedJSON.isEmpty {
                        Text(verbatim: model.localize(
                            "import.pastePlaceholder",
                            #"{"name": "My Dashboard", "widgets": [...], "layouts": {...}}"#
                        ))
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(TSSpacing.md)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                    }
                }
                .accessibilityLabel(Text(verbatim: model.localize("import.pasteLabel", "Dashboard JSON")))
            TSButton(variant: .primary, size: .medium, action: model.validatePasted) {
                HStack(spacing: TSSpacing.xs) {
                    Image(systemName: "doc.text.magnifyingglass").font(.system(size: 12, weight: .semibold))
                    Text(verbatim: model.localize("import.validate", "Validate & Preview"))
                }
            }
            .disabled(!model.canValidatePaste)
        }
    }
}

// MARK: - URL panel (web `<Input icon>` + Load)

/// The share-URL panel (web `<Input>` with a link glyph + "Load from URL").
struct ImportPreviewURLPanel: View {
    @Bindable var model: ImportPreviewModalModel

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            HStack(spacing: TSSpacing.sm) {
                Image(systemName: "link")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                TextField(
                    "",
                    text: $model.importURL,
                    prompt: Text(verbatim: model.localize(
                        "import.urlPlaceholder",
                        "https://teslasync.example.com/dashboard#import=..."
                    ))
                )
                .textFieldStyle(.plain)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textPrimary)
                .autocorrectionDisabled()
                .accessibilityLabel(Text(verbatim: model.localize("import.urlLabel", "Import URL")))
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.sm)
            .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            TSButton(variant: .primary, size: .medium, action: model.loadFromURL) {
                Text(verbatim: model.localize("import.loadUrl", "Load from URL"))
            }
            .disabled(!model.canLoadURL)
        }
    }
}
