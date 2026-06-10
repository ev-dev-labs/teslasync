//
//  AITripPostcardShareCardImageGeneration.Views.swift
//  TeslaSync — P4 shared surface · 0056 · AITripPostcardShareCardImageGeneration (Apple)
//
//  The presentational subviews composed by `AITripPostcardShareCardImageGeneration`: the Helix brand
//  mark (the native parity of `components/branding/HelixMark.tsx`), the Helix badge pill (web
//  `AIBadge`), the feature card scaffold (web `AIFeatureCard` — header + Ask Helix button + output
//  panel), the universal Ask-Helix action button, the compact in-button thinking dots, and the
//  freshness chip (P4 connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens /
//  components — no networking, no Tailwind ports, no raw hex. All types are prefixed so they coexist
//  with sibling AI surfaces in the same app module.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — a stylised vertical double helix (two intertwined sinusoidal strands with
/// two connecting rungs), the native port of the web `HelixMark` SVG. Decorative; the brand name is
/// voiced by the surrounding badge / button label.
struct PostcardHelixMark: View {
    var size: CGFloat = 16
    var tint: Color = .TS.statusInfo

    var body: some View {
        PostcardHelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: max(1, size / 11), lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path used by `PostcardHelixMark` — two opposite-phase sine strands over the
/// height with two horizontal rungs at the parallel points (web HelixMark geometry).
struct PostcardHelixMarkShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let steps = 28
        let amplitude = rect.width * 0.30
        let midX = rect.midX

        for phase in [0.0, Double.pi] {
            for index in 0 ... steps {
                let ratio = Double(index) / Double(steps)
                let point = CGPoint(
                    x: midX + CGFloat(sin(ratio * .pi * 2 + phase)) * amplitude,
                    y: rect.minY + CGFloat(ratio) * rect.height
                )
                if index == 0 {
                    path.move(to: point)
                } else {
                    path.addLine(to: point)
                }
            }
        }

        for rung in [0.32, 0.68] {
            let posY = rect.minY + CGFloat(rung) * rect.height
            path.move(to: CGPoint(x: midX - amplitude * 0.55, y: posY))
            path.addLine(to: CGPoint(x: midX + amplitude * 0.55, y: posY))
        }
        return path
    }
}

// MARK: - Helix badge (web `AIBadge`)

/// The small cyan "Helix" pill rendered next to the feature title — the native parity of the web
/// `AIBadge`. The brand name is voiced as one VoiceOver element.
struct AIPostcardBadge: View {
    var body: some View {
        let label = AIPostcardStrings.string("sharing.aiTripPostcard.badge", "Helix")
        return HStack(spacing: TSSpacing.xs) {
            PostcardHelixMark(size: 12)
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.statusInfo)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.statusInfo.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.statusInfo.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AIPostcardStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Feature card (web `AIFeatureCard`)

/// The Helix feature card scaffold — the native parity of the web `AIFeatureCard`: a glass panel over
/// a header (title + Helix badge + description + optional empty hint), the universal Ask Helix action
/// button, and the streaming output panel. Always rendered when the gate is on, so the surface never
/// collapses to a blank box.
struct AIPostcardFeatureCard: View {
    let resolved: AIPostcardResolved
    let onGenerate: () -> Void
    let onCancel: () -> Void
    let onRetry: () -> Void

    private static let descriptionFallback =
        "Ask Helix to draft a propose-only image prompt and preview spec for the selected trip\u{2019}s " +
        "share card. Helix only sees the redacted trip context (distance, duration, drive count, " +
        "vehicle name) \u{2014} never raw coordinates or street addresses. The draft is never published " +
        "automatically; review it here, then use the existing Share button on the trip to publish a " +
        "static share card."

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                AskHelixPostcardButton(
                    canStart: resolved.canStart,
                    isStreaming: resolved.isStreaming,
                    onGenerate: onGenerate
                )
                .frame(maxWidth: .infinity, alignment: .trailing)
                AIPostcardOutputView(phase: resolved.phase, onRetry: onRetry)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onDisappear { onCancel() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: AIPostcardStrings.string(
                    "sharing.aiTripPostcard.title", "Draft a Helix share-card image"
                ))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
                AIPostcardBadge()
            }
            Text(verbatim: AIPostcardStrings.string(
                "sharing.aiTripPostcard.description", Self.descriptionFallback
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            if !resolved.canStart {
                Text(verbatim: emptyHint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var emptyHint: String {
        resolved.hasTrip
            ? AIPostcardStrings.string(
                "sharing.aiTripPostcard.offlineHint", "Reconnect to draft a share card."
            )
            : AIPostcardStrings.string(
                "sharing.aiTripPostcard.noTripHint",
                "Pick a trip from the list above to enable Helix."
            )
    }
}

// MARK: - Ask Helix button (web universal CTA)

/// The universal Helix action button — the native parity of the web `AIFeatureCard` button: a
/// Helix-marked outline button reading "Ask Helix" (idle) / "Helix is thinking…" (streaming),
/// disabled when the inputs are not ready or a stream is in flight (web `!canStart || streaming`).
/// Its accessibility label carries the per-feature verb (web `aria-label = "Ask Helix · …"`).
struct AskHelixPostcardButton: View {
    let canStart: Bool
    let isStreaming: Bool
    let onGenerate: () -> Void

    var body: some View {
        let askHelix = AIPostcardStrings.string("helix.askHelix", "Ask Helix")
        let verb = AIPostcardStrings.string(
            "sharing.aiTripPostcard.button", "Generate share card"
        )
        let thinking = AIPostcardStrings.string("helix.thinking", "Helix is thinking\u{2026}")
        return TSButton(variant: .secondary, size: .small, action: onGenerate) {
            HStack(spacing: TSSpacing.xs) {
                PostcardHelixMark(size: 14)
                if isStreaming {
                    PostcardHelixThinkingDots(label: thinking)
                } else {
                    Text(verbatim: askHelix)
                        .foregroundStyle(Color.TS.statusInfo)
                }
            }
        }
        .disabled(!canStart || isStreaming)
        .accessibilityLabel(Text(verbatim: AIPostcardAccessibility.actionLabel(
            askHelix: askHelix, buttonLabel: verb
        )))
    }
}

// MARK: - In-button thinking dots (web `AIThinkingDots`)

/// The compact in-button thinking indicator — a label followed by three pulsing dots — the native
/// parity of the web `AIThinkingDots`. Motion respects Reduce Motion (the dots hold steady).
struct PostcardHelixThinkingDots: View {
    let label: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Text(verbatim: label)
                .foregroundStyle(Color.TS.statusInfo)
            HStack(spacing: 2) {
                ForEach(0 ..< 3, id: \.self) { index in
                    Circle()
                        .fill(Color.TS.statusInfo)
                        .frame(width: 3, height: 3)
                        .opacity(reduceMotion ? 0.6 : (animating ? 1 : 0.3))
                        .animation(
                            reduceMotion ? nil :
                                .easeInOut(duration: 0.6).repeatForever().delay(Double(index) * 0.15),
                            value: animating
                        )
                }
            }
            .accessibilityHidden(true)
        }
        .onAppear { animating = true }
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown beneath the card when the context is not live — a coloured dot + a label
/// (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the trip
/// context, with an explicit label.
struct AIPostcardFreshnessChip: View {
    let connection: AIPostcardConnection
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
        case .live: AIPostcardStrings.string("aiTripPostcard.live", "Live")
        case .stale: AIPostcardStrings.string("aiTripPostcard.stale", "Stale")
        case .offline: AIPostcardStrings.string("aiTripPostcard.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AIPostcardStrings.string("aiTripPostcard.staleA11y", "Stale — tap to refresh")
        case .offline:
            AIPostcardStrings.string(
                "aiTripPostcard.offlineA11y", "Offline — showing the last known draft"
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
