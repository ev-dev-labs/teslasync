//
//  PlaybackSpeedMenu.Previews.swift
//  TeslaSync — P4 shared surface · 0097 · PlaybackSpeedMenu (Apple)
//
//  Xcode previews for the branches the web source renders: the slowest speed (1x), a mid speed
//  (25x), and the fastest speed (100x, where the next forward cycle wraps to 1x). Each preview is
//  interactive — tapping the control cycles the bound speed forward and the menu picks an exact
//  speed — so the cycle/select branches are exercisable in the canvas. DEBUG-only; compiled by the
//  app targets and skipped by the shipped-surface gate scope.
//

import SwiftUI

#if DEBUG
    /// A faux transport bar hosting the control, with a bound `speed` so the cycle/select branches
    /// are live in the canvas.
    private struct PlaybackSpeedMenuPreviewHarness: View {
        @State private var speed: ReplaySpeed

        init(initial: ReplaySpeed) {
            _speed = State(initialValue: initial)
        }

        var body: some View {
            HStack(spacing: TSSpacing.md) {
                Text(verbatim: "Trip replay")
                    .font(Font.TS.panel)
                    .foregroundStyle(Color.TS.textPrimary)
                Spacer()
                PlaybackSpeedMenu(speed: speed) { speed = $0 }
            }
            .padding(TSSpacing.md)
            .background(
                Color.TS.surfaceGlass,
                in: RoundedRectangle(cornerRadius: TSRadius.md, style: .continuous)
            )
            .padding()
            .background(Color.TS.bg)
        }
    }

    #Preview("Slowest (1x)") {
        PlaybackSpeedMenuPreviewHarness(initial: .x1)
    }

    #Preview("Mid (25x)") {
        PlaybackSpeedMenuPreviewHarness(initial: .x25)
    }

    #Preview("Fastest (100x → wraps)") {
        PlaybackSpeedMenuPreviewHarness(initial: .x100)
    }
#endif
