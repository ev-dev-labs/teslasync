//
//  LiveTelemetrySegment.Views.swift
//  TeslaSync — P4 shared surface · 0180 · LiveTelemetrySegment (Apple)
//
//  The presentational leaves composed by ``LiveTelemetrySegment``, reproducing the web
//  `components/layout/status-bar/LiveTelemetrySegment.tsx` body: the dense single-line chip (a status
//  dot + a status icon + the short label + the muted "· {age}" stamp) and the status icon (the web
//  lucide `Wifi` / `WifiOff` / spinning `Loader2`). Every string arrives pre-resolved through the P1/S10
//  facade; every color comes from the P1/S9 tokens — no Tailwind ports, no raw hex. The chip is a pure
//  function of the resolved view-state; the link wrapper, tap handling, and accessibility live in the
//  parent surface. No networking lives here.
//

import SwiftUI

// MARK: - Tone → token

/// Maps the SwiftUI-free tone selector to a `Color.TS` value — the single place the emerald / amber /
/// rose / muted mapping becomes a concrete token, so the projection stays testable without SwiftUI. The
/// status dot pairs the tone with an SF Symbol so color is never the sole encoder.
extension LiveTelemetrySegmentTone {
    var color: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .muted: Color.TS.textMuted
        }
    }
}

// MARK: - Chip (web single-line segment body)

/// The dense status chip — the parity of the web `<Link>` body: a small tone dot, the status icon (the
/// `Loader2` spins while reconnecting), the short label (hidden in the `iconOnly` form), and the muted
/// "· {age}" freshness stamp (expanded + connected only). The whole chip is decorative for VoiceOver —
/// the parent surface owns the single accessible element with the status as its label.
struct LiveTelemetrySegmentChip: View {
    let resolved: LiveTelemetrySegmentResolved
    let reduceMotion: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(resolved.tone.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            LiveTelemetrySegmentStatusIcon(
                icon: resolved.icon,
                isSpinning: resolved.isSpinning,
                reduceMotion: reduceMotion
            )
            .font(Font.TS.caption)
            .foregroundStyle(resolved.tone.color)
            if resolved.showsLabel {
                Text(verbatim: resolved.shortLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(resolved.tone.color)
                if let ageText = resolved.ageText {
                    Text(verbatim: "· \(ageText)")
                        .font(Font.TS.caption)
                        .monospacedDigit()
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .padding(.horizontal, TSSpacing.xs)
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

// MARK: - Status icon (web lucide `Wifi` / `WifiOff` / spinning `Loader2`)

/// The status glyph — `wifi` (connected), `wifi.slash` (disconnected / idle), or a circular-arrows loader
/// that spins while reconnecting (the web `Loader2` `animate-spin`). The spin is gated on Reduce Motion so
/// it is a static glyph when the user has disabled motion. The icon is decorative (the surface already
/// voices the status), so it is hidden from VoiceOver (the web `aria-hidden`).
struct LiveTelemetrySegmentStatusIcon: View {
    let icon: LiveTelemetrySegmentIcon
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
