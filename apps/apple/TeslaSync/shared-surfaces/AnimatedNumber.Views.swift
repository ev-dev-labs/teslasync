//
//  AnimatedNumber.Views.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  The presentational subviews composed by `AnimatedNumber`: the reduce-motion-aware roller that owns
//  the count-up animation, and the `Animatable` text whose `animatableData` is the linear progress
//  SwiftUI interpolates each frame. Keeping the linear progress in `animatableData` and applying the
//  ease-out-quad curve inside the projection reproduces the web tick loop exactly (the web computes a
//  *linear* `elapsed / durationMs` and then eases it), rather than swapping in SwiftUI's cubic
//  `.easeOut`. The digits are monospaced (web `tabular-nums`); the colour is inherited so callers tint
//  the figure with the P1/S9 tokens at the use-site (the web span carries no colour of its own).
//
//  Reduce Motion (web has none; this is a native accessibility refinement): the roller skips the tween
//  and shows the settled value immediately — never a frozen zero, never a blank box.
//

import SwiftUI

// MARK: - Roller (owns the count-up animation)

/// Drives the count-up: starts at progress 0 and animates linearly to 1 over `duration`, or jumps
/// straight to the settled value when Reduce Motion is on or the duration is non-positive. Because the
/// parent re-identifies this view on `value` / `duration` changes, its `@State` progress resets to 0
/// and the count restarts — the parity of the web effect re-running.
struct AnimatedNumberRoller: View {
    let value: Double
    let duration: Double
    let format: (Double) -> String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var progress: Double = 0

    var body: some View {
        AnimatedNumberText(progress: progress, value: value, format: format)
            .onAppear(perform: startRoll)
    }

    private func startRoll() {
        let length = AnimatedNumberProjection.clampedDuration(duration)
        guard !reduceMotion, length > 0 else {
            progress = 1
            return
        }
        withAnimation(.linear(duration: length)) { progress = 1 }
    }
}

// MARK: - Animatable text (interpolated by SwiftUI each frame)

/// The rolling figure. SwiftUI interpolates `progress` (the linear 0...1 `animatableData`) every
/// frame; the body eases it (`AnimatedNumberProjection`), tweens zero → `value`, and formats the
/// result. Monospaced digits keep the width stable as the number rolls (web `tabular-nums`).
///
/// The `Animatable` conformance is isolated to the main actor (SE-0470): SwiftUI drives
/// `animatableData` on the main actor as part of the render loop, so the isolated conformance is both
/// correct and free of the data race that an implicitly nonisolated requirement would imply.
struct AnimatedNumberText: View, @MainActor Animatable {
    var progress: Double
    let value: Double
    let format: (Double) -> String

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    var body: some View {
        Text(verbatim: format(AnimatedNumberProjection.tween(to: value, progress: progress)))
            .monospacedDigit()
    }
}
