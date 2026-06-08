import SwiftUI

// MARK: - Top-down car glyph (web `VehicleTwin` size="sm")

struct DigitalTwinGlyph: View {
    let data: DigitalTwinMiniData
    let bodyColor: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false

    var body: some View {
        GeometryReader { geo in
            let carWidth = min(geo.size.width * 0.7, geo.size.height * 0.46)
            let carHeight = min(geo.size.height * 0.96, carWidth * 2.05)
            ZStack {
                chargingGlow(width: carWidth, height: carHeight)
                carShape(width: carWidth, height: carHeight)
                openingIndicators(width: carWidth, height: carHeight)
                lockGlyph(width: carWidth)
                chargePort(width: carWidth, height: carHeight)
            }
            .frame(width: geo.size.width, height: geo.size.height)
            .onAppear { pulse = true }
        }
    }

    @ViewBuilder
    private func chargingGlow(width: CGFloat, height: CGFloat) -> some View {
        if data.isCharging {
            RoundedRectangle(cornerRadius: width * 0.5, style: .continuous)
                .fill(Color.TS.statusSuccess.opacity(0.16))
                .frame(width: width * 1.5, height: height * 1.08)
                .blur(radius: 10)
                .scaleEffect(pulse && !reduceMotion ? 1.05 : 1)
                .animation(
                    reduceMotion ? nil : .easeInOut(duration: TSMotion.slowDuration).repeatForever(autoreverses: true),
                    value: pulse
                )
        }
    }

    /// Car body, roof glass, wheels.
    private func carShape(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            ForEach(wheelOffsets(width: width, height: height), id: \.self) { offset in
                Capsule()
                    .fill(Color.black.opacity(0.55))
                    .frame(width: width * 0.14, height: height * 0.2)
                    .offset(x: offset.width, y: offset.height)
            }
            RoundedRectangle(cornerRadius: width * 0.42, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [bodyColor.opacity(0.95), bodyColor.opacity(0.7)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: width, height: height)
                .overlay(
                    RoundedRectangle(cornerRadius: width * 0.42, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                )
            RoundedRectangle(cornerRadius: width * 0.3, style: .continuous)
                .fill(Color.black.opacity(0.45))
                .frame(width: width * 0.66, height: height * 0.4)
                .offset(y: -height * 0.06)
        }
    }

    private func wheelOffsets(width: CGFloat, height: CGFloat) -> [CGSize] {
        let dx = width * 0.5
        let dy = height * 0.28
        return [
            CGSize(width: -dx, height: -dy),
            CGSize(width: dx, height: -dy),
            CGSize(width: -dx, height: dy),
            CGSize(width: dx, height: dy)
        ]
    }

    /// Red ticks for open doors/frunk/trunk; cyan dots for open windows.
    private func openingIndicators(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            doorTick(open: data.doors.driverFront, xSign: -1, yFraction: -0.16, width: width, height: height)
            doorTick(open: data.doors.passengerFront, xSign: 1, yFraction: -0.16, width: width, height: height)
            doorTick(open: data.doors.driverRear, xSign: -1, yFraction: 0.14, width: width, height: height)
            doorTick(open: data.doors.passengerRear, xSign: 1, yFraction: 0.14, width: width, height: height)
            lidTick(open: data.frunkOpen, yFraction: -0.46, width: width, height: height)
            lidTick(open: data.trunkOpen, yFraction: 0.46, width: width, height: height)
            windowTick(state: data.windowFD, xSign: -1, yFraction: -0.1, width: width, height: height)
            windowTick(state: data.windowFP, xSign: 1, yFraction: -0.1, width: width, height: height)
            windowTick(state: data.windowRD, xSign: -1, yFraction: 0.08, width: width, height: height)
            windowTick(state: data.windowRP, xSign: 1, yFraction: 0.08, width: width, height: height)
        }
    }

    @ViewBuilder
    private func doorTick(
        open: Bool?,
        xSign: CGFloat,
        yFraction: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) -> some View {
        if open == true {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(Color.TS.statusDanger)
                .frame(width: width * 0.16, height: height * 0.04)
                .offset(x: xSign * width * 0.56, y: yFraction * height)
        }
    }

    @ViewBuilder
    private func lidTick(open: Bool?, yFraction: CGFloat, width: CGFloat, height: CGFloat) -> some View {
        if open == true {
            Capsule()
                .fill(Color.TS.statusDanger)
                .frame(width: width * 0.34, height: height * 0.035)
                .offset(y: yFraction * height)
        }
    }

    @ViewBuilder
    private func windowTick(
        state: TwinWindowState,
        xSign: CGFloat,
        yFraction: CGFloat,
        width: CGFloat,
        height: CGFloat
    ) -> some View {
        if state == .open || state == .partial {
            Circle()
                .fill(Color.TS.statusInfo.opacity(state == .partial ? 0.6 : 1))
                .frame(width: width * 0.1, height: width * 0.1)
                .offset(x: xSign * width * 0.34, y: yFraction * height)
        }
    }

    private func lockGlyph(width: CGFloat) -> some View {
        let locked = data.locked != false
        return Image(systemName: locked ? "lock.fill" : "lock.open.fill")
            .font(.system(size: max(11, width * 0.26), weight: .bold))
            .foregroundStyle(.white)
            .shadow(color: .black.opacity(0.4), radius: 1)
            .opacity(data.locked == nil ? 0.55 : 1)
            .accessibilityHidden(true)
    }

    private func chargePort(width: CGFloat, height: CGFloat) -> some View {
        let open = data.chargePortOpen == true || data.isCharging
        return Image(systemName: data.isCharging ? "bolt.fill" : "bolt")
            .font(.system(size: max(8, width * 0.2), weight: .bold))
            .foregroundStyle(open ? Color.TS.statusSuccess : Color.TS.textMuted)
            .padding(3)
            .background(Circle().fill(Color.black.opacity(open ? 0.35 : 0.2)))
            .offset(x: -width * 0.5, y: height * 0.34)
            .accessibilityHidden(true)
    }
}

// MARK: - Exterior color helper

/// Resolves a Tesla exterior color name or hex into a display color, falling back
/// to the brand accent when unknown (web `VehicleTwin` paint behavior).
func twinExteriorColor(_ raw: String?) -> Color {
    guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
        return Color.TS.accent.opacity(0.9)
    }
    if value.hasPrefix("#"), let hex = twinHexColor(value) { return hex }
    let lower = value.lowercased()
    if lower.contains("red") { return Color(red: 0.78, green: 0.12, blue: 0.16) }
    if lower.contains("white") || lower.contains("pearl") { return Color(white: 0.92) }
    if lower.contains("black") || lower.contains("solid") { return Color(white: 0.13) }
    if lower.contains("blue") { return Color(red: 0.16, green: 0.33, blue: 0.62) }
    if lower.contains("silver") { return Color(white: 0.72) }
    if lower.contains("grey") || lower.contains("gray") { return Color(white: 0.45) }
    return Color.TS.accent.opacity(0.9)
}

private func twinHexColor(_ hex: String) -> Color? {
    var cleaned = hex
    cleaned.removeFirst()
    guard cleaned.count == 6, let value = Int(cleaned, radix: 16) else { return nil }
    let red = Double((value >> 16) & 0xFF) / 255
    let green = Double((value >> 8) & 0xFF) / 255
    let blue = Double(value & 0xFF) / 255
    return Color(red: red, green: green, blue: blue)
}

// MARK: - Previews

#if DEBUG
    private let twinSampleInputs = DigitalTwinMiniInputs(
        security: TwinSecuritySnapshot(
            doorState: "OpenDriverFront",
            fdWindow: "Open",
            locked: false,
            sentryMode: true,
            createdAt: Date()
        ),
        vehicleState: TwinVehicleStateSnapshot(state: "online", isLocked: false, sentryMode: true),
        charging: TwinChargingSnapshot(chargePortDoorOpen: true, chargingState: "Charging", chargerPowerKw: 11)
    )

    #Preview("Content") {
        DigitalTwinMiniWidget(
            source: DigitalTwinMiniStaticSource(
                vehicle: TwinVehicle(id: 1, name: "Model 3", exteriorColor: "Red Multi-Coat"),
                inputs: twinSampleInputs
            ),
            onOpen: {}
        )
        .frame(width: 200, height: 320)
        .padding()
        .background(Color.TS.bg)
    }

    #Preview("Empty") {
        DigitalTwinMiniWidget(source: DigitalTwinMiniUnconfiguredSource(), onOpen: {})
            .frame(width: 200, height: 320)
            .padding()
            .background(Color.TS.bg)
    }

    #Preview("Offline") {
        DigitalTwinMiniWidget(
            source: DigitalTwinMiniStaticSource(vehicle: nil, failure: .offline),
            onOpen: {}
        )
        .frame(width: 200, height: 320)
        .padding()
        .background(Color.TS.bg)
    }
#endif
