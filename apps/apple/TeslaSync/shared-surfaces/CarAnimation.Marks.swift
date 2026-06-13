//
//  CarAnimation.Marks.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The composed peers of the web `ChargingBolt`, `BatteryFillAnimation`, and `WheelSpin` marks. Each lays its
//  view-box geometry into the projection box and reproduces the source's animation, honoring Reduce Motion by
//  rendering the final resting frame with no entry or loop. Colors are P1/S9 tokens (`--theme-primary →
//  accent`, `--text-muted → textMuted`, `--surface-1/3 → bg/surfaceGlass`, the battery bands → status
//  tokens, which carry the same hex as the web `COLOR.GOOD/WARN/BAD`).
//

import SwiftUI

// MARK: - ChargingBoltMark (web `ChargingBolt`)

/// The charging-bolt mark (web `ChargingBolt` `<motion.svg viewBox="0 0 24 24">`). It rises + fades in (web
/// `opacity 0→1`, `y -4→0`) then pulses its fill forever (web `fillOpacity [0.1, 0.3, 0.1]`); the stroked
/// outline stays solid. Decorative — the parent surface owns the VoiceOver label.
struct ChargingBoltMark: View {
    let projection: ChargingBoltProjection

    @State private var entered = false

    private var shown: Bool {
        entered || projection.reduce
    }

    private var scale: CGFloat {
        projection.scale
    }

    var body: some View {
        ZStack {
            CarPulseView(pulse: .chargingBolt, reduce: projection.reduce, startDelay: 0) {
                CarBoltShape().fill(Color.TS.accent)
            }
            CarBoltShape()
                .stroke(Color.TS.accent, style: CarStroke.round(width: CarStyle.boltStrokeWidth * scale))
        }
        .frame(width: projection.dimension, height: projection.dimension)
        .opacity(shown ? 1 : 0)
        .offset(y: shown ? 0 : -CarAnimationTiming.boltEntryRise * scale)
        .animation(entryAnimation, value: shown)
        .accessibilityHidden(true)
        .onAppear { entered = true }
        .onDisappear { entered = false }
    }

    private var entryAnimation: Animation? {
        projection.reduce ? nil : .easeOut(duration: CarAnimationTiming.boltEntryDuration)
    }
}

// MARK: - BatteryGaugeMark (web `BatteryFillAnimation`)

/// The battery-gauge mark (web `BatteryFillAnimation` `<motion.svg viewBox="0 0 48 24">`). The container
/// fades in (web `opacity 0→1`), and the fill cell grows from the left to the level width (web `width: 0 →
/// fillWidth`) in the semantic band color. Decorative — the web source renders it with no `role`/`aria`, so
/// it is hidden from VoiceOver and any battery readout is owned by an adjacent host label (as on the web).
struct BatteryGaugeMark: View {
    let projection: BatteryFillProjection

    @State private var entered = false

    private var shown: Bool {
        entered || projection.reduce
    }

    private var scale: CGFloat {
        projection.scale
    }

    var body: some View {
        ZStack {
            outline
            cap
            fill
        }
        .frame(width: projection.width, height: projection.height)
        .opacity(shown ? 1 : 0)
        .animation(fadeAnimation, value: shown)
        .accessibilityHidden(true)
        .onAppear { entered = true }
        .onDisappear { entered = false }
    }

    private var outline: some View {
        let shape = CarBatteryGeometry.outline
        return RoundedRectangle(cornerRadius: width(shape.cornerRadius))
            .strokeBorder(Color.TS.textMuted, lineWidth: width(CarStyle.batteryOutlineStrokeWidth))
            .frame(width: width(shape.rect.width), height: width(shape.rect.height))
            .position(point(CGPoint(x: shape.rect.midX, y: shape.rect.midY)))
    }

    private var cap: some View {
        let shape = CarBatteryGeometry.cap
        return RoundedRectangle(cornerRadius: width(shape.cornerRadius))
            .fill(Color.TS.textMuted.opacity(CarStyle.batteryCapFillOpacity))
            .frame(width: width(shape.rect.width), height: width(shape.rect.height))
            .position(point(CGPoint(x: shape.rect.midX, y: shape.rect.midY)))
    }

    private var fill: some View {
        BatteryFillShape(progress: shown ? 1 : 0, fillWidthViewBox: projection.fillWidthViewBox)
            .fill(levelColor)
            .frame(width: projection.width, height: projection.height)
            .animation(fillAnimation, value: shown)
    }

    private var levelColor: Color {
        switch projection.colorKind {
        case .good: Color.TS.statusSuccess
        case .warning: Color.TS.statusWarning
        case .danger: Color.TS.statusDanger
        }
    }

    private var fadeAnimation: Animation? {
        projection.reduce ? nil : .easeInOut(duration: CarAnimationTiming.batteryFadeDuration)
    }

    private var fillAnimation: Animation? {
        projection.reduce
            ? nil
            : .easeOut(duration: CarAnimationTiming.batteryFillDuration).delay(CarAnimationTiming.batteryFillDelay)
    }

    private func width(_ viewBoxValue: CGFloat) -> CGFloat {
        viewBoxValue * scale
    }

    private func point(_ vertex: CGPoint) -> CGPoint {
        CGPoint(x: vertex.x * scale, y: vertex.y * scale)
    }
}

// MARK: - WheelLoaderMark (web `WheelSpin`)

/// The spinning wheel loader (web `WheelSpin` `<motion.svg viewBox="0 0 24 24">`). The tire + hub stay still
/// while the spoke group rotates forever (web `rotate 0→360`, `2s linear`); Reduce Motion freezes the spokes.
/// Decorative — the parent surface owns the VoiceOver label.
struct WheelLoaderMark: View {
    let projection: WheelSpinProjection

    @State private var spinning = false

    private var scale: CGFloat {
        projection.scale
    }

    var body: some View {
        ZStack {
            tire
            hub
            WheelSpokesShape()
                .stroke(Color.TS.textMuted, style: CarStroke.round(width: CarStyle.spokeStrokeWidth * scale))
                .frame(width: projection.dimension, height: projection.dimension)
                .rotationEffect(.degrees(spinning ? 360 : 0))
                .animation(spinAnimation, value: spinning)
        }
        .frame(width: projection.dimension, height: projection.dimension)
        .accessibilityHidden(true)
        .onAppear { if !projection.reduce { spinning = true } }
        .onDisappear { spinning = false }
    }

    private var tire: some View {
        let circle = CarWheelGeometry.tire
        let diameter = circle.radius * 2 * scale
        return ZStack {
            Circle().fill(Color.TS.surfaceGlass)
            Circle().strokeBorder(Color.TS.textMuted, lineWidth: CarStyle.wheelTireStrokeWidth * scale)
        }
        .frame(width: diameter, height: diameter)
        .position(x: circle.center.x * scale, y: circle.center.y * scale)
    }

    private var hub: some View {
        let circle = CarWheelGeometry.hub
        let diameter = circle.radius * 2 * scale
        return ZStack {
            Circle().fill(Color.TS.bg)
            Circle().strokeBorder(Color.TS.textMuted, lineWidth: CarStyle.wheelHubStrokeWidth * scale)
        }
        .frame(width: diameter, height: diameter)
        .position(x: circle.center.x * scale, y: circle.center.y * scale)
    }

    private var spinAnimation: Animation? {
        projection.reduce ? nil : .linear(duration: CarAnimationTiming.wheelSpinCycle)
            .repeatForever(autoreverses: false)
    }
}
