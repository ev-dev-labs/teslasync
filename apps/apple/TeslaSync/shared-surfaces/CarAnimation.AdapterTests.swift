//
//  CarAnimation.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The pure-core coverage (the Foundation-only adapter + geometry + timeline): the surface identity, the mark
//  identities, the motion-preference port (the verbatim port of the web `useMotionPreference`), the four
//  projectors (the Tesla box, the bolt box, the battery band + clamp + fill width, the wheel box), the
//  battery band thresholds, the SVG geometry (the bezier command lists, the bolt polyline, the wheel spokes,
//  the battery cells), the view-box mapper, and the motion schedule (delays / pulses). Split from
//  CarAnimation.Tests.swift (the SwiftUI / state-holder half) to keep each file within the SwiftLint
//  file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure, with no
//  network and no clock.
//

import CoreGraphics
import XCTest
@testable import TeslaSync

// MARK: - Surface + mark identity

final class CarAnimationAdapterTests: XCTestCase {
    func testSurfaceSlugIsStable() {
        XCTAssertEqual(CarAnimationSurface.slug, "CarAnimation")
    }

    func testOnlyBatteryGaugeIsDecorative() {
        XCTAssertTrue(CarAnimationMark.tesla.isLabeled)
        XCTAssertTrue(CarAnimationMark.chargingBolt.isLabeled)
        XCTAssertTrue(CarAnimationMark.wheelSpin.isLabeled)
        XCTAssertFalse(CarAnimationMark.batteryFill.isLabeled)
    }
}

// MARK: - Motion preference (web `useMotionPreference`)

final class CarAnimationMotionPreferenceTests: XCTestCase {
    func testDefaultsToMotionEnabledWithDefaultDuration() {
        let preference = CarAnimationMotionPreference.resolve(reduceMotion: false)
        XCTAssertFalse(preference.reduce)
        XCTAssertEqual(preference.durationMs, 250)
    }

    func testHonoursDefaultMsOverrideWhenMotionAllowed() {
        let preference = CarAnimationMotionPreference.resolve(reduceMotion: false, defaultMs: 600)
        XCTAssertEqual(preference.durationMs, 600)
    }

    func testReducedReportsZeroDuration() {
        let preference = CarAnimationMotionPreference.resolve(reduceMotion: true)
        XCTAssertTrue(preference.reduce)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testReducedZeroDurationEvenWithCustomDefault() {
        let preference = CarAnimationMotionPreference.resolve(reduceMotion: true, defaultMs: 900)
        XCTAssertEqual(preference.durationMs, 0)
    }

    func testDurationSecondsIsMillisOverThousand() {
        XCTAssertEqual(CarAnimationMotionPreference.resolve(reduceMotion: false).durationSeconds, 0.25, accuracy: 1e-9)
        XCTAssertEqual(CarAnimationMotionPreference.resolve(reduceMotion: true).durationSeconds, 0, accuracy: 1e-9)
    }
}

// MARK: - Battery band (web `level >= 60 ? GOOD : level >= 30 ? WARN : BAD`)

final class BatteryLevelColorKindTests: XCTestCase {
    func testBandThresholds() {
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 100), .good)
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 60), .good)
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 59.9), .warning)
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 30), .warning)
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 29.9), .danger)
        XCTAssertEqual(BatteryLevelColorKind.resolve(level: 0), .danger)
    }
}

// MARK: - Projectors (the four web render bodies)

final class CarAnimationProjectorTests: XCTestCase {
    func testResolveCarScalesBoxAndHeight() {
        let projection = CarAnimationProjector.resolveCar(CarAnimationInput(size: 120), reduceMotion: false)
        XCTAssertEqual(projection.width, 120, accuracy: 1e-9)
        XCTAssertEqual(projection.height, 48, accuracy: 1e-9) // web h = size * 0.4
        XCTAssertEqual(projection.scale, 0.5, accuracy: 1e-9) // size / 240
        XCTAssertFalse(projection.reduce)
    }

    func testResolveBoltIsSquare() {
        let projection = CarAnimationProjector.resolveBolt(ChargingBoltInput(size: 48), reduceMotion: true)
        XCTAssertEqual(projection.dimension, 48, accuracy: 1e-9)
        XCTAssertEqual(projection.scale, 2, accuracy: 1e-9) // size / 24
        XCTAssertTrue(projection.reduce)
    }

    func testResolveBatteryWidthBandAndClamp() {
        let projection = CarAnimationProjector.resolveBattery(
            BatteryFillInput(level: 80, size: 48),
            reduceMotion: false
        )
        XCTAssertEqual(projection.width, 48, accuracy: 1e-9)
        XCTAssertEqual(projection.height, 24, accuracy: 1e-9) // web size * 0.5
        XCTAssertEqual(projection.scale, 1, accuracy: 1e-9) // size / 48
        XCTAssertEqual(projection.fillWidthViewBox, 30.4, accuracy: 1e-6) // 38 * 80 / 100
        XCTAssertEqual(projection.colorKind, .good)
        XCTAssertEqual(projection.clampedLevel, 80, accuracy: 1e-9)
    }

    func testResolveBatteryClampsAboveHundredButBandUsesRawLevel() {
        let projection = CarAnimationProjector.resolveBattery(
            BatteryFillInput(level: 130, size: 48),
            reduceMotion: false
        )
        XCTAssertEqual(projection.clampedLevel, 100, accuracy: 1e-9)
        XCTAssertEqual(projection.fillWidthViewBox, 38, accuracy: 1e-6) // full inner width
        XCTAssertEqual(projection.colorKind, .good)
    }

    func testResolveBatteryClampsBelowZeroToEmptyDangerFill() {
        let projection = CarAnimationProjector.resolveBattery(
            BatteryFillInput(level: -5, size: 48),
            reduceMotion: false
        )
        XCTAssertEqual(projection.clampedLevel, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.fillWidthViewBox, 0, accuracy: 1e-9)
        XCTAssertEqual(projection.colorKind, .danger)
    }

    func testResolveWheelIsSquare() {
        let projection = CarAnimationProjector.resolveWheel(WheelSpinInput(size: 24), reduceMotion: false)
        XCTAssertEqual(projection.dimension, 24, accuracy: 1e-9)
        XCTAssertEqual(projection.scale, 1, accuracy: 1e-9)
    }
}

// MARK: - Geometry (web SVG `d` + primitives)

final class CarAnimationGeometryTests: XCTestCase {
    func testBodyOutlineStartsMovesAndCloses() {
        let body = CarBodyGeometry.body
        XCTAssertEqual(body.count, 12)
        XCTAssertEqual(body.first, .move(CGPoint(x: 30, y: 60)))
        XCTAssertEqual(body.last, .close)
    }

    func testWindowsAndRearWindowAreClosed() {
        XCTAssertEqual(CarBodyGeometry.windshield.first, .move(CGPoint(x: 85, y: 30)))
        XCTAssertEqual(CarBodyGeometry.windshield.last, .close)
        XCTAssertEqual(CarBodyGeometry.rearWindow.first, .move(CGPoint(x: 55, y: 38)))
        XCTAssertEqual(CarBodyGeometry.rearWindow.last, .close)
    }

    func testWheelsAndLightsUseWebCoordinates() {
        XCTAssertEqual(CarBodyGeometry.tires.map(\.center.x), [70, 190])
        XCTAssertEqual(CarBodyGeometry.tires.allSatisfy { $0.radius == 14 }, true)
        XCTAssertEqual(CarBodyGeometry.hubs.allSatisfy { $0.radius == 6 }, true)
        XCTAssertEqual(CarBodyGeometry.headlight.center, CGPoint(x: 228, y: 55))
        XCTAssertEqual(CarBodyGeometry.taillight.rect, CGRect(x: 28, y: 50, width: 4, height: 12))
        XCTAssertEqual(CarBodyGeometry.shadow.radii, CGSize(width: 90, height: 4))
    }

    func testBoltPolylineHasSixVertices() {
        XCTAssertEqual(CarBoltGeometry.points.count, 6)
        XCTAssertEqual(CarBoltGeometry.points.first, CGPoint(x: 13, y: 2))
        XCTAssertEqual(CarBoltGeometry.points[4], CGPoint(x: 21, y: 10))
    }

    func testWheelLoaderSpokes() {
        XCTAssertEqual(CarWheelGeometry.spokeAngles, [0, 72, 144, 216, 288])
        XCTAssertEqual(CarWheelGeometry.tire.radius, 10)
        XCTAssertEqual(CarWheelGeometry.hub.radius, 4)
        XCTAssertEqual(CarWheelGeometry.center, CGPoint(x: 12, y: 12))
    }

    func testBatteryCells() {
        XCTAssertEqual(CarBatteryGeometry.outline.rect, CGRect(x: 2, y: 4, width: 38, height: 16))
        XCTAssertEqual(CarBatteryGeometry.cap.rect, CGRect(x: 40, y: 8, width: 4, height: 8))
        XCTAssertEqual(CarBatteryGeometry.fillOrigin, CGPoint(x: 4, y: 6))
        XCTAssertEqual(CarBatteryGeometry.fillHeight, 12)
    }
}

// MARK: - View-box mapper

final class CarViewBoxTests: XCTestCase {
    func testPointScalesIntoRect() {
        let viewBox = CarViewBox(size: CGSize(width: 240, height: 96))
        let rect = CGRect(x: 0, y: 0, width: 120, height: 48)
        XCTAssertEqual(viewBox.point(CGPoint(x: 240, y: 96), in: rect), CGPoint(x: 120, y: 48))
        XCTAssertEqual(viewBox.point(CGPoint(x: 120, y: 48), in: rect), CGPoint(x: 60, y: 24))
    }

    func testLengthScalesByHorizontalRatio() {
        let viewBox = CarViewBox(size: CGSize(width: 240, height: 96))
        let rect = CGRect(x: 0, y: 0, width: 120, height: 48)
        XCTAssertEqual(viewBox.length(1.5, in: rect), 0.75, accuracy: 1e-9) // 1.5 / 240 * 120
    }
}

// MARK: - Motion schedule (web `transition` + pulses)

final class CarAnimationTimelineTests: XCTestCase {
    func testHeadlightPulseMatchesWebKeyframes() {
        let pulse = CarPulse.headlight
        XCTAssertEqual(pulse.stops, [0, 0.8, 0.4, 0.8])
        XCTAssertEqual(pulse.cycle, 2, accuracy: 1e-9)
        XCTAssertEqual(pulse.resting, 0.8, accuracy: 1e-9)
        XCTAssertEqual(pulse.segmentDuration, 2.0 / 3.0, accuracy: 1e-9)
    }

    func testTaillightAndBoltPulses() {
        XCTAssertEqual(CarPulse.taillight.stops, [0, 0.7, 0.3, 0.7])
        XCTAssertEqual(CarPulse.taillight.resting, 0.7, accuracy: 1e-9)
        XCTAssertEqual(CarPulse.chargingBolt.stops, [0.1, 0.3, 0.1])
        XCTAssertEqual(CarPulse.chargingBolt.cycle, 1.5, accuracy: 1e-9)
        XCTAssertEqual(CarPulse.chargingBolt.segmentDuration, 0.75, accuracy: 1e-9)
    }

    func testEntryTimingConstants() {
        XCTAssertEqual(CarAnimationTiming.bodyDraw, 1.5, accuracy: 1e-9)
        XCTAssertEqual(CarAnimationTiming.windshieldDelay, 0.8, accuracy: 1e-9)
        XCTAssertEqual(CarAnimationTiming.wheelSpinCycle, 2, accuracy: 1e-9)
        XCTAssertEqual(CarAnimationTiming.batteryFillDuration, 1.2, accuracy: 1e-9)
    }
}

// MARK: - Value-type equality

final class CarAnimationValueTypeTests: XCTestCase {
    func testInputEquality() {
        XCTAssertEqual(CarAnimationInput(size: 120), CarAnimationInput(size: 120))
        XCTAssertNotEqual(CarAnimationInput(size: 120), CarAnimationInput(size: 90))
        XCTAssertEqual(BatteryFillInput(level: 80, size: 48), BatteryFillInput(level: 80, size: 48))
        XCTAssertNotEqual(BatteryFillInput(level: 80, size: 48), BatteryFillInput(level: 40, size: 48))
    }

    func testProjectionEquality() {
        let lhs = CarAnimationProjector.resolveBattery(BatteryFillInput(level: 80, size: 48), reduceMotion: false)
        let rhs = CarAnimationProjector.resolveBattery(BatteryFillInput(level: 80, size: 48), reduceMotion: false)
        XCTAssertEqual(lhs, rhs)
        let reduced = CarAnimationProjector.resolveBattery(BatteryFillInput(level: 80, size: 48), reduceMotion: true)
        XCTAssertNotEqual(lhs, reduced)
    }

    func testDefaultInputsMirrorWebDefaults() {
        XCTAssertEqual(CarAnimationInput().size, 120, accuracy: 1e-9)
        XCTAssertEqual(ChargingBoltInput().size, 32, accuracy: 1e-9)
        XCTAssertEqual(BatteryFillInput().level, 80, accuracy: 1e-9)
        XCTAssertEqual(BatteryFillInput().size, 48, accuracy: 1e-9)
        XCTAssertEqual(WheelSpinInput().size, 24, accuracy: 1e-9)
    }
}
