//
//  PlaybackSpeedMenu.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  The playback-speed control — the SwiftUI parity of `components/data-display/PlaybackSpeedMenu.tsx`.
//  The web component is a compact ghost button: a primary click cycles to the next-fastest speed
//  (wrapping), and a secondary right-click steps one speed slower (clamped). The native parity uses
//  SwiftUI's `Menu` with a `primaryAction` — the HIG-idiomatic counterpart: a tap runs the primary
//  action (cycle forward, mirroring the web `onClick`), while the secondary gesture (long-press on
//  iOS / right-click on macOS, mirroring the web `onContextMenu`) opens a menu of every speed for
//  direct selection — a superset of the web "one slower" step, with the current speed checkmarked.
//
//  Binds through `PlaybackSpeedMenuModel` (the `@MainActor` owner of the host `onChange` callback);
//  no networking and no side-effecting `Task` plumbing live in the view. The control is *controlled*
//  (the parent owns `speed`), exactly like the web source. Emits `view.opened` once on first
//  appearance (P1/S11).
//

import SwiftUI

// MARK: - PlaybackSpeedMenu (the shared surface)

/// The playback-speed control — the SwiftUI parity of `components/data-display/PlaybackSpeedMenu.tsx`.
/// A `{speed}x` `Menu` whose primary action cycles forward and whose menu selects an exact speed,
/// binding through `PlaybackSpeedMenuModel`.
public struct PlaybackSpeedMenu: View {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let surfaceSlug = PlaybackSpeedMenuMeta.surfaceSlug

    private let speed: ReplaySpeed
    @State private var model: PlaybackSpeedMenuModel

    /// Convenience initializer wiring the host `onChange` directly — the parity of mounting
    /// `<PlaybackSpeedMenu speed={…} onChange={…} />`. The control is controlled: `speed` is supplied
    /// by the parent on every render and `onChange` notifies it of the next value.
    public init(
        speed: ReplaySpeed,
        onChange: @escaping @MainActor (ReplaySpeed) -> Void,
        telemetry: any PlaybackSpeedMenuTelemetry = OSLogPlaybackSpeedMenuTelemetry()
    ) {
        self.speed = speed
        _model = State(initialValue: PlaybackSpeedMenuModel(onChange: onChange, telemetry: telemetry))
    }

    /// Designated initializer binding a pre-built action model (for hosts that own the model, e.g.
    /// previews and tests).
    public init(speed: ReplaySpeed, model: PlaybackSpeedMenuModel) {
        self.speed = speed
        _model = State(initialValue: model)
    }

    public var body: some View {
        Menu {
            ForEach(PlaybackSpeedMenuLogic.replaySpeeds) { option in
                PlaybackSpeedMenuItemButton(speed: option, isCurrent: option == speed) {
                    model.select(option)
                }
            }
        } label: {
            PlaybackSpeedMenuTriggerLabel(speed: speed)
        } primaryAction: {
            model.cycleForward(from: speed)
        }
        .accessibilityLabel(Text(verbatim: PlaybackSpeedMenuStrings.speedControlLabel))
        .accessibilityValue(Text(verbatim: PlaybackSpeedMenuStrings.speedValueLabel(speed)))
        .onAppear { model.markAppeared() }
    }
}
