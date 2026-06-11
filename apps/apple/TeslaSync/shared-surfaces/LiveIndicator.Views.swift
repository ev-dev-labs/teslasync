//
//  LiveIndicator.Views.swift
//  TeslaSync — P4 shared surface · 0094 · LiveIndicator (Apple)
//
//  The presentational leaves composed by `LiveIndicator`, reproducing the web
//  `components/data-display/LiveIndicator.tsx` body: the bare dot (web `variant === 'dot'` span), the
//  status chip (web pill / compact span: a bordered, tinted capsule with an icon, a label, and the
//  optional freshness stamp), and the status icon (web lucide `Wifi` / `WifiOff` / spinning
//  `Loader2`). Every string arrives pre-resolved through the P1/S10 facade; every color comes from
//  the P1/S9 tokens — no Tailwind ports, no raw hex. The whole badge is one VoiceOver element with the
//  status as its label and the freshness as its value, marked `updatesFrequently` (the parity of the
//  web `role="status"` live region). No networking lives here.
//

import SwiftUI

// MARK: - Tone → token

/// Maps the SwiftUI-free tone selector to a `Color.TS` value — the single place the emerald / amber /
/// rose / muted mapping becomes a concrete token, so the projection stays testable without SwiftUI.
extension LiveIndicatorTone {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        }
    }

    /// The capsule fill opacity (web `bg-{tone}-500/10`; the muted/unknown chip is fainter, the web
    /// `bg-white/[0.03]`).
    var fillOpacity: Double {
        self == .muted ? 0.08 : 0.12
    }
}

// MARK: - Dot (web `variant === 'dot'`)

/// The bare colored dot — the parity of the web `<span className="h-2 w-2 rounded-full" />`. No text;
/// a single VoiceOver element labelled with the status, and the status as pointer help (the web
/// `title`). Marked `updatesFrequently` so assistive tech treats it as a live status.
struct LiveIndicatorDot: View {
    let resolved: LiveIndicatorResolved

    var body: some View {
        Circle()
            .fill(resolved.tone.color)
            .frame(width: 8, height: 8)
            .help(Text(verbatim: resolved.label))
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Chip (web pill / compact)

/// The status chip — the parity of the web bordered, tinted capsule (`inline-flex … rounded-full
/// border px-2 py-0.5 text-xs`): the status icon, the label, and (pill only) the muted freshness
/// stamp. One VoiceOver element with the status as its label and the freshness as its value.
struct LiveIndicatorChip: View {
    let resolved: LiveIndicatorResolved
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            LiveIndicatorStatusIcon(
                icon: resolved.icon,
                isSpinning: resolved.isSpinning,
                reduceMotion: reduceMotion
            )
            Text(verbatim: resolved.label)
            if let freshness = resolved.freshness {
                Text(verbatim: "· \(freshness)")
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .font(Font.TS.caption)
        .foregroundStyle(resolved.tone.color)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs / 2)
        .background(resolved.tone.color.opacity(resolved.tone.fillOpacity), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.border, lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: resolved.accessibilityLabel))
        .liveIndicatorAccessibilityValue(resolved.accessibilityValue)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Status icon (web lucide `Wifi` / `WifiOff` / spinning `Loader2`)

/// The status glyph — `wifi` (connected), `wifi.slash` (disconnected / unknown), or a circular-arrows
/// loader that spins while reconnecting (the web `Loader2` `animate-spin`). The spin is gated on
/// Reduce Motion so it is a static glyph when the user has disabled motion. The icon is decorative
/// (the chip already voices the status), so it is hidden from VoiceOver (the web `aria-hidden`).
struct LiveIndicatorStatusIcon: View {
    let icon: LiveIndicatorIcon
    let isSpinning: Bool
    let reduceMotion: Bool

    @State private var rotating = false

    private var systemName: String {
        switch icon {
        case .wifi: "wifi"
        case .reconnecting: "arrow.triangle.2.circlepath"
        case .wifiSlash: "wifi.slash"
        }
    }

    var body: some View {
        Image(systemName: systemName)
            .rotationEffect(.degrees(shouldAnimate && rotating ? 360 : 0))
            .animation(spinAnimation, value: rotating)
            .onAppear { if shouldAnimate { rotating = true } }
            .accessibilityHidden(true)
    }

    private var shouldAnimate: Bool {
        isSpinning && !reduceMotion
    }

    private var spinAnimation: Animation? {
        shouldAnimate ? .linear(duration: 1).repeatForever(autoreverses: false) : nil
    }
}

// MARK: - Accessibility helper

private extension View {
    /// Applies the freshness as the accessibility value only when present, so a chip without a
    /// freshness stamp (dot / compact / non-connected) carries no empty announcement.
    @ViewBuilder
    func liveIndicatorAccessibilityValue(_ value: String?) -> some View {
        if let value, !value.isEmpty {
            accessibilityValue(Text(verbatim: value))
        } else {
            self
        }
    }
}
