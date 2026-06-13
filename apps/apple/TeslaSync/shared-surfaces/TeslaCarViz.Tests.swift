//
//  TeslaCarViz.Tests.swift
//  TeslaSync — P4 shared surface · 0106 · TeslaCarViz (Apple)
//
//  The state-holder + facade + geometry + view-composition half of the coverage (the pure catalog + adapter
//  derivations live in TeslaCarViz.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • TeslaCarVizModel — the once-only `view.opened`, the props update + re-derivation.
//    • TeslaCarVizStrings — the status / a11y / model copy resolves through the P1/S10 facade, and the spoken
//      summary assembles the live state.
//    • TeslaCarVizPalette — the theme flag + ambient opacities.
//    • Geometry — CarCanvasMetrics maps the design space, and SVGPathParser yields bounded, non-empty paths
//      for every silhouette.
//    • CarAnim — the resting frame under Reduce Motion + the moving ranges.
//    • Views — the public surface + the mini glyph compose in every real branch.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - State-holder (once-only telemetry + props update)

@MainActor
final class TeslaCarVizModelTests: XCTestCase {
    private func holder(_ input: TeslaCarVizInput, telemetry: TeslaCarVizTelemetry) -> TeslaCarVizModel {
        TeslaCarVizModel(input: input, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let model = holder(TeslaCarVizInput(batteryLevel: 50), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TeslaCarVizSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let model = holder(TeslaCarVizInput(batteryLevel: 50), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [TeslaCarVizSurface.slug], "view.opened fires once per instance")
    }

    func testUpdateReplacesPropsAndReDerivesProjection() {
        let model = holder(TeslaCarVizInput(batteryLevel: 10), telemetry: SpyTelemetry())
        XCTAssertEqual(model.projection.batteryBand, .low)
        model.update(TeslaCarVizInput(batteryLevel: 90, isCharging: true))
        XCTAssertEqual(model.input.batteryLevel, 90, accuracy: 0.0001)
        XCTAssertEqual(model.projection.batteryBand, .high)
        XCTAssertTrue(model.projection.isCharging)
    }

    func testProjectionMatchesProjector() {
        let input = TeslaCarVizInput(batteryLevel: 42, isLocked: true, speed: 12, model: .modelY)
        let model = holder(input, telemetry: SpyTelemetry())
        XCTAssertEqual(model.projection, TeslaCarVizProjector.resolve(input: input))
    }
}

// MARK: - Strings facade (P1/S10)

final class TeslaCarVizStringsTests: XCTestCase {
    func testStatusLabelsResolveThroughFacade() {
        let dots = TeslaCarVizProjector.statusDots(
            isCharging: true, isLocked: false, isClimateOn: true, sentryMode: true
        )
        XCTAssertEqual(TeslaCarVizStrings.label(for: dots[0]), "Charging")
        XCTAssertEqual(TeslaCarVizStrings.label(for: dots[1]), "Unlocked")
    }

    func testModelNamesAndAccessibilityCopy() {
        XCTAssertEqual(TeslaCarVizStrings.modelName(.model3), "Model 3")
        XCTAssertEqual(TeslaCarVizStrings.modelName(.cybertruck), "Cybertruck")
        XCTAssertEqual(TeslaCarVizStrings.accessibilityLabel, "Vehicle status")
        XCTAssertEqual(TeslaCarVizStrings.batteryPhrase(percent: 75), "Battery 75 percent")
        XCTAssertEqual(TeslaCarVizStrings.motionPhrase(isDriving: true), "Driving")
        XCTAssertEqual(TeslaCarVizStrings.motionPhrase(isDriving: false), "Parked")
    }

    func testAccessibilityValueAssemblesLiveState() {
        let projection = TeslaCarVizProjector.resolve(
            input: TeslaCarVizInput(
                batteryLevel: 80, isCharging: true, isLocked: true,
                isClimateOn: true, sentryMode: true, speed: 20, model: .modelX
            )
        )
        let value = TeslaCarVizStrings.accessibilityValue(for: projection)
        XCTAssertTrue(value.contains("Model X"))
        XCTAssertTrue(value.contains("Battery 80 percent"))
        XCTAssertTrue(value.contains("Charging"))
        XCTAssertTrue(value.contains("Locked"))
        XCTAssertTrue(value.contains("Climate on"))
        XCTAssertTrue(value.contains("Sentry armed"))
        XCTAssertTrue(value.contains("Driving"))
    }

    func testAccessibilityValueOmitsOptionalFragmentsWhenOff() {
        let projection = TeslaCarVizProjector.resolve(input: TeslaCarVizInput(batteryLevel: 50))
        let value = TeslaCarVizStrings.accessibilityValue(for: projection)
        XCTAssertFalse(value.contains("Climate on"))
        XCTAssertFalse(value.contains("Sentry armed"))
        XCTAssertTrue(value.contains("Parked"))
    }
}

// MARK: - Palette (theme flag + ambient opacities)

final class TeslaCarVizPaletteTests: XCTestCase {
    func testThemeFlagIsHonoured() {
        XCTAssertTrue(TeslaCarVizPalette(isLight: true).isLight)
        XCTAssertFalse(TeslaCarVizPalette(isLight: false).isLight)
    }

    func testAmbientOpacityStrongerInDarkAndIdleIsSubtle() {
        let dark = TeslaCarVizPalette(isLight: false)
        let light = TeslaCarVizPalette(isLight: true)
        XCTAssertGreaterThan(dark.ambientOpacity(.charging), light.ambientOpacity(.charging))
        XCTAssertLessThan(dark.ambientOpacity(.idle), dark.ambientOpacity(.sentry))
    }
}

// MARK: - Geometry (design-space mapping + SVG parser)

final class TeslaCarVizGeometryTests: XCTestCase {
    func testMetricsMapDesignSpaceWithFitScale() {
        let metrics = CarCanvasMetrics(size: CGSize(width: 560, height: 290))
        XCTAssertEqual(metrics.scale, 1, accuracy: 0.0001)
        XCTAssertEqual(metrics.point(280, 145).x, 280, accuracy: 0.0001)
        XCTAssertEqual(metrics.length(10), 10, accuracy: 0.0001)
        let half = CarCanvasMetrics(size: CGSize(width: 280, height: 145))
        XCTAssertEqual(half.scale, 0.5, accuracy: 0.0001)
        XCTAssertEqual(half.point(560, 290).x, 280, accuracy: 0.0001)
    }

    func testSilhouettePathsAreNonEmptyAndBounded() {
        for model in TeslaCarModel.allCases {
            let data = CarSilhouette.paths(for: model)
            for raw in [data.body, data.roof, data.wind] {
                let path = SVGPathParser.path(from: raw)
                XCTAssertFalse(path.isEmpty, "\(model) silhouette parsed empty")
                let bounds = path.boundingRect
                XCTAssertGreaterThan(bounds.width, 0)
                XCTAssertLessThanOrEqual(bounds.maxX, TeslaCarVizSurface.designWidth + 1)
                XCTAssertLessThanOrEqual(bounds.maxY, TeslaCarVizSurface.designHeight + 1)
            }
        }
    }

    func testMiniSilhouettesAreBounded() {
        for model in TeslaCarModel.allCases {
            let path = SVGPathParser.path(from: CarSilhouette.mini(for: model))
            XCTAssertFalse(path.isEmpty)
            XCTAssertLessThanOrEqual(path.boundingRect.maxX, 65)
        }
    }
}

// MARK: - Animation (Reduce-Motion resting frame + moving ranges)

final class TeslaCarVizAnimTests: XCTestCase {
    func testRestingFrameWhenNotAnimated() {
        let anim = CarAnim(time: 123.4, animated: false)
        XCTAssertEqual(anim.wheelAngle(driving: true), 0, accuracy: 0.0001)
        XCTAssertEqual(anim.headlightGlow, 1, accuracy: 0.0001)
        XCTAssertEqual(anim.taillightGlow, 1, accuracy: 0.0001)
        XCTAssertEqual(anim.sentryAngleOuter, 0, accuracy: 0.0001)
        XCTAssertEqual(anim.climateWave(0).opacity, 0.5, accuracy: 0.0001)
        XCTAssertEqual(anim.speedLine(0).progress, 0.5, accuracy: 0.0001)
    }

    func testMovingValuesStayInRange() {
        let anim = CarAnim(time: 3.2, animated: true)
        XCTAssertEqual(anim.wheelAngle(driving: false), 0, accuracy: 0.0001)
        let angle = anim.wheelAngle(driving: true)
        XCTAssertGreaterThanOrEqual(angle, 0)
        XCTAssertLessThan(angle, 360)
        XCTAssertGreaterThanOrEqual(anim.headlightGlow, 0.85)
        XCTAssertLessThanOrEqual(anim.headlightGlow, 1.0001)
        XCTAssertGreaterThanOrEqual(anim.climateWave(1).opacity, 0)
    }
}

// MARK: - Views (every real branch composes)

@MainActor
final class TeslaCarVizViewTests: XCTestCase {
    func testSurfaceComposesForEveryModelAndSize() {
        for model in TeslaCarModel.allCases {
            for size in TeslaCarVizSize.allCases {
                _ = TeslaCarViz(batteryLevel: 55, size: size, model: model)
            }
        }
    }

    func testSurfaceComposesForEveryStateBranch() {
        _ = TeslaCarViz(batteryLevel: 12, isCharging: true)
        _ = TeslaCarViz(batteryLevel: 80, isLocked: true, isClimateOn: true)
        _ = TeslaCarViz(batteryLevel: 50, sentryMode: true, speed: 42)
        _ = TeslaCarViz(batteryLevel: 0)
        _ = TeslaCarMini(batteryLevel: 65, isCharging: true, model: .cybertruck)
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = TeslaCarVizModel(
            input: TeslaCarVizInput(batteryLevel: 70, model: .modelS),
            telemetry: SpyTelemetry()
        )
        _ = TeslaCarViz(model: injected)
        XCTAssertEqual(TeslaCarViz.surfaceSlug, "TeslaCarViz")
    }

    func testContentAndCanvasCompose() {
        let projection = TeslaCarVizProjector.resolve(input: TeslaCarVizInput(batteryLevel: 33, speed: 9))
        let palette = TeslaCarVizPalette(isLight: false)
        _ = TeslaCarVizContent(projection: projection, palette: palette, animated: false)
        _ = TeslaCarCanvas(projection: projection, palette: palette, time: 0, animated: true)
        _ = TeslaCarStatusRow(projection: projection, palette: palette)
        _ = TeslaCarAmbientGlow(projection: projection, palette: palette)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: TeslaCarVizTelemetry, @unchecked Sendable {
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
