//
//  PlaybackControls.Views.swift
//  TeslaSync — P4 shared surface · 0096 · PlaybackControls (Apple)
//
//  The presentational subviews composed by `PlaybackControls`, reproducing the web
//  `PlaybackControls.tsx` transport row: the Reset / Play-Pause / Stop trio, the speed control (web
//  `PlaybackSpeedMenu`), the timeline scrubber (its own file), the "elapsed / total" readout, the
//  keyboard-help affordance (web `Tooltip` cheatsheet → a native popover), the transient shortcut
//  toast, and the freshness chip (P4 connectivity axis). All copy resolves through the P1/S10 facade;
//  all color comes from the P1/S9 tokens — no Tailwind ports, no raw hex, no neon body text.
//

import SwiftUI

// MARK: - Transport bar (web content row)

/// The interactive transport row — the web happy path. Reads/observes the model and routes every
/// affordance through it (the bar is controlled, never mutating playback state locally).
struct PlaybackControlsBarView: View {
    @Bindable var model: PlaybackControlsModel
    let preview: (@MainActor (Double) -> PlaybackControlsPreview?)?
    @State private var showHelp = false

    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            PlaybackControlsTransportButton(
                systemImage: "backward.end.fill",
                label: PlaybackControlsStrings.string("replay.controls.reset", "Reset"),
                action: model.stopPlayback
            )
            PlaybackControlsTransportButton(
                systemImage: model.resolved.isPlaying ? "pause.fill" : "play.fill",
                label: PlaybackControlsAccessibility.playPauseLabel(
                    isPlaying: model.resolved.isPlaying, strings: PlaybackControlsStrings.string
                ),
                prominent: true,
                action: model.togglePlayPause
            )
            PlaybackControlsTransportButton(
                systemImage: "stop.fill",
                label: PlaybackControlsStrings.string("replay.controls.stop", "Stop"),
                action: model.stopPlayback
            )
            PlaybackControlsSpeedControl(
                speed: model.resolved.speed,
                onCycle: model.cycleSpeed,
                onSelect: model.setSpeed
            )
            PlaybackControlsScrubber(
                progress: model.resolved.progress,
                durationMs: model.resolved.durationMs,
                valueText: model.resolved.scrubberValueText,
                markers: model.resolved.markers,
                preview: preview,
                onSeek: model.seek
            )
            .layoutPriority(1)
            PlaybackControlsTimeReadout(
                text: model.resolved.timeReadout,
                accessibilityText: PlaybackControlsAccessibility.timeReadoutLabel(
                    elapsed: model.resolved.elapsed,
                    total: model.resolved.total,
                    strings: PlaybackControlsStrings.string
                )
            )
            if model.resolved.enableKeyboardShortcuts {
                PlaybackControlsHelpButton(shortcuts: model.cheatsheet, isPresented: $showHelp)
            }
        }
    }
}

// MARK: - Transport button (web ghost icon `Button`)

/// A 32pt ghost icon button — the web `<Button variant="ghost" size="sm">` icon trio member. The play
/// member is tinted with the accent so it reads as the primary affordance.
struct PlaybackControlsTransportButton: View {
    let systemImage: String
    let label: String
    var prominent = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .semibold))
                .frame(width: 32, height: 32)
                .foregroundStyle(prominent ? Color.TS.accent : Color.TS.textSecondary)
                .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: label))
    }
}

// MARK: - Speed control (web `PlaybackSpeedMenu`)

/// The replay-speed control. Tapping cycles to the next speed (web click → `nextSpeed`); the context
/// menu offers direct selection of any speed (the Apple-idiomatic superset of the web right-click
/// back-step). Renders the compact "10x ⌄" cap.
struct PlaybackControlsSpeedControl: View {
    let speed: PlaybackControlsSpeed
    let onCycle: () -> Void
    let onSelect: (PlaybackControlsSpeed) -> Void

    var body: some View {
        Button(action: onCycle) {
            HStack(spacing: 2) {
                Text(verbatim: speed.label)
                    .font(Font.TS.bodySm)
                    .monospacedDigit()
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .opacity(0.5)
            }
            .foregroundStyle(Color.TS.accent)
            .padding(.horizontal, TSSpacing.sm)
            .frame(height: 32)
            .background(Color.TS.surfaceGlass, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu {
            ForEach(PlaybackControlsSpeed.allCases) { option in
                Button { onSelect(option) } label: {
                    if option == speed {
                        Label(option.label, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.label)
                    }
                }
            }
        }
        .accessibilityLabel(Text(verbatim: PlaybackControlsStrings.string(
            "replay.controls.speed", "Playback speed"
        )))
        .accessibilityValue(Text(verbatim: speed.label))
    }
}

// MARK: - Time readout (web `{elapsed} / {total}`)

/// The right-aligned monospaced time readout.
struct PlaybackControlsTimeReadout: View {
    let text: String
    let accessibilityText: String

    var body: some View {
        Text(verbatim: text)
            .font(Font.TS.caption)
            .monospacedDigit()
            .foregroundStyle(Color.TS.textSecondary)
            .lineLimit(1)
            .fixedSize()
            .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}

// MARK: - Keyboard help (web `Tooltip` cheatsheet → native popover)

/// The keyboard-help affordance — a keyboard icon button presenting the localized cheatsheet in a
/// popover (adapts to a sheet on compact width). Only mounted when shortcuts are enabled.
struct PlaybackControlsHelpButton: View {
    let shortcuts: [PlaybackControlsShortcut]
    @Binding var isPresented: Bool

    var body: some View {
        Button { isPresented.toggle() } label: {
            Image(systemName: "keyboard")
                .font(.system(size: 13, weight: .semibold))
                .frame(width: 28, height: 28)
                .foregroundStyle(Color.TS.textSecondary)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: PlaybackControlsStrings.string(
            "replay.shortcuts.help", "Show keyboard shortcuts"
        )))
        .popover(isPresented: $isPresented) {
            PlaybackControlsHelpSheet(shortcuts: shortcuts)
        }
    }
}

/// The cheatsheet body — a title over a key-cap / description grid (web help-tooltip grid).
struct PlaybackControlsHelpSheet: View {
    let shortcuts: [PlaybackControlsShortcut]

    var body: some View {
        VStack(alignment: .leading, spacing: TSSpacing.sm) {
            Text(verbatim: PlaybackControlsStrings.string("replay.shortcuts.title", "Trip replay shortcuts"))
                .font(Font.TS.bodySm)
                .fontWeight(.semibold)
                .foregroundStyle(Color.TS.textPrimary)
            ForEach(shortcuts) { shortcut in
                HStack(alignment: .firstTextBaseline, spacing: TSSpacing.md) {
                    Text(verbatim: shortcut.keyCap)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.TS.textPrimary)
                        .padding(.horizontal, TSSpacing.xs)
                        .padding(.vertical, 2)
                        .background(Color.TS.surface, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                        .frame(width: 92, alignment: .leading)
                    Text(verbatim: shortcut.description)
                        .font(Font.TS.caption)
                        .foregroundStyle(Color.TS.textSecondary)
                }
            }
        }
        .padding(TSSpacing.md)
        .frame(minWidth: 260, alignment: .leading)
        .accessibilityElement(children: .contain)
    }
}

// MARK: - Shortcut toast (web inline `ShortcutToast`)

/// The transient inline feedback bubble shown after a keyboard action.
struct PlaybackControlsToastView: View {
    let toast: PlaybackControlsToast

    var body: some View {
        Text(verbatim: toast.label)
            .font(.system(size: 11, design: .monospaced))
            .foregroundStyle(Color.TS.textPrimary)
            .padding(.horizontal, TSSpacing.sm)
            .padding(.vertical, TSSpacing.xs)
            .background(TSMaterial.overlay, in: RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TSRadius.sm, style: .continuous)
                    .strokeBorder(Color.TS.border, lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.2), radius: 6, y: 2)
            .accessibilityLabel(Text(verbatim: toast.label))
            .accessibilityAddTraits(.updatesFrequently)
    }
}

// MARK: - Freshness chip (P4 connectivity axis)

/// The freshness chip shown when the feed is not live — a colored dot + label, tappable to refresh.
struct PlaybackControlsFreshnessChip: View {
    let connection: PlaybackControlsConnection
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
        case .live: PlaybackControlsStrings.string("replay.live", "Live")
        case .stale: PlaybackControlsStrings.string("replay.stale", "Stale")
        case .offline: PlaybackControlsStrings.string("replay.offline", "Offline")
        }
    }

    private var accessibilityText: String {
        switch connection {
        case .live: label
        case .stale: PlaybackControlsStrings.string("replay.staleA11y", "Stale — tap to refresh")
        case .offline: PlaybackControlsStrings.string("replay.offlineA11y", "Offline — showing the last position")
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
        .accessibilityLabel(Text(verbatim: accessibilityText))
    }
}
