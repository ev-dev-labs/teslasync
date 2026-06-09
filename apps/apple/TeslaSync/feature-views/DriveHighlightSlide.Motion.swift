//
//  DriveHighlightSlide.Motion.swift
//  TeslaSync — P4 feature view · 0062 · DriveHighlightSlide (Apple)
//
//  The entrance-animation modifiers used by the content slide — the native parity of the web source's
//  `motion.*` staged reveals: a spring scale + rotation for the emoji
//  (`initial={{ scale: 0, rotate: -10 }}`, spring stiffness 180 / damping 14), and a slide-up + fade for
//  the label and the card (`initial={{ y, opacity: 0 }}` on per-element delays). Every animation
//  collapses to an instant reveal under Reduce Motion (`@Environment(\.accessibilityReduceMotion)` is
//  resolved by the caller and threaded in), so the surface honors the accessibility setting on iOS 18 /
//  iPadOS 18 / macOS 15.
//

import SwiftUI

// MARK: - Entrance-animation modifiers (web `motion` parity, Reduce-Motion-aware)

/// Spring scale + rotation reveal (web `motion.span initial={{ scale: 0, rotate: -10 }}` with
/// `transition={{ type: 'spring', stiffness: 180, damping: 14 }}`). Instant under Reduce Motion.
private struct DriveHighlightPopInModifier: ViewModifier {
    let reduceMotion: Bool

    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(shown || reduceMotion ? 1 : 0.01)
            .rotationEffect(.degrees(shown || reduceMotion ? 0 : -10))
            .opacity(shown || reduceMotion ? 1 : 0)
            .onAppear {
                guard !reduceMotion else {
                    shown = true
                    return
                }
                withAnimation(.interpolatingSpring(stiffness: 180, damping: 14)) {
                    shown = true
                }
            }
    }
}

/// Slide-up + fade-in (web `motion.p` / `motion.div` `initial={{ y, opacity: 0 }}`). Instant under
/// Reduce Motion.
private struct DriveHighlightSlideInModifier: ViewModifier {
    let delay: Double
    let duration: Double
    let yOffset: CGFloat
    let reduceMotion: Bool

    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : yOffset)
            .onAppear {
                guard !reduceMotion else {
                    shown = true
                    return
                }
                withAnimation(.easeOut(duration: duration).delay(delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    /// Web emoji spring entrance (`scale: 0, rotate: -10` → settle).
    func driveHighlightPopIn(reduceMotion: Bool) -> some View {
        modifier(DriveHighlightPopInModifier(reduceMotion: reduceMotion))
    }

    /// Web slide-up + fade entrance for the label / card (per-element `delay` + `duration`).
    func driveHighlightSlideIn(
        delay: Double,
        duration: Double,
        yOffset: CGFloat,
        reduceMotion: Bool
    ) -> some View {
        modifier(
            DriveHighlightSlideInModifier(
                delay: delay,
                duration: duration,
                yOffset: yOffset,
                reduceMotion: reduceMotion
            )
        )
    }
}
