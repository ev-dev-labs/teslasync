//
//  TeslaCarViz.Catalog.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The static, Foundation-only catalog for the live vehicle illustration — the surface identity (the
//  diagnostics slug + the SVG design space), the model variant (``TeslaCarModel`` + the `parseModelKey`
//  port + the per-model aspect ratio), the per-model anchor table (``TeslaCarLayout``, the web `WHEEL_POS`),
//  the size preset (``TeslaCarVizSize``, the web `sizeMap`), and the battery colour band (the web
//  `batteryColor` thresholds). No SwiftUI, so every value is constructible — and unit-tested — in isolation.
//

import Foundation

// MARK: - Surface identity (P1/S11 diagnostics slug)

/// The surface's stable, non-UI identity — the diagnostics slug emitted with `view.opened` (P1/S11), plus
/// the design space the SVG paths are authored in (web `viewBox="0 0 560 290"`). Kept SwiftUI-free so the
/// state-holder can emit telemetry, and the Shapes can share the geometry, without importing the view layer.
public enum TeslaCarVizSurface {
    /// Diagnostics surface slug (P1/S11 `view.opened`).
    public static let slug = "TeslaCarViz"
    /// The design-space width the silhouette paths use (web `viewBox` width).
    public static let designWidth: Double = 560
    /// The design-space height the silhouette paths use (web `viewBox` height).
    public static let designHeight: Double = 290
}

// MARK: - Model variant (web `TeslaModel`)

/// The Tesla model the illustration draws — the native peer of the web `TeslaModel` union. Drives the body
/// silhouette, the wheel / light / battery anchor points (``TeslaCarLayout``), and the frame aspect ratio.
public enum TeslaCarModel: String, CaseIterable, Sendable, Equatable {
    case model3
    case modelS
    case modelY
    case modelX
    case cybertruck

    /// Parses a free-form `vehicle.model` string (e.g. "Model 3 P", "Model Y", "Cybertruck") into a variant
    /// — the verbatim port of the web `parseModelKey`: lower-case, strip whitespace, then match the most
    /// specific token first, defaulting to Model 3. Lets a caller pass the raw fleet model string straight in.
    public static func parse(_ modelString: String?) -> TeslaCarModel {
        guard let raw = modelString, !raw.isEmpty else { return .model3 }
        let squashed = raw.lowercased().filter { !$0.isWhitespace }
        if squashed.contains("cybertruck") || squashed.contains("ct") { return .cybertruck }
        if squashed.contains("modelx") || squashed.contains("mx") { return .modelX }
        if squashed.contains("modely") || squashed.contains("my") { return .modelY }
        if squashed.contains("models") || squashed.contains("ms") { return .modelS }
        return .model3
    }

    /// The frame aspect ratio (`height = width * aspect`) — the web `cybertruck ? 0.56 : modelx/modely ?
    /// 0.55 : 0.52`.
    public var aspectRatio: Double {
        switch self {
        case .cybertruck: 0.56
        case .modelX, .modelY: 0.55
        case .model3, .modelS: 0.52
        }
    }

    /// Whether the body is the angular Cybertruck silhouette (the web `model === 'cybertruck'` branch that
    /// swaps every body / light / wheel path and adds the bed separator + tread lines).
    public var isCybertruck: Bool {
        self == .cybertruck
    }
}

// MARK: - Per-model layout (web `WHEEL_POS`, design-space coordinates)

/// The anchor points for the model's wheels, lights, battery bar, and lock badge — the verbatim port of the
/// web `WHEEL_POS[model]`, in the 560×290 design space. The Shapes consume these so the native composition
/// lands every decoration exactly where the web does.
public struct TeslaCarLayout: Sendable, Equatable {
    public let frontWheelX: Double
    public let rearWheelX: Double
    public let wheelY: Double
    public let headlightX: Double
    public let headlightY: Double
    public let taillightX: Double
    public let taillightY: Double
    public let batteryX: Double
    public let batteryY: Double
    public let lockX: Double
    public let lockY: Double

    public init(
        frontWheelX: Double,
        rearWheelX: Double,
        wheelY: Double,
        headlightX: Double,
        headlightY: Double,
        taillightX: Double,
        taillightY: Double,
        batteryX: Double,
        batteryY: Double,
        lockX: Double,
        lockY: Double
    ) {
        self.frontWheelX = frontWheelX
        self.rearWheelX = rearWheelX
        self.wheelY = wheelY
        self.headlightX = headlightX
        self.headlightY = headlightY
        self.taillightX = taillightX
        self.taillightY = taillightY
        self.batteryX = batteryX
        self.batteryY = batteryY
        self.lockX = lockX
        self.lockY = lockY
    }

    /// The width of the battery bar in design units (web `<rect width="260">`).
    public static let batteryBarWidth: Double = 260

    /// The layout table for a model — the native peer of `WHEEL_POS[model]`.
    public static func layout(for model: TeslaCarModel) -> TeslaCarLayout {
        switch model {
        case .model3:
            TeslaCarLayout(
                frontWheelX: 160, rearWheelX: 432, wheelY: 210, headlightX: 112, headlightY: 180,
                taillightX: 488, taillightY: 178, batteryX: 158, batteryY: 172, lockX: 296, lockY: 108
            )
        case .modelS:
            TeslaCarLayout(
                frontWheelX: 160, rearWheelX: 432, wheelY: 210, headlightX: 108, headlightY: 180,
                taillightX: 490, taillightY: 178, batteryX: 158, batteryY: 172, lockX: 296, lockY: 108
            )
        case .modelY:
            TeslaCarLayout(
                frontWheelX: 160, rearWheelX: 432, wheelY: 210, headlightX: 112, headlightY: 178,
                taillightX: 486, taillightY: 176, batteryX: 158, batteryY: 170, lockX: 296, lockY: 104
            )
        case .modelX:
            TeslaCarLayout(
                frontWheelX: 160, rearWheelX: 432, wheelY: 210, headlightX: 112, headlightY: 176,
                taillightX: 486, taillightY: 174, batteryX: 158, batteryY: 168, lockX: 296, lockY: 100
            )
        case .cybertruck:
            TeslaCarLayout(
                frontWheelX: 160, rearWheelX: 432, wheelY: 210, headlightX: 108, headlightY: 176,
                taillightX: 480, taillightY: 165, batteryX: 158, batteryY: 172, lockX: 296, lockY: 108
            )
        }
    }
}

// MARK: - Size (web `size: 'sm' | 'md' | 'lg'`)

/// The rendered width preset — the native peer of the web `size` prop (`sizeMap = { sm: 180, md: 280, lg:
/// 380 }`). The height follows from the model's ``TeslaCarModel/aspectRatio``.
public enum TeslaCarVizSize: String, CaseIterable, Sendable, Equatable {
    case sm
    case md
    case lg

    /// The base width in points (web `sizeMap`).
    public var width: Double {
        switch self {
        case .sm: 180
        case .md: 280
        case .lg: 380
        }
    }
}

// MARK: - Battery band (web `batteryColor` thresholds)

/// The battery charge band — the native peer of the web `batteryColor(level)` (`> 60` good, `> 25` warn,
/// else bad). Drives the battery-bar fill + glow, mapped to a semantic token by the view so "good stays
/// green" across every theme (the web `colors.ts` contract).
public enum TeslaCarVizBatteryBand: String, Sendable, Equatable {
    /// `> 60%` — green / success.
    case high
    /// `> 25%` — amber / warning.
    case medium
    /// `≤ 25%` — red / danger.
    case low

    /// The band for a charge level — the verbatim port of the web `batteryColor`.
    public static func forLevel(_ level: Double) -> TeslaCarVizBatteryBand {
        if level > 60 { return .high }
        if level > 25 { return .medium }
        return .low
    }
}
