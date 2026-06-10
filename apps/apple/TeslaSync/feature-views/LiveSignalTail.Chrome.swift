//
//  LiveSignalTail.Chrome.swift
//  TeslaSync — P4 feature view · 0263 · LiveSignalTail (Apple)
//
//  The header chrome shared by the surface: the four header stat cards, the
//  live/paused status chip, the pause / auto-scroll / clear control buttons, the
//  stale/offline connectivity banner, the Type badge, and the freshness dot. These
//  are the native counterparts of the web `StatCard`, `Badge`, `Button`, and the
//  shared `<FreshnessIndicator>` dot. The scrolling table that consumes them lives
//  in `LiveSignalTail.Table.swift`.
//

import SwiftUI

// MARK: - Per-kind + freshness tints (web `TYPE_VALUE_COLOR` / dot colors)

extension LiveSignalTailValueKind {
    /// The value-column tint + badge tone (web `TYPE_VALUE_COLOR` / `Badge variant`):
    /// number → info/cyan, string → success/green, boolean → warning/amber.
    var tint: Color {
        switch self {
        case .number: Color.TS.statusInfo
        case .string: Color.TS.statusSuccess
        case .boolean: Color.TS.statusWarning
        }
    }
}

extension LiveSignalTailFreshness {
    /// The freshness dot color (web `DOT_COLOR`): fresh → green, stale → amber,
    /// offline → red, unknown → muted.
    var dotColor: Color {
        switch self {
        case .fresh: Color.TS.statusSuccess
        case .stale: Color.TS.statusWarning
        case .offline: Color.TS.statusDanger
        case .unknown: Color.TS.textMuted
        }
    }
}

// MARK: - Stats grid (web 4× `StatCard`)

/// The four header stat cards, in an adaptive grid (two columns on compact width,
/// four on regular) — the web `grid-cols-2 sm:grid-cols-4`.
struct LiveSignalTailStatsGrid: View {
    let stats: LiveSignalTailStats

    #if os(iOS)
        @Environment(\.horizontalSizeClass) private var horizontalSizeClass
        private var columns: Int {
            horizontalSizeClass == .compact ? 2 : 4
        }
    #else
        private var columns: Int {
            4
        }
    #endif

    var body: some View {
        LazyVGrid(
            columns: Array(repeating: GridItem(.flexible(), spacing: TSSpacing.md), count: columns),
            spacing: TSSpacing.md
        ) {
            LiveSignalTailStatCard(
                label: LiveSignalTailStrings.statRate,
                value: "\(stats.rate)",
                unit: nil,
                systemImage: "waveform.path.ecg"
            )
            LiveSignalTailStatCard(
                label: LiveSignalTailStrings.statBuffer,
                value: "\(stats.bufferUsed)",
                unit: "/ \(stats.bufferMax)",
                systemImage: "arrow.up.arrow.down"
            )
            LiveSignalTailStatCard(
                label: LiveSignalTailStrings.statUnique,
                value: "\(stats.unique)",
                unit: nil,
                systemImage: "number"
            )
            LiveSignalTailStatCard(
                label: LiveSignalTailStrings.statFiltered,
                value: "\(stats.filtered)",
                unit: nil,
                systemImage: "line.3.horizontal.decrease.circle"
            )
        }
    }
}

/// One stat card — a label, an icon, and a large value with an optional unit (web
/// `StatCard`).
struct LiveSignalTailStatCard: View {
    let label: String
    let value: String
    let unit: String?
    let systemImage: String

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.xs) {
            HStack(spacing: TSSpacing.xs) {
                Text(verbatim: label)
                    .font(Font.TS.label)
                    .foregroundStyle(Color.TS.textMuted)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: TSSpacing.xs)
                Image(systemName: systemImage)
                    .font(.system(size: 12))
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
            }
            HStack(alignment: .firstTextBaseline, spacing: TSSpacing.xs) {
                Text(verbatim: value)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundStyle(Color.TS.textPrimary)
                if let unit {
                    Text(verbatim: unit)
                        .font(Font.TS.bodySm)
                        .foregroundStyle(Color.TS.textMuted)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                .strokeBorder(Color.TS.border.opacity(0.6), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: "\(label): \(value) \(unit ?? "")"))
    }
}

// MARK: - Status chip (web `headerExtra` connection badge)

/// The live / paused chip — the native form of the web `headerExtra` connection
/// badge. It reflects subscription intent (live vs paused); datum-level staleness
/// is owned by the connectivity banner, mirroring the web `<LiveIndicator>` vs
/// `<FreshnessIndicator>` split.
struct LiveSignalTailStatusChip: View {
    let connection: LiveSignalTailConnection
    let paused: Bool

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tone)
                .frame(width: 6, height: 6)
            Text(verbatim: paused ? LiveSignalTailStrings.pausedChip : LiveSignalTailStrings.liveChip)
                .font(Font.TS.label)
                .foregroundStyle(tone)
        }
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(tone.opacity(0.25), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: paused ? LiveSignalTailStrings.pausedChip : LiveSignalTailStrings.liveChip))
    }

    private var tone: Color {
        paused ? Color.TS.statusWarning : Color.TS.statusSuccess
    }
}

// MARK: - Control button (web header `Button`s)

/// A compact header control — a labelled, icon-leading button. `neutral` is the web
/// `secondary` variant, `danger` the destructive Clear; `isActive` is the web
/// auto-scroll highlight (`bg-cyan-500/10 text-cyan-400`).
struct LiveSignalTailControlButton: View {
    enum Tone {
        case neutral
        case danger
    }

    let title: String
    let systemImage: String
    let tone: Tone
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: TSSpacing.xs) {
                Image(systemName: systemImage)
                    .font(.system(size: 11, weight: .semibold))
                Text(verbatim: title)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
            }
            .padding(.horizontal, TSSpacing.md)
            .padding(.vertical, TSSpacing.xs)
            .foregroundStyle(foreground)
            .background(background, in: Capsule())
            .overlay(Capsule().strokeBorder(borderColor, lineWidth: 1))
        }
        .buttonStyle(.plain)
    }

    private var foreground: Color {
        if tone == .danger { return Color.TS.statusDanger }
        return isActive ? Color.TS.accent : Color.TS.textSecondary
    }

    private var background: Color {
        if tone == .danger { return Color.TS.statusDanger.opacity(0.12) }
        return isActive ? Color.TS.accent.opacity(0.12) : Color.TS.surface
    }

    private var borderColor: Color {
        if tone == .danger { return Color.TS.statusDanger.opacity(0.25) }
        return isActive ? Color.TS.accent.opacity(0.3) : Color.TS.border
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale / offline banner shown above the tail when the live stream is not
/// fresh — the feature-level analogue of the web freshness state.
struct LiveSignalTailConnectivityBanner: View {
    let connection: LiveSignalTailConnection

    var body: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: isOffline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            Text(verbatim: isOffline ? LiveSignalTailStrings.offlineBanner : LiveSignalTailStrings.staleBanner)
                .font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var isOffline: Bool {
        connection == .offline
    }

    private var tone: Color {
        isOffline ? Color.TS.textMuted : Color.TS.statusWarning
    }
}

// MARK: - Type badge + freshness dot

/// The Type column badge (web `<Badge variant=…>{type}</Badge>`) — the raw kind
/// word in its per-kind tone.
struct LiveSignalTailTypeBadge: View {
    let kind: LiveSignalTailValueKind

    var body: some View {
        Text(verbatim: kind.rawValue)
            .font(Font.TS.label)
            .foregroundStyle(kind.tint)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, 2)
            .background(kind.tint.opacity(0.12), in: Capsule())
            .overlay(Capsule().strokeBorder(kind.tint.opacity(0.25), lineWidth: 1))
            .accessibilityLabel(Text(verbatim: kind.rawValue))
    }
}

/// The freshness dot (web colored dot). Pulses while fresh, respecting Reduce
/// Motion.
struct LiveSignalTailFreshnessDot: View {
    let freshness: LiveSignalTailFreshness
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Circle()
            .fill(freshness.dotColor)
            .frame(width: 6, height: 6)
            .pulseIfFresh(freshness == .fresh && !reduceMotion)
            .accessibilityHidden(true)
    }
}

private extension View {
    /// Applies a subtle opacity pulse to the fresh dot (a `Circle` has no symbol
    /// effect); a no-op otherwise.
    @ViewBuilder
    func pulseIfFresh(_ active: Bool) -> some View {
        if active {
            modifier(LiveSignalTailPulseModifier())
        } else {
            self
        }
    }
}

/// A lightweight opacity pulse used by the fresh freshness dot.
private struct LiveSignalTailPulseModifier: ViewModifier {
    @State private var on = false

    func body(content: Content) -> some View {
        content
            .opacity(on ? 0.4 : 1)
            .animation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true), value: on)
            .onAppear { on = true }
    }
}
