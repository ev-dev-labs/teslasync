//
//  FreshnessIndicator.Views.swift
//  TeslaSync — P4 shared surface · 0090 · FreshnessIndicator (Apple)
//
//  The presentational subviews composed by `FreshnessIndicator`: the status dot (the native parity
//  of the web `rounded-full` span with the `DOT_COLOR`/`DOT_SIZE` maps and the fresh `animate-pulse`),
//  the relative-time label, the resolved readout row (dot + optional label + pointer tooltip), the
//  neutral loading skeleton chip, and the neutral unavailable / retry chip. All copy resolves through
//  the P1/S10 facade; all colour comes from the P1/S9 tokens; the shared `TSSkeleton` / `TSButton`
//  primitives are reused. No networking, no Tailwind ports, no raw hex.
//

import SwiftUI

// MARK: - Size → view mapping

extension FreshnessSize {
    /// The dot diameter as a `CGFloat` for SwiftUI frames (the pure core exposes points as `Double`).
    var dotDiameter: CGFloat {
        CGFloat(dotDiameterPoints)
    }
}

// MARK: - Status → tone mapping (web `DOT_COLOR` map)

extension FreshnessStatus {
    /// The dot tone — the native port of the web `DOT_COLOR` map: fresh→green, stale→amber,
    /// offline→red, unknown→neutral (the web `var(--surface-2)` neutral-surface dot).
    var tone: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        }
    }

    /// The localised status word voiced by the readout's VoiceOver label.
    var accessibilityWord: String {
        switch self {
        case .fresh: FreshnessStrings.string("freshness.status.fresh", "Fresh")
        case .stale: FreshnessStrings.string("freshness.status.stale", "Stale")
        case .offline: FreshnessStrings.string("freshness.status.offline", "Offline")
        case .unknown: FreshnessStrings.string("freshness.status.unknown", "No data")
        }
    }
}

// MARK: - Status dot (web `rounded-full` span + `animate-pulse`)

/// The coloured status dot — the native parity of the web `<span class="rounded-full …">`. Sized off
/// the `FreshnessSize` (web `DOT_SIZE`), toned off the status (web `DOT_COLOR`), and — for the fresh
/// status — pulsing its opacity (web `animate-pulse`). The pulse honours Reduce Motion (static at
/// full opacity when reduced). Decorative; the surrounding readout voices the status + age.
struct FreshnessDot: View {
    let status: FreshnessStatus
    let size: FreshnessSize
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulsing = false

    private var isPulsingStatus: Bool {
        status == .fresh
    }

    private var animatedOpacity: Double {
        guard isPulsingStatus, !reduceMotion, pulsing else { return 1 }
        return 0.4
    }

    var body: some View {
        Circle()
            .fill(status.tone)
            .frame(width: size.dotDiameter, height: size.dotDiameter)
            .opacity(animatedOpacity)
            .animation(
                reduceMotion || !isPulsingStatus
                    ? nil
                    : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                value: pulsing
            )
            .onAppear { pulsing = true }
            .accessibilityHidden(true)
    }
}

// MARK: - Relative-time label (web `text-[var(--text-muted)]` span)

/// The relative-time label — the native parity of the web muted-text span ("12s ago", "—"). Rendered
/// at the design-system caption token (the smallest typography step); the size axis is carried by the
/// dot. Decorative here; the readout row owns the combined VoiceOver label.
struct FreshnessLabel: View {
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .foregroundStyle(Color.TS.textMuted)
            .accessibilityHidden(true)
    }
}

// MARK: - Resolved readout (web rendered indicator)

/// The resolved indicator row — the dot plus the optional relative-time label, the native parity of
/// the web rendered `<FreshnessIndicator>`. The raw timestamp rides the pointer tooltip (web `title`),
/// and the row is one VoiceOver element reading the status word + age.
struct FreshnessReadyView: View {
    let readout: FreshnessReadout
    let showLabel: Bool
    let size: FreshnessSize

    private var accessibilityLabel: String {
        FreshnessAccessibility.label(
            status: readout.status,
            ageLabel: readout.ageLabel,
            statusWord: readout.status.accessibilityWord
        )
    }

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            FreshnessDot(status: readout.status, size: size)
            if showLabel {
                FreshnessLabel(text: readout.ageLabel)
            }
        }
        .help(readout.timestamp ?? readout.ageLabel)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }
}

// MARK: - Loading (feed resolving → neutral skeleton chip)

/// The neutral skeleton chip shown while the timestamp feed resolves — a shimmer dot plus a shimmer
/// label, sized to the indicator's footprint so the layout does not jump when the readout lands.
/// Shimmer respects Reduce Motion via the shared `TSSkeleton`.
struct FreshnessLoadingChip: View {
    let size: FreshnessSize

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            TSSkeleton(width: size.dotDiameter, height: size.dotDiameter, cornerRadius: size.dotDiameter / 2)
            TSSkeleton(width: 44, height: 10, cornerRadius: TSRadius.sm)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: FreshnessStrings.string("freshness.loadingA11y", "Loading freshness")))
    }
}

// MARK: - Unavailable (feed failed → neutral retry chip)

/// The neutral retry chip shown when the timestamp feed fails — a `QueryError` peer scaled to the
/// indicator's footprint. Re-requests the snapshot on tap.
struct FreshnessUnavailableChip: View {
    let onRetry: () -> Void

    var body: some View {
        TSButton(variant: .secondary, size: .small, action: onRetry) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: "clock.badge.exclamationmark")
                    .font(.caption2)
                Text(verbatim: FreshnessStrings.string("freshness.unavailable", "Freshness unavailable"))
                    .font(Font.TS.caption)
            }
        }
        .accessibilityLabel(Text(verbatim: FreshnessStrings.string(
            "freshness.unavailableA11y",
            "Freshness unavailable — tap to retry"
        )))
    }
}
