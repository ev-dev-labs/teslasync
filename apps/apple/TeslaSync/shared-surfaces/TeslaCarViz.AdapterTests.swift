//
//  TeslaCarViz.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The pure-core coverage (the Foundation-only catalog + adapter): the surface identity, the model parsing
//  (web `parseModelKey`), the aspect ratios + layout table, the size presets, the battery band thresholds
//  (web `batteryColor`), the projector derivations (driving flag, battery fraction + percent clamping,
//  ambient precedence, status-row composition), the resolved projection geometry, and the value-type
//  equality. Split from TeslaCarViz.Tests.swift (the SwiftUI / state-holder + geometry half) to keep each
//  file within the SwiftLint file-length budget. These run in the TeslaSync(/-macOS) XCTest targets; the
//  derivation is pure, with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class TeslaCarVizSurfaceTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(TeslaCarVizSurface.slug, "TeslaCarViz")
    }

    func testDesignSpaceMatchesWebViewBox() {
        XCTAssertEqual(TeslaCarVizSurface.designWidth, 560, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarVizSurface.designHeight, 290, accuracy: 0.0001)
    }
}

// MARK: - Model parsing (web `parseModelKey`)

final class TeslaCarModelParseTests: XCTestCase {
    func testParsesEachVariantFromFleetStrings() {
        XCTAssertEqual(TeslaCarModel.parse("Cybertruck"), .cybertruck)
        XCTAssertEqual(TeslaCarModel.parse("Model X"), .modelX)
        XCTAssertEqual(TeslaCarModel.parse("Model Y Long Range"), .modelY)
        XCTAssertEqual(TeslaCarModel.parse("Model S Plaid"), .modelS)
        XCTAssertEqual(TeslaCarModel.parse("Model 3 P"), .model3)
    }

    func testMatchesMostSpecificTokenFirst() {
        // "ct" ⇒ Cybertruck, "mx"/"my"/"ms" abbreviations resolve like the web.
        XCTAssertEqual(TeslaCarModel.parse("CT"), .cybertruck)
        XCTAssertEqual(TeslaCarModel.parse("MX"), .modelX)
        XCTAssertEqual(TeslaCarModel.parse("MY"), .modelY)
        XCTAssertEqual(TeslaCarModel.parse("MS"), .modelS)
    }

    func testDefaultsToModel3ForNilOrUnknown() {
        XCTAssertEqual(TeslaCarModel.parse(nil), .model3)
        XCTAssertEqual(TeslaCarModel.parse(""), .model3)
        XCTAssertEqual(TeslaCarModel.parse("Roadster"), .model3)
    }
}

// MARK: - Geometry catalog

final class TeslaCarModelGeometryTests: XCTestCase {
    func testAspectRatios() {
        XCTAssertEqual(TeslaCarModel.cybertruck.aspectRatio, 0.56, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarModel.modelX.aspectRatio, 0.55, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarModel.modelY.aspectRatio, 0.55, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarModel.model3.aspectRatio, 0.52, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarModel.modelS.aspectRatio, 0.52, accuracy: 0.0001)
    }

    func testCybertruckFlag() {
        XCTAssertTrue(TeslaCarModel.cybertruck.isCybertruck)
        XCTAssertFalse(TeslaCarModel.model3.isCybertruck)
    }

    func testLayoutTableSpotChecks() {
        let cyber = TeslaCarLayout.layout(for: .cybertruck)
        XCTAssertEqual(cyber.taillightY, 165, accuracy: 0.0001)
        XCTAssertEqual(cyber.headlightX, 108, accuracy: 0.0001)
        let modelX = TeslaCarLayout.layout(for: .modelX)
        XCTAssertEqual(modelX.lockY, 100, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarLayout.layout(for: .model3).frontWheelX, 160, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarLayout.batteryBarWidth, 260, accuracy: 0.0001)
    }
}

final class TeslaCarVizSizeTests: XCTestCase {
    func testWidthsMatchWebSizeMap() {
        XCTAssertEqual(TeslaCarVizSize.sm.width, 180, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarVizSize.md.width, 280, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarVizSize.lg.width, 380, accuracy: 0.0001)
    }
}

// MARK: - Battery band (web `batteryColor` thresholds)

final class TeslaCarVizBatteryBandTests: XCTestCase {
    func testThresholds() {
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(100), .high)
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(61), .high)
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(60), .medium, "boundary is > 60")
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(26), .medium)
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(25), .low, "boundary is > 25")
        XCTAssertEqual(TeslaCarVizBatteryBand.forLevel(0), .low)
    }
}

// MARK: - Projector derivations

final class TeslaCarVizProjectorTests: XCTestCase {
    func testDrivingFlag() {
        XCTAssertTrue(TeslaCarVizProjector.isDriving(speed: 0.1))
        XCTAssertFalse(TeslaCarVizProjector.isDriving(speed: 0))
        XCTAssertFalse(TeslaCarVizProjector.isDriving(speed: -5))
    }

    func testBatteryFractionClamps() {
        XCTAssertEqual(TeslaCarVizProjector.batteryFraction(level: 50), 0.5, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarVizProjector.batteryFraction(level: -10), 0, accuracy: 0.0001)
        XCTAssertEqual(TeslaCarVizProjector.batteryFraction(level: 150), 1, accuracy: 0.0001)
    }

    func testBatteryPercentRoundsAndClamps() {
        XCTAssertEqual(TeslaCarVizProjector.batteryPercent(level: 49.6), 50)
        XCTAssertEqual(TeslaCarVizProjector.batteryPercent(level: -5), 0)
        XCTAssertEqual(TeslaCarVizProjector.batteryPercent(level: 120), 100)
    }

    func testAmbientPrecedence() {
        XCTAssertEqual(TeslaCarVizProjector.ambientMode(sentryMode: true, isCharging: true, isDriving: true), .sentry)
        XCTAssertEqual(
            TeslaCarVizProjector.ambientMode(sentryMode: false, isCharging: true, isDriving: true),
            .charging
        )
        XCTAssertEqual(
            TeslaCarVizProjector.ambientMode(sentryMode: false, isCharging: false, isDriving: true),
            .driving
        )
        XCTAssertEqual(TeslaCarVizProjector.ambientMode(sentryMode: false, isCharging: false, isDriving: false), .idle)
    }
}

// MARK: - Status-row composition

final class TeslaCarVizStatusDotsTests: XCTestCase {
    func testChargingAndLockAlwaysPresentAndReflectState() {
        let dots = TeslaCarVizProjector.statusDots(
            isCharging: false, isLocked: false, isClimateOn: false, sentryMode: false
        )
        XCTAssertEqual(dots.map(\.id), [TeslaCarVizProjector.chargingDotID, TeslaCarVizProjector.lockDotID])
        XCTAssertFalse(dots[0].active)
        XCTAssertEqual(dots[0].labelFallback, "Not Charging")
        XCTAssertFalse(dots[1].active)
        XCTAssertEqual(dots[1].labelFallback, "Unlocked")
    }

    func testActiveLabelsAndRoles() {
        let dots = TeslaCarVizProjector.statusDots(
            isCharging: true, isLocked: true, isClimateOn: true, sentryMode: true
        )
        XCTAssertEqual(dots.map(\.id), [
            TeslaCarVizProjector.chargingDotID,
            TeslaCarVizProjector.lockDotID,
            TeslaCarVizProjector.climateDotID,
            TeslaCarVizProjector.sentryDotID
        ])
        XCTAssertEqual(dots[0].labelFallback, "Charging")
        XCTAssertEqual(dots[1].labelFallback, "Locked")
        XCTAssertEqual(dots[2].role, .info)
        XCTAssertEqual(dots[3].role, .danger)
        XCTAssertTrue(dots.allSatisfy(\.active))
    }

    func testClimateAndSentryAreConditional() {
        let climateOnly = TeslaCarVizProjector.statusDots(
            isCharging: false, isLocked: false, isClimateOn: true, sentryMode: false
        )
        XCTAssertEqual(climateOnly.count, 3)
        XCTAssertEqual(climateOnly.last?.id, TeslaCarVizProjector.climateDotID)
        let sentryOnly = TeslaCarVizProjector.statusDots(
            isCharging: false, isLocked: false, isClimateOn: false, sentryMode: true
        )
        XCTAssertEqual(sentryOnly.count, 3)
        XCTAssertEqual(sentryOnly.last?.id, TeslaCarVizProjector.sentryDotID)
    }
}

// MARK: - Resolved projection

final class TeslaCarVizProjectionTests: XCTestCase {
    func testFrameSizeFollowsSizeAndAspect() {
        let model3 = TeslaCarVizProjector.resolve(input: TeslaCarVizInput(batteryLevel: 50, size: .md, model: .model3))
        XCTAssertEqual(model3.width, 280, accuracy: 0.0001)
        XCTAssertEqual(model3.height, 280 * 0.52, accuracy: 0.0001)
        let cyber = TeslaCarVizProjector.resolve(
            input: TeslaCarVizInput(batteryLevel: 50, size: .lg, model: .cybertruck)
        )
        XCTAssertEqual(cyber.width, 380, accuracy: 0.0001)
        XCTAssertEqual(cyber.height, 380 * 0.56, accuracy: 0.0001)
    }

    func testResolveCarriesDerivedState() {
        let projection = TeslaCarVizProjector.resolve(
            input: TeslaCarVizInput(batteryLevel: 18, isCharging: true, speed: 30, sentryMode: true)
        )
        XCTAssertTrue(projection.isDriving)
        XCTAssertEqual(projection.batteryBand, .low)
        XCTAssertEqual(projection.batteryPercent, 18)
        XCTAssertEqual(projection.ambientMode, .sentry)
        XCTAssertEqual(projection.statusDots.count, 3)
    }
}

// MARK: - Value-type equality

final class TeslaCarVizInputEqualityTests: XCTestCase {
    func testEquality() {
        let base = TeslaCarVizInput(batteryLevel: 80, isCharging: true, model: .modelY)
        XCTAssertEqual(base, TeslaCarVizInput(batteryLevel: 80, isCharging: true, model: .modelY))
        XCTAssertNotEqual(base, TeslaCarVizInput(batteryLevel: 81, isCharging: true, model: .modelY))
        XCTAssertNotEqual(base, TeslaCarVizInput(batteryLevel: 80, isCharging: false, model: .modelY))
        XCTAssertNotEqual(base, TeslaCarVizInput(batteryLevel: 80, isCharging: true, model: .model3))
    }
}
