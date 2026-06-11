//
//  ProgressRing.Tests.swift
//  TeslaSync — P4 shared surface · 0099 · ProgressRing (Apple)
//
//  Coverage for the ProgressRing surface:
//    • Projection — the verbatim port of the web ring math: radius / center / circumference, the
//      clamped value (negative, in-range, over-max, non-finite), the guarded fill fraction (incl. the
//      non-positive `max` divide guard the web omits), the `strokeDashoffset` peer, the percentage, and
//      the proportional centered-text sizes with their floors. The full `resolve` snapshot plus the
//      empty / partial / full / over-max readings are the deterministic per-state coverage.
//    • Meta — the diagnostics slug + the web prop defaults + the font-scale constants.
//    • Accessibility — non-empty trimming, the centered-text join, the percentage reading, and the
//      composed label across all four caption / centered-text combinations.
//    • Model — the resolved projection, the accessibility label, `sync` adoption + idempotence, the
//      lazy once-only `view.opened` telemetry, and the no-op stop.
//    • Views — the public surfaces and the gauge compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection / model directly.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (geometry + clamping + font scaling)

final class ProgressRingProjectionTests: XCTestCase {
    func testDimensionGuardsNonFiniteAndNonPositive() {
        XCTAssertEqual(ProgressRingProjection.dimension(48, fallback: 10), 48, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.dimension(0, fallback: 10), 10, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.dimension(-5, fallback: 10), 10, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.dimension(.nan, fallback: 10), 10, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.dimension(.infinity, fallback: 10), 10, accuracy: 1e-9)
    }

    func testRadiusMatchesWebExpression() {
        // (48 - 4) / 2 = 22
        XCTAssertEqual(ProgressRingProjection.radius(size: 48, strokeWidth: 4), 22, accuracy: 1e-9)
    }

    func testRadiusFlooredAtZeroForOverThickStroke() {
        XCTAssertEqual(ProgressRingProjection.radius(size: 2, strokeWidth: 10), 0, accuracy: 1e-9)
    }

    func testCircumferenceMatchesWebExpression() {
        XCTAssertEqual(ProgressRingProjection.circumference(radius: 22), 2 * .pi * 22, accuracy: 1e-9)
    }

    func testClampNegativeInRangeAndOverMax() {
        XCTAssertEqual(ProgressRingProjection.clamp(value: -10, maxValue: 100), 0, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.clamp(value: 50, maxValue: 100), 50, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.clamp(value: 150, maxValue: 100), 100, accuracy: 1e-9)
    }

    func testClampHandlesNonFiniteValueAndMax() {
        XCTAssertEqual(ProgressRingProjection.clamp(value: .nan, maxValue: 100), 0, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.clamp(value: 50, maxValue: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.clamp(value: 50, maxValue: -3), 0, accuracy: 1e-9)
    }

    func testFillFractionMatchesWebRatio() {
        XCTAssertEqual(ProgressRingProjection.fillFraction(value: 50, maxValue: 100), 0.5, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.fillFraction(value: 0, maxValue: 100), 0, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.fillFraction(value: 150, maxValue: 100), 1, accuracy: 1e-9)
    }

    func testFillFractionGuardsNonPositiveMax() {
        // The web divides by `max` unguarded; the native peer yields an empty ring instead of NaN.
        XCTAssertEqual(ProgressRingProjection.fillFraction(value: 50, maxValue: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.fillFraction(value: 50, maxValue: .nan), 0, accuracy: 1e-9)
    }

    func testOffsetMatchesWebDashOffset() {
        let circumference = 2 * Double.pi * 22
        XCTAssertEqual(
            ProgressRingProjection.offset(circumference: circumference, fillFraction: 0),
            circumference,
            accuracy: 1e-9
        )
        XCTAssertEqual(ProgressRingProjection.offset(circumference: circumference, fillFraction: 1), 0, accuracy: 1e-9)
        XCTAssertEqual(
            ProgressRingProjection.offset(circumference: circumference, fillFraction: 0.5),
            circumference * 0.5,
            accuracy: 1e-9
        )
    }

    func testPercentScalesFraction() {
        XCTAssertEqual(ProgressRingProjection.percent(value: 25, maxValue: 100), 25, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingProjection.percent(value: 21.5, maxValue: 43), 50, accuracy: 1e-9)
    }

    func testMainFontSizeScaleAndFloor() {
        // round(48 * 0.32) = 15, above the floor of 10.
        XCTAssertEqual(ProgressRingProjection.mainFontSize(forSize: 48), 15, accuracy: 1e-9)
        // round(24 * 0.32) = 8, clamped up to the floor of 10.
        XCTAssertEqual(ProgressRingProjection.mainFontSize(forSize: 24), 10, accuracy: 1e-9)
    }

    func testSubFontSizeScaleAndFloor() {
        // round(48 * 0.18) = 9, above the floor of 8.
        XCTAssertEqual(ProgressRingProjection.subFontSize(forSize: 48), 9, accuracy: 1e-9)
        // round(24 * 0.18) = 4, clamped up to the floor of 8.
        XCTAssertEqual(ProgressRingProjection.subFontSize(forSize: 24), 8, accuracy: 1e-9)
    }

    func testResolveFullSnapshot() {
        let input = ProgressRingInput(
            value: 50, max: 100, size: 48, strokeWidth: 4, centerLabel: "50", centerSubLabel: "%"
        )
        let resolved = ProgressRingProjection.resolve(input)
        XCTAssertEqual(resolved.size, 48, accuracy: 1e-9)
        XCTAssertEqual(resolved.strokeWidth, 4, accuracy: 1e-9)
        XCTAssertEqual(resolved.radius, 22, accuracy: 1e-9)
        XCTAssertEqual(resolved.center, 24, accuracy: 1e-9)
        XCTAssertEqual(resolved.circumference, 2 * .pi * 22, accuracy: 1e-9)
        XCTAssertEqual(resolved.clamped, 50, accuracy: 1e-9)
        XCTAssertEqual(resolved.fillFraction, 0.5, accuracy: 1e-9)
        XCTAssertEqual(resolved.offset, (2 * .pi * 22) * 0.5, accuracy: 1e-9)
        XCTAssertEqual(resolved.percent, 50, accuracy: 1e-9)
        XCTAssertTrue(resolved.hasCenter)
        XCTAssertEqual(resolved.mainFontSize, 15, accuracy: 1e-9)
        XCTAssertEqual(resolved.subFontSize, 9, accuracy: 1e-9)
    }

    func testResolvePerFillState() {
        let empty = ProgressRingProjection.resolve(ProgressRingInput(value: 0, max: 100))
        XCTAssertEqual(empty.fillFraction, 0, accuracy: 1e-9)
        XCTAssertEqual(empty.percent, 0, accuracy: 1e-9)
        XCTAssertFalse(empty.hasCenter)

        let partial = ProgressRingProjection.resolve(ProgressRingInput(value: 25, max: 100))
        XCTAssertEqual(partial.fillFraction, 0.25, accuracy: 1e-9)

        let full = ProgressRingProjection.resolve(ProgressRingInput(value: 100, max: 100))
        XCTAssertEqual(full.fillFraction, 1, accuracy: 1e-9)

        let over = ProgressRingProjection.resolve(ProgressRingInput(value: 120, max: 100))
        XCTAssertEqual(over.fillFraction, 1, accuracy: 1e-9)
        XCTAssertEqual(over.clamped, 100, accuracy: 1e-9)
    }

    func testResolveUsesDefaultDimensionsForDegenerateInput() {
        let resolved = ProgressRingProjection.resolve(ProgressRingInput(value: 10, size: 0, strokeWidth: 0))
        XCTAssertEqual(resolved.size, ProgressRingMeta.defaultSize, accuracy: 1e-9)
        XCTAssertEqual(resolved.strokeWidth, ProgressRingMeta.defaultStrokeWidth, accuracy: 1e-9)
    }

    func testResolveHasCenterTracksNonNilNotNonEmpty() {
        let emptyString = ProgressRingProjection.resolve(ProgressRingInput(value: 1, centerLabel: ""))
        XCTAssertTrue(emptyString.hasCenter)
        let none = ProgressRingProjection.resolve(ProgressRingInput(value: 1))
        XCTAssertFalse(none.hasCenter)
    }
}

// MARK: - Meta (diagnostics slug + web defaults)

final class ProgressRingMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(ProgressRingMeta.surfaceSlug, "ProgressRing")
        XCTAssertEqual(ProgressRing.surfaceSlug, "ProgressRing")
    }

    func testWebDefaults() {
        XCTAssertEqual(ProgressRingMeta.defaultMax, 100, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.defaultSize, 48, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.defaultStrokeWidth, 4, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.minMainFontSize, 10, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.minSubFontSize, 8, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.mainFontScale, 0.32, accuracy: 1e-9)
        XCTAssertEqual(ProgressRingMeta.subFontScale, 0.18, accuracy: 1e-9)
    }

    func testInputDefaultsMatchWebProps() {
        let input = ProgressRingInput(value: 5)
        XCTAssertEqual(input.max, ProgressRingMeta.defaultMax, accuracy: 1e-9)
        XCTAssertEqual(input.size, ProgressRingMeta.defaultSize, accuracy: 1e-9)
        XCTAssertEqual(input.strokeWidth, ProgressRingMeta.defaultStrokeWidth, accuracy: 1e-9)
        XCTAssertNil(input.label)
        XCTAssertNil(input.centerLabel)
        XCTAssertNil(input.centerSubLabel)
    }
}

// MARK: - Accessibility (composed label)

final class ProgressRingAccessibilityTests: XCTestCase {
    func testNonEmptyTrimsAndRejectsBlank() {
        XCTAssertNil(ProgressRingAccessibility.nonEmpty(nil))
        XCTAssertNil(ProgressRingAccessibility.nonEmpty(""))
        XCTAssertNil(ProgressRingAccessibility.nonEmpty("   "))
        XCTAssertEqual(ProgressRingAccessibility.nonEmpty("  Battery  "), "Battery")
    }

    func testCenterTextJoinsPresentParts() {
        XCTAssertNil(ProgressRingAccessibility.centerText(ProgressRingInput(value: 1)))
        XCTAssertEqual(
            ProgressRingAccessibility.centerText(ProgressRingInput(value: 1, centerLabel: "86")),
            "86"
        )
        XCTAssertEqual(
            ProgressRingAccessibility.centerText(
                ProgressRingInput(value: 1, centerLabel: "86", centerSubLabel: "%")
            ),
            "86 %"
        )
        XCTAssertEqual(
            ProgressRingAccessibility.centerText(
                ProgressRingInput(value: 1, centerLabel: "  ", centerSubLabel: "kWh")
            ),
            "kWh"
        )
    }

    func testPercentTextRounds() {
        let half = ProgressRingProjection.resolve(ProgressRingInput(value: 50, max: 100))
        XCTAssertEqual(ProgressRingAccessibility.percentText(half), "50%")
        let nearlyHalf = ProgressRingProjection.resolve(ProgressRingInput(value: 49.6, max: 100))
        XCTAssertEqual(ProgressRingAccessibility.percentText(nearlyHalf), "50%")
        let full = ProgressRingProjection.resolve(ProgressRingInput(value: 100, max: 100))
        XCTAssertEqual(ProgressRingAccessibility.percentText(full), "100%")
    }

    func testCombinedLabelCaptionPlusCenteredText() {
        let input = ProgressRingInput(value: 86, max: 100, label: "Battery", centerLabel: "86", centerSubLabel: "%")
        let resolved = ProgressRingProjection.resolve(input)
        XCTAssertEqual(ProgressRingAccessibility.combinedLabel(input, resolved: resolved), "Battery, 86 %")
    }

    func testCombinedLabelCenteredTextOnly() {
        let input = ProgressRingInput(value: 86, max: 100, centerLabel: "86", centerSubLabel: "%")
        let resolved = ProgressRingProjection.resolve(input)
        XCTAssertEqual(ProgressRingAccessibility.combinedLabel(input, resolved: resolved), "86 %")
    }

    func testCombinedLabelCaptionPlusPercentFallback() {
        let input = ProgressRingInput(value: 75, max: 100, label: "Charge")
        let resolved = ProgressRingProjection.resolve(input)
        XCTAssertEqual(ProgressRingAccessibility.combinedLabel(input, resolved: resolved), "Charge, 75%")
    }

    func testCombinedLabelPercentOnly() {
        let input = ProgressRingInput(value: 75, max: 100)
        let resolved = ProgressRingProjection.resolve(input)
        XCTAssertEqual(ProgressRingAccessibility.combinedLabel(input, resolved: resolved), "75%")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class ProgressRingModelTests: XCTestCase {
    private func makeModel(
        _ input: ProgressRingInput,
        telemetry: ProgressRingTelemetry
    ) -> ProgressRingModel {
        ProgressRingModel(input: input, telemetry: telemetry)
    }

    func testResolvedProjectsInput() {
        let model = makeModel(
            ProgressRingInput(value: 50, max: 100, size: 48, strokeWidth: 4),
            telemetry: SpyProgressRingTelemetry()
        )
        XCTAssertEqual(model.resolved.fillFraction, 0.5, accuracy: 1e-9)
        XCTAssertEqual(model.resolved.radius, 22, accuracy: 1e-9)
    }

    func testAccessibilityLabelComposesFromInput() {
        let model = makeModel(
            ProgressRingInput(value: 86, max: 100, label: "Battery", centerLabel: "86", centerSubLabel: "%"),
            telemetry: SpyProgressRingTelemetry()
        )
        XCTAssertEqual(model.accessibilityLabel, "Battery, 86 %")
    }

    func testSyncAdoptsNewInput() {
        let model = makeModel(ProgressRingInput(value: 10, max: 100), telemetry: SpyProgressRingTelemetry())
        model.sync(ProgressRingInput(value: 80, max: 100))
        XCTAssertEqual(model.input.value, 80, accuracy: 1e-9)
        XCTAssertEqual(model.resolved.fillFraction, 0.8, accuracy: 1e-9)
    }

    func testSyncIsIdempotentForUnchangedInput() {
        let input = ProgressRingInput(value: 10, max: 100)
        let model = makeModel(input, telemetry: SpyProgressRingTelemetry())
        model.sync(input)
        XCTAssertEqual(model.input, input)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyProgressRingTelemetry()
        let model = makeModel(ProgressRingInput(value: 1, max: 100), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ProgressRingMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyProgressRingTelemetry()
        let model = makeModel(ProgressRingInput(value: 1, max: 100), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [ProgressRingMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class ProgressRingViewTests: XCTestCase {
    func testPublicSurfacesCompose() {
        _ = ProgressRing(value: 30)
        _ = ProgressRing(value: 86, size: 120, strokeWidth: 10, centerLabel: "86", centerSubLabel: "%")
        _ = ProgressRing(
            value: 14.2,
            max: 21.5,
            color: Color.TS.statusWarning,
            label: "Energy",
            centerLabel: "14.2",
            centerSubLabel: "kWh"
        )
        _ = ProgressRing(
            input: ProgressRingInput(value: 5, max: 100),
            color: Color.TS.accent,
            telemetry: SpyProgressRingTelemetry()
        )
    }

    func testGaugeComposesPerState() {
        let empty = ProgressRingInput(value: 0, max: 100)
        let full = ProgressRingInput(value: 100, max: 100, centerLabel: "100", centerSubLabel: "%")
        _ = ProgressRingGauge(
            resolved: ProgressRingProjection.resolve(empty),
            input: empty,
            color: Color.TS.accent,
            accessibilityLabel: "0%"
        )
        _ = ProgressRingGauge(
            resolved: ProgressRingProjection.resolve(full),
            input: full,
            color: Color.TS.statusSuccess,
            accessibilityLabel: "100 %"
        )
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyProgressRingTelemetry: ProgressRingTelemetry, @unchecked Sendable {
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
