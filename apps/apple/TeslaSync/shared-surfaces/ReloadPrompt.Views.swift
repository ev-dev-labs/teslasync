//
//  ReloadPrompt.Views.swift
//  TeslaSync — P4 shared surface · 0136 · ReloadPrompt (Apple)
//
//  The presentational subviews composed by the surface: the new-version reload banner (the native
//  parity of the web `ReloadPrompt` — the spinning refresh glyph, the "New version available" title, the
//  live "Reloading in Ns..." countdown, and the "Later" + "Reload Now" affordances, with the one-second
//  auto-reload tick) and the freshness chip (P4 connectivity axis). All consume the P1/S10 facade and
//  the shared P1/S9 tokens / components — no networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web accent (`neon-cyan`) maps to the brand
//  `accent`, so the banner reads as the same "system / informational" tone in both light and dark
//  themes. The refresh glyph spins continuously (web `animate-spin`), falling back to a static glyph
//  under Reduce Motion; the countdown itself always advances (it is information, not decoration).
//
//  Accessibility note: the glyph + title + countdown form one VoiceOver element (the web `role="alert"`
//  / `aria-live="polite"` announcement), while the "Later" and "Reload Now" controls stay individually
//  focusable with their own labels (web real `<button>`s).
//

import SwiftUI

// MARK: - Reload banner (web `ReloadPrompt`)

/// The new-version reload banner — the native parity of the web `ReloadPrompt` component. Renders the
/// spinning refresh glyph, the title, the live countdown status, and the "Later" / "Reload Now"
/// affordances; drives the one-second countdown tick (web `setInterval(..., 1000)`) for as long as it is
/// on screen, which is exactly the window the data phase is shown.
public struct ReloadPromptBanner: View {
    private let countdown: Int
    private let onTick: () -> Void
    private let onLater: () -> Void
    private let onReloadNow: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spinning = false

    public init(
        countdown: Int,
        onTick: @escaping () -> Void,
        onLater: @escaping () -> Void,
        onReloadNow: @escaping () -> Void
    ) {
        self.countdown = countdown
        self.onTick = onTick
        self.onLater = onLater
        self.onReloadNow = onReloadNow
    }

    private var titleText: String {
        ReloadPromptStrings.string("pwa.newVersion", "New version available")
    }

    private var statusText: String {
        ReloadPromptCopy.reloadingIn(
            template: ReloadPromptStrings.string("pwa.reloadingIn", "Reloading in {{seconds}}s..."),
            seconds: countdown
        )
    }

    public var body: some View {
        HStack(spacing: TSSpacing.md) {
            glyph
            messageColumn
            Spacer(minLength: TSSpacing.sm)
            laterButton
            reloadButton
        }
        .padding(TSSpacing.lg)
        .frame(maxWidth: 420, alignment: .leading)
        .tsGlassPanel()
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.accent.opacity(0.30), lineWidth: 1)
        )
        .shadow(color: Color.TS.accent.opacity(0.18), radius: 12, y: 4)
        .accessibilityElement(children: .contain)
        .task(id: countdown) {
            // The web `setInterval(..., 1000)` cadence: one tick per second for as long as the banner is
            // shown. Re-armed on each rendered second; cancelled automatically when the banner leaves.
            try? await Task.sleep(for: .seconds(1))
            guard !Task.isCancelled else { return }
            onTick()
        }
        .onAppear { spinning = true }
    }

    private var glyph: some View {
        Image(systemName: "arrow.triangle.2.circlepath")
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(Color.TS.accent)
            .rotationEffect(.degrees(spinning ? 360 : 0))
            .animation(
                reduceMotion ? nil : .linear(duration: 1).repeatForever(autoreverses: false),
                value: spinning
            )
            .padding(TSSpacing.sm)
            .background(Color.TS.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.md))
            .accessibilityHidden(true)
    }

    private var messageColumn: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: titleText)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(1)
            Text(verbatim: statusText)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(1)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: ReloadPromptAccessibility.bannerLabel(
            title: titleText, status: statusText
        )))
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var laterButton: some View {
        TSButton(variant: .ghost, size: .small, action: onLater) {
            Text(verbatim: ReloadPromptStrings.string("pwa.later", "Later"))
        }
        .accessibilityLabel(Text(verbatim: ReloadPromptStrings.string("pwa.later", "Later")))
    }

    private var reloadButton: some View {
        TSButton(variant: .primary, size: .small, action: onReloadNow) {
            Text(verbatim: ReloadPromptStrings.string("pwa.reloadNow", "Reload Now"))
        }
        .accessibilityLabel(Text(verbatim: ReloadPromptStrings.string("pwa.reloadNow", "Reload Now")))
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the banner when the registration is not live — a coloured dot + a
/// label (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request an update check,
/// with an explicit label.
struct ReloadPromptFreshnessChip: View {
    let connection: ReloadPromptConnection
    let onRefresh: () -> Void

    private var tone: Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }

    private var label: String {
        switch connection {
        case .live: ReloadPromptStrings.string("pwa.live", "Live")
        case .stale: ReloadPromptStrings.string("pwa.stale", "Stale")
        case .offline: ReloadPromptStrings.string("pwa.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            ReloadPromptStrings.string("pwa.staleA11y", "Stale — tap to check again")
        case .offline:
            ReloadPromptStrings.string("pwa.offlineA11y", "Offline — update checks paused")
        }
    }

    var body: some View {
        Button(action: onRefresh) {
            HStack(spacing: TSSpacing.xs) {
                Circle().fill(tone).frame(width: 6, height: 6)
                Text(verbatim: label)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(tone.opacity(0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: accessibilityLabelText))
    }
}
