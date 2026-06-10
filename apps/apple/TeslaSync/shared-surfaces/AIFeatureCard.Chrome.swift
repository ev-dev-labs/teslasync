//
//  AIFeatureCard.Chrome.swift
//  TeslaSync — P4 shared surface · 0018 · AIFeatureCard (Apple)
//
//  The streamed-output + connectivity chrome split out of `…Views.swift` (one file ≤ 400 lines per
//  the SwiftLint contract): the web `AiOutputPanel` (Helix error / thinking indicator / accumulated
//  text), the web `AIThinkingIndicator` (Helix mark + label + shimmering skeleton lines), the Helix
//  error row, the P4 leaf connectivity chip + banner, the freshness string/tone helper, and the
//  reduce-motion-safe pulse modifier. All consume the P1/S10 facade and the shared P1/S9 tokens —
//  no networking, no raw hex.
//

import SwiftUI

// MARK: - Freshness helper (P4 leaf connectivity axis)

/// Resolves the localised freshness label / a11y note / tone for a connectivity state — shared by
/// the badge, the chip, and the banner so the copy stays consistent and is asserted in one place.
enum AIFeatureCardFreshness {
    static func label(for connection: AIFeatureCardConnection) -> String {
        switch connection {
        case .live: AIFeatureCardStrings.string("aiFeatureCard.live", "Live")
        case .stale: AIFeatureCardStrings.string("aiFeatureCard.stale", "Stale")
        case .offline: AIFeatureCardStrings.string("aiFeatureCard.offline", "Offline")
        }
    }

    static func note(for connection: AIFeatureCardConnection) -> String {
        switch connection {
        case .live:
            AIFeatureCardStrings.string("aiFeatureCard.live", "Live")
        case .stale:
            AIFeatureCardStrings.string("aiFeatureCard.staleA11y", "Stale — tap refresh to update")
        case .offline:
            AIFeatureCardStrings.string("aiFeatureCard.offlineA11y", "Offline — showing the last known state")
        }
    }

    static func tone(for connection: AIFeatureCardConnection) -> Color {
        switch connection {
        case .live: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.textMuted
        }
    }
}

// MARK: - Connectivity chip (P4 leaf — status row)

/// The freshness chip + manual refresh affordance shown on the card's status row — a coloured dot
/// with the freshness label and a refresh button so pointer + VoiceOver users can recover a stale /
/// offline state. Rendered for every connectivity state (live included) so the card has a stable
/// header shape.
struct AIFeatureCardConnectivityChip: View {
    let connection: AIFeatureCardConnection
    let onRefresh: () -> Void

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                Circle()
                    .fill(AIFeatureCardFreshness.tone(for: connection))
                    .frame(width: 6, height: 6)
                Text(verbatim: AIFeatureCardFreshness.label(for: connection))
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
            }
            .accessibilityElement(children: .combine)
            .accessibilityLabel(Text(verbatim: AIFeatureCardFreshness.note(for: connection)))
            Button(action: onRefresh) {
                Image(systemName: "arrow.clockwise")
                    .font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(.plain)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityLabel(Text(verbatim: AIFeatureCardStrings.string("aiFeatureCard.refresh", "Refresh")))
        }
    }
}

// MARK: - Connectivity banner (P4 leaf — stale / offline)

/// The stale / offline banner shown above the header when the snapshot is not live — a tinted inline
/// callout that explains why the card may be showing older data. Hidden entirely when live.
struct AIFeatureCardConnectivityBanner: View {
    let connection: AIFeatureCardConnection

    private var isOffline: Bool {
        connection == .offline
    }

    private var label: String {
        isOffline
            ? AIFeatureCardStrings.string("aiFeatureCard.offlineBanner", "Offline — showing last known data")
            : AIFeatureCardStrings.string("aiFeatureCard.staleBanner", "Reconnecting — data may be stale")
    }

    var body: some View {
        let tone = isOffline ? Color.TS.textMuted : Color.TS.statusWarning
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 10, weight: .semibold))
                .accessibilityHidden(true)
            Text(verbatim: label)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Output panel (web `AiOutputPanel`)

/// The streamed-output panel — the native port of the web `AiOutputPanel`: the Helix error row for
/// an `error` stream, the animated thinking indicator while the SSE is open and no text has arrived,
/// and the accumulated narrative otherwise. Collapses to nothing when there is nothing to show
/// (`AIFeatureOutputState.hidden`) so it is never a blank box.
struct AIFeatureCardOutputPanel: View {
    let output: AIFeatureOutputState

    var body: some View {
        switch output {
        case .hidden:
            EmptyView()
        case let .error(message):
            panel { AIFeatureCardErrorRow(message: message) }
        case .thinking:
            panel { AIFeatureCardThinkingIndicator() }
        case let .text(value):
            panel {
                Text(verbatim: value)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
            }
        }
    }

    private func panel(@ViewBuilder _ content: () -> some View) -> some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
    }
}

/// The web `AiOutputPanel` error branch: the Helix mark + "Helix error:" + the message (or the
/// localised "unknown" when the terminal message is empty).
struct AIFeatureCardErrorRow: View {
    let message: String

    private var errorLabel: String {
        AIFeatureCardStrings.string("helix.errorLabel", "Helix error:")
    }

    private var resolvedMessage: String {
        message.isEmpty
            ? AIFeatureCardStrings.string("ai.common.errorUnknown", "unknown")
            : message
    }

    var body: some View {
        HStack(alignment: .top, spacing: TSSpacing.sm) {
            AIFeatureCardHelixMark(size: 16, tint: Color.TS.statusDanger)
            (
                Text(verbatim: "\(errorLabel) ").fontWeight(.medium)
                    + Text(verbatim: resolvedMessage)
            )
            .font(Font.TS.body)
            .foregroundStyle(Color.TS.statusDanger)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(errorLabel) \(resolvedMessage)"))
    }
}

/// The web `AIThinkingIndicator`: a Helix mark + "Helix is thinking…" label and shimmering skeleton
/// lines (decreasing widths to mimic prose), shown while the stream is open and no text has arrived.
/// Honours reduce-motion (the pulse + skeleton shimmer are decorative) and announces as a status.
struct AIFeatureCardThinkingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var thinkingLabel: String {
        AIFeatureCardStrings.string("helix.thinking", "Helix is thinking…")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack(spacing: TSSpacing.xs) {
                AIFeatureCardHelixMark(size: 14)
                    .aiFeatureCardPulse(active: !reduceMotion)
                Text(verbatim: thinkingLabel)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.accent)
            }
            TSSkeleton(height: 10)
            TSSkeleton(width: 220, height: 10)
            TSSkeleton(width: 160, height: 10)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: thinkingLabel))
        .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Pulse helper (reduce-motion safe)

/// A reduce-motion-safe opacity pulse for the Helix mark — a real repeating animation driven by an
/// internal state toggle (a constant-opacity `.animation` would never actually animate). Inert when
/// inactive; callers pass `!reduceMotion` so the gate lives at the call site.
private struct AIFeatureCardPulseModifier: ViewModifier {
    let active: Bool
    @State private var dimmed = false

    private var pulse: Animation? {
        guard active else { return nil }
        return .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)
    }

    func body(content: Content) -> some View {
        content
            .opacity(active && dimmed ? 0.4 : 1)
            .animation(pulse, value: dimmed)
            .onAppear { dimmed = active }
            .onChange(of: active) { _, newValue in dimmed = newValue }
    }
}

extension View {
    /// Applies a repeating opacity pulse when `active`, and is otherwise inert — a single
    /// reduce-motion gate shared by the action button and the thinking indicator.
    func aiFeatureCardPulse(active: Bool) -> some View {
        modifier(AIFeatureCardPulseModifier(active: active))
    }
}
