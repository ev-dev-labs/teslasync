//
//  AchievementUnlockedToast.Views.swift
//  TeslaSync — P4 shared surface · 0111 · AchievementUnlockedToast (Apple)
//
//  The presentational subviews composed by the surface: the single celebration toast (the native
//  parity of the web `AchievementUnlockedToast` — the unlocked-badge medallion, the trophy eyebrow,
//  the name + description, the "View" + dismiss affordances, the confetti burst, and the 6s
//  auto-dismiss), the compact unlocked badge, the confetti overlay, and the freshness chip (P4
//  connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components — no
//  networking, no Tailwind ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the web celebration accent (`yellow-300/400/500`)
//  maps to the brand amber `statusWarning`, exactly as the sibling `AchievementBadge` surface maps it,
//  so the toast reads as "gold / unlocked" in both light and dark themes.
//
//  Accessibility note: the badge + eyebrow + name + description form one VoiceOver "status" element
//  (the web `role="status"` / `aria-live="polite"` announcement), while the "View" and dismiss
//  controls stay individually focusable with their own labels (web real `<button>`s).
//

import SwiftUI

// MARK: - Compact unlocked badge (web `AchievementBadge size="md"`, unlocked)

/// The toast's celebratory medallion — the emoji in the amber unlocked treatment plus the
/// "✓ Unlocked" status caption (the web badge's `lifetime.unlocked` line). A compact, self-contained
/// reproduction of the web `AchievementBadge` unlocked render; the name + description live in the
/// toast's text column, so the medallion carries only the icon + status. Decorative — the toast's
/// combined label speaks the content.
struct AchievementUnlockedBadgeView: View {
    let achievement: AchievementUnlockedAchievement

    var body: some View {
        VStack(spacing: TSSpacing.xs) {
            ZStack {
                Circle().fill(Color.TS.statusWarning.opacity(0.12))
                Circle().strokeBorder(Color.TS.statusWarning.opacity(0.35), lineWidth: 2)
                Text(verbatim: achievement.displayIcon)
                    .font(.system(size: 30))
            }
            .frame(width: 56, height: 56)
            Text(verbatim: AchievementUnlockedStrings.string("lifetime.unlocked", "✓ Unlocked"))
                .font(Font.TS.caption)
                .fontWeight(.medium)
                .foregroundStyle(Color.TS.statusWarning)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Confetti overlay (web confetti burst)

/// The confetti burst emitted from the badge centre — the native parity of the web `motion.span`
/// particles. Each particle starts at the origin and animates out to its terminal offset + rotation
/// while fading, over `AchievementConfetti.durationSeconds`. Decorative + non-interactive; an empty
/// particle set (Reduce Motion) renders nothing, honouring `prefers-reduced-motion`.
struct AchievementUnlockedConfettiView: View {
    let icon: String
    let particles: [AchievementConfettiParticle]
    @State private var launched = false

    var body: some View {
        ZStack {
            ForEach(particles) { particle in
                Text(verbatim: icon)
                    .font(.system(size: 14))
                    .offset(
                        x: launched ? particle.velocityX : 0,
                        y: launched ? particle.velocityY : 0
                    )
                    .rotationEffect(.degrees(launched ? particle.rotation : 0))
                    .opacity(launched ? 0 : 1)
                    .animation(
                        .timingCurve(0.16, 0.84, 0.44, 1, duration: AchievementConfetti.durationSeconds)
                            .delay(particle.delaySeconds),
                        value: launched
                    )
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .onAppear { launched = true }
    }
}

// MARK: - Single celebration toast (web `AchievementUnlockedToast`)

/// One achievement-unlocked celebration toast — the native parity of the web `AchievementUnlockedToast`
/// component. Renders the unlocked-badge medallion (with the confetti burst overlaid), the trophy
/// eyebrow, the achievement name + description, and the "View" + dismiss affordances; springs in on
/// appear (fade-only under Reduce Motion) and auto-dismisses after `lifetimeSeconds` (web `durationMs`).
public struct AchievementUnlockedToast: View {
    private let event: AchievementUnlockedEventData
    private let lifetimeSeconds: TimeInterval
    private let onView: () -> Void
    private let onDismiss: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var appeared = false
    @State private var dismissTask: Task<Void, Never>?

    public init(
        event: AchievementUnlockedEventData,
        lifetimeSeconds: TimeInterval = AchievementUnlockedLifetime.defaultSeconds,
        onView: @escaping () -> Void,
        onDismiss: @escaping () -> Void
    ) {
        self.event = event
        self.lifetimeSeconds = lifetimeSeconds
        self.onView = onView
        self.onDismiss = onDismiss
    }

    private var particles: [AchievementConfettiParticle] {
        AchievementConfetti.particles(
            reduceMotion: reduceMotion,
            seed: AchievementConfetti.seed(for: event.id)
        )
    }

    private var statusLabel: String {
        AchievementUnlockedAccessibility.toastLabel(
            eyebrow: eyebrowText,
            name: event.achievement.name,
            detail: event.achievement.detail
        )
    }

    private var eyebrowText: String {
        AchievementUnlockedStrings.string("achievements.toastEyebrow", "Achievement Unlocked")
    }

    public var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.md) {
            ZStack {
                AchievementUnlockedBadgeView(achievement: event.achievement)
                if !particles.isEmpty {
                    AchievementUnlockedConfettiView(
                        icon: event.achievement.displayIcon,
                        particles: particles
                    )
                }
            }

            VStack(alignment: .leading, spacing: TSSpacing.xs) {
                statusContent
                viewButton
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            dismissButton
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: 360, alignment: .leading)
        .background(
            Color.TS.statusWarning.opacity(0.06),
            in: RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
        )
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.lg, style: .continuous)
                .strokeBorder(Color.TS.statusWarning.opacity(0.40), lineWidth: 1)
        )
        .shadow(color: Color.TS.statusWarning.opacity(0.18), radius: 12, y: 4)
        .opacity(appeared ? 1 : 0)
        .scaleEffect(appeared || reduceMotion ? 1 : 0.96)
        .offset(y: appeared || reduceMotion ? 0 : 12)
        .onAppear(perform: handleAppear)
        .onDisappear {
            dismissTask?.cancel()
            dismissTask = nil
        }
    }

    /// The announced "status" element (web `role="status"`): eyebrow + name + description, spoken in
    /// one pass. The controls below stay separately focusable.
    private var statusContent: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "trophy.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.TS.statusWarning)
                    .accessibilityHidden(true)
                Text(verbatim: eyebrowText)
                    .font(Font.TS.label)
                    .fontWeight(.semibold)
                    .textCase(.uppercase)
                    .foregroundStyle(Color.TS.statusWarning)
            }
            Text(verbatim: event.achievement.name)
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .lineLimit(2)
            Text(verbatim: event.achievement.detail)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textSecondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: statusLabel))
        .accessibilityAddTraits(.updatesFrequently)
    }

    private var viewButton: some View {
        Button(action: onView) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: AchievementUnlockedStrings.string("achievements.view", "View"))
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                Image(systemName: "arrow.forward")
                    .font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(Color.TS.statusWarning)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: AchievementUnlockedStrings.string("achievements.view", "View")))
    }

    private var dismissButton: some View {
        Button(action: dismissNow) {
            Image(systemName: "xmark")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .padding(TSSpacing.xs)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: AchievementUnlockedStrings.string(
            "achievements.dismiss", "Dismiss achievement notification"
        )))
    }

    private func handleAppear() {
        withAnimation(reduceMotion ? nil : .spring(response: 0.45, dampingFraction: 0.75)) {
            appeared = true
        }
        startAutoDismiss()
    }

    private func dismissNow() {
        dismissTask?.cancel()
        dismissTask = nil
        onDismiss()
    }

    /// Schedules the one-shot auto-dismiss — the native parity of the web `setTimeout(onDismiss,
    /// durationMs)`, cancelled on disappear / manual dismiss. A non-positive lifetime disables it.
    private func startAutoDismiss() {
        guard lifetimeSeconds > 0 else { return }
        dismissTask?.cancel()
        dismissTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(lifetimeSeconds))
            guard !Task.isCancelled else { return }
            onDismiss()
        }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the stack when the feed is not live — a coloured dot + a label
/// (`Stale` / `Offline`). A button so VoiceOver and pointer users can re-request the snapshot, with an
/// explicit label.
struct AchievementUnlockedFreshnessChip: View {
    let connection: AchievementUnlockedConnection
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
        case .live: AchievementUnlockedStrings.string("achievements.live", "Live")
        case .stale: AchievementUnlockedStrings.string("achievements.stale", "Stale")
        case .offline: AchievementUnlockedStrings.string("achievements.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AchievementUnlockedStrings.string("achievements.staleA11y", "Stale — tap to refresh")
        case .offline:
            AchievementUnlockedStrings.string("achievements.offlineA11y", "Offline — showing the last known unlocks")
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
