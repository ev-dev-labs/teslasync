//
//  TeslaCarViz.DrawLive.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The conditional live decorations layered over the body + always-present lights (TeslaCarViz.DrawState):
//  the charging cable + pulsing plug (only while charging), the lock badge (closed shackle when locked, open
//  when unlocked), the rising climate waves (only when climate is on), the counter-rotating Sentry rings
//  (only when armed), and the sweeping speed lines (only while driving). Each is a pure function of the
//  projection + palette + metrics + ``CarAnim``, so every branch and the Reduce-Motion resting frame is
//  deterministic. No string interpolation — strips are built as direct `Path`s.
//

import Foundation
import SwiftUI

/// One Sentry ring's parameters (design radius, spin angle, dash pattern, colour).
struct CarRing {
    let radius: CGFloat
    let angle: Double
    let dash: [CGFloat]
    let color: Color
}

/// The conditional live decorations — the native peers of the web `{isCharging && …}` / `{sentryMode && …}`
/// conditional SVG groups.
enum CarLiveDecorations {
    /// The charging cable + pulsing plug indicator (web charging group, only when charging).
    static func drawCharging(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        guard projection.isCharging else { return }
        let layout = projection.layout
        let headX = layout.headlightX
        let headY = layout.headlightY
        var cable = Path()
        cable.move(to: metrics.point(headX - 10, headY + 5))
        cable.addLine(to: metrics.point(headX - 50, headY + 5))
        cable.addCurve(
            to: metrics.point(headX - 65, headY - 10),
            control1: metrics.point(headX - 60, headY + 5),
            control2: metrics.point(headX - 65, headY)
        )
        cable.addLine(to: metrics.point(headX - 65, headY - 45))
        context.strokeRound(cable, palette.charging, metrics.length(3))
        let plugCenter = metrics.point(headX - 65, headY - 50)
        context.fill(
            carCirclePath(center: plugCenter, radius: metrics.length(6 * anim.plugScale)),
            with: .color(palette.charging.opacity(anim.plugGlow))
        )
        context.fill(
            carCirclePath(center: plugCenter, radius: metrics.length(2)),
            with: .color(.white.opacity(0.9))
        )
    }

    /// The lock badge — a closed shackle when locked (green), an open one when unlocked (amber).
    static func drawLock(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection
    ) {
        let centerX = projection.layout.lockX
        let centerY = projection.layout.lockY
        let badgeOrigin = metrics.point(centerX - 10, centerY - 8)
        let badge = CGRect(x: badgeOrigin.x, y: badgeOrigin.y, width: metrics.length(20), height: metrics.length(16))
        context.fill(Path(roundedRect: badge, cornerRadius: metrics.length(4)), with: .color(palette.lockBadge))
        let tint = projection.isLocked ? palette.lockedTint : palette.unlockedTint
        let bodyOrigin = metrics.point(centerX - 5, centerY - 2)
        let bodyRect = CGRect(x: bodyOrigin.x, y: bodyOrigin.y, width: metrics.length(10), height: metrics.length(8))
        context.stroke(
            Path(roundedRect: bodyRect, cornerRadius: metrics.length(2)),
            with: .color(tint),
            lineWidth: metrics.length(1.2)
        )
        var shackle = Path()
        shackle.move(to: metrics.point(centerX - 3, centerY - 2))
        shackle.addLine(to: metrics.point(centerX - 3, centerY - 5))
        shackle.addQuadCurve(
            to: metrics.point(centerX + 3, projection.isLocked ? centerY - 5 : centerY - 6),
            control: metrics.point(centerX, centerY - 9)
        )
        if projection.isLocked { shackle.addLine(to: metrics.point(centerX + 3, centerY - 2)) }
        context.strokeRound(shackle, tint, metrics.length(1.2))
        context.fill(
            carCirclePath(center: metrics.point(centerX, centerY + 2), radius: metrics.length(1)),
            with: .color(tint)
        )
    }

    /// The rising climate waves above the lock badge (web climate group, only when climate is on).
    static func drawClimate(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        guard projection.isClimateOn else { return }
        let baseX = projection.layout.lockX - 5
        let topY = projection.layout.lockY + 18
        for index in 0 ..< 3 {
            let wave = anim.climateWave(index)
            let originY = topY + wave.offsetY
            let shift = Double(index) * 15
            var path = Path()
            path.move(to: metrics.point(baseX - 15 + shift, originY))
            path.addCurve(
                to: metrics.point(baseX - 5 + shift, originY),
                control1: metrics.point(baseX - 12 + shift, originY - 4),
                control2: metrics.point(baseX - 8 + shift, originY - 4)
            )
            context.strokeRound(path, palette.climate.opacity(wave.opacity), metrics.length(1.2))
        }
    }

    /// The two counter-rotating dashed Sentry rings (web Sentry group, only when armed).
    static func drawSentry(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        guard projection.sentryMode else { return }
        let center = metrics.point(280, 160)
        drawRing(context, center: center, metrics: metrics, ring: CarRing(
            radius: metrics.length(90), angle: anim.sentryAngleOuter, dash: [4, 4], color: palette.sentry.opacity(0.5)
        ))
        drawRing(context, center: center, metrics: metrics, ring: CarRing(
            radius: metrics.length(95), angle: anim.sentryAngleInner, dash: [8, 8], color: palette.sentry.opacity(0.32)
        ))
    }

    private static func drawRing(
        _ context: GraphicsContext,
        center: CGPoint,
        metrics: CarCanvasMetrics,
        ring: CarRing
    ) {
        var rotated = context
        rotated.translateBy(x: center.x, y: center.y)
        rotated.rotate(by: .degrees(ring.angle))
        let circle = carCirclePath(center: .zero, radius: ring.radius)
        let scaledDash = ring.dash.map { $0 * metrics.scale }
        rotated.stroke(
            circle,
            with: .color(ring.color),
            style: StrokeStyle(lineWidth: metrics.length(1), dash: scaledDash)
        )
    }

    /// The sweeping speed lines off the tail (web speed-line group, only while driving).
    static func drawSpeedLines(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        guard projection.isDriving else { return }
        for index in 0 ..< 4 {
            let line = anim.speedLine(index)
            let shift = 30 * line.progress
            let startX = 530 + Double(index) * 8 + shift
            let lineY = 160 + Double(index) * 12
            let path = carLinePath(metrics.point(startX, lineY), metrics.point(startX + 30, lineY))
            context.strokeRound(path, palette.speedLine.opacity(line.opacity), metrics.length(1.5))
        }
    }
}
