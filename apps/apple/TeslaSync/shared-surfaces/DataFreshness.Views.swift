//
//  DataFreshness.Views.swift
//  TeslaSync — P4 shared surface · 0079 · DataFreshness (Apple)
//
//  The presentational subviews composed by `DataFreshness`: the status dot (the native parity of the
//  web `rounded-full` span with the `FRESHNESS_COLORS` map, the fetching `animate-ping` ring, and the
//  background-refetch `animate-pulse`), the status icon (the native parity of the web lucide
//  `STATUS_CONFIG` icon with the fetching `animate-spin`), the relative-time label, and the chip row
//  (dot + icon + optional label) wrapped as a button when refreshable. All copy resolves through the
//  P1/S10 facade; all colour comes from the P1/S9 tokens; no networking, no Tailwind ports, no raw
//  hex. Every animation honours Reduce Motion.
//

import SwiftUI

// MARK: - Status → tone mapping (web `FRESHNESS_COLORS`)

extension DataFreshnessStatus {
    /// The status tone — the native port of the web `FRESHNESS_COLORS` map: fresh→success (emerald),
    /// fetching→info (sky), stale→warning (amber), error→danger (red).
    var tone: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .fetching: Color.TS.statusInfo
        case .stale: Color.TS.statusWarning
        case .error: Color.TS.statusDanger
        }
    }
}

// MARK: - Status dot (web `rounded-full` span + ping ring + pulse)

/// The coloured status dot — the native parity of the web `<span class="rounded-full …">`. Toned off
/// the status (web `FRESHNESS_COLORS`), it shows an expanding ping ring while fetching (web
/// `status === 'fetching' && animate-ping`) and a gentle opacity pulse during a background refetch
/// (web `showPulse && animate-pulse`). Both animations honour Reduce Motion (a static full-opacity
/// dot when reduced). Decorative; the surrounding chip voices the status + age.
struct DataFreshnessDot: View {
    let status: DataFreshnessStatus
    let isBackgroundRefetch: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false

    private let diameter: CGFloat = 6

    private var showsPing: Bool {
        status == .fetching && !reduceMotion
    }

    private var showsPulse: Bool {
        isBackgroundRefetch && !reduceMotion
    }

    private var dotOpacity: Double {
        guard showsPulse, animating else { return 1 }
        return 0.4
    }

    var body: some View {
        ZStack {
            if showsPing {
                Circle()
                    .fill(status.tone)
                    .scaleEffect(animating ? 2.2 : 1)
                    .opacity(animating ? 0 : 0.4)
                    .animation(
                        .easeOut(duration: TSMotion.slowDuration * 2.5).repeatForever(autoreverses: false),
                        value: animating
                    )
            }
            Circle()
                .fill(status.tone)
                .opacity(dotOpacity)
                .animation(
                    showsPulse
                        ? .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)
                        : nil,
                    value: animating
                )
        }
        .frame(width: diameter, height: diameter)
        .onAppear { animating = true }
        .accessibilityHidden(true)
    }
}

// MARK: - Status icon (web lucide `STATUS_CONFIG` icon + `animate-spin`)

/// The status icon — the native parity of the web lucide icon (`Wifi` / `RefreshCw` / `WifiOff`).
/// Toned off the status, sized off `compact` (web `h-2 w-2` vs `h-2.5 w-2.5`), and — for the fetching
/// `RefreshCw` — spinning (web `animate-spin`). The spin honours Reduce Motion. Decorative; the chip
/// owns the combined VoiceOver label.
struct DataFreshnessIcon: View {
    let status: DataFreshnessStatus
    let compact: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spinning = false

    private var spins: Bool {
        status.iconSpins && !reduceMotion
    }

    var body: some View {
        Image(systemName: status.iconSystemName)
            .font(.caption2)
            .imageScale(compact ? .small : .medium)
            .foregroundStyle(status.tone)
            .rotationEffect(.degrees(spins && spinning ? 360 : 0))
            .animation(
                spins ? .linear(duration: 1).repeatForever(autoreverses: false) : nil,
                value: spinning
            )
            .onAppear { spinning = true }
            .accessibilityHidden(true)
    }
}

// MARK: - Relative-time label (web `tabular-nums` span)

/// The relative-time label — the native parity of the web relative-time span ("5m ago", "updating…",
/// ""). Toned off the status (web `cfg.color`), rendered with monospaced digits (web `tabular-nums`)
/// and reserving a stable minimum width so the label changing never reflows neighbouring header
/// items (web `min-w-[4.5rem]`). Decorative; the chip owns the combined VoiceOver label.
struct DataFreshnessLabel: View {
    let text: String
    let tone: Color

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(tone)
            .frame(minWidth: 72, alignment: .leading)
            .accessibilityHidden(true)
    }
}

// MARK: - Chip (the web rendered indicator span)

/// The chip row — the dot + icon + optional relative-time label, the native parity of the web
/// rendered `<DataFreshness>` span. It is a button when the surface is refreshable and not fetching
/// (web `role="button"` + `onClick`), else a read-only status row (web `role="status"`). The tooltip
/// rides `.help` (web `title`), and the row is one VoiceOver element reading the web `aria-label`
/// plus the age as its value.
struct DataFreshnessChip: View {
    let readout: DataFreshnessReadout
    let helpText: String
    let onRefresh: () -> Void

    private var spacing: CGFloat {
        readout.compact ? TSSpacing.xs * 0.5 : TSSpacing.xs
    }

    private var isInteractive: Bool {
        readout.refreshable && !readout.isFetching
    }

    private var row: some View {
        HStack(spacing: spacing) {
            DataFreshnessDot(status: readout.status, isBackgroundRefetch: readout.isBackgroundRefetch)
            DataFreshnessIcon(status: readout.status, compact: readout.compact)
            if !readout.compact {
                DataFreshnessLabel(text: readout.relativeLabel, tone: readout.status.tone)
            }
        }
    }

    var body: some View {
        Group {
            if isInteractive {
                Button(action: onRefresh) { row }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(.isButton)
            } else {
                row
                    .accessibilityElement(children: .ignore)
            }
        }
        .help(helpText)
        .accessibilityLabel(Text(verbatim: readout.accessibilityLabel))
        .accessibilityValue(Text(verbatim: readout.accessibilityValue))
    }
}
