//
//  AnimatedNumber.Tests.swift
//  TeslaSync — P4 shared surface · 0075 · AnimatedNumber (Apple)
//
//  Coverage for the AnimatedNumber surface:
//    • Projection — the verbatim port of the web tick loop: ease-out-quad boundaries + midpoint, the
//      zero-anchored tween, the duration guard, and the formatted display string at progress 0 / 0.5 /
//      1 (the deterministic per-state "snapshot").
//    • Formatting — the `fmtNumber` parity: non-finite → zero, fraction-digit clamp, locale-aware
//      grouping (en_US vs de_DE), and the prefix / suffix composition.
//    • Meta — the diagnostics slug + the web defaults.
//    • Accessibility — the spoken label equals the settled composed value.
//    • Model — the formatting projection, `sync` adoption + idempotence, the lazy once-only
//      `view.opened` telemetry, and the no-op stop.
//    • Views — the public surface, the roller, the Animatable text, and the animation key compose
//      (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure adapter / projection / model directly. A fixed `Locale` is used so the
//  grouping / decimal assertions are deterministic regardless of the runner's region.
//

import SwiftUI
import XCTest
@testable import TeslaSync

private let usLocale = Locale(identifier: "en_US")
private let deLocale = Locale(identifier: "de_DE")

// MARK: - Projection (easing + tween + duration guard)

final class AnimatedNumberProjectionTests: XCTestCase {
    func testEaseOutQuadBoundaries() {
        XCTAssertEqual(AnimatedNumberProjection.easeOutQuad(0), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.easeOutQuad(1), 1, accuracy: 1e-9)
    }

    func testEaseOutQuadMidpoint() {
        // 1 - (1 - 0.5)^2 = 0.75
        XCTAssertEqual(AnimatedNumberProjection.easeOutQuad(0.5), 0.75, accuracy: 1e-9)
    }

    func testEaseOutQuadClampsOutOfRangeProgress() {
        XCTAssertEqual(AnimatedNumberProjection.easeOutQuad(-2), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.easeOutQuad(5), 1, accuracy: 1e-9)
    }

    func testEaseOutQuadIsMonotonic() {
        var previous = AnimatedNumberProjection.easeOutQuad(0)
        for step in 1 ... 20 {
            let value = AnimatedNumberProjection.easeOutQuad(Double(step) / 20)
            XCTAssertGreaterThanOrEqual(value, previous)
            previous = value
        }
    }

    func testTweenStartsAtZeroAndReachesValue() {
        XCTAssertEqual(AnimatedNumberProjection.tween(to: 250, progress: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.tween(to: 250, progress: 1), 250, accuracy: 1e-9)
    }

    func testTweenMidpointAppliesEasing() {
        // 250 * 0.75 = 187.5
        XCTAssertEqual(AnimatedNumberProjection.tween(to: 250, progress: 0.5), 187.5, accuracy: 1e-9)
    }

    func testClampedDurationGuardsNonPositiveAndNonFinite() {
        XCTAssertEqual(AnimatedNumberProjection.clampedDuration(1.5), 1.5, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.clampedDuration(0), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.clampedDuration(-3), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.clampedDuration(.nan), 0, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberProjection.clampedDuration(.infinity), 0, accuracy: 1e-9)
    }

    func testDisplayStringPerAnimationState() {
        let input = AnimatedNumberInput(value: 100, decimals: 0, locale: usLocale)
        XCTAssertEqual(AnimatedNumberProjection.displayString(for: input, progress: 0), "0")
        XCTAssertEqual(AnimatedNumberProjection.displayString(for: input, progress: 0.5), "75")
        XCTAssertEqual(AnimatedNumberProjection.displayString(for: input, progress: 1), "100")
    }

    func testDisplayStringPerAnimationStateWithAffixes() {
        let input = AnimatedNumberInput(value: 100, decimals: 0, prefix: "$", suffix: "%", locale: usLocale)
        XCTAssertEqual(AnimatedNumberProjection.displayString(for: input, progress: 0), "$0%")
        XCTAssertEqual(AnimatedNumberProjection.displayString(for: input, progress: 1), "$100%")
    }

    func testSettledStringMatchesProgressOne() {
        let input = AnimatedNumberInput(value: 1234.5, decimals: 2, prefix: "$", locale: usLocale)
        XCTAssertEqual(
            AnimatedNumberProjection.settledString(for: input),
            AnimatedNumberProjection.displayString(for: input, progress: 1)
        )
        XCTAssertEqual(AnimatedNumberProjection.resolve(input).text, "$1,234.50")
    }
}

// MARK: - Formatting (web `fmtNumber` parity)

final class AnimatedNumberFormattingTests: XCTestCase {
    func testSafeReplacesNonFiniteWithZero() {
        XCTAssertEqual(AnimatedNumberFormatting.safe(.nan), 0)
        XCTAssertEqual(AnimatedNumberFormatting.safe(.infinity), 0)
        XCTAssertEqual(AnimatedNumberFormatting.safe(-.infinity), 0)
        XCTAssertEqual(AnimatedNumberFormatting.safe(42.5), 42.5)
    }

    func testClampDecimalsToWebPrecisionRange() {
        XCTAssertEqual(AnimatedNumberFormatting.clampDecimals(-5), 0)
        XCTAssertEqual(AnimatedNumberFormatting.clampDecimals(2), 2)
        XCTAssertEqual(AnimatedNumberFormatting.clampDecimals(99), AnimatedNumberMeta.maxFractionDigits)
    }

    func testStringFixedFractionDigits() {
        XCTAssertEqual(AnimatedNumberFormatting.string(1234, decimals: 2, locale: usLocale), "1,234.00")
        XCTAssertEqual(AnimatedNumberFormatting.string(1234, decimals: 0, locale: usLocale), "1,234")
    }

    func testStringRoundsToPrecision() {
        XCTAssertEqual(AnimatedNumberFormatting.string(12345.6, decimals: 0, locale: usLocale), "12,346")
    }

    func testStringNonFiniteRendersZero() {
        XCTAssertEqual(AnimatedNumberFormatting.string(.nan, decimals: 0, locale: usLocale), "0")
    }

    func testStringIsLocaleAware() {
        XCTAssertEqual(AnimatedNumberFormatting.string(1234.5, decimals: 2, locale: usLocale), "1,234.50")
        XCTAssertEqual(AnimatedNumberFormatting.string(1234.5, decimals: 2, locale: deLocale), "1.234,50")
    }

    func testComposedBracketsNumber() {
        XCTAssertEqual(AnimatedNumberFormatting.composed(prefix: nil, number: "5", suffix: nil), "5")
        XCTAssertEqual(AnimatedNumberFormatting.composed(prefix: "$", number: "5", suffix: nil), "$5")
        XCTAssertEqual(AnimatedNumberFormatting.composed(prefix: nil, number: "5", suffix: "%"), "5%")
        XCTAssertEqual(AnimatedNumberFormatting.composed(prefix: "~", number: "5", suffix: " kWh"), "~5 kWh")
    }

    func testDisplayComposesFormattedValue() {
        let input = AnimatedNumberInput(value: 0, decimals: 1, suffix: " kWh", locale: usLocale)
        XCTAssertEqual(AnimatedNumberFormatting.display(input, value: -42.7), "-42.7 kWh")
    }
}

// MARK: - Meta (diagnostics slug + web defaults)

final class AnimatedNumberMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(AnimatedNumberMeta.surfaceSlug, "AnimatedNumber")
        XCTAssertEqual(AnimatedNumber.surfaceSlug, "AnimatedNumber")
    }

    func testWebDefaults() {
        XCTAssertEqual(AnimatedNumberMeta.defaultDuration, 1, accuracy: 1e-9)
        XCTAssertEqual(AnimatedNumberMeta.defaultDecimals, 0)
        XCTAssertEqual(AnimatedNumberMeta.maxFractionDigits, 20)
    }

    func testInputDefaultsMatchWebProps() {
        let input = AnimatedNumberInput(value: 5)
        XCTAssertEqual(input.duration, AnimatedNumberMeta.defaultDuration, accuracy: 1e-9)
        XCTAssertEqual(input.decimals, AnimatedNumberMeta.defaultDecimals)
        XCTAssertNil(input.prefix)
        XCTAssertNil(input.suffix)
    }
}

// MARK: - Accessibility (settled label)

final class AnimatedNumberAccessibilityTests: XCTestCase {
    func testValueLabelEqualsSettledComposedValue() {
        let input = AnimatedNumberInput(value: 86.4, decimals: 1, suffix: "%", locale: usLocale)
        XCTAssertEqual(AnimatedNumberAccessibility.valueLabel(input), "86.4%")
        XCTAssertEqual(
            AnimatedNumberAccessibility.valueLabel(input),
            AnimatedNumberProjection.settledString(for: input)
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class AnimatedNumberModelTests: XCTestCase {
    private func makeModel(
        _ input: AnimatedNumberInput,
        telemetry: AnimatedNumberTelemetry
    ) -> AnimatedNumberModel {
        AnimatedNumberModel(input: input, telemetry: telemetry)
    }

    func testSettledTextProjectsInput() {
        let model = makeModel(
            AnimatedNumberInput(value: 1234.5, decimals: 2, prefix: "$", locale: usLocale),
            telemetry: SpyAnimatedNumberTelemetry()
        )
        XCTAssertEqual(model.settledText, "$1,234.50")
    }

    func testFormatComposesArbitraryFrameValue() {
        let model = makeModel(
            AnimatedNumberInput(value: 100, decimals: 0, suffix: "%", locale: usLocale),
            telemetry: SpyAnimatedNumberTelemetry()
        )
        XCTAssertEqual(model.format(75), "75%")
        XCTAssertEqual(model.format(0), "0%")
    }

    func testSyncAdoptsNewInput() {
        let model = makeModel(
            AnimatedNumberInput(value: 10, locale: usLocale),
            telemetry: SpyAnimatedNumberTelemetry()
        )
        model.sync(AnimatedNumberInput(value: 20, locale: usLocale))
        XCTAssertEqual(model.input.value, 20, accuracy: 1e-9)
        XCTAssertEqual(model.settledText, "20")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyAnimatedNumberTelemetry()
        let model = makeModel(AnimatedNumberInput(value: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [AnimatedNumberMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyAnimatedNumberTelemetry()
        let model = makeModel(AnimatedNumberInput(value: 1, locale: usLocale), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [AnimatedNumberMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class AnimatedNumberViewTests: XCTestCase {
    func testTextComposesAtEveryAnimationState() {
        let format: (Double) -> String = { String(Int($0)) }
        _ = AnimatedNumberText(progress: 0, value: 100, format: format)
        _ = AnimatedNumberText(progress: 0.5, value: 100, format: format)
        _ = AnimatedNumberText(progress: 1, value: 100, format: format)
    }

    func testRollerComposes() {
        _ = AnimatedNumberRoller(value: 100, duration: 1, format: { String($0) })
        _ = AnimatedNumberRoller(value: 100, duration: 0, format: { String($0) })
    }

    func testPublicSurfacesCompose() {
        _ = AnimatedNumber(value: 10247)
        _ = AnimatedNumber(value: 1234.5, duration: 1.2, decimals: 2, prefix: "$")
        _ = AnimatedNumber(value: 86.4, decimals: 1, suffix: "%", locale: usLocale)
        _ = AnimatedNumber(
            input: AnimatedNumberInput(value: 5, locale: usLocale),
            telemetry: SpyAnimatedNumberTelemetry()
        )
    }

    func testAnimationKeyIsHashable() {
        let lhs = AnimatedNumberAnimationKey(value: 100, duration: 1)
        let rhs = AnimatedNumberAnimationKey(value: 100, duration: 1)
        let other = AnimatedNumberAnimationKey(value: 200, duration: 1)
        XCTAssertEqual(lhs, rhs)
        XCTAssertNotEqual(lhs, other)
        XCTAssertEqual(Set([lhs, rhs]).count, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyAnimatedNumberTelemetry: AnimatedNumberTelemetry, @unchecked Sendable {
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
