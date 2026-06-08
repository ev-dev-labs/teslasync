//
//  EnvironmentSlide.Motion.swift
//  TeslaSync — P4 feature view · 0063 · EnvironmentSlide (Apple)
//
//  The entrance-animation modifiers used by the content slide — the native parity of the web
//  source's `motion.*` staged reveals (spring scale-in for the globe, slide-up + fade for the label /
//  figure / caption / tree grid). Every animation collapses to an instant reveal under Reduce Motion
//  (`@Environment(\.accessibilityReduceMotion)` is resolved by the caller and threaded in), so the
//  surface honors the accessibility setting on iOS 18 / iPadOS 18 / macOS 15.
//

import SwiftUI

// MARK: - Entrance-animation modifiers (web `motion` parity, Reduce-Motion-aware)

/// Spring scale-in from zero (web `motion.span initial={{ scale: 0 }}` spring). Instant under
/// Reduce Motion.
private struct PopInModifier: ViewModifier {
    let delay: Double
    let reduceMotion: Bool

    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .scaleEffect(shown || reduceMotion ? 1 : 0.01)
            .opacity(shown || reduceMotion ? 1 : 0)
            .onAppear {
                guard !reduceMotion else {
                    shown = true
                    return
                }
                withAnimation(.spring(response: 0.5, dampingFraction: 0.55).delay(delay)) {
                    shown = true
                }
            }
    }
}

/// Slide-up + fade-in (web `motion.p initial={{ y, opacity: 0 }}`). Instant under Reduce Motion.
private struct SlideInModifier: ViewModifier {
    let delay: Double
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
                withAnimation(.easeOut(duration: TSMotion.slowDuration).delay(delay)) {
                    shown = true
                }
            }
    }
}

extension View {
    func popIn(delay: Double, reduceMotion: Bool) -> some View {
        modifier(PopInModifier(delay: delay, reduceMotion: reduceMotion))
    }

    func slideIn(delay: Double, yOffset: CGFloat, reduceMotion: Bool) -> some View {
        modifier(SlideInModifier(delay: delay, yOffset: yOffset, reduceMotion: reduceMotion))
    }
}
