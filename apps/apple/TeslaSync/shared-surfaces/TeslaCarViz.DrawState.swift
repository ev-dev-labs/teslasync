//
//  TeslaCarViz.DrawState.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The always-present decorations layered over the static body (TeslaCarViz.Draw.swift): the head/tail
//  lights (lit while driving, with the breathing glow), the door handle, and the battery bar + percentage.
//  The conditional live decorations — charging, lock, climate, Sentry, speed lines — live in
//  TeslaCarViz.DrawLive.swift. Each shape is a pure function of the projection + palette + metrics +
//  ``CarAnim``, so every state branch (and the Reduce-Motion resting frame) is deterministic. The dynamic
//  light/cable strips are built as direct `Path`s (no string interpolation) so the geometry stays legible.
//

import Foundation
import SwiftUI

/// The always-present decorations drawn over the body — the native peers of the web SVG light + battery groups.
enum CarDecorations {
    /// The headlight: DRL strip + projector + turn-signal accent, lit while driving, plus the beam cone.
    static func drawHeadlight(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        let layout = projection.layout
        let cybertruck = projection.model.isCybertruck
        let driving = projection.isDriving
        let drl = headlightStrip(metrics, layout, cybertruck: cybertruck)
        let drlColor = (driving ? palette.headlightOn : palette.headlightOff)
            .opacity(driving ? anim.headlightGlow : 1)
        context.strokeRound(drl, drlColor, metrics.length(cybertruck ? 3 : 2.5))
        let projector = carEllipsePath(
            center: metrics.point(layout.headlightX + (cybertruck ? 5 : 2), layout.headlightY),
            radiusX: metrics.length(cybertruck ? 3 : 4),
            radiusY: metrics.length(cybertruck ? 2.5 : 6)
        )
        context.fill(projector, with: .color((driving ? palette.projectorOn : palette.headlightOff)
                .opacity(driving ? 0.9 : 0.5)))
        let signal = carEllipsePath(
            center: metrics.point(layout.headlightX + (cybertruck ? 10 : 6), layout.headlightY + (cybertruck ? 0 : 12)),
            radiusX: metrics.length(cybertruck ? 2 : 3),
            radiusY: metrics.length(cybertruck ? 1.5 : 2)
        )
        context.fill(signal, with: .color((driving ? Color.TS.statusWarning : palette.headlightOff)
                .opacity(driving ? 0.5 : 0.2)))
        if driving { drawBeam(context, metrics, palette, layout) }
    }

    private static func headlightStrip(
        _ metrics: CarCanvasMetrics,
        _ layout: TeslaCarLayout,
        cybertruck: Bool
    ) -> Path {
        if cybertruck {
            return carLinePath(
                metrics.point(layout.headlightX, layout.headlightY - 3),
                metrics.point(layout.headlightX + 20, layout.headlightY - 5)
            )
        }
        var path = Path()
        path.move(to: metrics.point(layout.headlightX - 2, layout.headlightY - 14))
        path.addQuadCurve(
            to: metrics.point(layout.headlightX - 2, layout.headlightY + 14),
            control: metrics.point(layout.headlightX - 6, layout.headlightY)
        )
        return path
    }

    private static func drawBeam(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ layout: TeslaCarLayout
    ) {
        var beam = Path()
        beam.move(to: metrics.point(layout.headlightX - 5, layout.headlightY - 8))
        beam.addLine(to: metrics.point(layout.headlightX - 60, layout.headlightY - 40))
        beam.addLine(to: metrics.point(layout.headlightX - 60, layout.headlightY + 20))
        beam.addLine(to: metrics.point(layout.headlightX - 5, layout.headlightY + 8))
        beam.closeSubpath()
        context.fill(beam, with: .color(palette.projectorOn.opacity(0.12)))
    }

    /// The continuous tail-light strip + glow halo (web tail-light group, always lit, breathing).
    static func drawTaillight(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection,
        _ anim: CarAnim
    ) {
        let layout = projection.layout
        let cybertruck = projection.model.isCybertruck
        let strip = taillightStrip(metrics, layout, cybertruck: cybertruck)
        context.strokeRound(strip, palette.taillight.opacity(anim.taillightGlow), metrics.length(cybertruck ? 4 : 3))
        let halo = carEllipsePath(
            center: metrics.point(layout.taillightX + 3, layout.taillightY + 9),
            radiusX: metrics.length(8),
            radiusY: metrics.length(14)
        )
        context.fill(halo, with: .color(palette.taillight.opacity(0.10)))
    }

    private static func taillightStrip(
        _ metrics: CarCanvasMetrics,
        _ layout: TeslaCarLayout,
        cybertruck: Bool
    ) -> Path {
        if cybertruck {
            return carLinePath(
                metrics.point(layout.taillightX, layout.taillightY - 8),
                metrics.point(layout.taillightX, layout.taillightY + 12)
            )
        }
        var path = Path()
        path.move(to: metrics.point(layout.taillightX + 3, layout.taillightY - 2))
        path.addQuadCurve(
            to: metrics.point(layout.taillightX + 3, layout.taillightY + 20),
            control: metrics.point(layout.taillightX + 5, layout.taillightY + 9)
        )
        return path
    }

    /// The door handle / feature line (web door-handle line).
    static func drawDoorHandle(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ model: TeslaCarModel
    ) {
        let line = model.isCybertruck
            ? carLinePath(metrics.point(210, 162), metrics.point(380, 162))
            : carLinePath(metrics.point(250, 156), metrics.point(340, 154))
        let color = model.isCybertruck ? palette.detailFaint : palette.detailLine
        context.stroke(line, with: .color(color), lineWidth: metrics.length(1))
    }

    /// The battery bar — track, banded fill, and the percentage label (web battery-bar group).
    static func drawBattery(
        _ context: GraphicsContext,
        _ metrics: CarCanvasMetrics,
        _ palette: TeslaCarVizPalette,
        _ projection: TeslaCarVizProjection
    ) {
        let layout = projection.layout
        let origin = metrics.point(layout.batteryX, layout.batteryY)
        let height = metrics.length(8)
        let corner = metrics.length(4)
        let fullWidth = metrics.length(TeslaCarLayout.batteryBarWidth)
        let track = CGRect(x: origin.x, y: origin.y, width: fullWidth, height: height)
        context.fill(Path(roundedRect: track, cornerRadius: corner), with: .color(palette.batteryTrack))
        let fillWidth = fullWidth * projection.batteryFraction
        if fillWidth > 0 {
            let fill = CGRect(x: origin.x, y: origin.y, width: fillWidth, height: height)
            context.fill(
                Path(roundedRect: fill, cornerRadius: corner),
                with: .color(palette.battery(projection.batteryBand))
            )
        }
        let label = Text(verbatim: "\(projection.batteryPercent)%")
            .font(.system(size: metrics.length(7), weight: .bold))
            .foregroundColor(palette.batteryText)
        context.draw(label, at: metrics.point(layout.batteryX + 130, layout.batteryY + 4), anchor: .center)
    }
}
