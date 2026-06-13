//
//  CarAnimation.Geometry.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The Foundation/CoreGraphics-only geometry for the four marks — the native peers of the web SVG `d`
//  attributes and primitive shapes, captured in their design view-box coordinates so the SwiftUI shapes can
//  scale them into any rect (the same disposition as `SpinnerBoltGeometry`). The bezier outlines (the Tesla
//  body + windows) are command lists (`move` / `line` / `quad` / `close`); the charging bolt is a closed
//  polyline; the wheels, lights, shadow, and battery cells are typed primitives (circles, ellipses,
//  rounded rects, radial spokes). All vertices are the exact web SVG coordinates. No SwiftUI here, so the
//  whole geometry is unit-testable in isolation.
//

import CoreGraphics
import Foundation

// MARK: - CarPathCommand (web SVG `d`)

/// One command of a bezier outline in view-box coordinates — the native peer of an SVG `d` segment. The web
/// uses absolute `M` (move), `L` (line), and `Q` (quadratic) commands plus `Z` (close); the relative bolt
/// commands are pre-resolved to absolute vertices in ``CarBoltGeometry``.
public enum CarPathCommand: Sendable, Equatable {
    case move(CGPoint)
    case line(CGPoint)
    case quad(to: CGPoint, control: CGPoint)
    case close
}

// MARK: - CarViewBox (view-box → rect mapper)

/// Maps a mark's design view box into a SwiftUI draw rect — the native peer of the SVG `viewBox` → element
/// box transform. `point(_:in:)` scales a view-box vertex into the rect; `length(_:in:)` scales a view-box
/// length (a stroke width) by the same horizontal ratio. The mark aspect ratios match their boxes, so the
/// horizontal and vertical ratios agree.
public struct CarViewBox: Sendable, Equatable {
    public let size: CGSize

    public init(size: CGSize) {
        self.size = size
    }

    /// Scales a view-box vertex into the draw rect.
    public func point(_ vertex: CGPoint, in rect: CGRect) -> CGPoint {
        CGPoint(
            x: rect.minX + vertex.x / size.width * rect.width,
            y: rect.minY + vertex.y / size.height * rect.height
        )
    }

    /// Scales a view-box length (a stroke width) into the draw rect by the horizontal ratio.
    public func length(_ value: CGFloat, in rect: CGRect) -> CGFloat {
        value / size.width * rect.width
    }
}

// MARK: - Primitive value types

/// A circle in view-box coordinates (web `<circle cx cy r>`) — the wheels and hubs.
public struct CarCircle: Sendable, Equatable {
    public let center: CGPoint
    public let radius: CGFloat

    public init(center: CGPoint, radius: CGFloat) {
        self.center = center
        self.radius = radius
    }
}

/// An axis-aligned ellipse in view-box coordinates (web `<ellipse cx cy rx ry>`) — the headlight + shadow.
public struct CarEllipse: Sendable, Equatable {
    public let center: CGPoint
    public let radii: CGSize

    public init(center: CGPoint, radii: CGSize) {
        self.center = center
        self.radii = radii
    }
}

/// A rounded rectangle in view-box coordinates (web `<rect x y width height rx>`) — the taillight + battery.
public struct CarRoundedRect: Sendable, Equatable {
    public let rect: CGRect
    public let cornerRadius: CGFloat

    public init(rect: CGRect, cornerRadius: CGFloat) {
        self.rect = rect
        self.cornerRadius = cornerRadius
    }
}

// MARK: - Tesla silhouette outlines (web SVG `d`, view box 0 0 240 96)

/// The Tesla body, windshield, and rear-window bezier outlines — the native peers of the three web `<path>`
/// `d` strings, captured verbatim as absolute command lists in the `0…240 × 0…96` view box.
public enum CarBodyGeometry {
    /// Web `d`: `M30 60 Q30 40 50 35 L80 28 Q100 20 130 20 Q160 20 180 28 L210 35 Q230 40 230 60`
    /// `L230 65 Q230 70 225 70 L35 70 Q30 70 30 65 Z`.
    public static let body: [CarPathCommand] = [
        .move(CGPoint(x: 30, y: 60)),
        .quad(to: CGPoint(x: 50, y: 35), control: CGPoint(x: 30, y: 40)),
        .line(CGPoint(x: 80, y: 28)),
        .quad(to: CGPoint(x: 130, y: 20), control: CGPoint(x: 100, y: 20)),
        .quad(to: CGPoint(x: 180, y: 28), control: CGPoint(x: 160, y: 20)),
        .line(CGPoint(x: 210, y: 35)),
        .quad(to: CGPoint(x: 230, y: 60), control: CGPoint(x: 230, y: 40)),
        .line(CGPoint(x: 230, y: 65)),
        .quad(to: CGPoint(x: 225, y: 70), control: CGPoint(x: 230, y: 70)),
        .line(CGPoint(x: 35, y: 70)),
        .quad(to: CGPoint(x: 30, y: 65), control: CGPoint(x: 30, y: 70)),
        .close
    ]

    /// Web `d`: `M85 30 Q100 22 130 22 Q155 22 170 28 L155 42 Q140 44 120 44 Q100 44 90 42 Z`.
    public static let windshield: [CarPathCommand] = [
        .move(CGPoint(x: 85, y: 30)),
        .quad(to: CGPoint(x: 130, y: 22), control: CGPoint(x: 100, y: 22)),
        .quad(to: CGPoint(x: 170, y: 28), control: CGPoint(x: 155, y: 22)),
        .line(CGPoint(x: 155, y: 42)),
        .quad(to: CGPoint(x: 120, y: 44), control: CGPoint(x: 140, y: 44)),
        .quad(to: CGPoint(x: 90, y: 42), control: CGPoint(x: 100, y: 44)),
        .close
    ]

    /// Web `d`: `M55 38 L82 30 L88 42 Q78 44 68 42 Z`.
    public static let rearWindow: [CarPathCommand] = [
        .move(CGPoint(x: 55, y: 38)),
        .line(CGPoint(x: 82, y: 30)),
        .line(CGPoint(x: 88, y: 42)),
        .quad(to: CGPoint(x: 68, y: 42), control: CGPoint(x: 78, y: 44)),
        .close
    ]

    /// The mark view box (web `viewBox="0 0 240 96"`).
    public static let viewBox = CarViewBox(size: CGSize(width: 240, height: 96))

    /// Front + rear tires (web `<circle r="14">`).
    public static let tires: [CarCircle] = [
        CarCircle(center: CGPoint(x: 70, y: 70), radius: 14),
        CarCircle(center: CGPoint(x: 190, y: 70), radius: 14)
    ]

    /// Front + rear hubs (web `<circle r="6">`).
    public static let hubs: [CarCircle] = [
        CarCircle(center: CGPoint(x: 70, y: 70), radius: 6),
        CarCircle(center: CGPoint(x: 190, y: 70), radius: 6)
    ]

    /// The pulsing headlight glow (web `<ellipse cx="228" cy="55" rx="4" ry="6">`).
    public static let headlight = CarEllipse(center: CGPoint(x: 228, y: 55), radii: CGSize(width: 4, height: 6))

    /// The pulsing taillight (web `<rect x="28" y="50" width="4" height="12" rx="2">`).
    public static let taillight = CarRoundedRect(
        rect: CGRect(x: 28, y: 50, width: 4, height: 12),
        cornerRadius: 2
    )

    /// The ground shadow (web `<ellipse cx="130" cy="86" rx="90" ry="4">`).
    public static let shadow = CarEllipse(center: CGPoint(x: 130, y: 86), radii: CGSize(width: 90, height: 4))
}

// MARK: - Charging bolt (web SVG `d`, view box 0 0 24 24)

/// The charging-bolt outline — the native peer of the web path `M13 2L3 14h9l-1 8 10-12h-9l1-8z`, with the
/// relative `h`/`l` commands pre-resolved to absolute vertices in the `0…24` view box (a closed polyline,
/// like the Spinner bolt).
public enum CarBoltGeometry {
    /// The mark view box (web `viewBox="0 0 24 24"`).
    public static let viewBox = CarViewBox(size: CGSize(width: 24, height: 24))

    /// The six absolute vertices of the closed bolt outline (web `d`, relative commands resolved).
    public static let points: [CGPoint] = [
        CGPoint(x: 13, y: 2),
        CGPoint(x: 3, y: 14),
        CGPoint(x: 12, y: 14),
        CGPoint(x: 11, y: 22),
        CGPoint(x: 21, y: 10),
        CGPoint(x: 12, y: 10)
    ]
}

// MARK: - Wheel loader (web SVG, view box 0 0 24 24)

/// The spinning wheel loader geometry — the tire, the hub, and the five radial spokes (web `<line>` ticks at
/// 0/72/144/216/288° around the hub) in the `0…24` view box.
public enum CarWheelGeometry {
    /// The mark view box (web `viewBox="0 0 24 24"`).
    public static let viewBox = CarViewBox(size: CGSize(width: 24, height: 24))

    /// The outer tire (web `<circle cx="12" cy="12" r="10">`).
    public static let tire = CarCircle(center: CGPoint(x: 12, y: 12), radius: 10)

    /// The inner hub (web `<circle cx="12" cy="12" r="4">`).
    public static let hub = CarCircle(center: CGPoint(x: 12, y: 12), radius: 4)

    /// The hub center the spokes rotate around (web `rotate(angle 12 12)`).
    public static let center = CGPoint(x: 12, y: 12)

    /// One spoke tick before rotation (web `x1="12" y1="5" x2="12" y2="8"`).
    public static let spokeStart = CGPoint(x: 12, y: 5)
    public static let spokeEnd = CGPoint(x: 12, y: 8)

    /// The five spoke angles in degrees (web `[0, 72, 144, 216, 288]`).
    public static let spokeAngles: [Double] = [0, 72, 144, 216, 288]
}

// MARK: - Battery gauge (web SVG, view box 0 0 48 24)

/// The battery-gauge geometry — the outline, the positive-terminal cap, and the fill cell origin in the
/// `0…48 × 0…24` view box. The fill width is derived per-level by ``CarAnimationProjector/resolveBattery``.
public enum CarBatteryGeometry {
    /// The mark view box (web `viewBox="0 0 48 24"`).
    public static let viewBox = CarViewBox(size: CGSize(width: 48, height: 24))

    /// The battery outline (web `<rect x="2" y="4" width="38" height="16" rx="3">`).
    public static let outline = CarRoundedRect(
        rect: CGRect(x: 2, y: 4, width: 38, height: 16),
        cornerRadius: 3
    )

    /// The positive-terminal cap (web `<rect x="40" y="8" width="4" height="8" rx="1">`).
    public static let cap = CarRoundedRect(
        rect: CGRect(x: 40, y: 8, width: 4, height: 8),
        cornerRadius: 1
    )

    /// The fill cell origin + height + corner (web `<rect x="4" y="6" height="12" rx="1.5">`); the width is
    /// the per-level ``BatteryFillProjection/fillWidthViewBox``.
    public static let fillOrigin = CGPoint(x: 4, y: 6)
    public static let fillHeight: CGFloat = 12
    public static let fillCornerRadius: CGFloat = 1.5
}
