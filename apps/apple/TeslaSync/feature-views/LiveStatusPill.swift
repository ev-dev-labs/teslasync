//
//  LiveStatusPill.swift
//  TeslaSync — P4 feature view · 0249 · LiveStatusPill (Apple)
//
//  Native, Apple-idiomatic parity of the web `LiveStatusPill`
//  (web/src/features/system/components/status/LiveStatusPill.tsx).
//
//  A pure presentational chip mounted beside the Refresh button on the
//  System Status surface: a tinted capsule pairing a status dot, a connection
//  glyph, the state label, a middot, and an "updated <relative>" readout. It
//  owns no data — exactly like the web component — so the loading / empty /
//  error / stale states belong to whatever surface embeds the pill; the pill
//  itself reproduces the three connection tones the web `TONE` map carries
//  (`live` / `reconnecting` / `offline`) plus the `lastUpdateAt == nil` "no
//  update yet" branch (web `"—"`).
//
//  The structural decisions (tone, pulse, glyph, label, relative bucket) are
//  derived by ``LiveStatusPillPresentation``; this file is just the layout. On
//  appear it emits the P1/S11 `view.opened` diagnostics event with the
//  ``LiveStatusPillSurface/slug``.
//

import SwiftUI

// MARK: - LiveStatusPill (the feature surface)

/// The composable live-connection chip. Bind the SSE `state`, the last-delivery
/// instant (`lastUpdateAt`, epoch milliseconds or `nil`), and the advancing
/// `now` tick (epoch milliseconds) — the same numeric contract the web parent
/// passes. The tint, glyph, pulse, label, and relative readout are derived by
/// ``LiveStatusPillPresentation``.
public struct LiveStatusPill: View {
    private let presentation: LiveStatusPillPresentation
    private let telemetry: any LiveStatusPillTelemetry

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    /// Designated initialiser.
    /// - Parameters:
    ///   - state: the SSE connection state (web `state`).
    ///   - lastUpdateAt: the last delivery instant in epoch milliseconds, or
    ///     `nil` when nothing has arrived yet (web `lastUpdateAt`, `null` ⇒ "—").
    ///   - now: the current instant in epoch milliseconds; the parent advances it
    ///     so the relative label re-renders (web `now`).
    ///   - telemetry: diagnostics sink; defaults to the `os_log` sink.
    public init(
        state: LiveStatusState,
        lastUpdateAt: Double?,
        now: Double,
        telemetry: any LiveStatusPillTelemetry = OSLogLiveStatusPillTelemetry()
    ) {
        presentation = LiveStatusPillPresentation(state: state, now: now, lastUpdateAt: lastUpdateAt)
        self.telemetry = telemetry
    }

    public var body: some View {
        HStack(spacing: Self.gap) {
            dot
            icon
            label
            separator
            relative
        }
        .font(Font.TS.label)
        .monospacedDigit()
        .padding(.horizontal, Self.paddingHorizontal)
        .padding(.vertical, Self.paddingVertical)
        .background(presentation.tint.opacity(Self.fillOpacity), in: Capsule(style: .continuous))
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(presentation.tint.opacity(Self.ringOpacity), lineWidth: 1)
        )
        .fixedSize()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: presentation.accessibilityLabel))
        .accessibilityAddTraits(.updatesFrequently)
        .onAppear {
            // web `animate-pulse` — only the reconnecting tone pulses, and only
            // when Reduce Motion is off.
            guard presentation.pulses, !reduceMotion else { return }
            withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
                pulsing = true
            }
        }
        .task { LiveStatusPillSurface.reportOpen(to: telemetry) }
    }

    // MARK: Status dot (web `<span class="h-2 w-2 rounded-full" />`)

    private var dot: some View {
        Circle()
            .fill(presentation.tint)
            .frame(width: Self.dotSize, height: Self.dotSize)
            .opacity(pulsing ? Self.pulseMinOpacity : 1)
            .accessibilityHidden(true)
    }

    // MARK: Glyph (web Lucide `Activity` / `Wifi` / `WifiOff`)

    private var icon: some View {
        Image(systemName: presentation.iconSystemName)
            .font(.system(size: Self.iconSize, weight: .medium))
            .foregroundStyle(presentation.tint)
            .accessibilityHidden(true)
    }

    // MARK: State label (web `<span>{tone.label}</span>`)

    private var label: some View {
        Text(verbatim: presentation.labelText)
            .foregroundStyle(presentation.tint)
    }

    // MARK: Separator (web decorative middot, `aria-hidden`)

    private var separator: some View {
        Text(verbatim: Self.separatorGlyph)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }

    // MARK: Relative readout (web `<span>{rel}</span>`, text-muted)

    private var relative: some View {
        Text(verbatim: presentation.relativeText)
            .foregroundStyle(Color.TS.textMuted)
    }

    // MARK: Geometry (web `gap-1.5 px-2.5 py-1`, dot `h-2 w-2`, icon `h-3.5`)

    private static let gap: CGFloat = 6
    private static let paddingHorizontal: CGFloat = 10
    private static let paddingVertical: CGFloat = 4
    private static let dotSize: CGFloat = 8
    private static let iconSize: CGFloat = 14
    private static let fillOpacity: Double = 0.1
    private static let ringOpacity: Double = 0.3
    private static let pulseMinOpacity: Double = 0.4
    /// A typographic middot separator (web `·`), not localizable prose; hidden
    /// from VoiceOver exactly as the web marks it `aria-hidden`.
    private static let separatorGlyph = "·"
}
