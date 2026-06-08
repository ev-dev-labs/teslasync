//
//  DigitalTwinWidget.Twin.swift
//  TeslaSync — P4 dashboard widget · 0036 · DigitalTwinWidget (Apple)
//
//  VehicleTwinView — the layered side-profile EV illustration (SwiftUI Canvas) whose
//  doors/windows/lights/lock/sentry/charge are driven by VehicleTwinState. Struct + drawing extension kept together for
//  private access.
//

import Foundation
import SwiftUI

// MARK: - VehicleTwinView (web `components/vehicles` VehicleTwin → SwiftUI)

/// Native reproduction of the web `VehicleTwin`: a layered side-profile EV whose
/// doors, windows, lights, lock, sentry, seat and charge state are driven by
/// `VehicleTwinState`. Animations (drive-in + wheel spin) honor Reduce Motion;
/// the whole figure is exposed to VoiceOver as one image with a state summary.
public struct VehicleTwinView: View {
    private let state: VehicleTwinState
    private let size: TwinRenderSize
    private let driveIn: Bool
    private let exteriorColor: String?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var entered = false

    public init(
        state: VehicleTwinState,
        size: TwinRenderSize = .md,
        driveIn: Bool = false,
        exteriorColor: String? = nil
    ) {
        self.state = state
        self.size = size
        self.driveIn = driveIn
        self.exteriorColor = exteriorColor
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack {
                carCanvas(geo.size)
                symbolOverlays(geo.size)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .opacity(slidIn ? 1 : 0.2)
            .scaleEffect(slidIn ? 1 : 0.96)
            .offset(x: slidIn ? 0 : geo.size.width * 0.55)
        }
        .aspectRatio(560.0 / 240.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityAddTraits(.isImage)
        .accessibilityLabel(DigitalTwinStrings.text(
            "widget.twin.a11yLabel",
            "Vehicle digital twin showing current physical state"
        ))
        .accessibilityValue(Text(verbatim: accessibilitySummary))
        .onAppear {
            guard driveIn, !reduceMotion else { entered = true; return }
            withAnimation(.easeOut(duration: 0.6)) { entered = true }
        }
    }

    private var slidIn: Bool {
        entered || reduceMotion || !driveIn
    }

    private var spinning: Bool {
        (state.isDriving || driveIn) && !reduceMotion
    }

    private func carCanvas(_ canvasSize: CGSize) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !spinning)) { timeline in
            Canvas { context, size in
                let phase = timeline.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.2) / 1.2
                let angle = spinning ? phase * 360 : 0
                drawCar(in: &context, size: size, wheelAngle: angle)
            }
        }
        .frame(width: canvasSize.width, height: canvasSize.height)
    }
}

extension VehicleTwinView {
    // MARK: Canvas drawing

    private func drawCar(in context: inout GraphicsContext, size: CGSize, wheelAngle: Double) {
        func point(_ fx: CGFloat, _ fy: CGFloat) -> CGPoint {
            CGPoint(x: fx * size.width, y: fy * size.height)
        }
        func box(_ fx: CGFloat, _ fy: CGFloat, _ fw: CGFloat, _ fh: CGFloat) -> CGRect {
            CGRect(x: fx * size.width, y: fy * size.height, width: fw * size.width, height: fh * size.height)
        }

        drawGroundShadow(in: &context, size: size)
        if state.isCharging { drawChargingUnderglow(in: &context, size: size) }

        let wheelRadius = size.height * 0.18
        drawWheel(in: &context, center: point(0.27, 0.70), radius: wheelRadius, angle: wheelAngle)
        drawWheel(in: &context, center: point(0.74, 0.70), radius: wheelRadius, angle: wheelAngle)

        drawBody(in: &context, size: size)

        // Lower cladding / rocker.
        context.fill(
            Path(roundedRect: box(0.07, 0.655, 0.88, 0.075), cornerRadius: size.height * 0.03),
            with: .color(Color.black.opacity(0.45))
        )

        drawWindows(in: &context, size: size)
        drawDoors(in: &context, size: size)
        drawLights(in: &context, size: size)
    }

    private func drawGroundShadow(in context: inout GraphicsContext, size: CGSize) {
        var shadow = context
        shadow.addFilter(.blur(radius: size.height * 0.04))
        let rect = CGRect(
            x: size.width * 0.12,
            y: size.height * 0.80,
            width: size.width * 0.76,
            height: size.height * 0.12
        )
        shadow.fill(Path(ellipseIn: rect), with: .color(Color.black.opacity(0.42)))
    }

    private func drawChargingUnderglow(in context: inout GraphicsContext, size: CGSize) {
        var glow = context
        glow.addFilter(.blur(radius: size.height * 0.06))
        let rect = CGRect(
            x: size.width * 0.20,
            y: size.height * 0.74,
            width: size.width * 0.60,
            height: size.height * 0.16
        )
        glow.fill(Path(ellipseIn: rect), with: .color(TwinPalette.chargeGreen.opacity(0.5)))
    }

    private func drawBody(in context: inout GraphicsContext, size: CGSize) {
        func point(_ fx: CGFloat, _ fy: CGFloat) -> CGPoint {
            CGPoint(x: fx * size.width, y: fy * size.height)
        }
        var path = Path()
        path.move(to: point(0.05, 0.66))
        path.addQuadCurve(to: point(0.075, 0.50), control: point(0.04, 0.56))
        path.addQuadCurve(to: point(0.31, 0.40), control: point(0.16, 0.40))
        path.addLine(to: point(0.62, 0.40))
        path.addQuadCurve(to: point(0.82, 0.49), control: point(0.74, 0.40))
        path.addLine(to: point(0.92, 0.53))
        path.addQuadCurve(to: point(0.96, 0.64), control: point(0.975, 0.57))
        path.addLine(to: point(0.95, 0.72))
        path.addLine(to: point(0.05, 0.72))
        path.closeSubpath()

        let base = TwinPalette.paint(for: exteriorColor ?? nonEmpty(state.vehicleColor))
        let gradient = Gradient(colors: [base.opacity(0.96), base, base.opacity(0.78)])
        context.fill(path, with: .linearGradient(
            gradient,
            startPoint: point(0.5, 0.38),
            endPoint: point(0.5, 0.72)
        ))
        context.stroke(path, with: .color(Color.white.opacity(0.10)), lineWidth: 1)

        // Shoulder highlight.
        var shoulder = Path()
        shoulder.move(to: point(0.12, 0.50))
        shoulder.addLine(to: point(0.88, 0.51))
        context.stroke(shoulder, with: .color(Color.white.opacity(0.16)), lineWidth: 1)
    }

    private func drawWindows(in context: inout GraphicsContext, size: CGSize) {
        let panes = state.windowStates
        let startX: CGFloat = 0.33
        let endX: CGFloat = 0.80
        let gap: CGFloat = 0.012
        let paneWidth = (endX - startX - gap * CGFloat(panes.count - 1)) / CGFloat(panes.count)
        let topY: CGFloat = 0.415
        let bottomY: CGFloat = 0.485

        for (index, windowState) in panes.enumerated() {
            let left = startX + CGFloat(index) * (paneWidth + gap)
            let right = left + paneWidth
            var pane = Path()
            pane.move(to: CGPoint(x: (left + 0.01) * size.width, y: topY * size.height))
            pane.addLine(to: CGPoint(x: right * size.width, y: topY * size.height))
            pane.addLine(to: CGPoint(x: (right - 0.006) * size.width, y: bottomY * size.height))
            pane.addLine(to: CGPoint(x: left * size.width, y: bottomY * size.height))
            pane.closeSubpath()
            context.fill(pane, with: .color(TwinPalette.windowFill(windowState)))
            context.stroke(
                pane,
                with: .color(TwinPalette.windowStroke(windowState)),
                lineWidth: windowState == .open ? 2 : 1
            )
        }
    }

    private func drawDoors(in context: inout GraphicsContext, size: CGSize) {
        func seam(_ fx: CGFloat) -> Path {
            var path = Path()
            path.move(to: CGPoint(x: fx * size.width, y: 0.50 * size.height))
            path.addLine(to: CGPoint(x: fx * size.width, y: 0.70 * size.height))
            return path
        }
        // Driver front + rear door seams; amber + thicker when reported open.
        let frontOpen = state.doors.driverFront == true
        let rearOpen = state.doors.driverRear == true
        context.stroke(
            seam(0.58),
            with: .color(frontOpen ? TwinPalette.amber : Color.white.opacity(0.14)),
            lineWidth: frontOpen ? 2.5 : 1
        )
        context.stroke(
            seam(0.40),
            with: .color(rearOpen ? TwinPalette.amber : Color.white.opacity(0.14)),
            lineWidth: rearOpen ? 2.5 : 1
        )
    }

    private func drawLights(in context: inout GraphicsContext, size: CGSize) {
        func box(_ fx: CGFloat, _ fy: CGFloat, _ fw: CGFloat, _ fh: CGFloat) -> CGRect {
            CGRect(x: fx * size.width, y: fy * size.height, width: fw * size.width, height: fh * size.height)
        }

        // Headlight (front / right).
        let headlightOn = state.headlights == true || driveIn
        if headlightOn {
            var glow = context
            glow.addFilter(.blur(radius: size.height * 0.05))
            glow.fill(Path(ellipseIn: box(0.86, 0.54, 0.12, 0.08)), with: .color(TwinPalette.headlightOn.opacity(0.55)))
        }
        context.fill(
            Path(roundedRect: box(0.885, 0.55, 0.05, 0.05), cornerRadius: size.height * 0.02),
            with: .color(headlightOn ? TwinPalette.headlightOn : Color.white.opacity(0.16))
        )

        // Taillight (rear / left).
        let taillightBright = state.hazards == true
        context.fill(
            Path(roundedRect: box(0.055, 0.52, 0.045, 0.05), cornerRadius: size.height * 0.02),
            with: .color(TwinPalette.taillight.opacity(taillightBright ? 0.9 : 0.5))
        )

        // Charge port (rear quarter).
        if state.isCharging {
            var glow = context
            glow.addFilter(.blur(radius: size.height * 0.04))
            glow.fill(Path(ellipseIn: box(0.10, 0.585, 0.07, 0.07)), with: .color(TwinPalette.chargeGreen.opacity(0.7)))
            context.fill(Path(ellipseIn: box(0.115, 0.60, 0.035, 0.035)), with: .color(TwinPalette.chargeGreen))
        } else if state.chargePortOpen == true {
            context.stroke(
                Path(ellipseIn: box(0.11, 0.595, 0.045, 0.045)),
                with: .color(TwinPalette.chargeGreen),
                lineWidth: 1.5
            )
        }
    }

    private func drawWheel(in context: inout GraphicsContext, center: CGPoint, radius: CGFloat, angle: Double) {
        let tireRect = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.fill(Path(ellipseIn: tireRect), with: .color(Color.black.opacity(0.95)))
        let rimRadius = radius * 0.6
        let rimRect = CGRect(
            x: center.x - rimRadius,
            y: center.y - rimRadius,
            width: rimRadius * 2,
            height: rimRadius * 2
        )
        context.fill(
            Path(ellipseIn: rimRect),
            with: .radialGradient(
                Gradient(colors: [TwinPalette.chrome.opacity(0.7), Color(red: 0.18, green: 0.21, blue: 0.27)]),
                center: center,
                startRadius: 0,
                endRadius: rimRadius
            )
        )

        var spokes = context
        spokes.translateBy(x: center.x, y: center.y)
        spokes.rotate(by: .degrees(angle))
        for index in 0 ..< 5 {
            var spoke = spokes
            spoke.rotate(by: .degrees(Double(index) * 72))
            let spokePath = Path(
                roundedRect: CGRect(x: -1, y: -rimRadius * 0.85, width: 2, height: rimRadius * 0.8),
                cornerRadius: 1
            )
            spoke.fill(spokePath, with: .color(TwinPalette.chrome.opacity(0.55)))
        }
        context.fill(
            Path(ellipseIn: CGRect(
                x: center.x - radius * 0.12,
                y: center.y - radius * 0.12,
                width: radius * 0.24,
                height: radius * 0.24
            )),
            with: .color(TwinPalette.chrome.opacity(0.8))
        )
    }

    // MARK: SF Symbol overlays (lock / sentry / seat / frunk / trunk)

    private func symbolOverlays(_ size: CGSize) -> some View {
        ZStack {
            if let locked = state.locked {
                Image(systemName: locked ? "lock.fill" : "lock.open.fill")
                    .font(.system(size: size.height * 0.10, weight: .bold))
                    .foregroundStyle(locked ? TwinPalette.lockedGreen : TwinPalette.unlockedRed)
                    .padding(size.height * 0.03)
                    .background(.ultraThinMaterial, in: Circle())
                    .position(x: size.width * 0.49, y: size.height * 0.50)
                    .accessibilityHidden(true)
            }
            if state.sentryMode == true {
                SentryPulse(reduceMotion: reduceMotion, glyphSize: size.height * 0.10)
                    .position(x: size.width * 0.49, y: size.height * 0.30)
                    .accessibilityHidden(true)
            }
            if state.driverSeatOccupied == true {
                Circle()
                    .fill(TwinPalette.seatCyan.opacity(0.4))
                    .frame(width: size.height * 0.07, height: size.height * 0.07)
                    .position(x: size.width * 0.42, y: size.height * 0.56)
                    .accessibilityHidden(true)
            }
            if state.frunkOpen == true {
                openIndicator(size: size).position(x: size.width * 0.88, y: size.height * 0.45)
            }
            if state.trunkOpen == true {
                openIndicator(size: size).position(x: size.width * 0.10, y: size.height * 0.44)
            }
        }
    }

    private func openIndicator(size: CGSize) -> some View {
        Image(systemName: "chevron.up.circle.fill")
            .font(.system(size: size.height * 0.09, weight: .semibold))
            .foregroundStyle(TwinPalette.amber)
            .accessibilityHidden(true)
    }

    private var accessibilitySummary: String {
        DigitalTwinAccessibility.summary(for: state)
    }

    private func nonEmpty(_ raw: String) -> String? {
        raw.isEmpty ? nil : raw
    }
}

/// The pulsing sentry shield (web sentry overlay). Honors Reduce Motion.
private struct SentryPulse: View {
    let reduceMotion: Bool
    let glyphSize: CGFloat
    @State private var pulsing = false

    var body: some View {
        Image(systemName: "shield.lefthalf.filled")
            .font(.system(size: glyphSize, weight: .bold))
            .foregroundStyle(TwinPalette.sentryRed)
            .opacity(reduceMotion ? 1 : (pulsing ? 0.45 : 1))
            .padding(glyphSize * 0.3)
            .background(.ultraThinMaterial, in: Circle())
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1).repeatForever(autoreverses: true)) { pulsing = true }
            }
    }
}
