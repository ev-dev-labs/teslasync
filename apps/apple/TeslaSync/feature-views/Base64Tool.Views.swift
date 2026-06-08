//
//  Base64Tool.Views.swift
//  TeslaSync — P4 feature view · 0011 · Base64Tool (Apple)
//
//  Presentational subviews for the Base64 tool — the ToolCard-style header, the
//  encode/decode segmented control, the input editor (with example hint), the
//  output panel + copy affordance, and the empty / invalid states. All copy
//  resolves through the P1/S10 facade; all chrome is token-driven (P1/S9).
//

import SwiftUI
#if canImport(UIKit)
    import UIKit
#elseif canImport(AppKit)
    import AppKit
#endif

// MARK: - Header (web `ToolCard` icon + title + description)

/// The amber ToolCard-style header: a `curlybraces` glyph (web lucide `Braces`)
/// over the title + description. Rendered inline (the reusable native `ToolCard`
/// is a separate surface) so this view stays self-contained.
struct Base64ToolHeader: View {
    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            Image(systemName: "curlybraces")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.TS.statusWarning)
                .frame(width: 36, height: 36)
                .background(
                    Color.TS.statusWarning.opacity(0.12),
                    in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                )
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Base64Strings.text("devtools.utils.base64", "Base64")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Base64Strings.text("devtools.utils.base64Desc", "Base64Desc")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Mode toggle (web encode/decode `Button`s)

/// The encode / decode segmented control — two token buttons whose variant flips
/// with the active mode (web `variant={mode === 'encode' ? 'primary' : 'ghost'}`).
struct Base64ModeToggle: View {
    let mode: Base64Mode
    let onSelect: (Base64Mode) -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            button(for: .encode, titleKey: "Encode", fallback: "Encode")
            button(for: .decode, titleKey: "Decode", fallback: "Decode")
            Spacer(minLength: 0)
        }
    }

    private func button(for target: Base64Mode, titleKey: String, fallback: String) -> some View {
        let isActive = mode == target
        return TSButton(
            variant: isActive ? .primary : .ghost,
            size: .small,
            action: { onSelect(target) },
            label: { Base64Strings.text(titleKey, fallback) }
        )
        .accessibilityAddTraits(isActive ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Input editor (web `Textarea`)

/// The multi-line input editor with a mode-specific example overlay (native
/// `TextEditor` has none) and token chrome, mirroring the web `Textarea`.
struct Base64InputField: View {
    @Binding var text: String
    let example: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Base64Strings.text("Input Label", "Input")
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
            ZStack(alignment: .topLeading) {
                if text.isEmpty {
                    Text(verbatim: example)
                        .font(Font.TS.body)
                        .foregroundStyle(Color.TS.textMuted)
                        .padding(.horizontal, TSSpacing.sm + 4)
                        .padding(.vertical, TSSpacing.sm + 4)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                TextEditor(text: $text)
                    .font(Font.TS.body)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 76)
                    .padding(.horizontal, TSSpacing.xs)
                    .padding(.vertical, TSSpacing.xs)
            }
            .background(
                Color.TS.surface,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .accessibilityLabel(Base64Strings.text("Input Label", "Input"))
        }
    }
}

// MARK: - Output panel (web result `<pre>` + `CopyButton`)

/// The success output panel: the "Output" label, a copy affordance, and the
/// monospaced result (web `font-mono text-cyan-300`, here the cyan accent token).
struct Base64OutputPanel: View {
    let output: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack {
                Base64Strings.text("Output Label", "Output")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                Spacer(minLength: TSSpacing.sm)
                Base64CopyButton(text: output)
            }
            Text(verbatim: output)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(Color.TS.accent)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(TSSpacing.md)
        .background(
            Color.TS.bg,
            in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
        )
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Invalid state (web `t('Invalid Input')`)

/// The inline error treatment shown when the transform throws (web catch branch).
struct Base64InvalidPanel: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            Base64Strings.text("Invalid Input", "Invalid Input")
                .font(Font.TS.body)
                .foregroundStyle(Color.TS.statusDanger)
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

/// A friendly empty state shown before any input — the web hides the panel,
/// but the surface contract is "never a blank box".
struct Base64EmptyHint: View {
    var body: some View {
        ContentUnavailableView {
            Label {
                Base64Strings.text("base64.emptyTitle", "No output yet")
            } icon: {
                Image(systemName: "curlybraces")
            }
        } description: {
            Base64Strings.text("base64.emptyHint", "Enter text above to see the result here.")
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - Copy button (web `CopyButton`)

/// Copies `text` to the system pasteboard with a transient "Copied" confirmation,
/// the native parity of the web `CopyButton`. Cross-platform clipboard via UIKit
/// (iOS/iPadOS) or AppKit (macOS).
struct Base64CopyButton: View {
    let text: String
    @State private var copied = false

    var body: some View {
        Button(action: copy) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                if copied {
                    Base64Strings.text("action.copied", "Copied").font(Font.TS.caption)
                } else {
                    Base64Strings.text("action.copy", "Copy").font(Font.TS.caption)
                }
            }
            .foregroundStyle(copied ? Color.TS.statusSuccess : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            copied
                ? Base64Strings.text("action.copied", "Copied")
                : Base64Strings.text("action.copy", "Copy")
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
