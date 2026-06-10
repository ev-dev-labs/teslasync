//
//  StateTimeline.Views.swift
//  TeslaSync — P4 feature view · 0235 · StateTimeline (Apple)
//
//  Presentational chrome composed by `StateTimeline`: the rail header (start · window ·
//  end), the freshness chip + stale/offline banner, the horizontal tick rail (each dot
//  colored by its destination state, the selected one ringed), and the loading / empty
//  / error states. The empty state reproduces the web actionable hint ("No transitions
//  in window" + "Last transition {{rel}}" + the widen-window / jump-to-last buttons).
//  All copy resolves through the P1/S10 facade; all chrome is token-driven (P1/S9). No
//  networking and no Tailwind ports live here.
//

import SwiftUI

// MARK: - Localization text helper (SwiftUI side of the P1/S10 facade)

extension StateTimelineStrings {
    /// A `Text` over the resolved string (keeps the SwiftUI dependency out of the model).
    static func text(_ key: String, _ fallback: String) -> Text {
        Text(verbatim: string(key, fallback))
    }
}

// MARK: - Tick palette (web getStateColor `dot` hue → P1/S9 tokens)

/// Maps a resolved FSM state tone to a SwiftUI color. Mirrors the FSM diagram's
/// `FSMStateColor` token mapping so a state paints the same hue wherever it appears
/// (web `getStateColor(...).dot`); held locally as a computed property so the surface
/// stays decoupled from the diagram's view code, matching the per-surface palette
/// convention.
extension FSMStateColor {
    var stateTimelineTint: Color {
        switch self {
        case .success: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        case .info: Color.TS.statusInfo
        case .neutral: Color.TS.textMuted
        case .cyan: Color.TS.chartSeriesRegen
        case .purple: Color.TS.chartSeriesPower
        case .orange: Color(.sRGB, red: 0.984, green: 0.573, blue: 0.235, opacity: 1)
        case .indigo: Color(.sRGB, red: 0.506, green: 0.545, blue: 0.969, opacity: 1)
        case .strongDanger: Color.TS.statusDanger
        case .faded: Color.TS.statusDanger.opacity(0.45)
        }
    }
}

// MARK: - Header (start · window · end)

/// The rail header: the window-start clock, the centered window-length label, and the
/// window-end clock (web the three `text-[10px] uppercase` spans). Shown only with the
/// rail (web renders it inside the populated `state-timeline`, not the empty branch).
struct StateTimelineHeader: View {
    let startLabel: String
    let windowLabel: String
    let endLabel: String

    var body: some View {
        HStack(alignment: .center, spacing: TSSpacing.sm) {
            Text(verbatim: startLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            Spacer(minLength: TSSpacing.xs)
            Text(verbatim: windowLabel)
                .font(Font.TS.caption)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textSecondary)
            Spacer(minLength: TSSpacing.xs)
            Text(verbatim: endLabel)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Freshness chip (Live / Stale / Offline)

/// The header freshness chip reflecting the bound source's live-state (ADR-013).
struct StateTimelineFreshnessChip: View {
    let connection: StateTimelineConnection

    private struct Descriptor {
        let tone: Color
        let key: String
        let fallback: String
    }

    var body: some View {
        let descriptor = Self.descriptor(for: connection)
        return HStack(spacing: 4) {
            Circle().fill(descriptor.tone).frame(width: 6, height: 6)
            StateTimelineStrings.text(descriptor.key, descriptor.fallback)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(StateTimelineStrings.text(descriptor.key, descriptor.fallback))
    }

    private static func descriptor(for connection: StateTimelineConnection) -> Descriptor {
        switch connection {
        case .live:
            Descriptor(tone: Color.TS.statusSuccess, key: "debugger.timeline.live", fallback: "Live")
        case .stale:
            Descriptor(tone: Color.TS.statusWarning, key: "debugger.timeline.stale", fallback: "Stale")
        case .offline:
            Descriptor(tone: Color.TS.textMuted, key: "debugger.timeline.offline", fallback: "Offline")
        }
    }
}

// MARK: - Connectivity banner (stale / offline)

/// The stale/offline banner shown above the rail when the bound source is not live, so
/// a cached timeline is clearly labeled (web `DataFreshness` intent).
struct StateTimelineConnectivityBanner: View {
    let connection: StateTimelineConnection

    var body: some View {
        let offline = connection == .offline
        let key = offline ? "debugger.timeline.offlineBanner" : "debugger.timeline.staleBanner"
        let fallback = offline
            ? "Offline — showing the last loaded transitions"
            : "Reconnecting — the transition timeline may be stale"
        let tone = offline ? Color.TS.textMuted : Color.TS.statusWarning
        return HStack(spacing: TSSpacing.xs) {
            Image(systemName: offline ? "wifi.slash" : "clock.arrow.circlepath")
                .font(.system(size: 11, weight: .semibold))
            StateTimelineStrings.text(key, fallback).font(Font.TS.caption)
        }
        .foregroundStyle(tone)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, TSSpacing.sm)
        .padding(.vertical, TSSpacing.xs)
        .background(tone.opacity(0.12), in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Rail (the horizontal tick timeline)

/// The horizontal rail with one dot per transition, placed by `leftPercent`, colored
/// by destination state, the selected dot ringed. Each dot is a labeled, tappable
/// control (web `<button aria-label>` inside a `<Tooltip>`).
struct StateTimelineRail: View {
    let ticks: [StateTimelineTick]
    let selectedID: Int?
    let tooltip: (StateTimelineTick) -> String
    let label: (StateTimelineTick) -> String
    let onSelect: (StateTimelineTick) -> Void

    private let railHeight: CGFloat = 40

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .topLeading) {
                Capsule()
                    .fill(Color.TS.border)
                    .frame(height: 1)
                    .position(x: geo.size.width / 2, y: geo.size.height / 2)
                ForEach(ticks) { tick in
                    StateTimelineDot(
                        tone: tick.tone,
                        selected: selectedID == tick.id,
                        tooltip: tooltip(tick),
                        label: label(tick),
                        action: { onSelect(tick) }
                    )
                    .position(x: dotX(tick.leftPercent, width: geo.size.width), y: geo.size.height / 2)
                }
            }
        }
        .frame(height: railHeight)
        .accessibilityElement(children: .contain)
    }

    /// The dot's pixel x, clamped to the rail so a caller-windowed tick never lands off
    /// the visible rail (web pre-windows to 0…100%).
    private func dotX(_ percent: Double, width: CGFloat) -> CGFloat {
        let clamped = min(max(percent, 0), 100)
        return CGFloat(clamped / 100) * width
    }
}

/// One placed dot — a tappable, labeled control (web tick button). The selected dot
/// grows and gains a ring (web `h-4 w-4 ring-2`).
struct StateTimelineDot: View {
    let tone: FSMStateColor
    let selected: Bool
    let tooltip: String
    let label: String
    let action: () -> Void

    var body: some View {
        let size: CGFloat = selected ? 16 : 10
        return Button(action: action) {
            Circle()
                .fill(tone.stateTimelineTint)
                .frame(width: size, height: size)
                .overlay {
                    if selected {
                        Circle()
                            .strokeBorder(Color.white.opacity(0.3), lineWidth: 2)
                            .frame(width: size + 6, height: size + 6)
                    }
                }
                .padding(6)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .help(tooltip)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
    }
}

// MARK: - Empty state (web "No transitions in window" + actionable hint)

/// The resolved-but-empty rail: the web "No transitions in window" message, the
/// optional "Last transition {{rel}}" hint, and the optional widen-window / jump-to-last
/// actions. Never a blank box.
struct StateTimelineEmptyView: View {
    let message: String
    let lastSeen: String?
    let widenLabel: String?
    let jumpLabel: String
    let showJump: Bool
    let onWiden: () -> Void
    let onJump: () -> Void

    private var hasActions: Bool {
        widenLabel != nil || showJump
    }

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            messageLine
            if hasActions {
                HStack(spacing: TSSpacing.sm) {
                    if let widenLabel {
                        Button(action: onWiden) {
                            Text(verbatim: widenLabel)
                                .font(Font.TS.caption)
                                .fontWeight(.semibold)
                                .padding(.horizontal, TSSpacing.md)
                                .padding(.vertical, TSSpacing.xs)
                                .background(Color.TS.accent.opacity(0.16), in: Capsule())
                                .foregroundStyle(Color.TS.accent)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: widenLabel))
                    }
                    if showJump {
                        Button(action: onJump) {
                            Text(verbatim: jumpLabel)
                                .font(Font.TS.caption)
                                .fontWeight(.semibold)
                                .foregroundStyle(Color.TS.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: jumpLabel))
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.xs)
    }

    private var messageLine: some View {
        HStack(spacing: TSSpacing.xs) {
            Image(systemName: "clock.badge.questionmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            Text(verbatim: message)
                .font(Font.TS.caption)
                .foregroundStyle(Color.TS.textMuted)
            if let lastSeen {
                Text(verbatim: "·")
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textMuted)
                    .accessibilityHidden(true)
                Text(verbatim: lastSeen)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
        }
    }
}

// MARK: - Loading state (web `<Skeleton>` chrome)

/// The initial-fetch skeleton chrome: a faint header line over a rail skeleton with a
/// few muted dot outlines, respecting Reduce Motion (via `TSSkeleton`).
struct StateTimelineLoadingView: View {
    private let dots = 6

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            HStack {
                TSSkeleton(width: 44, height: 8, cornerRadius: 4)
                Spacer()
                TSSkeleton(width: 90, height: 8, cornerRadius: 4)
                Spacer()
                TSSkeleton(width: 44, height: 8, cornerRadius: 4)
            }
            ZStack(alignment: .leading) {
                Capsule().fill(Color.TS.border).frame(height: 1)
                HStack(spacing: TSSpacing.x3xl) {
                    ForEach(0 ..< dots, id: \.self) { _ in
                        Circle().fill(Color.TS.border).frame(width: 10, height: 10)
                    }
                }
            }
            .frame(height: 40)
        }
        .accessibilityElement()
        .accessibilityLabel(StateTimelineStrings.text("debugger.timeline.loading", "Loading transitions"))
    }
}

// MARK: - Error state (web `QueryError` with retry)

/// The fetch-failure state with a retry affordance (web `QueryError`). Mirrors the
/// inline error treatment used across the feature-view surfaces.
struct StateTimelineErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: TSSpacing.sm) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 22))
                .foregroundStyle(Color.TS.statusDanger)
                .accessibilityHidden(true)
            StateTimelineStrings.text("debugger.timeline.errorTitle", "Couldn't load transitions")
                .font(Font.TS.body)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
                .multilineTextAlignment(.center)
            if !message.isEmpty {
                Text(verbatim: message)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
                    .multilineTextAlignment(.center)
            }
            Button(action: onRetry) {
                StateTimelineStrings.text("debugger.timeline.retry", "Retry")
                    .font(Font.TS.caption)
                    .fontWeight(.semibold)
                    .padding(.horizontal, TSSpacing.md)
                    .padding(.vertical, TSSpacing.xs)
                    .background(Color.TS.accent.opacity(0.16), in: Capsule())
                    .foregroundStyle(Color.TS.accent)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(StateTimelineStrings.text("debugger.timeline.retry", "Retry"))
        }
        .frame(maxWidth: .infinity, minHeight: 120)
        .padding(.vertical, TSSpacing.sm)
        .accessibilityElement(children: .combine)
    }
}
