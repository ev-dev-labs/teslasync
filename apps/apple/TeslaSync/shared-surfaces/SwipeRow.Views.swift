//
//  SwipeRow.Views.swift
//  TeslaSync — P4 shared surface · 0189 · SwipeRow (Apple)
//
//  The interactive swipe row — the SwiftUI parity of the web `SwipeRow` happy path. A ZStack lays the
//  left-/right-edge action panels behind the foreground row and translates the row with the live drag
//  offset. A `DragGesture` reproduces the web touch math through the pure `SwipeRowGeometry`: it locks
//  onto the horizontal axis past 8px, cancels on a dominant vertical drift so the parent list keeps
//  scrolling, clamps the travel to the wired side, fires a one-shot haptic the first time the reveal
//  threshold is crossed, and on release auto-fires (past half width) / peeks (past the threshold) /
//  snaps closed. Reduce Motion collapses the snap-back animation (web `prefers-reduced-motion`); all
//  colour comes from the P1/S9 tokens. The whole row is one VoiceOver element exposing each wired
//  action as a custom action, so the hidden gesture stays fully operable without a swipe.
//

import SwiftUI

// MARK: - Interactive content (web `active` branch)

/// The swipe-enabled row. Owns the live drag offset + gesture state and renders the action underlays
/// behind the translated foreground row. Only mounted when the surface is active (capability ∧ a
/// wired action); the pass-through case renders the children plainly upstream.
struct SwipeRowInteractiveContent<Content: View>: View {
    let leftAction: SwipeAction?
    let rightAction: SwipeAction?
    let revealThreshold: Double
    let content: () -> Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var offset: Double = 0
    @State private var locked = false
    @State private var cancelled = false
    @State private var hapticArmed = true
    @State private var hapticTick = 0
    @State private var rowWidth: Double = 0

    private var hasLeft: Bool {
        leftAction != nil
    }

    private var hasRight: Bool {
        rightAction != nil
    }

    var body: some View {
        ZStack {
            rightUnderlay
            leftUnderlay
            foreground
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipped()
        .contentShape(Rectangle())
        .gesture(swipeGesture)
        .onGeometryChange(for: CGFloat.self, of: { $0.size.width }, action: { rowWidth = Double($0) })
        .sensoryFeedback(.impact(flexibility: .solid, intensity: 0.6), trigger: hapticTick)
        .accessibilityElement(children: .combine)
        .accessibilityHint(accessibilityHint)
        .accessibilityActions { accessibilityActions }
    }

    // MARK: Layers

    /// The wrapped row, translated by the live drag offset. Backed by the canvas token so the action
    /// underlays stay hidden behind it at rest (web `bg-[var(--bg-canvas)]`).
    private var foreground: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.TS.bg)
            .offset(x: offset)
    }

    @ViewBuilder
    private var rightUnderlay: some View {
        if let rightAction {
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                SwipeActionButton(action: rightAction, isRevealed: offset < 0) { fire(rightAction) }
            }
        }
    }

    @ViewBuilder
    private var leftUnderlay: some View {
        if let leftAction {
            HStack(spacing: 0) {
                SwipeActionButton(action: leftAction, isRevealed: offset > 0) { fire(leftAction) }
                Spacer(minLength: 0)
            }
        }
    }

    // MARK: Accessibility (custom actions make the hidden gesture operable)

    @ViewBuilder
    private var accessibilityActions: some View {
        if let leftAction {
            Button(actionLabel(leftAction)) { fire(leftAction) }
        }
        if let rightAction {
            Button(actionLabel(rightAction)) { fire(rightAction) }
        }
    }

    private var accessibilityHint: Text {
        let hint = SwipeRowAccessibility.rowActionsHint(
            hasLeftAction: hasLeft,
            hasRightAction: hasRight,
            strings: SwipeRowStrings.string
        )
        return Text(verbatim: hint ?? "")
    }

    private func actionLabel(_ action: SwipeAction) -> String {
        SwipeRowAccessibility.actionLabel(
            label: action.label,
            override: action.accessibilityLabel,
            strings: SwipeRowStrings.string
        )
    }

    // MARK: Interaction

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: SwipeRowGeometry.horizontalLock)
            .onChanged { onDragChanged($0) }
            .onEnded { _ in onDragEnded() }
    }

    private func onDragChanged(_ value: DragGesture.Value) {
        guard !cancelled else { return }
        let dx = Double(value.translation.width)
        let dy = Double(value.translation.height)
        if !locked {
            if SwipeRowGeometry.shouldCancelForVerticalDrift(dx: dx, dy: dy) {
                cancelled = true
                offset = 0
                return
            }
            guard SwipeRowGeometry.hasHorizontalLock(dx: dx) else { return }
            locked = true
        }
        let next = SwipeRowGeometry.constrainedOffset(
            dx: dx, width: rowWidth, hasLeftAction: hasLeft, hasRightAction: hasRight
        )
        if hapticArmed, SwipeRowGeometry.crossedRevealThreshold(offset: next, threshold: revealThreshold) {
            hapticArmed = false
            hapticTick += 1
        }
        offset = next
    }

    private func onDragEnded() {
        let wasDragging = locked
        let wasCancelled = cancelled
        locked = false
        cancelled = false
        hapticArmed = true
        guard wasDragging, !wasCancelled else {
            animate(to: 0)
            return
        }
        apply(SwipeRowGeometry.releaseOutcome(
            finalOffset: offset, width: rowWidth, hasLeftAction: hasLeft, hasRightAction: hasRight,
            threshold: revealThreshold
        ))
    }

    private func apply(_ outcome: SwipeRowOutcome) {
        switch outcome {
        case .fireRight: if let rightAction { fire(rightAction) }
        case .fireLeft: if let leftAction { fire(leftAction) }
        case .peekRight, .peekLeft: animate(to: SwipeRowGeometry.restingOffset(for: outcome))
        case .closed: animate(to: 0)
        }
    }

    private func fire(_ action: SwipeAction) {
        animate(to: 0)
        action.onAction()
    }

    private func animate(to target: Double) {
        withAnimation(reduceMotion ? nil : .easeOut(duration: TSMotion.fastDuration)) {
            offset = target
        }
    }
}

// MARK: - Action button (the revealed underlay control)

/// One edge action panel — a tone-tinted button (icon over label) the user taps once the row is
/// peeked open. Hidden from hit-testing + VoiceOver until revealed (the swipe row exposes the action
/// as a custom action regardless, so it is always operable). Web `actionPanelClasses`: danger paints
/// the rose/danger token, default the cyan/accent token.
struct SwipeActionButton: View {
    let action: SwipeAction
    let isRevealed: Bool
    let onFire: () -> Void

    private var tone: Color {
        switch action.tone {
        case .default: Color.TS.accent
        case .danger: Color.TS.statusDanger
        }
    }

    var body: some View {
        Button(action: onFire) {
            VStack(spacing: TSSpacing.xs) {
                Image(systemName: action.resolvedSymbolName)
                    .font(.system(size: 16, weight: .semibold))
                Text(verbatim: action.label)
                    .font(Font.TS.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
            }
            .foregroundStyle(tone)
            .frame(width: SwipeRowGeometry.actionWidth)
            .frame(maxHeight: .infinity)
            .background(tone.opacity(0.18))
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isRevealed)
        .accessibilityHidden(true)
    }
}
