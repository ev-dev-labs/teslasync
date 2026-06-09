//
//  JsonFormatter.Views.swift
//  TeslaSync — P4 feature view · 0017 · JsonFormatter (Apple)
//
//  Presentational subviews for the JsonFormatter tool — the ToolCard-style header,
//  the JSON input editor (with example hint), the formatted-output panel + copy
//  affordance, and the invalid / empty states. All copy resolves through the P1/S10
//  facade; all chrome is token-driven (P1/S9). No networking and no charts/maps.
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Header (web `ToolCard` icon + title + description)

/// The green ToolCard-style header: a `curlybraces` glyph (web lucide `Braces` +
/// color "green") over the title + description. Rendered inline (the reusable native
/// `ToolCard` is a separate surface) so this view stays self-contained.
struct JsonFormatterHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "curlybraces")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusSuccess)
                .frame(width: 36, height: 36)
                .background(
                    Color.TS.statusSuccess.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                JsonFormatterStrings.text("Json Formatter", "Json Formatter")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                JsonFormatterStrings.text("Json Formatter Desc", "Json Formatter Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Input editor (web `Textarea` rows=4)

/// The multi-line JSON input editor with an example overlay (native `TextEditor`
/// has none) and token chrome, mirroring the web `Textarea`.
struct JsonFormatterInputField: View {
    @Binding var text: String

    /// The web input hint `'{"key":"value"}'` — an example value, not user copy.
    private let example = "{\"key\":\"value\"}"

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            JsonFormatterStrings.text("Json Input", "Json Input")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(verbatim: example)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 4)
                        .padding(.vertical, TSSpacing.sm + 4)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $text)
                    .font(.system(.body, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 104)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, TSSpacing.xs)
                    .autocorrectionDisabled(true)
                #if os(iOS)
                    .textInputAutocapitalization(.never)
                #endif
            }
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(JsonFormatterStrings.text("Json Input", "Json Input"))
        }
    }
}

// MARK: - Output panel (web result `<pre>` + `CopyButton`)

/// The success output panel: the "Formatted" label, a copy affordance, and the
/// monospaced pretty-printed JSON (web `font-mono text-emerald-300`, here the green
/// success token), scrollable to match the web `max-h-64 overflow-auto`.
struct JsonFormatterOutputPanel: View {
    let output: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                JsonFormatterStrings.text("Formatted", "Formatted")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                JsonFormatterCopyButton(text: output)
            }
            ScrollView([.vertical, .horizontal]) {
                Text(verbatim: output)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.statusSuccess)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(maxHeight: 256)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Invalid state (web `<p text-rose-300>{e.message}</p>`)

/// The inline error treatment shown when `JSON.parse` throws (web catch branch): the
/// localized "Invalid JSON" headline plus the engine-style parse message.
struct JsonFormatterInvalidPanel: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                JsonFormatterStrings.text("Invalid Json", "Invalid Json")
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.statusDanger)
                Text(verbatim: message)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(Color.TS.statusDanger)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.statusDanger.opacity(0.10),
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                .strokeBorder(Color.TS.statusDanger.opacity(0.3), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Empty state (no input)

/// A friendly empty state shown before any input — the web renders nothing, but the
/// surface contract is "never a blank box".
struct JsonFormatterEmptyHint: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                JsonFormatterStrings.text("json.emptyTitle", "No formatted output yet")
            } icon: {
                Image(systemName: "curlybraces")
            }
        } description: {
            JsonFormatterStrings.text("json.emptyHint", "Paste JSON above to see it formatted here.")
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Copy button (web `CopyButton`)

/// Copies `text` to the system pasteboard with a transient "Copied" confirmation,
/// the native parity of the web `CopyButton`. Cross-platform clipboard via UIKit
/// (iOS/iPadOS) or AppKit (macOS).
struct JsonFormatterCopyButton: View {
    let text: String
    @State private var copied = false

    var body: some View {
        Button(action: copy) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                if copied {
                    JsonFormatterStrings.text("action.copied", "Copied").font(Font.TS.caption)
                } else {
                    JsonFormatterStrings.text("action.copy", "Copy").font(Font.TS.caption)
                }
            }
            .foregroundStyle(copied ? Color.TS.statusSuccess : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            copied
                ? JsonFormatterStrings.text("action.copied", "Copied")
                : JsonFormatterStrings.text("action.copy", "Copy")
        )
    }

    private func copy() {
        Self.writeToPasteboard(text)
        copied = true
        Task {
            try? await Task.sleep(for: .seconds(1.6))
            copied = false
        }
    }

    private static func writeToPasteboard(_ value: String) {
        #if canImport(UIKit)
            UIPasteboard.general.string = value
        #elseif canImport(AppKit)
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(value, forType: .string)
        #endif
    }
}
