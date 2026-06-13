//
//  TeslaCarViz.Views.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The SwiftUI composition of the illustration: the soft ambient glow behind the car (web blurred radial
//  gradient, its mood driven by the projection), the `Canvas` that renders the whole car in one deterministic
//  pass (driven by ``CarStructure`` + ``CarDecorations``), the bottom status row (web `<StatusDot>` row), and
//  the `TeslaCarVizContent` that stacks them. Motion is supplied by a `TimelineView(.animation)` only when
//  motion is allowed; under Reduce Motion a single still frame is drawn — every element stays visible, never
//  a blank box. All colour comes from ``TeslaCarVizPalette`` (P1/S9 tokens); all copy via the P1/S10 facade.
//

import SwiftUI

// MARK: - Ambient glow (web blurred radial gradient)

/// The soft mood glow behind the car — green while charging, red under Sentry, cyan while driving, neutral
/// when idle (web ambient selector). Purely decorative; hidden from VoiceOver.
struct TeslaCarAmbientGlow: View {
    let projection: TeslaCarVizProjection
    let palette: TeslaCarVizPalette

    var body: some View {
        let hue = palette.ambient(projection.ambientMode)
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [hue.opacity(palette.ambientOpacity(projection.ambientMode)), .clear],
                    center: .center,
                    startRadius: 0,
                    endRadius: projection.width * 0.35
                )
            )
            .frame(width: projection.width * 0.7, height: projection.height * 0.55)
            .blur(radius: max(18, projection.width * 0.08))
            .accessibilityHidden(true)
    }
}

// MARK: - Canvas renderer (the whole car in one pass)

/// Draws the entire car for one frame — the static body (``CarStructure``) then the live decorations
/// (``CarDecorations``), in the web's z-order. `time` advances only while animating; `animated` collapses
/// every motion to a calm resting frame for Reduce Motion.
struct TeslaCarCanvas: View {
    let projection: TeslaCarVizProjection
    let palette: TeslaCarVizPalette
    let time: Double
    let animated: Bool

    var body: some View {
        Canvas { context, size in
            let metrics = CarCanvasMetrics(size: size)
            let anim = CarAnim(time: time, animated: animated)
            CarStructure.drawShadow(context, metrics, palette, projection.model)
            CarStructure.drawBody(context, metrics, palette, projection.model)
            CarStructure.drawDetailLines(context, metrics, palette, projection.model)
            CarStructure.drawWheels(context, metrics, palette, projection, anim)
            CarDecorations.drawHeadlight(context, metrics, palette, projection, anim)
            CarDecorations.drawTaillight(context, metrics, palette, projection, anim)
            CarDecorations.drawDoorHandle(context, metrics, palette, projection.model)
            CarDecorations.drawBattery(context, metrics, palette, projection)
            CarLiveDecorations.drawCharging(context, metrics, palette, projection, anim)
            CarLiveDecorations.drawLock(context, metrics, palette, projection)
            CarLiveDecorations.drawClimate(context, metrics, palette, projection, anim)
            CarLiveDecorations.drawSentry(context, metrics, palette, projection, anim)
            CarLiveDecorations.drawSpeedLines(context, metrics, palette, projection, anim)
        }
        .frame(width: projection.width, height: projection.height)
        .accessibilityHidden(true)
    }
}

// MARK: - Status row (web `<StatusDot>` row)

/// One status pill — a lit (or muted) dot and its localized label (web `<StatusDot>`).
struct TeslaCarStatusDotView: View {
    let dot: TeslaCarVizStatusDot
    let palette: TeslaCarVizPalette

    var body: some View {
        let tint = dot.active ? palette.statusColor(dot.role) : palette.statusInactive
        HStack(spacing: TSSpacing.xs) {
            Circle()
                .fill(tint)
                .frame(width: 6, height: 6)
                .shadow(color: dot.active ? tint.opacity(0.6) : .clear, radius: 3)
            Text(verbatim: TeslaCarVizStrings.label(for: dot))
                .font(Font.TS.caption)
                .foregroundStyle(dot.active ? palette.statusColor(dot.role) : palette.statusInactiveText)
        }
    }
}

/// The full status row beneath the car. The live state is spoken once by the parent's combined accessibility
/// element, so the visible row is hidden from VoiceOver to avoid double reading.
struct TeslaCarStatusRow: View {
    let projection: TeslaCarVizProjection
    let palette: TeslaCarVizPalette

    var body: some View {
        HStack(spacing: TSSpacing.md) {
            ForEach(projection.statusDots) { dot in
                TeslaCarStatusDotView(dot: dot, palette: palette)
            }
        }
        .padding(.bottom, TSSpacing.xs)
        .accessibilityHidden(true)
    }
}

// MARK: - Content (ambient + car + status row)

/// Stacks the ambient glow, the animated car, and the status row into the web component's `w × h` footprint.
/// The motion timeline runs only when `animated`; otherwise a single still frame is drawn.
struct TeslaCarVizContent: View {
    let projection: TeslaCarVizProjection
    let palette: TeslaCarVizPalette
    let animated: Bool

    var body: some View {
        ZStack {
            TeslaCarAmbientGlow(projection: projection, palette: palette)
            illustration
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                TeslaCarStatusRow(projection: projection, palette: palette)
            }
        }
        .frame(width: projection.width, height: projection.height)
    }

    @ViewBuilder
    private var illustration: some View {
        if animated {
            TimelineView(.animation) { timeline in
                TeslaCarCanvas(
                    projection: projection,
                    palette: palette,
                    time: timeline.date.timeIntervalSinceReferenceDate,
                    animated: true
                )
            }
        } else {
            TeslaCarCanvas(projection: projection, palette: palette, time: 0, animated: false)
        }
    }
}

// MARK: - Compact card silhouette (web `TeslaCarMini`)

/// The compact glyph's inputs (web `TeslaCarMini` props).
struct CarMiniSpec {
    let model: TeslaCarModel
    let batteryLevel: Double
    let isCharging: Bool
}

/// Renders the compact card silhouette + battery sliver for `TeslaCarMini` into a `Canvas`, mapping the
/// model's mini design space (64 × 32, or 64 × 34 for Model X) into the frame.
enum CarMiniRenderer {
    static func draw(
        _ context: GraphicsContext,
        size: CGSize,
        spec: CarMiniSpec,
        palette: TeslaCarVizPalette
    ) {
        let model = spec.model
        let designHeight = model == .modelX ? 34.0 : 32.0
        let scaleX = size.width / 64
        let scaleY = size.height / designHeight
        func point(_ designX: Double, _ designY: Double) -> CGPoint {
            CGPoint(x: designX * scaleX, y: designY * scaleY)
        }
        let transform = CGAffineTransform(scaleX: scaleX, y: scaleY)
        let body = SVGPathParser.path(from: CarSilhouette.mini(for: model)).applying(transform)
        context.fill(body, with: .color(palette.bodyFill.opacity(0.6)))
        context.stroke(body, with: .color(palette.bodyStroke), lineWidth: 0.8 * scaleY)
        let wheelY = model == .modelX ? 24.0 : 22.0
        let wheelRadius = 4 * scaleY
        context.fill(carCirclePath(center: point(18, wheelY), radius: wheelRadius), with: .color(palette.wheelOuter))
        context.fill(carCirclePath(center: point(50, wheelY), radius: wheelRadius), with: .color(palette.wheelOuter))
        let barY = model == .modelX ? 19.0 : 17.0
        let track = CGRect(origin: point(18, barY), size: CGSize(width: 28 * scaleX, height: 2 * scaleY))
        context.fill(Path(roundedRect: track, cornerRadius: scaleY), with: .color(palette.batteryTrack))
        let fraction = TeslaCarVizProjector.batteryFraction(level: spec.batteryLevel)
        if fraction > 0 {
            let fill = CGRect(origin: point(18, barY), size: CGSize(width: 28 * scaleX * fraction, height: 2 * scaleY))
            let band = TeslaCarVizBatteryBand.forLevel(spec.batteryLevel)
            context.fill(Path(roundedRect: fill, cornerRadius: scaleY), with: .color(palette.battery(band)))
        }
        if spec.isCharging {
            let dot = carCirclePath(center: point(10, model == .modelX ? 20 : 18), radius: 2 * scaleY)
            context.fill(dot, with: .color(palette.charging))
        }
    }
}
