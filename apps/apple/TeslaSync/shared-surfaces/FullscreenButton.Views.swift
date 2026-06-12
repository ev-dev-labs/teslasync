//
//  FullscreenButton.Views.swift
//  TeslaSync — P4 shared surface · 0214 · FullscreenButton (Apple)
//
//  The presentational subview composed by `FullscreenButton`: the button's label content — a single
//  SF Symbol mirroring the web lucide glyph (`Maximize` when resting, `Minimize` when fullscreen). It
//  is a pure function of the fullscreen flag and the reduce-motion preference; it consumes the shared
//  P1/S9 sizing — no networking, no Tailwind ports, no raw hex. The glyph swap animates with a
//  symbol-aware content transition that collapses to an instant change when Reduce Motion is on. The
//  spoken label is supplied by the parent control, so this content is hidden from VoiceOver to avoid a
//  duplicate announcement.
//

import SwiftUI

// MARK: - Button label (web `<Button icon={isFs ? <Minimize/> : <Maximize/>} />` content)

/// The fullscreen button's label — the leading glyph, swapping between the resting `Maximize` (enter)
/// and the fullscreen `Minimize` (exit) on the fullscreen flag (web `isFs ? <Minimize/> :
/// <Maximize/>`). An icon-only control, matching the compact toolbar density of the web source.
struct FullscreenButtonLabel: View {
    let isFullscreen: Bool
    let reduceMotion: Bool

    private var iconName: String {
        FullscreenButtonLogic.iconSystemImage(isFullscreen: isFullscreen)
    }

    var body: some View {
        Image(systemName: iconName)
            .font(.system(size: 14, weight: .medium))
            .contentTransition(.symbolEffect(.replace))
            .animation(TSAnimation.fast(reduceMotion: reduceMotion), value: isFullscreen)
            .accessibilityHidden(true)
    }
}
