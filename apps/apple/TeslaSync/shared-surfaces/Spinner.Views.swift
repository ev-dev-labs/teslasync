//
//  Spinner.Views.swift
//  TeslaSync — P4 shared surface · 0140 · Spinner (Apple)
//
//  The presentational pieces of the brand loading mark — the native peers of the web SVG: the bolt outline
//  as a SwiftUI `Shape` (web path `d`), the dual-glow drop-shadow stack (web `.spinner-bolt-glow`), the
//  static fully-filled bolt rendered under reduced motion (web `fillOpacity={reduce ? 1 : 0}` with no draw
//  cycle), and the animated strike that draws / fills / fades on a loop (web `@keyframes boltDraw` driven by
//  a `KeyframeAnimator`). All chrome is token-driven (P1/S9): the bolt is `Color.TS.textPrimary` so it stays
//  legible in light + dark + high-contrast, and the glow tracks the brand `accent` + `statusSuccess` tokens
//  (the native peer of the web `--theme-primary` / `--theme-accent`). No raw hex, no Tailwind ports. The
//  mark is decorative — VoiceOver reads the parent surface's label, not the bolt.
//

import SwiftUI

// MARK: - Bolt outline (web SVG path `d`)

/// The lightning-bolt outline as a SwiftUI `Shape` — the native peer of the web path
/// `M112 30 L62 108 h34 L78 170 l58-82 h-34 z`. It scales the normalized ``SpinnerBoltGeometry`` vertices
/// into the draw rect as one closed sub-path, so a stroke `trim` traces the strike along it and a fill
/// solidifies it.
struct SpinnerBoltShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let points = SpinnerBoltGeometry.normalizedPoints
        guard let first = points.first else { return path }
        path.move(to: scaled(first, in: rect))
        for normalized in points.dropFirst() {
            path.addLine(to: scaled(normalized, in: rect))
        }
        path.closeSubpath()
        return path
    }

    private func scaled(_ normalized: CGPoint, in rect: CGRect) -> CGPoint {
        CGPoint(
            x: rect.minX + normalized.x * rect.width,
            y: rect.minY + normalized.y * rect.height
        )
    }
}

// MARK: - Stroke + motion helpers

/// The shared stroke style for the bolt outline — the native peer of the web `strokeLinecap="round"` +
/// `strokeLinejoin="round"`, at the size-scaled line width.
enum SpinnerBoltStroke {
    static func style(width: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
    }
}

/// Whether the strike-draw cycle runs — the native boundary that honors Reduce Motion. The web renders a
/// static, fully-filled bolt when `prefers-reduced-motion: reduce` (no draw cycle, no fade); otherwise the
/// `boltDraw` loop runs. Pure + unit-tested so the reduce-motion contract is verifiable without a host.
enum SpinnerMotion {
    static func boltAnimates(reduce: Bool) -> Bool {
        !reduce
    }
}

// MARK: - Bolt mark (web `<svg class="spinner-bolt-glow">`)

/// The composed bolt mark — the native peer of the glowing `<svg>`: it selects the static or animated bolt
/// from the projection's Reduce Motion flag, sizes it to the box, and lays the dual-glow drop-shadow stack
/// over it (web `.spinner-bolt-glow`). The mark is hidden from VoiceOver; the parent surface owns the label.
struct SpinnerBoltMark: View {
    let projection: SpinnerProjection

    var body: some View {
        Group {
            if SpinnerMotion.boltAnimates(reduce: projection.reduce) {
                SpinnerAnimatedBolt(projection: projection)
            } else {
                SpinnerStaticBolt(projection: projection)
            }
        }
        .frame(width: projection.dimension, height: projection.dimension)
        .shadow(color: Color.TS.accent.opacity(0.85), radius: SpinnerProjector.glowPrimaryRadius)
        .shadow(color: Color.TS.statusSuccess.opacity(0.75), radius: SpinnerProjector.glowAccentRadius)
        .accessibilityHidden(true)
    }
}

// MARK: - Static bolt (web reduced-motion branch)

/// The reduced-motion bolt — a fully-filled, fully-stroked mark with no animation (web
/// `fillOpacity={reduce ? 1 : 0}` + `strokeDasharray="none"`). The fill solidifies the body while the round
/// stroke softens the corners, matching the web's filled-plus-outlined draw.
struct SpinnerStaticBolt: View {
    let projection: SpinnerProjection

    var body: some View {
        ZStack {
            SpinnerBoltShape()
                .fill(Color.TS.textPrimary)
                .opacity(projection.restingFillOpacity)
            SpinnerBoltShape()
                .stroke(Color.TS.textPrimary, style: SpinnerBoltStroke.style(width: projection.strokeWidthPoints))
        }
    }
}

// MARK: - Animated bolt (web `@keyframes boltDraw`)

/// The interpolated values one frame of the strike-draw cycle needs — the `KeyframeAnimator` value type
/// whose properties each ``SpinnerBoltKeyframes`` track animates: the stroke `trim` window (draw on, then
/// retreat), the fill opacity (solidify, then clear), and the overall opacity (the fade in + out).
private struct SpinnerBoltFrame {
    var trimFrom: Double
    var trimTo: Double
    var fillOpacity: Double
    var opacity: Double
}

/// The animated bolt — the native peer of the web `.spinner-bolt-draw` element driven by `@keyframes
/// boltDraw 2s ease-in-out infinite`. A `KeyframeAnimator` loops ``SpinnerBoltKeyframes``: the stroke draws
/// on (`trimTo` `0 → 1`), the fill solidifies (`fillOpacity` `0 → 1`), the mark holds, then the tail
/// retreats (`trimFrom` `0 → 1`) and the whole bolt fades out before the next strike.
struct SpinnerAnimatedBolt: View {
    let projection: SpinnerProjection

    var body: some View {
        let stops = SpinnerBoltKeyframes.stops
        let durations = SpinnerBoltKeyframes.segmentDurations()
        let initial = SpinnerBoltKeyframes.initialStop

        return KeyframeAnimator(
            initialValue: SpinnerBoltFrame(
                trimFrom: initial.trimFrom,
                trimTo: initial.trimTo,
                fillOpacity: initial.fillOpacity,
                opacity: initial.opacity
            ),
            repeating: true
        ) { frame in
            ZStack {
                SpinnerBoltShape()
                    .fill(Color.TS.textPrimary)
                    .opacity(frame.fillOpacity)
                SpinnerBoltShape()
                    .trim(from: frame.trimFrom, to: frame.trimTo)
                    .stroke(
                        Color.TS.textPrimary,
                        style: SpinnerBoltStroke.style(width: projection.strokeWidthPoints)
                    )
            }
            .opacity(frame.opacity)
        } keyframes: { _ in
            KeyframeTrack(\.trimTo) {
                LinearKeyframe(stops[1].trimTo, duration: durations[0])
                LinearKeyframe(stops[2].trimTo, duration: durations[1])
                LinearKeyframe(stops[3].trimTo, duration: durations[2])
                LinearKeyframe(stops[4].trimTo, duration: durations[3])
            }
            KeyframeTrack(\.trimFrom) {
                LinearKeyframe(stops[1].trimFrom, duration: durations[0])
                LinearKeyframe(stops[2].trimFrom, duration: durations[1])
                LinearKeyframe(stops[3].trimFrom, duration: durations[2])
                LinearKeyframe(stops[4].trimFrom, duration: durations[3])
            }
            KeyframeTrack(\.fillOpacity) {
                CubicKeyframe(stops[1].fillOpacity, duration: durations[0])
                CubicKeyframe(stops[2].fillOpacity, duration: durations[1])
                CubicKeyframe(stops[3].fillOpacity, duration: durations[2])
                CubicKeyframe(stops[4].fillOpacity, duration: durations[3])
            }
            KeyframeTrack(\.opacity) {
                CubicKeyframe(stops[1].opacity, duration: durations[0])
                CubicKeyframe(stops[2].opacity, duration: durations[1])
                CubicKeyframe(stops[3].opacity, duration: durations[2])
                CubicKeyframe(stops[4].opacity, duration: durations[3])
            }
        }
    }
}
