//
//  Slider.Tests.swift
//  TeslaSync — P4 shared surface · 0226 · Slider (Apple)
//
//  Coverage for the Slider surface's resolved view-state, state-holder, and views:
//    • Projection — the deterministic per-input "snapshot": the labelled value branch (custom +
//      default formatter), the clamp/snap normalisation, the out-of-range value, the showLabel = false
//      branch (accessible name preserved), the disabled flag, the degenerate range widening, the
//      identifier passthrough, and the localized hint routing through the injected i18n facade.
//    • Model — initial sanitisation, the `setValue` commit (snap + clamp + onChange, idempotent for
//      an unchanged value), the keyboard `apply` transitions, `sync` adoption + idempotence, and the
//      once-only `view.opened` telemetry.
//    • Views — the public surface + subviews compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model directly. The pure numeric / formatting / meta coverage
//  lives in Slider.AdapterTests.swift.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: SliderResolve = { key, _ in "[\(key)]" }

private let percent: @Sendable (Double) -> String = { "\(Int($0))%" }

private func input(
    value: Double = 32,
    minimum: Double = 0,
    maximum: Double = 100,
    step: Double = 1,
    label: String = "Brightness",
    showLabel: Bool = true,
    isDisabled: Bool = false,
    identifier: String = "slider-fixed"
) -> SliderInput {
    SliderInput(
        value: value,
        minimum: minimum,
        maximum: maximum,
        step: step,
        label: label,
        showLabel: showLabel,
        isDisabled: isDisabled,
        identifier: identifier
    )
}

// MARK: - Projection (deterministic per-input snapshot)

final class SliderProjectionTests: XCTestCase {
    func testLabelledValueBranchWithCustomFormatter() {
        let resolved = SliderProjection.resolve(input(value: 32), format: percent)
        XCTAssertEqual(resolved.value, 32)
        XCTAssertEqual(resolved.displayText, "32%")
        XCTAssertEqual(resolved.labelText, "Brightness")
        XCTAssertTrue(resolved.showLabel)
        XCTAssertFalse(resolved.isDisabled)
        XCTAssertEqual(resolved.accessibilityLabel, "Brightness")
        XCTAssertEqual(resolved.accessibilityValue, "32%")
        XCTAssertEqual(resolved.controlLowerBound, 0)
        XCTAssertEqual(resolved.controlUpperBound, 100)
    }

    func testDefaultFormatterUsesStringValue() {
        let resolved = SliderProjection.resolve(input(value: 32))
        XCTAssertEqual(resolved.displayText, "32")
        XCTAssertEqual(resolved.accessibilityValue, "32")
    }

    func testValueIsSnappedToStep() {
        let resolved = SliderProjection.resolve(input(value: 7, step: 5))
        XCTAssertEqual(resolved.value, 5)
        XCTAssertEqual(resolved.displayText, "5")
    }

    func testValueOutOfRangeIsClamped() {
        XCTAssertEqual(SliderProjection.resolve(input(value: 150)).value, 100)
        XCTAssertEqual(SliderProjection.resolve(input(value: -20)).value, 0)
    }

    func testShowLabelFalseKeepsAccessibleName() {
        let resolved = SliderProjection.resolve(input(showLabel: false), format: percent)
        XCTAssertFalse(resolved.showLabel)
        XCTAssertEqual(resolved.accessibilityLabel, "Brightness")
    }

    func testDisabledFlagCarried() {
        XCTAssertTrue(SliderProjection.resolve(input(isDisabled: true)).isDisabled)
    }

    func testDegenerateRangeWidensControlUpperBound() {
        let resolved = SliderProjection.resolve(input(value: 5, minimum: 5, maximum: 5, step: 1))
        XCTAssertEqual(resolved.value, 5)
        XCTAssertEqual(resolved.maximum, 5)
        XCTAssertEqual(resolved.controlLowerBound, 5)
        XCTAssertEqual(resolved.controlUpperBound, 6)
    }

    func testIdentifierPassesThrough() {
        XCTAssertEqual(SliderProjection.resolve(input(identifier: "slider-abc")).accessibilityIdentifier, "slider-abc")
    }

    func testHintRoutesThroughInjectedStrings() {
        XCTAssertEqual(
            SliderProjection.resolve(input(), strings: echoStrings).accessibilityHint,
            "[slider.accessibility.hint]"
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class SliderModelTests: XCTestCase {
    func testInitSanitizesValue() {
        let model = SliderModel(input: input(value: 7, step: 5), telemetry: SpySliderTelemetry())
        XCTAssertEqual(model.value, 5)
        XCTAssertEqual(model.resolved.value, 5)
    }

    func testSetValueCommitsAndForwardsOnChange() {
        let box = ValueBox()
        let model = SliderModel(
            input: input(value: 50, step: 5),
            onChange: { box.values.append($0) },
            telemetry: SpySliderTelemetry()
        )
        model.setValue(55)
        XCTAssertEqual(model.value, 55)
        XCTAssertEqual(model.resolved.displayText, "55")
        XCTAssertEqual(box.values, [55])
    }

    func testSetValueSnapsBeforeForwarding() {
        let box = ValueBox()
        let model = SliderModel(
            input: input(value: 50, step: 5),
            onChange: { box.values.append($0) },
            telemetry: SpySliderTelemetry()
        )
        model.setValue(53) // snaps to 55
        XCTAssertEqual(box.values, [55])
    }

    func testSetValueIsIdempotentForUnchangedValue() {
        let box = ValueBox()
        let model = SliderModel(
            input: input(value: 50, step: 5),
            onChange: { box.values.append($0) },
            telemetry: SpySliderTelemetry()
        )
        model.setValue(50)
        model.setValue(52) // snaps back to 50 — unchanged
        XCTAssertTrue(box.values.isEmpty)
    }

    func testApplyServicesKeyboardCommands() {
        let box = ValueBox()
        let model = SliderModel(
            input: input(value: 50, step: 5),
            onChange: { box.values.append($0) },
            telemetry: SpySliderTelemetry()
        )
        model.apply(.stepUp)
        model.apply(.pageUp)
        model.apply(.toMaximum)
        model.apply(.toMinimum)
        XCTAssertEqual(box.values, [55, 65, 100, 0])
        XCTAssertEqual(model.value, 0)
    }

    func testSyncAdoptsNewInput() {
        let model = SliderModel(input: input(value: 50, step: 5), telemetry: SpySliderTelemetry())
        model.sync(input(value: 20, step: 5))
        XCTAssertEqual(model.value, 20)
        XCTAssertEqual(model.resolved.value, 20)
    }

    func testSyncIsIdempotent() {
        let box = ValueBox()
        let model = SliderModel(
            input: input(value: 50, step: 5),
            onChange: { box.values.append($0) },
            telemetry: SpySliderTelemetry()
        )
        model.sync(input(value: 50, step: 5))
        XCTAssertEqual(model.value, 50)
        XCTAssertTrue(box.values.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpySliderTelemetry()
        let model = SliderModel(input: input(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SliderMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpySliderTelemetry()
        let model = SliderModel(input: input(), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [SliderMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class SliderViewTests: XCTestCase {
    func testPublicSurfaceComposes() {
        _ = SliderField(value: 32, minimum: 0, maximum: 100, label: "Brightness", onChange: { _ in })
        _ = SliderField(
            value: 32,
            minimum: 0,
            maximum: 100,
            step: 5,
            label: "Brightness",
            format: percent,
            showLabel: false,
            isDisabled: true,
            id: "slider-x",
            telemetry: SpySliderTelemetry(),
            onChange: { _ in }
        )
        _ = SliderField(value: .constant(32), minimum: 0, maximum: 100, label: "Brightness")
    }

    func testSubviewsCompose() {
        let resolved = SliderProjection.resolve(input(value: 32), format: percent)
        _ = SliderLabelRow(labelText: resolved.labelText, displayText: resolved.displayText)
        _ = SliderTrackView(resolved: resolved, value: .constant(32), onCommand: { _ in })
    }
}

// MARK: - Test doubles

/// A main-actor box that records the values forwarded through `onChange`.
@MainActor
private final class ValueBox {
    var values: [Double] = []
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpySliderTelemetry: SliderTelemetry, @unchecked Sendable {
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
