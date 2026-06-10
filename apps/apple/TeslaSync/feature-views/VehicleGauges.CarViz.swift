//
//  VehicleGauges.CarViz.swift
//  TeslaSync — P4 feature view · 0304 · VehicleGauges (Apple)
//
//  The native vehicle visualization — the Apple-idiomatic counterpart of the web
//  `<TeslaCarViz>` SVG. There is no shared native car component (atomic shared components are a
//  separate P4 bundle), so this surface ships its own production-polished rendering: a battery
//  ring around a model silhouette, with corner status badges for charging / sentry / climate /
//  lock and a motion treatment when the vehicle is moving. It conveys the same state the web
//  SVG does (battery, charging, locked, climate, sentry, speed, model) using SF Symbols + the
//  shared P1/S9 tokens — no raw hex, no Tailwind ports. Reduce Motion is honoured.
//

import SwiftUI

// MARK: - Car visualization (web `<TeslaCarViz>`)

/// The vehicle visualization — a battery ring + model silhouette + corner status badges, the
/// native parity of the web `<TeslaCarViz>`. A pure function of `VehicleGaugesCarVizModel`.
struct VehicleGaugesCarViz: View {
    let model: VehicleGaugesCarVizModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fill = 0.0
    @State private var bob = false

    var body: some View {
        VStack(spacing: TSSpacing.md) {
            silhouette
            caption
        }
        .onAppear { onAppear() }
        .onChange(of: model.batteryFraction) { _, value in animateFill(to: value) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilityLabel))
    }

    private var silhouette: some View {
        ZStack {
            Circle().stroke(Color.TS.border.opacity(0.3), lineWidth: 10)
            Circle()
                .trim(from: 0, to: fill)
                .stroke(model.batteryTint.color, style: StrokeStyle(lineWidth: 10, lineCap: .round))
                .rotationEffect(.degrees(-90))
            car
        }
        .frame(width: 176, height: 176)
        .overlay(alignment: .topTrailing) { chargingBadge }
        .overlay(alignment: .topLeading) { sentryBadge }
        .overlay(alignment: .bottomTrailing) { climateBadge }
        .overlay(alignment: .bottomLeading) { lockBadge }
    }

    private var car: some View {
        HStack(spacing: 3) {
            Image(systemName: carSymbol)
                .font(.system(size: 56, weight: .regular))
                .foregroundStyle(Color.TS.textSecondary)
                .offset(x: bob ? 4 : -4)
            if model.isMoving {
                motionLines
            }
        }
    }

    private var motionLines: some View {
        VStack(alignment: .leading, spacing: 4) {
            ForEach([18.0, 12.0, 16.0], id: \.self) { width in
                Capsule()
                    .fill(Color.TS.accent.opacity(0.5))
                    .frame(width: width, height: 2)
            }
        }
        .accessibilityHidden(true)
    }

    private var caption: some View {
        VStack(spacing: 2) {
            Text(verbatim: modelName)
                .font(Font.TS.panel)
                .foregroundStyle(Color.TS.textPrimary)
            Text(verbatim: model.batteryText)
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(model.batteryTint.color)
        }
    }
}

// MARK: - Status badges

private extension VehicleGaugesCarViz {
    @ViewBuilder var chargingBadge: some View {
        if model.isCharging {
            VehicleGaugesCarBadge(systemName: "bolt.fill", tint: .success)
        }
    }

    @ViewBuilder var sentryBadge: some View {
        if model.sentryMode {
            VehicleGaugesCarBadge(systemName: "shield.fill", tint: .danger)
        }
    }

    @ViewBuilder var climateBadge: some View {
        if model.isClimateOn {
            VehicleGaugesCarBadge(systemName: "wind", tint: .accent)
        }
    }

    var lockBadge: some View {
        VehicleGaugesCarBadge(
            systemName: model.isLocked ? "lock.fill" : "lock.open.fill",
            tint: VehicleGaugesTintRules.lock(isLocked: model.isLocked)
        )
    }
}

// MARK: - Derivations

private extension VehicleGaugesCarViz {
    /// All models render with the SF Symbol car silhouette; identity is conveyed by the caption +
    /// the battery ring (the shared atomic car artwork is out of this surface's scope).
    var carSymbol: String {
        "car.side.fill"
    }

    var modelName: String {
        switch model.modelKey {
        case .model3: VehicleGaugesStrings.string("vehicleGauges.model.model3", "Model 3")
        case .modelS: VehicleGaugesStrings.string("vehicleGauges.model.modelS", "Model S")
        case .modelY: VehicleGaugesStrings.string("vehicleGauges.model.modelY", "Model Y")
        case .modelX: VehicleGaugesStrings.string("vehicleGauges.model.modelX", "Model X")
        case .cybertruck: VehicleGaugesStrings.string("vehicleGauges.model.cybertruck", "Cybertruck")
        }
    }

    var accessibilityLabel: String {
        VehicleGaugesAccessibility.carLabel(
            modelName: modelName,
            batteryText: model.batteryText,
            statusParts: statusParts
        )
    }

    var statusParts: [String] {
        var parts: [String] = []
        if model.isCharging { parts.append(VehicleGaugesStrings.string("vehicleGauges.charging", "Charging")) }
        parts.append(model.isLocked
            ? VehicleGaugesStrings.string("common.locked", "Locked")
            : VehicleGaugesStrings.string("common.unlocked", "Unlocked"))
        if model.isClimateOn { parts.append(VehicleGaugesStrings.string("common.climateOn", "Climate ON")) }
        if model.sentryMode { parts.append(VehicleGaugesStrings.string("common.sentryOn", "Sentry ON")) }
        if model.isMoving { parts.append(VehicleGaugesStrings.string("common.driving", "Driving")) }
        return parts
    }

    func onAppear() {
        animateFill(to: model.batteryFraction)
        guard model.isMoving, !reduceMotion else { return }
        withAnimation(.easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true)) {
            bob = true
        }
    }

    func animateFill(to value: Double) {
        if reduceMotion {
            fill = value
        } else {
            withAnimation(.easeOut(duration: TSMotion.slowDuration)) { fill = value }
        }
    }
}

// MARK: - Corner badge

/// A small tinted icon badge anchored to a corner of the car silhouette.
struct VehicleGaugesCarBadge: View {
    let systemName: String
    let tint: VehicleGaugesTint

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint.color)
            .frame(width: 26, height: 26)
            .background(Color.TS.surface, in: Circle())
            .overlay(Circle().strokeBorder(tint.color.opacity(0.3), lineWidth: 1))
            .accessibilityHidden(true)
    }
}
