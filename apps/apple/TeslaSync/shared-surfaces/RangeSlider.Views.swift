//
//  RangeSlider.Views.swift
//  TeslaSync — P4 shared surface · 0224 · RangeSlider (Apple)
//
//  The presentational pieces of the dual-thumb range slider — the native peers of the web elements: the
//  label / value row (web `showLabel` header: the label and the tabular-nums "low – high" caption), the
//  interactive track (web's two stacked `<input type="range">`: a thin ground, the selected-range fill,
//  and two draggable thumbs), and the degenerate-range affordance (the native never-a-blank-box peer of an
//  unusable `max <= min` slider). All chrome is token-driven (P1/S9); no raw hex, no Tailwind ports.
//
//  The web stacks two native range inputs and toggles pointer-events / z-index so each thumb stays
//  grabbable; the native idiom is one track with two thumbs, each its own VoiceOver-adjustable element
//  (Arrow keys / swipe step by `step`, the WAI-ARIA APG slider pattern), and the colliding thumb raised by
//  the web `lowPct > 50` rule. The thumb follows the iOS slider idiom (a white knob with an accent ring +
//  shadow, the TimelineScrubber 0107 playhead idiom) rather than porting the browser's accent-tinted native
//  thumb. Reduce Motion drops the fill / thumb transition.
//

import SwiftUI

// MARK: - Motion (web `transition-transform duration-normal` on the thumb)

/// Builds the SwiftUI fill / thumb animation — the native boundary that turns the web thumb transition into
/// a single token-driven `Animation`. Returns `nil` under reduced motion so positions snap with no
/// movement. The duration is the design system's `fast` motion token (P1/S9).
public enum RangeSliderMotion {
    /// The fill / thumb travel animation, or `nil` when reduced motion is in effect.
    public static func thumb(reduce: Bool) -> Animation? {
        reduce ? nil : .easeOut(duration: TSMotion.fastDuration)
    }
}

// MARK: - Label row (web `showLabel` header)

/// The label + value row — the native peer of the web header: the label on the leading edge (web
/// `typography.role.label`) and the "low – high" readout on the trailing edge (web `<Caption
/// className="tabular-nums">`). Collapsed into one VoiceOver element reading the localized summary so the
/// dash is not spoken literally; the adjustable thumbs below carry the real interaction.
struct RangeSliderLabelRow: View {
    let label: String
    let valueText: String
    let accessibilitySummary: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: TSSpacing.sm) {
            Text(verbatim: label)
                .font(Font.TS.label)
                .foregroundStyle(Color.TS.textSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: valueText)
                .font(Font.TS.caption)
                .monospacedDigit()
                .foregroundStyle(Color.TS.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }
}

// MARK: - Thumb (web range thumb — iOS knob idiom)

/// One draggable knob — a white circle with an accent ring and a soft shadow (the iOS slider idiom, shared
/// with the TimelineScrubber playhead). It grows slightly and thickens its ring while dragging, and dims
/// when disabled. The hit target is padded to the HIG-minimum so the small knob stays easy to grab.
struct RangeSliderThumb: View {
    let size: CGFloat
    let disabled: Bool
    let dragging: Bool

    private let hitTarget: CGFloat = 44

    var body: some View {
        Circle()
            .fill(Color.white)
            .frame(width: dragging ? size + 4 : size, height: dragging ? size + 4 : size)
            .overlay(
                Circle().strokeBorder(
                    Color.TS.accent.opacity(disabled ? 0.4 : 1),
                    lineWidth: dragging ? 3 : 2
                )
            )
            .shadow(color: Color.black.opacity(0.25), radius: 2, y: 1)
            .frame(width: hitTarget, height: hitTarget)
            .contentShape(Circle())
            .opacity(disabled ? 0.5 : 1)
    }
}

// MARK: - Track (web two stacked range inputs)

/// The interactive track — the native peer of the web's stacked range inputs: a thin ground capsule (web
/// `bg-[var(--surface-2)]`, mapped to the design `border` token at 50% per the TimelineScrubber slider
/// precedent), the selected-range fill (web `bg-cyan-500/60` → accent at 60%), and two thumbs positioned by
/// their percent. Each thumb is an independent VoiceOver-adjustable element; a drag on either maps its
/// position back through the state-holder's swap rules. The colliding thumb is raised by the web `lowPct >
/// 50` z-order so it stays grabbable near an edge.
struct RangeSliderTrack: View {
    let model: RangeSliderModel
    let reduceMotion: Bool

    @State private var dragging: Thumb?

    private let trackAreaHeight: CGFloat = 24
    private let trackThickness: CGFloat = 4
    private let thumbSize: CGFloat = 22
    private let coordSpace = "rangeSliderTrack"

    private enum Thumb: Equatable {
        case low
        case high
    }

    var body: some View {
        GeometryReader { geo in
            let width = geo.size.width
            ZStack(alignment: .leading) {
                ground(width: width)
                fill(width: width)
                thumb(.low, width: width)
                thumb(.high, width: width)
            }
            .frame(height: trackAreaHeight)
            .coordinateSpace(.named(coordSpace))
        }
        .frame(height: trackAreaHeight)
    }

    // MARK: Layers

    private func ground(width: CGFloat) -> some View {
        Capsule()
            .fill(Color.TS.border.opacity(0.5))
            .frame(width: max(0, width - thumbSize), height: trackThickness)
            .position(x: width / 2, y: trackAreaHeight / 2)
            .accessibilityHidden(true)
    }

    private func fill(width: CGFloat) -> some View {
        let projection = model.projection
        let startX = centerX(percent: projection.fillStartPercent, width: width)
        let endX = centerX(percent: projection.fillEndPercent, width: width)
        return Capsule()
            .fill(Color.TS.accent.opacity(projection.isDisabled ? 0.3 : 0.6))
            .frame(width: max(0, endX - startX), height: trackThickness)
            .position(x: (startX + endX) / 2, y: trackAreaHeight / 2)
            .animation(RangeSliderMotion.thumb(reduce: reduceMotion), value: projection.fillStartPercent)
            .animation(RangeSliderMotion.thumb(reduce: reduceMotion), value: projection.fillEndPercent)
            .accessibilityHidden(true)
    }

    private func thumb(_ which: Thumb, width: CGFloat) -> some View {
        let projection = model.projection
        let percent = which == .low ? projection.lowPercent : projection.highPercent
        // Web z-order: low on top once it passes the midpoint, otherwise the high thumb is raised.
        let onTop = which == .low ? projection.lowOnTop : !projection.lowOnTop
        return RangeSliderThumb(size: thumbSize, disabled: projection.isDisabled, dragging: dragging == which)
            .position(x: centerX(percent: percent, width: width), y: trackAreaHeight / 2)
            .zIndex(onTop ? 2 : 1)
            .animation(RangeSliderMotion.thumb(reduce: reduceMotion), value: percent)
            .gesture(dragGesture(which, width: width))
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: which == .low ? model.lowThumbLabel : model.highThumbLabel))
            .accessibilityValue(Text(verbatim: which == .low ? model.displayLow : model.displayHigh))
            .accessibilityAdjustableAction { direction in adjust(which, direction) }
    }

    // MARK: Geometry

    /// The x of a thumb's center for a 0…100 percent, inset by half a thumb on each end so the knob never
    /// clips at the extremes (the travel range the native browser thumb also respects).
    private func centerX(percent: Double, width: CGFloat) -> CGFloat {
        let travel = max(1, width - thumbSize)
        return thumbSize / 2 + CGFloat(percent / 100) * travel
    }

    /// The 0…1 fraction for a drag location x, inverting ``centerX(percent:width:)``.
    private func fraction(fromLocationX locationX: CGFloat, width: CGFloat) -> Double {
        let travel = max(1, width - thumbSize)
        return Double((locationX - thumbSize / 2) / travel)
    }

    // MARK: Interaction

    private func dragGesture(_ which: Thumb, width: CGFloat) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .named(coordSpace))
            .onChanged { value in
                guard model.projection.isAdjustable else { return }
                dragging = which
                let fraction = fraction(fromLocationX: value.location.x, width: width)
                if which == .low {
                    model.dragLow(toFraction: fraction)
                } else {
                    model.dragHigh(toFraction: fraction)
                }
            }
            .onEnded { _ in dragging = nil }
    }

    private func adjust(_ which: Thumb, _ direction: AccessibilityAdjustmentDirection) {
        switch direction {
        case .increment:
            if which == .low { model.incrementLow() } else { model.incrementHigh() }
        case .decrement:
            if which == .low { model.decrementLow() } else { model.decrementHigh() }
        @unknown default:
            break
        }
    }
}

// MARK: - Degenerate-range affordance (native — never a blank box)

/// The friendly leaf shown when `max <= min` (no span to slide over) — a labelled row rather than an
/// unusable / blank track (native HIG). The web renders a full, immovable track; the native peer states the
/// condition so the surface never reads as broken. Token-driven (P1/S9); copy via the P1/S10 facade;
/// combined into a single VoiceOver element.
struct RangeSliderEmptyState: View {
    var body: some View {
        HStack(spacing: TSSpacing.sm) {
            Image(systemName: "slider.horizontal.3")
                .font(.system(size: 18))
                .foregroundStyle(Color.TS.textMuted)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: RangeSliderStrings.emptyTitle)
                    .font(Font.TS.body)
                    .foregroundStyle(Color.TS.textPrimary)
                Text(verbatim: RangeSliderStrings.emptyMessage)
                    .font(Font.TS.caption)
                    .foregroundStyle(Color.TS.textSecondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, TSSpacing.xs)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(
            Text(verbatim: "\(RangeSliderStrings.emptyTitle). \(RangeSliderStrings.emptyMessage)")
        )
    }
}
