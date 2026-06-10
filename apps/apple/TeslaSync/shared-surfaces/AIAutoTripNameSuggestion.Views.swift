//
//  AIAutoTripNameSuggestion.Views.swift
//  TeslaSync — P4 shared surface · 0007 · AIAutoTripNameSuggestion (Apple)
//
//  The presentational subviews composed by `AIAutoTripNameSuggestion`: the Helix brand mark (the
//  native parity of `components/branding/HelixMark.tsx`), the Helix badge pill (web `AIBadge`), the
//  feature card scaffold (web `AIFeatureCard` — header + Ask Helix button + output panel), the
//  universal Ask-Helix action button, the compact in-button thinking dots, and the freshness chip
//  (P4 connectivity axis). All consume the P1/S10 facade and the shared P1/S9 tokens / components —
//  no networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Helix brand mark (native parity of `components/branding/HelixMark.tsx`)

/// The Helix brand glyph — a stylised vertical double helix (two intertwined sinusoidal strands
/// with two connecting rungs), the native port of the web `HelixMark` SVG. Decorative; the brand
/// name is voiced by the surrounding badge / button label.
struct HelixMark: View {
    var size: CGFloat = 16
    var tint: Color = .TS.statusInfo

    var body: some View {
        HelixMarkShape()
            .stroke(
                tint,
                style: StrokeStyle(lineWidth: max(1, size / 11), lineCap: .round, lineJoin: .round)
            )
            .frame(width: size, height: size)
            .accessibilityHidden(true)
    }
}

/// The double-helix path used by `HelixMark` — two opposite-phase sine strands over the height with
/// two horizontal rungs at the parallel points (web HelixMark geometry).
struct HelixMarkShape: Shape {
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
struct AIBadge: View {
    var body: some View {
        let label = AITripNameStrings.string("trips.detail.aiSuggestName.badge", "Helix")
        return HStack(spacing: TSSpacing.xs) {
            HelixMark(size: 12)
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.statusInfo)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, 2)
        .background(Color.TS.statusInfo.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(Color.TS.statusInfo.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: AITripNameStrings.string("helix.ariaLabel", "Helix")))
    }
}

// MARK: - Feature card (web `AIFeatureCard`)

/// The Helix feature card scaffold — the native parity of the web `AIFeatureCard`: a glass panel
/// over a header (title + Helix badge + description + optional empty hint), the universal Ask Helix
/// action button, and the streaming output panel. Always rendered when the gate is on, so the
/// surface never collapses to a blank box.
struct AITripNameFeatureCard: View {
    let resolved: AITripNameResolved
    let onGenerate: () -> Void
    let onCancel: () -> Void
    let onRetry: () -> Void

    private static let descriptionFallback =
        "Get a short, propose-only name suggestion grounded in this trip\u{2019}s route context " +
        "(start and end places, drive count, distance, time window). The suggestion is never saved " +
        "automatically \u{2014} review the proposed name in the panel and click Save to apply it."

    var body: some View {
        TSGlassPanel {
            VStack(alignment: .leading, spacing: TSSpacing.lg) {
                header
                AskHelixButton(
                    canStart: resolved.canStart,
                    isStreaming: resolved.isStreaming,
                    onGenerate: onGenerate
                )
                .frame(maxWidth: .infinity, alignment: .trailing)
                AITripNameOutputView(phase: resolved.phase, onRetry: onRetry)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .onDisappear { onCancel() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.sm) {
                Text(verbatim: AITripNameStrings.string(
                    "trips.detail.aiSuggestName.title", "Suggest a trip name"
                ))
                .font(Font.TS.section)
                .foregroundStyle(Color.TS.textPrimary)
                .accessibilityAddTraits(.isHeader)
                AIBadge()
            }
            Text(verbatim: AITripNameStrings.string(
                "trips.detail.aiSuggestName.description", Self.descriptionFallback
            ))
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            if !resolved.canStart {
                Text(verbatim: emptyHint)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var emptyHint: String {
        resolved.hasTrip
            ? AITripNameStrings.string(
                "trips.detail.aiSuggestName.offlineHint", "Reconnect to suggest a name."
            )
            : AITripNameStrings.string(
                "trips.detail.aiSuggestName.noTripHint", "Open a trip to suggest a name."
            )
    }
}

// MARK: - Ask Helix button (web universal CTA)

/// The universal Helix action button — the native parity of the web `AIFeatureCard` button: a
/// Helix-marked outline button reading "Ask Helix" (idle) / "Helix is thinking…" (streaming),
/// disabled when the inputs are not ready or a stream is in flight (web `!canStart || streaming`).
/// Its accessibility label carries the per-feature verb (web `aria-label = "Ask Helix · …"`).
struct AskHelixButton: View {
    let canStart: Bool
    let isStreaming: Bool
    let onGenerate: () -> Void

    var body: some View {
        let askHelix = AITripNameStrings.string("helix.askHelix", "Ask Helix")
        let verb = AITripNameStrings.string(
            "trips.detail.aiSuggestName.generateButton", "Suggest a name"
        )
        let thinking = AITripNameStrings.string("helix.thinking", "Helix is thinking\u{2026}")
        return TSButton(variant: .secondary, size: .small, action: onGenerate) {
            HStack(spacing: TSSpacing.xs) {
                HelixMark(size: 14)
                if isStreaming {
                    HelixThinkingDots(label: thinking)
                } else {
                    Text(verbatim: askHelix)
                        .foregroundStyle(Color.TS.statusInfo)
                }
            }
        }
        .disabled(!canStart || isStreaming)
        .accessibilityLabel(Text(verbatim: AITripNameAccessibility.actionLabel(
            askHelix: askHelix, buttonLabel: verb
        )))
    }
}

// MARK: - In-button thinking dots (web `AIThinkingDots`)

/// The compact in-button thinking indicator — a label followed by three pulsing dots — the native
/// parity of the web `AIThinkingDots`. Motion respects Reduce Motion (the dots hold steady).
struct HelixThinkingDots: View {
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

/// The freshness chip shown beneath the card when the context is not live — a coloured dot + a
/// label (`Stale` / `Offline`). It is a button so VoiceOver and pointer users can re-request the
/// trip context, with an explicit label.
struct AITripNameFreshnessChip: View {
    let connection: AITripNameConnection
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
        case .live: AITripNameStrings.string("aiSuggestName.live", "Live")
        case .stale: AITripNameStrings.string("aiSuggestName.stale", "Stale")
        case .offline: AITripNameStrings.string("aiSuggestName.offline", "Offline")
        }
    }

    private var accessibilityLabelText: String {
        switch connection {
        case .live:
            label
        case .stale:
            AITripNameStrings.string("aiSuggestName.staleA11y", "Stale — tap to refresh")
        case .offline:
            AITripNameStrings.string(
                "aiSuggestName.offlineA11y", "Offline — showing the last known suggestion"
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
