//
//  CodeBlock.Views.swift
//  TeslaSync — P4 feature view · 0220 · CodeBlock (Apple)
//
//  The presentational subviews composed by `CodeBlock`: the rendered card (the header with the uppercased
//  language tag + the live-refresh affordance + the copy-to-clipboard button, over a horizontally
//  scrollable monospaced body), the copy button (with a brief "Copied" confirmation), and the live-state
//  connectivity banner. All consume the P1/S10 facade-resolved strings + the shared P1/S9 tokens — no
//  networking, no Tailwind ports, no raw hex, no syntax highlighting (web parity).
//
//  Colour parity (ADR-006 semantic, not literal): the web `--surface-overlay` card → surface token, the
//  `--border-subtle` hairlines → border token, the `--text-secondary` language tag → textSecondary, and
//  the `--text-primary` code body → textPrimary; the ghost copy button tones to textMuted, confirming in
//  statusSuccess.
//

import SwiftUI

// MARK: - Card (web `<div><header/><pre><code/></pre></div>`)

/// The rendered snippet: the header (language tag + live-refresh affordance + copy button) over a
/// horizontally scrollable monospaced body. The native parity of the web CodeBlock card.
struct CodeBlockCard: View {
    let projection: CodeBlockProjection
    let connection: CodeBlockConnection
    let isFetching: Bool
    let onCopy: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Rectangle()
                .fill(Color.TS.border)
                .frame(height: 1)
                .accessibilityHidden(true)
            codeBody
        }
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: projection.accessibilityLabel))
    }

    // MARK: Header (web `text-[11px] uppercase tracking-wider text-secondary` + CopyButton)

    private var header: some View {
        HStack(spacing: TSSpacing.sm) {
            Text(verbatim: projection.languageLabel.uppercased())
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .tracking(0.6)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .accessibilityHidden(true)
            Spacer(minLength: 0)
            if isFetching {
                ProgressView()
                    .controlSize(.mini)
                    .accessibilityHidden(true)
            }
            CodeBlockCopyButton(onCopy: onCopy)
        }
        .padding(.horizontal, TSSpacing.md)
        .padding(.vertical, TSSpacing.xs)
        .background(Color.TS.surfaceGlass)
    }

    // MARK: Body (web `<pre className="overflow-x-auto p-3 text-xs mono text-primary">`)

    private var codeBody: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            Text(verbatim: projection.code)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .lineSpacing(2)
                .textSelection(.enabled)
                .fixedSize(horizontal: true, vertical: false)
                .padding(TSSpacing.md)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - Copy button (web `<CopyButton iconOnly variant="ghost" size="sm">`)

/// The icon-only copy affordance. It briefly confirms with a checkmark (honoring Reduce Motion) and writes
/// the raw snippet text to the clipboard through the model's injected pasteboard seam.
struct CodeBlockCopyButton: View {
    let onCopy: () -> Void

    @State private var didCopy = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: copy) {
            Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(didCopy ? Color.TS.statusSuccess : Color.TS.textMuted)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(
            didCopy
                ? CodeBlockStrings.text("codeBlock.copied", "Copied")
                : CodeBlockStrings.text("codeBlock.a11y.copy", "Copy code")
        )
        .accessibilityAddTraits(.isButton)
    }

    private func copy() {
        onCopy()
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

// MARK: - Connectivity banner (live-state freshness — stale / offline)

/// The phase-independent freshness affordance shown above the card while the bound feed is reconnecting
/// (stale) or unreachable (offline): the surface keeps showing the cached snippet and this banner explains
/// why. The native parity of the prompt's stale-chip / offline-chip requirement, communicated across every
/// render phase rather than only the content card.
struct CodeBlockConnectivityBanner: View {
    let connection: CodeBlockConnection

    /// One banner's icon glyph, tone, and pre-localized message — modeled as a small value (not a tuple)
    /// so the freshness branch stays within the shared lint budget.
    private struct Descriptor {
        let icon: String
        let tone: Color
        let text: Text
    }

    private var descriptor: Descriptor? {
        switch connection {
        case .live:
            nil
        case .stale:
            Descriptor(
                icon: "arrow.triangle.2.circlepath",
                tone: Color.TS.statusWarning,
                text: CodeBlockStrings.text("codeBlock.staleBanner", "Reconnecting — showing the cached snippet")
            )
        case .offline:
            Descriptor(
                icon: "wifi.slash",
                tone: Color.TS.textMuted,
                text: CodeBlockStrings.text("codeBlock.offlineBanner", "Offline — showing the last received snippet")
            )
        }
    }

    var body: some View {
        if let descriptor {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: descriptor.icon)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(descriptor.tone)
                    .accessibilityHidden(true)
                descriptor.text
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(descriptor.tone.opacity(0.12), in: Capsule())
            .accessibilityElement(children: .combine)
        }
    }
}
