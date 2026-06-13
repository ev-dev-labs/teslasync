//
//  CarAnimation.Shapes.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The presentational `Shape` peers of the web SVG paths + primitives, plus the looping-pulse helper. Each
//  shape scales its view-box geometry (``CarAnimation.Geometry.swift``) into the SwiftUI draw rect, so the
//  marks render crisply at any size. ``CarPathShape`` traces the Tesla bezier outlines (and supports a
//  stroke `trim` for the body draw-in); ``CarBoltShape`` traces the charging bolt; ``BatteryFillShape``
//  grows its fill with an animatable `progress` (web `width: 0 → fillWidth`); ``WheelSpokesShape`` lays the
//  five radial ticks. All chrome is token-driven (P1/S9) at the call sites — no raw hex here.
//

import SwiftUI

// MARK: - Stroke style (web `strokeLinecap`/`strokeLinejoin="round"`)

/// The shared round stroke used by the bolt + wheel spokes (web `strokeLinecap="round"`).
enum CarStroke {
    static func round(width: CGFloat) -> StrokeStyle {
        StrokeStyle(lineWidth: width, lineCap: .round, lineJoin: .round)
    }
}

// MARK: - CarPathShape (web bezier `<path d>`)

/// A bezier outline as a SwiftUI `Shape` — the native peer of a web `<path d>` (the Tesla body + windows). It
/// scales the ``CarPathCommand`` list from its view box into the draw rect; because it is a `Shape`, a
/// `.trim(from:to:)` traces the body's draw-in and a `.fill` solidifies it.
struct CarPathShape: Shape {
    let commands: [CarPathCommand]
    let viewBox: CarViewBox

    func path(in rect: CGRect) -> Path {
        var path = Path()
        for command in commands {
            switch command {
            case let .move(point):
                path.move(to: viewBox.point(point, in: rect))
            case let .line(point):
                path.addLine(to: viewBox.point(point, in: rect))
            case let .quad(to, control):
                path.addQuadCurve(to: viewBox.point(to, in: rect), control: viewBox.point(control, in: rect))
            case .close:
                path.closeSubpath()
            }
        }
        return path
    }
}

// MARK: - CarBoltShape (web bolt `<path d>`)

/// The charging-bolt outline as a closed `Shape` — the native peer of the web polyline
/// `M13 2L3 14h9l-1 8 10-12h-9l1-8z`, scaling ``CarBoltGeometry`` into the draw rect.
struct CarBoltShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let points = CarBoltGeometry.points
        guard let first = points.first else { return path }
        path.move(to: CarBoltGeometry.viewBox.point(first, in: rect))
        for vertex in points.dropFirst() {
            path.addLine(to: CarBoltGeometry.viewBox.point(vertex, in: rect))
        }
        path.closeSubpath()
        return path
    }
}

// MARK: - BatteryFillShape (web `<motion.rect width: 0 → fillWidth>`)

/// The battery fill cell as an animatable `Shape` — the native peer of the web `<motion.rect>` whose `width`
/// grows from `0` to the level width. `progress` (`0…1`) is the animatable fraction of the resolved
/// ``BatteryFillProjection/fillWidthViewBox`` to draw, growing rightward from the fixed left edge.
struct BatteryFillShape: Shape {
    var progress: CGFloat
    let fillWidthViewBox: CGFloat

    var animatableData: CGFloat {
        get { progress }
        set { progress = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let viewBox = CarBatteryGeometry.viewBox
        let origin = CarBatteryGeometry.fillOrigin
        let width = fillWidthViewBox * max(0, min(progress, 1))
        guard width > 0 else { return Path() }
        let topLeft = viewBox.point(origin, in: rect)
        let cell = CGRect(
            x: topLeft.x,
            y: topLeft.y,
            width: viewBox.length(width, in: rect),
            height: viewBox.length(CarBatteryGeometry.fillHeight, in: rect)
        )
        let corner = viewBox.length(CarBatteryGeometry.fillCornerRadius, in: rect)
        return Path(roundedRect: cell, cornerRadius: corner)
    }
}

// MARK: - WheelSpokesShape (web rotated `<line>` ticks)

/// The five radial spoke ticks as one `Shape` — the native peer of the web `<line>`s rotated 0/72/144/216/
/// 288° about the hub. The whole shape is rotated by the loader's spin animation; here it just lays the
/// ticks at rest, scaling ``CarWheelGeometry`` into the draw rect.
struct WheelSpokesShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        let viewBox = CarWheelGeometry.viewBox
        let center = viewBox.point(CarWheelGeometry.center, in: rect)
        let start = viewBox.point(CarWheelGeometry.spokeStart, in: rect)
        let end = viewBox.point(CarWheelGeometry.spokeEnd, in: rect)
        for angle in CarWheelGeometry.spokeAngles {
            let radians = CGFloat(angle) * .pi / 180
            path.move(to: rotate(start, around: center, by: radians))
            path.addLine(to: rotate(end, around: center, by: radians))
        }
        return path
    }

    private func rotate(_ point: CGPoint, around pivot: CGPoint, by radians: CGFloat) -> CGPoint {
        let dx = point.x - pivot.x
        let dy = point.y - pivot.y
        return CGPoint(
            x: pivot.x + dx * cos(radians) - dy * sin(radians),
            y: pivot.y + dx * sin(radians) + dy * cos(radians)
        )
    }
}

// MARK: - CarPulseView (web looping opacity `@keyframes`)

/// A looping opacity pulse around a fill — the native peer of a web `animate={{ opacity: [...] }}` with
/// `repeat: Infinity`. When motion is allowed it drives a `KeyframeAnimator` across the ``CarPulse`` stops
/// after the start delay; when Reduce Motion is on it renders the steady `resting` opacity with no loop. The
/// content is the already-shaped, already-colored element (the head/tail-light or the bolt fill).
struct CarPulseView<Content: View>: View {
    let pulse: CarPulse
    let reduce: Bool
    let startDelay: Double
    @ViewBuilder let content: Content

    @State private var active = false

    var body: some View {
        Group {
            if reduce {
                content.opacity(pulse.resting)
            } else if active {
                animated
            } else {
                content.opacity(pulse.stops.first ?? 0)
            }
        }
        .onAppear { scheduleStart() }
        .onDisappear { active = false }
    }

    private var animated: some View {
        let segment = pulse.segmentDuration
        let tail = Array(pulse.stops.dropFirst())
        return KeyframeAnimator(initialValue: pulse.stops.first ?? 0, repeating: true) { opacity in
            content.opacity(opacity)
        } keyframes: { _ in
            KeyframeTrack {
                for stop in tail {
                    CubicKeyframe(stop, duration: segment)
                }
            }
        }
    }

    private func scheduleStart() {
        guard !reduce else { return }
        if startDelay <= 0 {
            active = true
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + startDelay) {
            active = true
        }
    }
}
