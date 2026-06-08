//
//  OnboardingGate.Views.swift
//  TeslaSync — P4 feature view · 0194 · OnboardingGate (Apple)
//
//  Small presentation primitives the surface composes: the verdict card (the gate's
//  pass / redirect outcome with its CTA), the three-anchor checklist (the onboarding
//  data the status feed reports), the empty/error notice, and the freshness chip +
//  connectivity banner the native state matrix adds. All render over the shared
//  design tokens — no hardcoded colors, no English literals (strings via P1/S10).
//

import SwiftUI

// MARK: - Notice (empty + error chrome)

/// A friendly icon + title + message with a retry affordance, used for the gate's
/// hold states (empty `!data`, failed status check). Never a blank box.
struct OnboardingGateNotice: View {
    enum Tone {
        case muted
        case danger

        var color: Color {
            switch self {
            case .muted: Color.TS.textMuted
            case .danger: Color.TS.statusDanger
            }
        }
    }

    let systemImage: String
    let tone: Tone
    let title: String
    let message: String
    let retry: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(tone.color)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(tone == .danger ? tone.color : Color.TS.textPrimary)
            }
            Text(verbatim: message)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            OnboardingGatePillButton(
                title: OnboardingGateStrings.string("onboarding.gate.retry", "Try again"),
                systemImage: "arrow.clockwise",
                tint: tone.color,
                action: retry
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(Color.TS.bg, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Verdict card (web pass / redirect outcome)

/// The gate's verdict, rendered as a card: a glyph, a title + supporting copy, and —
/// for the redirect verdict — the "Go to setup" CTA that drives `navigate(…)`.
struct OnboardingGateDecisionCard: View {
    let decision: GateDecision
    let goToOnboarding: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Image(systemName: glyph)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(tint)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(Font.TS.body)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.TS.textPrimary)
            }
            Text(verbatim: detail)
                .font(Font.TS.bodySm)
                .foregroundStyle(Color.TS.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if decision.isRedirect {
                OnboardingGatePillButton(
                    title: OnboardingGateStrings.string("onboarding.gate.redirect.cta", "Go to setup"),
                    systemImage: "arrow.right",
                    tint: tint,
                    action: goToOnboarding
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(TSSpacing.md)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(tint.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }

    private var glyph: String {
        switch decision {
        case .pass(.complete): "checkmark.seal.fill"
        case .pass: "arrow.forward.circle"
        case .redirect: "arrow.right.circle.fill"
        case .hold: "hourglass"
        }
    }

    private var tint: Color {
        switch decision {
        case .pass(.complete): Color.TS.statusSuccess
        case .pass: Color.TS.statusInfo
        case .redirect: Color.TS.accent
        case .hold: Color.TS.textMuted
        }
    }

    private var title: String {
        switch decision {
        case .pass(.complete):
            OnboardingGateStrings.string("onboarding.gate.complete.title", "You're all set")
        case .pass:
            OnboardingGateStrings.string("onboarding.gate.continue.title", "Continuing to your dashboard")
        case .redirect:
            OnboardingGateStrings.string("onboarding.gate.redirect.title", "Taking you to setup")
        case .hold:
            OnboardingGateStrings.string("onboarding.gate.loading", "Checking your setup…")
        }
    }

    private var detail: String {
        switch decision {
        case .pass(.complete):
            OnboardingGateStrings.string(
                "onboarding.gate.complete.body",
                "Setup is complete — your dashboard is ready."
            )
        case .pass:
            OnboardingGateStrings.string(
                "onboarding.gate.continue.body",
                "You can finish setup any time from Settings."
            )
        case .redirect:
            OnboardingGateStrings.string(
                "onboarding.gate.redirect.body",
                "Complete the remaining steps to unlock your dashboard."
            )
        case .hold:
            OnboardingGateStrings.string("onboarding.gate.loading", "Checking your setup…")
        }
    }
}

// MARK: - Anchor checklist (the three onboarding steps as data)

/// The three onboarding anchors as a compact checklist with an "x of 3" progress
/// label, giving the verdict context (web `OnboardingStatus` anchors).
struct OnboardingAnchorList: View {
    let anchors: [OnboardingAnchor]
    let completed: Int

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            Text(verbatim: progressLabel)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityLabel(Text(verbatim: progressLabel))
            ForEach(anchors, id: \.kind) { anchor in
                OnboardingAnchorRow(anchor: anchor)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
    }

    private var progressLabel: String {
        let format = OnboardingGateStrings.string("onboarding.gate.progress", "%1$d of %2$d complete")
        return String(format: format, completed, anchors.count)
    }
}

/// A single anchor row: a check (done) or hollow circle (pending) and the step name.
struct OnboardingAnchorRow: View {
    let anchor: OnboardingAnchor

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: anchor.done ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(anchor.done ? Color.TS.statusSuccess : Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: OnboardingGateAccessibility.anchorTitle(anchor.kind))
                .font(Font.TS.bodySm)
                .foregroundStyle(anchor.done ? Color.TS.textSecondary : Color.TS.textPrimary)
                .strikethrough(anchor.done, color: Color.TS.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: OnboardingGateAccessibility.anchorLabel(anchor)))
    }
}

// MARK: - Pill button (shared CTA / retry affordance)

/// A compact tinted capsule button used for the redirect CTA and the retry actions.
struct OnboardingGatePillButton: View {
    let title: String
    let systemImage: String
    let tint: Color
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
            }
            .foregroundStyle(tint)
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .background(tint.opacity(0.14), in: Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title))
        .accessibilityAddTraits(.isButton)
    }
}

// MARK: - Freshness chip (native chrome — `LiveConnectionState`)

/// A small dot + label reflecting live / stale / offline freshness, the same
/// affordance the dashboard surfaces use so the gate reads consistently.
struct OnboardingFreshnessChip: View {
    let connection: OnboardingGateConnection

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
        case .live: OnboardingGateStrings.string("onboarding.gate.live", "Live")
        case .stale: OnboardingGateStrings.string("onboarding.gate.stale", "Stale")
        case .offline: OnboardingGateStrings.string("onboarding.gate.offline", "Offline")
        }
    }
}

// MARK: - Connectivity banner (native chrome — stale / offline)

/// The inline banner shown above a cached verdict when the status feed is stale or
/// offline, so a non-live status is never presented as current.
struct OnboardingConnectivityBanner: View {
    let connection: OnboardingGateConnection

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
            ? OnboardingGateStrings.string("onboarding.gate.offlineBanner", "Offline — showing the last known status")
            : OnboardingGateStrings.string(
                "onboarding.gate.staleBanner",
                "Reconnecting — this status may be out of date"
            )
    }
}

// MARK: - Tint (background per verdict)

/// The background tint for a gate decision — the native analogue of the web
/// container's conditional `bg-…` class, keyed off the verdict instead of data.
enum OnboardingGateTint {
    static func color(for decision: GateDecision) -> Color {
        switch decision {
        case .pass(.complete): Color.TS.statusSuccess.opacity(0.06)
        case .pass: Color.TS.statusInfo.opacity(0.06)
        case .redirect: Color.TS.accent.opacity(0.08)
        case .hold(.error): Color.TS.statusDanger.opacity(0.06)
        case .hold: Color.TS.surfaceGlass
        }
    }
}
