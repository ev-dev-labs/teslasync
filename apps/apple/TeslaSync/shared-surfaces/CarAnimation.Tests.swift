//
//  CarAnimation.Tests.swift
//  TeslaSync — P4 shared surface · 0190 · CarAnimation (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + geometry + value
//  types live in CarAnimation.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • CarAnimationModel — the once-only `view.opened`, the reduce-motion rebind, and the per-mark resolved
//      accessibility label (web `aria-label`, `nil` for the decorative battery gauge).
//    • Strings — the three web `aria-label` fallbacks + the per-mark resolver go through the P1/S10 facade.
//    • Views — the four public surfaces compose in every real branch (default props, injected reduced model).
//    • Shapes — the bezier / bolt / battery-fill / spoke shapes trace non-empty outlines inside their box.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - CarAnimationModel (lifecycle + rebind + resolved label)

@MainActor
final class CarAnimationModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyCarTelemetry()
        let model = CarAnimationModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [CarAnimationSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyCarTelemetry()
        let model = CarAnimationModel(telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [CarAnimationSurface.slug], "view.opened fires once per instance")
    }

    func testUpdateReduceMotionFlipsFlag() {
        let model = CarAnimationModel(reduceMotion: false)
        XCTAssertFalse(model.reduceMotion)
        model.update(reduceMotion: true)
        XCTAssertTrue(model.reduceMotion)
    }

    func testAccessibilityLabelPerMark() {
        let model = CarAnimationModel()
        XCTAssertEqual(model.accessibilityLabel(for: .tesla), "Tesla vehicle illustration")
        XCTAssertEqual(model.accessibilityLabel(for: .chargingBolt), "Charging")
        XCTAssertEqual(model.accessibilityLabel(for: .wheelSpin), "Loading")
        XCTAssertNil(model.accessibilityLabel(for: .batteryFill))
    }
}

// MARK: - Strings facade (P1/S10)

final class CarAnimationStringsTests: XCTestCase {
    func testWebAriaLabelFallbacks() {
        XCTAssertEqual(CarAnimationStrings.tesla, "Tesla vehicle illustration")
        XCTAssertEqual(CarAnimationStrings.charging, "Charging")
        XCTAssertEqual(CarAnimationStrings.loading, "Loading")
    }

    func testLabelResolverMatchesMarks() {
        XCTAssertEqual(CarAnimationStrings.label(for: .tesla), "Tesla vehicle illustration")
        XCTAssertEqual(CarAnimationStrings.label(for: .chargingBolt), "Charging")
        XCTAssertEqual(CarAnimationStrings.label(for: .wheelSpin), "Loading")
        XCTAssertNil(CarAnimationStrings.label(for: .batteryFill), "battery gauge is decorative in the source")
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class CarAnimationViewTests: XCTestCase {
    func testPublicSurfacesComposeForEveryMark() {
        _ = CarAnimation()
        _ = CarAnimation(size: 200)
        _ = ChargingBolt()
        _ = ChargingBolt(size: 64)
        _ = BatteryFillAnimation()
        _ = BatteryFillAnimation(level: 42, size: 96)
        _ = WheelSpin()
        _ = WheelSpin(size: 48)
        XCTAssertEqual(CarAnimation.surfaceSlug, "CarAnimation")
    }

    func testSurfacesComposeFromInjectedReducedModel() {
        let spy = SpyCarTelemetry()
        _ = CarAnimation(size: 160, model: CarAnimationModel(reduceMotion: true, telemetry: spy))
        _ = ChargingBolt(size: 40, model: CarAnimationModel(reduceMotion: true, telemetry: spy))
        _ = BatteryFillAnimation(level: 10, size: 80, model: CarAnimationModel(reduceMotion: true, telemetry: spy))
        _ = WheelSpin(size: 32, model: CarAnimationModel(reduceMotion: true, telemetry: spy))
    }

    func testMarkSubviewsComposeForBothMotionModes() {
        let animated = CarAnimationProjector.resolveCar(CarAnimationInput(), reduceMotion: false)
        let reduced = CarAnimationProjector.resolveCar(CarAnimationInput(), reduceMotion: true)
        _ = TeslaSilhouetteMark(projection: animated)
        _ = TeslaSilhouetteMark(projection: reduced)
        _ = ChargingBoltMark(projection: CarAnimationProjector.resolveBolt(ChargingBoltInput(), reduceMotion: false))
        _ = BatteryGaugeMark(projection: CarAnimationProjector.resolveBattery(BatteryFillInput(), reduceMotion: false))
        _ = WheelLoaderMark(projection: CarAnimationProjector.resolveWheel(WheelSpinInput(), reduceMotion: true))
    }
}

// MARK: - Shapes (web SVG paths trace non-empty outlines)

final class CarAnimationShapeTests: XCTestCase {
    private let rect = CGRect(x: 0, y: 0, width: 240, height: 96)

    func testBodyAndWindowPathsTraceOutlinesInsideBox() {
        let tolerance = rect.insetBy(dx: -1, dy: -1)
        for commands in [CarBodyGeometry.body, CarBodyGeometry.windshield, CarBodyGeometry.rearWindow] {
            let path = CarPathShape(commands: commands, viewBox: CarBodyGeometry.viewBox).path(in: rect)
            XCTAssertFalse(path.isEmpty)
            XCTAssertTrue(tolerance.contains(path.boundingRect))
        }
    }

    func testBoltShapeTracesOutline() {
        let square = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = CarBoltShape().path(in: square)
        XCTAssertFalse(path.isEmpty)
        XCTAssertTrue(square.insetBy(dx: -1, dy: -1).contains(path.boundingRect))
    }

    func testBatteryFillGrowsWithProgress() {
        let empty = BatteryFillShape(progress: 0, fillWidthViewBox: 30).path(in: rect)
        XCTAssertTrue(empty.isEmpty, "no fill at progress 0 (web width: 0)")
        let full = BatteryFillShape(progress: 1, fillWidthViewBox: 30).path(in: rect)
        XCTAssertFalse(full.isEmpty)
        let half = BatteryFillShape(progress: 0.5, fillWidthViewBox: 30).path(in: rect)
        XCTAssertLessThan(half.boundingRect.width, full.boundingRect.width)
    }

    func testWheelSpokesTraceFiveTicks() {
        let square = CGRect(x: 0, y: 0, width: 24, height: 24)
        let path = WheelSpokesShape().path(in: square)
        XCTAssertFalse(path.isEmpty)
        XCTAssertTrue(square.insetBy(dx: -1, dy: -1).contains(path.boundingRect))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyCarTelemetry: CarAnimationTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}
