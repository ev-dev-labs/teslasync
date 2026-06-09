//
//  ResponseViewer.SnippetPanel.swift
//  TeslaSync — P4 feature view · 0041 · ResponseViewer (Apple)
//
//  The public `ResponseSnippetPanel` — the SwiftUI parity of the web exported
//  `SnippetPanel`. A collapsible card with a language picker (cURL / JavaScript
//  / Python / Go), a labelled copy control, and the generated snippet rendered
//  monospaced. Snippet text comes from the pure `ResponseSnippet` generator.
//

import SwiftUI

// MARK: - Snippet panel (web `SnippetPanel`)

/// A collapsible code-snippet panel for a request. Public because the web file
/// exports `SnippetPanel` for the request builder to embed alongside the viewer.
public struct ResponseSnippetPanel: View {
    private let method: String
    private let url: String
    private let requestBody: String?

    @State private var isOpen = false
    @State private var format: SnippetFormat = .curl

    public init(method: String, url: String, body: String? = nil) {
        self.method = method
        self.url = url
        requestBody = body
    }

    private var snippet: String {
        ResponseSnippet.generate(method: method, url: url, format: format, body: requestBody)
    }

    private var toggleTitle: String {
        ResponseViewerStrings.string("playground.codeSnippet", "Code Snippet")
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            ResponseDisclosureToggle(title: toggleTitle, isOpen: isOpen) { isOpen.toggle() }
            if isOpen {
                VStack(alignment: .leading, spacing: 0) {
                    formatBar
                    snippetText
                }
                .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                        .strokeBorder(Color.TS.border, lineWidth: 1)
                )
            }
        }
    }

    // MARK: Format bar

    private var formatBar: some View {
        HStack(spacing: TSSpacing.xs) {
            ForEach(SnippetFormat.allCases) { option in
                formatButton(option)
            }
            Spacer(minLength: TSSpacing.sm)
            ResponseCopyButton(
                value: snippet,
                label: ResponseViewerStrings.string("playground.copy", "Copy")
            )
        }
        .padding(TSSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.TS.border).frame(height: 1)
        }
    }

    private func formatButton(_ option: SnippetFormat) -> some View {
        let isSelected = option == format
        return Button {
            format = option
        } label: {
            Text(verbatim: option.label)
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(isSelected ? Color.TS.textPrimary : Color.TS.textMuted)
                .padding(.horizontal, TSSpacing.sm)
                .padding(.vertical, TSSpacing.xs)
                .background(
                    isSelected ? Color.TS.surfaceGlass : Color.clear,
                    in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: option.label))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }

    // MARK: Snippet body

    private var snippetText: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: snippet)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(Color.TS.textSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.md)
        }
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: toggleTitle))
        .accessibilityValue(Text(verbatim: snippet))
    }
}

// MARK: - Labelled copy control (web `CopyButton` with a `Copy` label)

/// A copy-to-clipboard control with a visible label and a transient
/// confirmation, mirroring the web `CopyButton` used inside the snippet panel.
struct ResponseCopyButton: View {
    let value: String
    let label: String

    @State private var didCopy = false

    var body: some View {
        Button {
            TSClipboard.copy(value)
            didCopy = true
            Task { @MainActor in
                try? await Task.sleep(for: .seconds(1.5))
                didCopy = false
            }
        } label: {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                Text(verbatim: label)
            }
            .font(Font.TS.caption)
            .fontWeight(.medium)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.accent)
        .accessibilityLabel(Text(verbatim: label))
    }
}
