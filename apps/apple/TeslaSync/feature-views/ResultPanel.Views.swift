//
//  ResultPanel.Views.swift
//  TeslaSync — P4 feature view · 0008 · ResultPanel (Apple)
//
//  Small presentation primitives the surface composes: the copy affordance (web
//  `CopyButton` — Copy ⇄ Copied toggle), the scrollable monospaced code block (web
//  `<pre class="max-h-64 overflow-auto …">`), and the freshness chip + connectivity
//  banner the native state matrix adds. All render over the shared design tokens.
//

import SwiftUI

// MARK: - Copy button (web `CopyButton`: Copy ⇄ Copied, 2s reset)

/// The one-tap clipboard affordance — the native analogue of the web `CopyButton`.
/// Toggles its icon + label to "Copied" for two seconds (web `setTimeout(…, 2000)`),
/// honoring Reduce Motion, and announces the transition to VoiceOver.
struct ResultCopyButton: View {
    let perform: () -> Void
    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Button(action: handleTap) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: copied ? "checkmark.circle.fill" : "doc.on.doc")
                    .font(.system(size: 11, weight: .semibold))
                    .contentTransition(.symbolEffect(.replace))
                Text(verbatim: ResultPanelAccessibility.copyLabel(copied: copied))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .foregroundStyle(copied ? Color.TS.statusSuccess : Color.TS.textSecondary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(Color.TS.surfaceGlass, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .animation(reduceMotion ? nil : .easeInOut(duration: TSMotion.fastDuration), value: copied)
        .accessibilityLabel(Text(verbatim: ResultPanelAccessibility.copyLabel(copied: copied)))
        .accessibilityAddTraits(.isButton)
        .onDisappear { resetTask?.cancel() }
    }

    private func handleTap() {
        perform()
        copied = true
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}

// MARK: - Code block (web `<pre class="max-h-64 overflow-auto …">`)

/// The scrollable, monospaced JSON readout — the native analogue of the web `<pre>`
/// block: an inset surface, a bounded height with internal scrolling, and
/// selectable text so the value can be inspected or copied by hand.
struct ResultCodeBlock: View {
    let json: String
    /// Web `max-h-64` (16rem ≈ 256pt) before the block scrolls internally.
    private let maxHeight: CGFloat = 256

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            Text(verbatim: json)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(Color.TS.textPrimary)
                .textSelection(.enabled)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(TSSpacing.sm)
        }
        .frame(maxHeight: maxHeight)
        .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border, lineWidth: 1)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: json))
    }
}

// MARK: - Freshness chip (native chrome — `LiveConnectionState`)

/// A small dot + optional label reflecting live / stale / offline freshness, the
/// same affordance the dashboard surfaces use so the panel reads consistently.
struct ResultFreshnessChip: View {
    let connection: ResultConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: label)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(tone.opacity(0.12), in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: label))
    }

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ResultPanelStrings.string("devtools.resultPanel.live", "Live")
        case .stale: ResultPanelStrings.string("devtools.resultPanel.stale", "Stale")
        case .offline: ResultPanelStrings.string("devtools.resultPanel.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (native chrome — stale / offline)

/// The inline banner shown above a cached result when the feed is stale or offline,
/// so a non-live value is never presented as current.
struct ResultConnectivityBanner: View {
    let connection: ResultConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: connection == .offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var tone: Color {
        connection == .offline ? Color.TS.textMuted : Color.TS.statusWarning
    }

    private var label: String {
        connection == .offline
            ? ResultPanelStrings.string("devtools.resultPanel.offlineBanner", "Offline — showing the last result")
            : ResultPanelStrings.string("devtools.resultPanel.staleBanner", "Reconnecting — this result may be stale")
    }
}

// MARK: - Tint (web `error ? bg-neon-red/5 : hasData ? bg-neon-green/5 : bg-white/[0.02]`)

/// The background tint for a render variant, the native analogue of the web
/// container's conditional `bg-…` class.
enum ResultPanelTint {
    static func color(for variant: ResultVariant) -> Color {
        switch variant {
        case .error: Color.TS.statusDanger.opacity(0.06)
        case .result: Color.TS.statusSuccess.opacity(0.06)
        case .loading, .idle: Color.TS.surfaceGlass
        }
    }
}
