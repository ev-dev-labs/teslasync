//
//  CarAnimation.TeslaMark.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The composed Tesla silhouette — the native peer of the web `CarAnimation` `<svg>`. It lays the body, the
//  windows, the wheels, the head/tail-lights, and the ground shadow in the mark's view-box space (scaled to
//  the projection box), and reproduces the source's staggered entry: the body strokes in (web `pathLength`),
//  the windows fade (web `opacity`), the wheels pop on a spring (web `scale` `type: spring`), the shadow
//  stretches (web `scaleX`), and the head/tail-lights pulse forever (``CarPulseView``). When Reduce Motion is
//  on, every element renders at its final resting frame with no entry or loop (`shown` is always true and the
//  animations are nil). Colors are P1/S9 tokens: `--theme-primary → accent`, `--surface-1/2/3 → bg/surface/
//  surfaceGlass` (the elevation ordering), `--text-muted → textMuted`, the taillight `#ef4444 → statusDanger`.
//

import SwiftUI

/// The animated Tesla silhouette mark (web `CarAnimation` `<svg viewBox="0 0 240 96">`). Decorative — the
/// parent surface owns the VoiceOver label, so this composition is hidden from accessibility.
struct TeslaSilhouetteMark: View {
    let projection: CarAnimationProjection

    @State private var entered = false

    private var shown: Bool {
        entered || projection.reduce
    }

    private var scale: CGFloat {
        projection.scale
    }

    var body: some View {
        ZStack {
            shadowLayer
            bodyLayer
            windowLayer
            wheelLayer
            lightLayer
        }
        .frame(width: projection.width, height: projection.height)
        .accessibilityHidden(true)
        .onAppear { entered = true }
        .onDisappear { entered = false }
    }

    // MARK: Body (web body `<path>` draw-in)

    private var bodyLayer: some View {
        ZStack {
            CarPathShape(commands: CarBodyGeometry.body, viewBox: CarBodyGeometry.viewBox)
                .fill(Color.TS.surface)
            CarPathShape(commands: CarBodyGeometry.body, viewBox: CarBodyGeometry.viewBox)
                .trim(from: 0, to: shown ? 1 : 0)
                .stroke(Color.TS.accent, style: CarStroke.round(width: width(CarStyle.bodyStrokeWidth)))
        }
        .frame(width: projection.width, height: projection.height)
        .animation(motion(CarAnimationTiming.bodyDraw), value: shown)
    }

    // MARK: Windows (web windshield + rear-window fade)

    private var windowLayer: some View {
        ZStack {
            window(
                CarBodyGeometry.windshield,
                fill: CarStyle.windshieldFillOpacity,
                strokeOpacity: CarStyle.windshieldStrokeOpacity,
                strokeWidth: CarStyle.windshieldStrokeWidth
            )
            .opacity(shown ? 1 : 0)
            .animation(motion(CarAnimationTiming.windshieldDuration, CarAnimationTiming.windshieldDelay), value: shown)
            window(
                CarBodyGeometry.rearWindow,
                fill: CarStyle.rearWindowFillOpacity,
                strokeOpacity: CarStyle.rearWindowStrokeOpacity,
                strokeWidth: CarStyle.rearWindowStrokeWidth
            )
            .opacity(shown ? 1 : 0)
            .animation(motion(CarAnimationTiming.rearWindowDuration, CarAnimationTiming.rearWindowDelay), value: shown)
        }
        .frame(width: projection.width, height: projection.height)
    }

    private func window(
        _ commands: [CarPathCommand],
        fill: Double,
        strokeOpacity: Double,
        strokeWidth: CGFloat
    ) -> some View {
        ZStack {
            CarPathShape(commands: commands, viewBox: CarBodyGeometry.viewBox)
                .fill(Color.TS.accent.opacity(fill))
            CarPathShape(commands: commands, viewBox: CarBodyGeometry.viewBox)
                .stroke(Color.TS.accent.opacity(strokeOpacity), lineWidth: width(strokeWidth))
        }
        .frame(width: projection.width, height: projection.height)
    }

    // MARK: Wheels (web tire + hub spring pop)

    private var wheelLayer: some View {
        ZStack {
            popCircle(
                CarBodyGeometry.tires[0],
                fill: Color.TS.surfaceGlass,
                strokeWidth: CarStyle.tireStrokeWidth,
                delay: CarAnimationTiming.frontTireDelay
            )
            popCircle(
                CarBodyGeometry.tires[1],
                fill: Color.TS.surfaceGlass,
                strokeWidth: CarStyle.tireStrokeWidth,
                delay: CarAnimationTiming.rearTireDelay
            )
            popCircle(
                CarBodyGeometry.hubs[0],
                fill: Color.TS.bg,
                strokeWidth: CarStyle.hubStrokeWidth,
                delay: CarAnimationTiming.frontHubDelay
            )
            popCircle(
                CarBodyGeometry.hubs[1],
                fill: Color.TS.bg,
                strokeWidth: CarStyle.hubStrokeWidth,
                delay: CarAnimationTiming.rearHubDelay
            )
        }
        .frame(width: projection.width, height: projection.height)
    }

    private func popCircle(_ circle: CarCircle, fill: Color, strokeWidth: CGFloat, delay: Double) -> some View {
        let diameter = width(circle.radius * 2)
        return ZStack {
            Circle().fill(fill)
            Circle().strokeBorder(Color.TS.textMuted, lineWidth: width(strokeWidth))
        }
        .frame(width: diameter, height: diameter)
        .position(point(circle.center))
        .scaleEffect(shown ? 1 : 0)
        .animation(spring(delay), value: shown)
    }

    // MARK: Lights + shadow

    private var lightLayer: some View {
        ZStack {
            CarPulseView(
                pulse: .headlight,
                reduce: projection.reduce,
                startDelay: CarAnimationTiming.headlightDelay
            ) {
                ellipse(CarBodyGeometry.headlight, color: Color.TS.accent)
            }
            CarPulseView(
                pulse: .taillight,
                reduce: projection.reduce,
                startDelay: CarAnimationTiming.taillightDelay
            ) {
                taillight
            }
        }
        .frame(width: projection.width, height: projection.height)
    }

    private var taillight: some View {
        let rect = CarBodyGeometry.taillight
        return RoundedRectangle(cornerRadius: width(rect.cornerRadius))
            .fill(Color.TS.statusDanger)
            .frame(width: width(rect.rect.width), height: width(rect.rect.height))
            .position(point(CGPoint(x: rect.rect.midX, y: rect.rect.midY)))
    }

    private var shadowLayer: some View {
        ellipse(CarBodyGeometry.shadow, color: Color.TS.textMuted)
            .opacity(CarStyle.shadowFillOpacity)
            .scaleEffect(x: shown ? 1 : 0, y: 1, anchor: .center)
            .animation(motion(CarAnimationTiming.shadowDuration, CarAnimationTiming.shadowDelay), value: shown)
    }

    private func ellipse(_ shape: CarEllipse, color: Color) -> some View {
        Ellipse()
            .fill(color)
            .frame(width: width(shape.radii.width * 2), height: width(shape.radii.height * 2))
            .position(point(shape.center))
    }

    // MARK: Scaling + animation helpers

    private func width(_ viewBoxValue: CGFloat) -> CGFloat {
        viewBoxValue * scale
    }

    private func point(_ vertex: CGPoint) -> CGPoint {
        CGPoint(x: vertex.x * scale, y: vertex.y * scale)
    }

    private func motion(_ duration: Double, _ delay: Double = 0) -> Animation? {
        projection.reduce ? nil : .easeInOut(duration: duration).delay(delay)
    }

    private func spring(_ delay: Double) -> Animation? {
        projection.reduce
            ? nil
            : .spring(
                response: CarAnimationTiming.wheelPopResponse,
                dampingFraction: CarAnimationTiming.wheelPopDamping
            )
            .delay(delay)
    }
}
