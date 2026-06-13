//
//  TeslaCarViz.Draw.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The structural half of the Canvas renderer for the illustration: the time-driven animation model
//  (``CarAnim``), the design-space drawing helpers on `GraphicsContext`, and the static body — ground
//  shadow, the model silhouette (body / glass / windshield + the Cybertruck + Model X extras), the door /
//  skirt detail lines, and the (optionally rolling) wheels. The state decorations — lights, battery, lock,
//  charging, climate, Sentry, speed lines — live in TeslaCarViz.DrawState.swift. Every animated quantity is
//  a pure function of `time` + `animated`, so Reduce Motion simply pins `animated=false` to a resting frame.
//

import Foundation
import SwiftUI

// MARK: - Animation model (web framer transitions as pure time functions)

/// The illustration's animation state as a pure function of elapsed `time`. When `animated` is false (Reduce
/// Motion, or a still snapshot) every value collapses to a calm resting frame, so nothing moves but every
/// element stays legibly visible — the native peer of the web `motion-safe:` gate.
struct CarAnim {
    let time: Double
    let animated: Bool

    private static let tau = Double.pi * 2

    /// The rolling-wheel angle in degrees (web wheel `rotate 360` every 0.8s ⇒ 450°/s) — only when driving.
    func wheelAngle(driving: Bool) -> Double {
        guard animated, driving else { return 0 }
        return (time * 450).truncatingRemainder(dividingBy: 360)
    }

    /// The headlight breathing opacity (web `[0.85, 1, 0.85]` over 2.5s).
    var headlightGlow: Double {
        animated ? 0.925 + 0.075 * sin(time * Self.tau / 2.5) : 1
    }

    /// The tail-light breathing opacity (web `[0.7, 1, 0.7]` over 2s).
    var taillightGlow: Double {
        animated ? 0.85 + 0.15 * sin(time * Self.tau / 2.0) : 1
    }

    /// The charge-indicator pulse scale (web `[1, 1.3, 1]` over 1.5s).
    var plugScale: Double {
        animated ? 1.15 + 0.15 * sin(time * Self.tau / 1.5) : 1.15
    }

    /// The charge-indicator pulse opacity (web `[0.8, 1, 0.8]` over 1.5s).
    var plugGlow: Double {
        animated ? 0.9 + 0.1 * sin(time * Self.tau / 1.5) : 1
    }

    /// The outer Sentry ring angle (web `rotate 360` over 20s ⇒ 18°/s).
    var sentryAngleOuter: Double {
        animated ? (time * 18).truncatingRemainder(dividingBy: 360) : 0
    }

    /// The inner Sentry ring angle (web `rotate -360` over 30s ⇒ -12°/s).
    var sentryAngleInner: Double {
        animated ? -(time * 12).truncatingRemainder(dividingBy: 360) : 0
    }

    /// One climate wave's rise + fade (web `opacity [0, 0.6, 0]`, `y: -8`, 2s, staggered 0.3s per index).
    func climateWave(_ index: Int) -> (offsetY: Double, opacity: Double) {
        guard animated else { return (-4, 0.5) }
        let local = phase(span: 2.0, delay: Double(index) * 0.3)
        return (-8 * local, 0.6 * sin(.pi * local))
    }

    /// One speed line's sweep + fade (web `opacity [0, 0.6, 0]`, x-translate, 0.6s, staggered 0.15s).
    func speedLine(_ index: Int) -> (progress: Double, opacity: Double) {
        guard animated else { return (0.5, 0.5) }
        let local = phase(span: 0.6, delay: Double(index) * 0.15)
        return (local, 0.6 * sin(.pi * local))
    }

    private func phase(span: Double, delay: Double) -> Double {
        let wrapped = ((time - delay).truncatingRemainder(dividingBy: span) + span)
            .truncatingRemainder(dividingBy: span)
        return wrapped / span
    }
}

// MARK: - Design-space drawing helpers

extension GraphicsContext {
    /// Strokes a path with round caps + joins — the SVG `strokeLinecap="round"` default for the strips.
    func strokeRound(_ path: Path, _ color: Color, _ width: CGFloat) {
        stroke(path, with: .color(color), style: StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round))
    }
}

/// A filled/stroked circle in render space.
func carCirclePath(center: CGPoint, radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
}

/// An ellipse in render space (web `<ellipse rx ry>`).
func carEllipsePath(center: CGPoint, radiusX: CGFloat, radiusY: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: center.x - radiusX, y: center.y - radiusY, width: radiusX * 2, height: radiusY * 2))
}

/// A straight line in render space.
func carLinePath(_ from: CGPoint, _ to: CGPoint) -> Path {
    var path = Path()
    path.move(to: from)
    path.addLine(to: to)
    return path
}

/// One wheel's draw parameters (design-space centre, roll angle, Cybertruck tread flag).
struct WheelSpec {
    let model: TeslaCarModel
    let centerX: Double
    let centerY: Double
    let angle: Double
    let withTread: Bool
}

// MARK: - Structural renderer

/// The static body of the car — drawn once per frame into the shared `Canvas` context. Stateless: every
/// shape is a pure function of the projection + palette + metrics, so the whole illustration is deterministic.
enum CarStructure {
    /// The ground shadow ellipse (web `<ellipse cx 280 cy 270>`).
    static func drawShadow(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ model: TeslaCarModel
    ) {
        let radiusX = metrics.length(model.isCybertruck ? 240 : 220)
        let ellipse = carEllipsePath(center: metrics.point(280, 270), radiusX: radiusX, radiusY: metrics.length(12))
        context.fill(ellipse, with: .color(palette.shadow))
    }

    /// The model silhouette — body fill + outline, the glass roof, the windshield, and the model-specific
    /// extras (web `ModelBody`).
    static func drawBody(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ model: TeslaCarModel
    ) {
        let data = CarSilhouette.paths(for: model)
        let body = SVGPathParser.path(from: data.body).applying(metrics.transform)
        let roof = SVGPathParser.path(from: data.roof).applying(metrics.transform)
        let wind = SVGPathParser.path(from: data.wind).applying(metrics.transform)
        context.fill(body, with: .color(palette.bodyFill))
        context.stroke(body, with: .color(palette.bodyStroke), lineWidth: metrics.length(1.5))
        context.fill(roof, with: .color(palette.glassFill))
        context.stroke(roof, with: .color(palette.glassStroke), lineWidth: metrics.length(1))
        context.fill(wind, with: .color(palette.windFill))
        context.stroke(wind, with: .color(palette.glassStroke), lineWidth: metrics.length(0.8))
        drawModelExtras(context, metrics, palette, model)
    }

    private static func drawModelExtras(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ model: TeslaCarModel
    ) {
        if model.isCybertruck {
            context.strokeRound(
                carLinePath(metrics.point(420, 152), metrics.point(420, 200)), palette.detailFaint, metrics.length(1)
            )
            context.strokeRound(
                carLinePath(metrics.point(121, 180), metrics.point(483, 170)), palette.detailFaint, metrics.length(0.5)
            )
        }
        if model == .modelX {
            let hinge = SVGPathParser
                .path(from: "M290 100 L290 85 C290 78 300 75 310 78 L340 88")
                .applying(metrics.transform)
            context.strokeRound(hinge, palette.speedLine.opacity(0.35), metrics.length(0.8))
        }
    }

    /// The door-seam / side-skirt / roof-shine detail lines (web non-Cybertruck detail group).
    static func drawDetailLines(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ model: TeslaCarModel
    ) {
        guard !model.isCybertruck else { return }
        let shine = model == .modelS ? "M220 112 Q296 106 390 108"
            : (model == .modelX || model == .modelY) ? "M220 108 Q296 102 380 104" : "M220 112 Q296 108 380 110"
        context.strokeRound(
            SVGPathParser.path(from: shine).applying(metrics.transform),
            palette.roofShine,
            metrics.length(1.5)
        )
        let skirt = model == .modelS ? "M120 202 Q200 208 296 208 Q430 208 498 202"
            : (model == .modelX || model == .modelY) ? "M122 204 Q200 210 296 210 Q430 210 494 204"
            : "M120 202 Q200 208 296 208 Q430 208 496 202"
        context.stroke(
            SVGPathParser.path(from: skirt).applying(metrics.transform),
            with: .color(palette.detailFaint),
            lineWidth: metrics.length(0.8)
        )
        let frontTop = model == .modelX ? 120.0 : model == .modelY ? 122.0 : 126.0
        let rearTop = model == .modelX ? 122.0 : model == .modelY ? 124.0 : 128.0
        context.stroke(
            carLinePath(metrics.point(model == .modelS ? 270 : 265, frontTop), metrics.point(
                model == .modelS ? 268 : 260,
                205
            )),
            with: .color(palette.detailFaint),
            lineWidth: metrics.length(0.8)
        )
        context.stroke(
            carLinePath(metrics.point(model == .modelS ? 355 : 345, rearTop), metrics.point(
                model == .modelS ? 358 : 348,
                205
            )),
            with: .color(palette.detailFaint),
            lineWidth: metrics.length(0.8)
        )
    }

    /// Both wheels, rolling when driving (web front + rear wheel groups).
    static func drawWheels(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        let angle = anim.wheelAngle(driving: projection.isDriving)
        let layout = projection.layout
        drawWheel(context, metrics, palette, WheelSpec(
            model: projection.model,
            centerX: layout.frontWheelX,
            centerY: layout.wheelY,
            angle: angle,
            withTread: projection.model.isCybertruck
        ))
        drawWheel(context, metrics, palette, WheelSpec(
            model: projection.model,
            centerX: layout.rearWheelX,
            centerY: layout.wheelY,
            angle: angle,
            withTread: false
        ))
    }

    private static func drawWheel(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ spec: WheelSpec
    ) {
        let model = spec.model
        let center = metrics.point(spec.centerX, spec.centerY)
        let innerRadius = metrics.length(model.isCybertruck ? 24 : 22)
        context.fill(carCirclePath(center: center, radius: metrics.length(32)), with: .color(palette.wheelOuter))
        context.fill(carCirclePath(center: center, radius: innerRadius), with: .color(palette.wheelInner))
        var spin = context
        spin.translateBy(x: center.x, y: center.y)
        spin.rotate(by: .degrees(spec.angle))
        let spokeLength = metrics.length(model.isCybertruck ? 22 : 20)
        for index in 0 ..< 5 {
            var spoke = spin
            spoke.rotate(by: .degrees(Double(index) * 72))
            spoke.strokeRound(
                carLinePath(.zero, CGPoint(x: 0, y: -spokeLength)),
                palette.wheelSpoke,
                metrics.length(2.5)
            )
        }
        context.fill(carCirclePath(center: center, radius: metrics.length(8)), with: .color(palette.wheelHub))
        context.fill(
            carCirclePath(center: center, radius: metrics.length(3)),
            with: .color(palette.wheelSpoke.opacity(0.5))
        )
        guard spec.withTread else { return }
        for offset in stride(from: -18.0, through: 18.0, by: 6.0) {
            let tread = carLinePath(
                metrics.point(spec.centerX + offset, spec.centerY - 24),
                metrics.point(spec.centerX + offset, spec.centerY - 20)
            )
            context.stroke(tread, with: .color(palette.tread), lineWidth: metrics.length(2))
        }
    }
}
