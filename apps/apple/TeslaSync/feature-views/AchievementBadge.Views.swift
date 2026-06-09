//
//  AchievementBadge.Views.swift
//  TeslaSync — P4 feature view · 0051 · AchievementBadge (Apple)
//
//  The presentational subviews composed by `AchievementBadge`: the badge tile (web
//  unlocked vs locked render), the inline progress ring (web `ProgressRing`), the
//  freshness chip (P4 connectivity axis), and the loading / empty / error chrome. All
//  consume the P1/S10 facade and the shared P1/S9 tokens — no networking, no Tailwind
//  ports, no raw hex.
//
//  Colour parity (ADR-006 semantic, not literal): the unlocked accent (web
//  `yellow-400/500`) and the near-complete ring (web `#eab308`) map to the brand amber
//  `statusWarning`; the locked ring (web `#6b7280`) maps to `textMuted`; the locked
//  tile's faint neutral tint (web `white/[0.03]`) maps to `textPrimary` at low alpha
//  so it adapts to both light and dark themes.
//

import SwiftUI

// MARK: - Per-size layout metrics (web `sizeConfig`)

/// The dimensional metrics for a badge size — the native mirror of the web
/// `sizeConfig` map (ring diameter, stroke, icon point size, the inter-row gap, and
/// the name font). Description and status fonts are fixed at the web `text-xs` size,
/// matching the source where only the name picks up `cfg.textSize`.
struct AchievementBadgeLayout {
    let ringDiameter: CGFloat
    let strokeWidth: CGFloat
    let iconPointSize: CGFloat
    let namePointSize: CGFloat
    let gap: CGFloat
    let contentWidth: CGFloat

    static func of(_ size: AchievementBadgeSize) -> AchievementBadgeLayout {
        switch size {
        case .sm:
            AchievementBadgeLayout(
                ringDiameter: 56, strokeWidth: 3, iconPointSize: 20,
                namePointSize: 12, gap: TSSpacing.xs, contentWidth: 96
            )
        case .md:
            AchievementBadgeLayout(
                ringDiameter: 72, strokeWidth: 4, iconPointSize: 30,
                namePointSize: 14, gap: TSSpacing.sm, contentWidth: 120
            )
        case .lg:
            AchievementBadgeLayout(
                ringDiameter: 96, strokeWidth: 5, iconPointSize: 36,
                namePointSize: 16, gap: TSSpacing.md, contentWidth: 144
            )
        }
    }

    /// The fixed web `text-xs` size used for the description + status footer.
    var captionPointSize: CGFloat {
        12
    }
}

// MARK: - Inline progress ring (web `ProgressRing`)

/// The locked badge's progress ring — a track plus a rounded arc trimmed to the
/// resolved 0...1 fraction (web `<ProgressRing value={pct} max={100} />`). The arc is
/// the brand amber when near-complete (web `#eab308`) and muted grey otherwise (web
/// `#6b7280`). Decorative: the spoken percentage lives on the composed tile label.
struct AchievementBadgeRing: View {
    let fraction: Double
    let nearComplete: Bool
    let lineWidth: CGFloat

    private var arcColor: Color {
        nearComplete ? Color.TS.statusWarning : Color.TS.textMuted
    }

    private var clamped: Double {
        min(max(fraction, 0), 1)
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(Color.TS.border, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: clamped)
                .stroke(arcColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Near-complete pulse (web `animate-pulse`, Reduce Motion aware)

/// The web `isNearComplete && 'animate-pulse'` treatment — a slow opacity breathe on
/// the tile, suppressed entirely under Reduce Motion (then the tile stays fully
/// opaque). Applied only when the badge is near completion.
private struct AchievementBadgePulse: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var animates: Bool {
        active && !reduceMotion
    }

    func body(content: Content) -> some View {
        content
            .opacity(animates && pulsing ? 0.6 : 1)
            .animation(
                animates ? .easeInOut(duration: 1.1).repeatForever(autoreverses: true) : nil,
                value: pulsing
            )
            .onAppear { if animates { pulsing = true } }
    }
}

private extension View {
    func achievementPulse(active: Bool) -> some View {
        modifier(AchievementBadgePulse(active: active))
    }
}

// MARK: - Shared tile surface (the rounded, bordered badge container)

extension View {
    /// The badge's rounded tile container — the shared padding / fill / border applied
    /// by the data tile and the loading / empty / error chrome so the surface keeps a
    /// consistent shape across every state (web `rounded-xl border …`).
    func achievementBadgeSurface(background: Color, border: Color) -> some View {
        padding(TSSpacing.md)
            .frame(maxWidth: .infinity)
            .background(background, in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(border, lineWidth: 1)
            )
    }
}

// MARK: - Badge tile (web non-chrome render: circle + name + description + status)

/// The resolved badge tile — the unlocked / locked circle (ring + grayscale icon when
/// locked, full-colour icon when unlocked), the name, the description, and the
/// unlocked-or-percent footer, wrapped in the shared fade-in (web `FadeIn`).
struct AchievementBadgeTile: View {
    let resolved: AchievementBadgeResolved
    let achievement: AchievementBadgeData

    private var layout: AchievementBadgeLayout {
        AchievementBadgeLayout.of(resolved.size)
    }

    private var statusText: String {
        resolved.unlocked
            ? AchievementBadgeStrings.string("lifetime.unlocked", "✓ Unlocked")
            : AchievementBadgeFormat.percentLabel(progress: achievement.progress)
    }

    private var accessibilityStatus: String {
        if resolved.unlocked {
            return AchievementBadgeStrings.string("achievement.a11y.unlockedStatus", "Unlocked")
        }
        return String(
            format: AchievementBadgeStrings.string("achievement.a11y.progressStatus", "%lld percent complete"),
            resolved.percent
        )
    }

    var body: some View {
        TSFadeIn {
            VStack(spacing: layout.gap) {
                badgeCircle
                name
                description
                status
            }
            .achievementBadgeSurface(background: tileBackground, border: tileBorder)
            .achievementPulse(active: resolved.isNearComplete)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(verbatim: AchievementBadgeAccessibility.badgeLabel(
                name: achievement.name,
                description: achievement.description,
                status: accessibilityStatus
            )))
        }
    }

    private var badgeCircle: some View {
        ZStack {
            if !resolved.unlocked {
                AchievementBadgeRing(
                    fraction: resolved.ringFraction,
                    nearComplete: resolved.isNearComplete,
                    lineWidth: layout.strokeWidth
                )
            }
            Text(verbatim: achievement.icon)
                .font(.system(size: layout.iconPointSize))
                .grayscale(resolved.unlocked ? 0 : 1)
                .opacity(resolved.unlocked ? 1 : 0.5)
        }
        .frame(width: layout.ringDiameter, height: layout.ringDiameter)
        .accessibilityHidden(true)
    }

    private var name: some View {
        Text(verbatim: achievement.name)
            .font(.system(size: layout.namePointSize, weight: .semibold))
            .foregroundStyle(resolved.unlocked ? Color.TS.statusWarning : Color.TS.textSecondary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: layout.contentWidth)
    }

    private var description: some View {
        Text(verbatim: achievement.description)
            .font(.system(size: layout.captionPointSize))
            .foregroundStyle(Color.TS.textMuted)
            .multilineTextAlignment(.center)
            .lineLimit(3)
            .minimumScaleFactor(0.7)
            .frame(maxWidth: layout.contentWidth)
    }

    private var status: some View {
        Text(verbatim: statusText)
            .font(.system(size: layout.captionPointSize, weight: resolved.unlocked ? .medium : .regular))
            .monospacedDigit()
            .foregroundStyle(resolved.unlocked ? Color.TS.statusWarning : Color.TS.textMuted)
    }

    private var tileBackground: Color {
        resolved.unlocked
            ? Color.TS.statusWarning.opacity(0.10)
            : Color.TS.textPrimary.opacity(0.04)
    }

    private var tileBorder: Color {
        resolved.unlocked
            ? Color.TS.statusWarning.opacity(0.35)
            : Color.TS.border
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the tile when the feed is not live — a coloured
/// dot + label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users
/// can re-request the snapshot (the web parent's re-fetch), with an explicit label.
struct AchievementBadgeFreshnessChip: View {
    let connection: AchievementBadgeConnection
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
        case .live: AchievementBadgeStrings.string("achievement.live", "Live")
        case .stale: AchievementBadgeStrings.string("achievement.stale", "Stale")
        case .offline: AchievementBadgeStrings.string("achievement.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AchievementBadgeStrings.string("achievement.staleA11y", "Stale — tap to refresh")
        case .offline:
            AchievementBadgeStrings.string("achievement.offlineA11y", "Offline — showing last known data")
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
