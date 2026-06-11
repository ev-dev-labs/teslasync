//
//  AchievementUnlockListener.Views.swift
//  TeslaSync — P4 shared surface · 0112 · AchievementUnlockListener (Apple)
//
//  The presentational subviews composed by `AchievementUnlockListener`: the celebration toast row (the
//  native parity of the web `AchievementUnlockedToast` — the achievement glyph, the "Achievement
//  Unlocked" eyebrow, the name + description, the View deep-link, and the dismiss control), the toast
//  stack (web `AchievementUnlockedToastStack`), and the freshness chip (P4 connectivity axis). All copy
//  resolves through the P1/S10 facade; all colour comes from the P1/S9 tokens; the shared `TSButton` /
//  `TSFadeIn` primitives are reused. No networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web toast's celebratory yellow chrome
//  (`border-yellow-500/40`, the `text-yellow-300` eyebrow + View link, the trophy glyph) maps to the
//  brand amber `statusWarning` token at the web fill / border opacities, so it adapts to light + dark.
//

import SwiftUI

// MARK: - Toast row (web `AchievementUnlockedToast`)

/// One celebration toast — the achievement emoji in an amber medallion, the trophy "Achievement
/// Unlocked" eyebrow, the achievement name + description, the "View" deep-link affordance, and the
/// dismiss control, wrapped in the shared fade-in (web spring entry, Reduce-Motion aware). The copy
/// block is one combined VoiceOver element voicing the eyebrow + name + description (the web
/// `role="status"`); the View + dismiss controls stay individually focusable with their own labels.
struct AchievementUnlockListenerToastRow: View {
    let toast: AchievementUnlockListenerToast
    let onView: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        TSFadeIn {
            HStack(alignment: .top, spacing: TSSpacing.md) {
                medallion
                VStack(alignment: .leading, spacing: TSSpacing.xs) {
                    copyBlock
                    viewButton
                }
                Spacer(minLength: 0)
                dismissButton
            }
            .padding(TSSpacing.md)
            .frame(maxWidth: 360, alignment: .leading)
            .background(
                Color.TS.statusWarning.opacity(0.08),
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.statusWarning.opacity(0.4), lineWidth: 1)
            )
            .accessibilityElement(children: .contain)
        }
    }

    private var medallion: some View {
        Text(verbatim: toast.icon)
            .font(.system(size: 24))
            .frame(width: 44, height: 44)
            .background(Color.TS.statusWarning.opacity(0.12), in: Circle())
            .overlay(Circle().strokeBorder(Color.TS.statusWarning.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }

    private var copyBlock: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                Text(verbatim: toast.eyebrow)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .tracking(0.6)
                    .foregroundStyle(Color.TS.statusWarning)
            }
            Text(verbatim: toast.name)
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
            if !toast.detail.isEmpty {
                Text(verbatim: toast.detail)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .lineLimit(2)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isStaticText)
        .accessibilityLabel(Text(verbatim: toast.accessibilityLabel))
    }

    private var viewButton: some View {
        TSButton(variant: .ghost, size: .small, action: onView) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: toast.viewLabel)
                Image(systemName: "arrow.right")
                    .font(.system(size: 11, weight: .semibold))
            }
        }
        .accessibilityLabel(Text(verbatim: toast.viewLabel))
    }

    private var dismissButton: some View {
        TSButton(variant: .ghost, size: .small, action: onDismiss) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
        }
        .accessibilityLabel(Text(verbatim: toast.dismissLabel))
    }
}

// MARK: - Toast stack (web `AchievementUnlockedToastStack`)

/// The celebration toast stack — one `AchievementUnlockListenerToastRow` per queued unlock, newest at
/// the top (the queue is already newest-first), the native parity of the web fixed-position stack.
struct AchievementUnlockListenerToastStack: View {
    let toasts: [AchievementUnlockListenerToast]
    let onView: (String) -> Void
    let onDismiss: (String) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.md) {
            ForEach(toasts) { toast in
                AchievementUnlockListenerToastRow(
                    toast: toast,
                    onView: { onView(toast.id) },
                    onDismiss: { onDismiss(toast.id) }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the stack when the feed is not live — a coloured dot + label
/// (`Stale` / `Offline`). A button so VoiceOver + pointer users can re-request the snapshot, with an
/// explicit label. Hidden entirely when live.
struct AchievementUnlockListenerFreshnessChip: View {
    let connection: AchievementUnlockListenerConnection
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
        case .live: AchievementUnlockListenerStrings.string("achievements.listener.live", "Live")
        case .stale: AchievementUnlockListenerStrings.string("achievements.listener.stale", "Stale")
        case .offline: AchievementUnlockListenerStrings.string("achievements.listener.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AchievementUnlockListenerStrings.string(
                "achievements.listener.staleA11y",
                "Stale — tap to refresh"
            )
        case .offline:
            AchievementUnlockListenerStrings.string(
                "achievements.listener.offlineA11y",
                "Offline — showing the last received unlocks"
            )
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
