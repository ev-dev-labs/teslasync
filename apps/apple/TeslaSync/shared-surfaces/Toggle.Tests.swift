//
//  Toggle.Tests.swift
//  TeslaSync — P4 shared surface · 0230 · Toggle (Apple)
//
//  Coverage for the Toggle surface's resolved view-state, state-holder, and views:
//    • Projection — the deterministic per-input "snapshot": the on / off state, the labelled branch,
//      the empty / nil label branch (no label row, fallback accessible name), the size passthrough,
//      the identifier passthrough, and the unlabeled name routing through the injected i18n facade.
//    • Model — initial state, the `setOn` commit (onChange, idempotent for an unchanged state), the
//      `toggle` flip, `sync` adoption + idempotence, and the once-only `view.opened` telemetry.
//    • Views — the public surface + subviews compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model directly. The pure meta / size / accessibility coverage
//  lives in Toggle.AdapterTests.swift.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: ToggleResolve = { key, _ in "[\(key)]" }

private func input(
    isOn: Bool = false,
    label: String? = "Sentry mode",
    size: ToggleSize = .medium,
    identifier: String = "toggle-fixed"
) -> ToggleInput {
    ToggleInput(isOn: isOn, label: label, size: size, identifier: identifier)
}

// MARK: - Projection (deterministic per-input snapshot)

final class ToggleProjectionTests: XCTestCase {
    func testOnStateLabelledBranch() {
        let resolved = ToggleProjection.resolve(input(isOn: true, label: "Sentry mode"))
        XCTAssertTrue(resolved.isOn)
        XCTAssertEqual(resolved.labelText, "Sentry mode")
        XCTAssertTrue(resolved.hasLabel)
        XCTAssertEqual(resolved.accessibilityLabel, "Sentry mode")
        XCTAssertEqual(resolved.size, .medium)
    }

    func testOffStateCarried() {
        XCTAssertFalse(ToggleProjection.resolve(input(isOn: false)).isOn)
    }

    func testNilLabelOmitsRowAndUsesFallbackName() {
        let resolved = ToggleProjection.resolve(input(label: nil), strings: echoStrings)
        XCTAssertNil(resolved.labelText)
        XCTAssertFalse(resolved.hasLabel)
        XCTAssertEqual(resolved.accessibilityLabel, "[toggle.accessibility.unlabeled]")
    }

    func testEmptyLabelOmitsRowAndUsesFallbackName() {
        let resolved = ToggleProjection.resolve(input(label: ""), strings: echoStrings)
        XCTAssertNil(resolved.labelText)
        XCTAssertEqual(resolved.accessibilityLabel, "[toggle.accessibility.unlabeled]")
    }

    func testSizePassesThrough() {
        XCTAssertEqual(ToggleProjection.resolve(input(size: .small)).size, .small)
        XCTAssertEqual(ToggleProjection.resolve(input(size: .medium)).size, .medium)
    }

    func testIdentifierPassesThrough() {
        XCTAssertEqual(
            ToggleProjection.resolve(input(identifier: "toggle-abc")).accessibilityIdentifier,
            "toggle-abc"
        )
    }
}

// MARK: - Model (state-holder)

@MainActor
final class ToggleModelTests: XCTestCase {
    func testInitAdoptsState() {
        let model = ToggleModel(input: input(isOn: true), telemetry: SpyToggleTelemetry())
        XCTAssertTrue(model.isOn)
        XCTAssertTrue(model.resolved.isOn)
    }

    func testSetOnCommitsAndForwardsOnChange() {
        let box = BoolBox()
        let model = ToggleModel(
            input: input(isOn: false),
            onChange: { box.values.append($0) },
            telemetry: SpyToggleTelemetry()
        )
        model.setOn(true)
        XCTAssertTrue(model.isOn)
        XCTAssertTrue(model.resolved.isOn)
        XCTAssertEqual(box.values, [true])
    }

    func testSetOnIsIdempotentForUnchangedState() {
        let box = BoolBox()
        let model = ToggleModel(
            input: input(isOn: false),
            onChange: { box.values.append($0) },
            telemetry: SpyToggleTelemetry()
        )
        model.setOn(false)
        XCTAssertTrue(box.values.isEmpty)
    }

    func testToggleFlipsAndForwards() {
        let box = BoolBox()
        let model = ToggleModel(
            input: input(isOn: false),
            onChange: { box.values.append($0) },
            telemetry: SpyToggleTelemetry()
        )
        model.toggle()
        model.toggle()
        XCTAssertEqual(box.values, [true, false])
        XCTAssertFalse(model.isOn)
    }

    func testSyncAdoptsNewInput() {
        let model = ToggleModel(input: input(isOn: false, label: "A"), telemetry: SpyToggleTelemetry())
        model.sync(input(isOn: true, label: "B"))
        XCTAssertTrue(model.isOn)
        XCTAssertEqual(model.resolved.labelText, "B")
    }

    func testSyncIsIdempotent() {
        let box = BoolBox()
        let model = ToggleModel(
            input: input(isOn: true),
            onChange: { box.values.append($0) },
            telemetry: SpyToggleTelemetry()
        )
        model.sync(input(isOn: true))
        XCTAssertTrue(model.isOn)
        XCTAssertTrue(box.values.isEmpty)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyToggleTelemetry()
        let model = ToggleModel(input: input(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [ToggleMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let spy = SpyToggleTelemetry()
        let model = ToggleModel(input: input(), telemetry: spy)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(spy.surfaces, [ToggleMeta.surfaceSlug])
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class ToggleViewTests: XCTestCase {
    func testPublicSurfaceComposes() {
        _ = ToggleSwitch(isOn: true, label: "Sentry mode", onChange: { _ in })
        _ = ToggleSwitch(
            isOn: false,
            label: "Compact",
            size: .small,
            id: "toggle-x",
            telemetry: SpyToggleTelemetry(),
            onChange: { _ in }
        )
        _ = ToggleSwitch(isOn: .constant(true), label: "Bound")
        _ = ToggleSwitch(isOn: .constant(false))
    }

    func testSubviewsCompose() {
        let resolved = ToggleProjection.resolve(input(isOn: true, label: "Sentry mode"))
        _ = ToggleSwitchControl(resolved: resolved, isOn: .constant(true))
        _ = ToggleLabel(text: resolved.labelText ?? "") {}
    }
}

// MARK: - Test doubles

/// A main-actor box that records the values forwarded through `onChange`.
@MainActor
private final class BoolBox {
    var values: [Bool] = []
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyToggleTelemetry: ToggleTelemetry, @unchecked Sendable {
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
