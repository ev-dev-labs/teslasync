//
//  MarkdownRenderer.CodeBlock.swift
//  TeslaSync — P4 feature view · 0221 · MarkdownRenderer (Apple)
//
//  The fenced code block view for the chatbot markdown renderer — the native parity of the web source's
//  delegated CodeBlock.tsx: a bordered card with a header (the uppercased language tag + a copy-to-clipboard
//  button) over a horizontally scrollable monospaced body. No syntax highlighting (web parity — plain mono
//  keeps the bundle lean). Copy routes through the model's injected pasteboard seam; token-driven (P1/S9),
//  copy via the P1/S10 facade.
//

import SwiftUI

/// A fenced code block (web `CodeBlock`). The copy button briefly confirms with a checkmark, honoring
/// Reduce Motion, and copies the raw fenced text verbatim.
struct MarkdownCodeBlockView: View {
    let block: MarkdownCodeBlock
    let onCopy: (String) -> Void

    @State private var didCopy = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            body(for: block.code)
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibilityLabel)
    }

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: block.languageLabel.uppercased())
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .tracking(0.6)
                .foregroundStyle(Color.TS.textSecondary)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            copyButton
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass)
    }

    private var copyButton: some View {
        Button(action: copy) {
            HStack(spacing: 4) {
                Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                MarkdownRendererStrings.text(
                    didCopy ? "markdownRenderer.codeBlock.copied" : "markdownRenderer.codeBlock.copy",
                    didCopy ? "Copied" : "Copy"
                )
                .font(Font.TS.caption)
            }
            .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.textMuted)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            didCopy
                ? MarkdownRendererStrings.text("markdownRenderer.codeBlock.copied", "Copied")
                : MarkdownRendererStrings.text("markdownRenderer.codeBlock.copy", "Copy")
        )
        .accessibilityAddTraits(.isButton)
    }

    private func body(for code: String) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: code)
                .font(.system(.callout, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .padding(TSSpacing.sm)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var accessibilityLabel: Text {
        let template = MarkdownRendererStrings.string("markdownRenderer.codeBlock.a11y", "Code block, %@")
        return Text(verbatim: String(format: template, block.languageLabel))
    }

    private func copy() {
        onCopy(block.code)
        withAnimation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration)) {
            didCopy = true
        }
        Task {
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            withAnimation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration)) {
                didCopy = false
            }
        }
    }
}
