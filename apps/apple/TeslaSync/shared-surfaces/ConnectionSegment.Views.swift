//
//  ConnectionSegment.Views.swift
//  TeslaSync — P4 shared surface · 0178 · ConnectionSegment (Apple)
//
//  The presentational leaves composed by ``ConnectionSegment``, reproducing the web
//  `components/layout/status-bar/ConnectionSegment.tsx` body: the dense single-line chip (a tone dot + the
//  status icon + the "API" label + the muted "· {latency}ms" / "· Offline" / "· Stale" suffix) and the
//  status icon (the web lucide `Activity` / `AlertTriangle` / `CircleSlash` / `HelpCircle`). Every string
//  arrives pre-resolved through the P1/S10 facade; every colour comes from the P1/S9 tokens — no Tailwind
//  ports, no raw hex. The chip is a pure function of the resolved view-state; the link wrapper, tap
//  handling, and accessibility live in the parent surface. No networking lives here.
//

import SwiftUI

// MARK: - Tone → token

/// Maps the SwiftUI-free tone selector to a `Color.TS` value — the single place the emerald / amber / rose
/// / muted mapping becomes a concrete token, so the projection stays testable without SwiftUI. The status
/// dot pairs the tone with an SF Symbol so colour is never the sole encoder.
extension ConnectionSegmentTone {
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

/// The dense status chip — the parity of the web `<Link>` body: a small tone dot, the status icon, the
/// always-"API" short label (hidden in the `iconOnly` form), and the muted "· {latency}ms" / "· Offline" /
/// "· Stale" suffix. The whole chip is decorative for VoiceOver — the parent surface owns the single
/// accessible element with the status as its label.
struct ConnectionSegmentChip: View {
    let resolved: ConnectionSegmentResolved

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(resolved.tone.color)
                .frame(width: 6, height: 6)
                .accessibilityHidden(true)
            ConnectionSegmentStatusIcon(icon: resolved.icon)
                .font(Font.TS.caption)
                .foregroundStyle(resolved.tone.color)
            if resolved.showsLabel {
                Text(verbatim: resolved.shortLabel)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .foregroundStyle(resolved.tone.color)
                if let suffix = resolved.suffix {
                    Text(verbatim: "· \(suffix)")
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

// MARK: - Status icon (web lucide `Activity` / `AlertTriangle` / `CircleSlash` / `HelpCircle`)

/// The status glyph — `waveform.path.ecg` (Activity / online), `exclamationmark.triangle` (degraded),
/// `slash.circle` (offline), or `questionmark.circle` (connecting). The icon is decorative (the surface
/// already voices the status), so it is hidden from VoiceOver (the web `aria-hidden`).
struct ConnectionSegmentStatusIcon: View {
    let icon: ConnectionSegmentIcon

    private var systemName: String {
        switch icon {
        case .activity: "waveform.path.ecg"
        case .warning: "exclamationmark.triangle"
        case .slash: "slash.circle"
        case .help: "questionmark.circle"
        }
    }

    var body: some View {
        Image(systemName: systemName)
            .accessibilityHidden(true)
    }
}
