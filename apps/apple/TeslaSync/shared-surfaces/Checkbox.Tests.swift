//
//  Checkbox.Tests.swift
//  TeslaSync — P4 shared surface · 0204 · Checkbox (Apple)
//
//  Coverage for the Checkbox surface's resolved view-state, state-holder, and views:
//    • Projection — the deterministic per-input "snapshot": the controlled / uncontrolled checked
//      resolution, the glyph (check / minus / none, mixed wins), the accent-active flag, the disabled
//      flag, the labelled / nil-label branches, the size + identifier passthrough, and the accessible
//      name + checked value routed through the injected i18n facade.
//    • Model — initial seeding from `defaultChecked`, the controlled value source, the `setChecked`
//      commit (onChange, idempotent for an unchanged value), the uncontrolled `toggle` flip, the
//      controlled toggle routing to onChange WITHOUT mutating the local flag, the disabled guard,
//      `sync` adoption + idempotence + the initial-only `defaultChecked` that never reseeds, and the
//      once-only `view.opened` telemetry.
//    • Views — the public surface (all three initializers) + subviews compose (signature contract).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so each
//  assertion reads the pure projection / model directly. The pure meta / size / accessibility coverage
//  lives in Checkbox.AdapterTests.swift.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

/// A resolver that echoes the key so key-routing can be asserted deterministically.
private let echoStrings: CheckboxResolve = { key, _ in "[\(key)]" }

private func input(
    isControlled: Bool = false,
    controlledChecked: Bool = false,
    defaultChecked: Bool = false,
    isIndeterminate: Bool = false,
    isDisabled: Bool = false,
    label: String? = "Sentry mode",
    size: CheckboxSize = .medium,
    identifier: String = "checkbox-fixed"
) -> CheckboxInput {
    CheckboxInput(
        isControlled: isControlled,
        controlledChecked: controlledChecked,
        defaultChecked: defaultChecked,
        isIndeterminate: isIndeterminate,
        isDisabled: isDisabled,
        label: label,
        size: size,
        identifier: identifier
    )
}

// MARK: - Projection (deterministic per-input snapshot + pure derivations)

final class CheckboxProjectionTests: XCTestCase {
    func testResolvedCheckedUncontrolledUsesLocalFlag() {
        let snap = input(isControlled: false)
        XCTAssertTrue(CheckboxProjection.resolvedChecked(input: snap, internalChecked: true))
        XCTAssertFalse(CheckboxProjection.resolvedChecked(input: snap, internalChecked: false))
    }

    func testResolvedCheckedControlledUsesPropAndIgnoresLocalFlag() {
        let on = input(isControlled: true, controlledChecked: true)
        XCTAssertTrue(CheckboxProjection.resolvedChecked(input: on, internalChecked: false))
        let off = input(isControlled: true, controlledChecked: false)
        XCTAssertFalse(CheckboxProjection.resolvedChecked(input: off, internalChecked: true))
    }

    func testGlyphMixedWinsThenCheckedThenNone() {
        XCTAssertEqual(CheckboxProjection.glyph(isChecked: true, isIndeterminate: true), .minus)
        XCTAssertEqual(CheckboxProjection.glyph(isChecked: false, isIndeterminate: true), .minus)
        XCTAssertEqual(CheckboxProjection.glyph(isChecked: true, isIndeterminate: false), .check)
        XCTAssertEqual(CheckboxProjection.glyph(isChecked: false, isIndeterminate: false), .none)
    }

    func testIsActiveWhenCheckedOrIndeterminate() {
        XCTAssertTrue(CheckboxProjection.isActive(isChecked: true, isIndeterminate: false))
        XCTAssertTrue(CheckboxProjection.isActive(isChecked: false, isIndeterminate: true))
        XCTAssertTrue(CheckboxProjection.isActive(isChecked: true, isIndeterminate: true))
        XCTAssertFalse(CheckboxProjection.isActive(isChecked: false, isIndeterminate: false))
    }

    func testNextCheckedInverts() {
        XCTAssertTrue(CheckboxProjection.nextChecked(current: false))
        XCTAssertFalse(CheckboxProjection.nextChecked(current: true))
    }

    func testResolveUncheckedBranch() {
        let resolved = CheckboxProjection.resolve(
            input: input(label: "Sentry mode"),
            internalChecked: false,
            strings: echoStrings
        )
        XCTAssertFalse(resolved.isChecked)
        XCTAssertFalse(resolved.isActive)
        XCTAssertEqual(resolved.glyph, .none)
        XCTAssertEqual(resolved.labelText, "Sentry mode")
        XCTAssertTrue(resolved.hasLabel)
        XCTAssertEqual(resolved.accessibilityLabel, "Sentry mode")
        XCTAssertEqual(resolved.accessibilityValue, "[checkbox.accessibility.unchecked]")
        XCTAssertEqual(resolved.accessibilityIdentifier, "checkbox-fixed")
    }

    func testResolveCheckedBranch() {
        let resolved = CheckboxProjection.resolve(
            input: input(),
            internalChecked: true,
            strings: echoStrings
        )
        XCTAssertTrue(resolved.isChecked)
        XCTAssertTrue(resolved.isActive)
        XCTAssertEqual(resolved.glyph, .check)
        XCTAssertEqual(resolved.accessibilityValue, "[checkbox.accessibility.checked]")
    }

    func testResolveIndeterminateBranch() {
        let resolved = CheckboxProjection.resolve(
            input: input(isIndeterminate: true),
            internalChecked: false,
            strings: echoStrings
        )
        XCTAssertTrue(resolved.isIndeterminate)
        XCTAssertTrue(resolved.isActive)
        XCTAssertEqual(resolved.glyph, .minus)
        XCTAssertEqual(resolved.accessibilityValue, "[checkbox.accessibility.mixed]")
    }

    func testResolveDisabledFlows() {
        let resolved = CheckboxProjection.resolve(input: input(isDisabled: true), internalChecked: false)
        XCTAssertTrue(resolved.isDisabled)
    }

    func testResolveNilLabelOmitsRowAndUsesFallbackName() {
        let resolved = CheckboxProjection.resolve(
            input: input(label: nil),
            internalChecked: false,
            strings: echoStrings
        )
        XCTAssertNil(resolved.labelText)
        XCTAssertFalse(resolved.hasLabel)
        XCTAssertEqual(resolved.accessibilityLabel, "[checkbox.accessibility.unlabeled]")
    }

    func testResolveSizeAndControlledCheckedPassThrough() {
        let resolved = CheckboxProjection.resolve(
            input: input(isControlled: true, controlledChecked: true, size: .large),
            internalChecked: false
        )
        XCTAssertEqual(resolved.size, .large)
        XCTAssertTrue(resolved.isChecked, "controlled value wins over the local flag")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class CheckboxModelTests: XCTestCase {
    func testInitSeedsInternalCheckedFromDefaultChecked() {
        XCTAssertTrue(CheckboxModel(input: input(defaultChecked: true), telemetry: spy()).internalChecked)
        XCTAssertFalse(CheckboxModel(input: input(defaultChecked: false), telemetry: spy()).internalChecked)
    }

    func testControlledInitResolvesFromPropNotLocalFlag() {
        let model = CheckboxModel(
            input: input(isControlled: true, controlledChecked: true, defaultChecked: false),
            telemetry: spy()
        )
        XCTAssertTrue(model.isChecked)
        XCTAssertFalse(model.internalChecked)
    }

    func testSetCheckedUncontrolledCommitsAndForwards() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(defaultChecked: false),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.setChecked(true)
        XCTAssertTrue(model.isChecked)
        XCTAssertTrue(model.internalChecked)
        XCTAssertEqual(box.values, [true])
    }

    func testSetCheckedIsIdempotentForUnchangedValue() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(defaultChecked: false),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.setChecked(false)
        XCTAssertTrue(box.values.isEmpty)
    }

    func testToggleUncontrolledFlipsAndForwards() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(defaultChecked: false),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.toggle()
        model.toggle()
        XCTAssertEqual(box.values, [true, false])
        XCTAssertFalse(model.isChecked)
        XCTAssertFalse(model.internalChecked)
    }

    func testControlledToggleRoutesToOnChangeWithoutMutatingLocalFlag() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(isControlled: true, controlledChecked: false),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.toggle()
        XCTAssertEqual(box.values, [true], "web onChange(!checked) routes out; the parent owns the value")
        XCTAssertFalse(model.internalChecked, "controlled mode never mutates the local flag")
        XCTAssertFalse(model.isChecked, "the value stays until the parent re-renders with a new checked")
    }

    func testDisabledGuardsSetCheckedAndToggle() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(defaultChecked: false, isDisabled: true),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.toggle()
        model.setChecked(true)
        XCTAssertTrue(box.values.isEmpty, "web `if (disabled) return` — no change is committed")
        XCTAssertFalse(model.internalChecked)
        XCTAssertFalse(model.isChecked)
    }

    func testSyncAdoptsControlledValueAndIndeterminate() {
        let model = CheckboxModel(
            input: input(isControlled: true, controlledChecked: false, isIndeterminate: false),
            telemetry: spy()
        )
        XCTAssertFalse(model.isChecked)
        model.sync(input(isControlled: true, controlledChecked: true, isIndeterminate: true))
        XCTAssertTrue(model.isChecked)
        XCTAssertTrue(model.isIndeterminate)
        XCTAssertEqual(model.resolved.glyph, .minus)
    }

    func testSyncIsIdempotentForUnchangedSnapshot() {
        let box = BoolBox()
        let model = CheckboxModel(
            input: input(defaultChecked: true),
            onChange: { box.values.append($0) },
            telemetry: spy()
        )
        model.sync(input(defaultChecked: true))
        XCTAssertTrue(model.internalChecked)
        XCTAssertTrue(box.values.isEmpty)
    }

    func testSyncDoesNotReseedLocalFlagFromDefaultChecked() {
        // defaultChecked is initial-only (web DOM defaultChecked): once toggled, a re-render with a
        // changed sibling prop must not reopen the box to its default.
        let model = CheckboxModel(input: input(defaultChecked: true), telemetry: spy())
        XCTAssertTrue(model.internalChecked)
        model.toggle()
        XCTAssertFalse(model.internalChecked)
        model.sync(input(defaultChecked: true, label: "Changed label"))
        XCTAssertFalse(model.internalChecked, "a re-render with defaultChecked=true does not re-check")
        XCTAssertEqual(model.resolved.labelText, "Changed label")
    }

    func testStartEmitsViewOpenedOnce() {
        let telemetry = spy()
        let model = CheckboxModel(input: input(), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [CheckboxMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotEmit() {
        let telemetry = spy()
        let model = CheckboxModel(input: input(), telemetry: telemetry)
        model.start()
        model.stop()
        model.stop()
        XCTAssertEqual(telemetry.surfaces, [CheckboxMeta.surfaceSlug])
    }

    private func spy() -> SpyCheckboxTelemetry {
        SpyCheckboxTelemetry()
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class CheckboxViewTests: XCTestCase {
    func testPublicSurfaceComposes() {
        _ = Checkbox(isChecked: true, label: "Sentry mode", onChange: { _ in })
        _ = Checkbox(
            isChecked: false,
            indeterminate: true,
            label: "Select all",
            size: .large,
            isDisabled: true,
            id: "checkbox-x",
            telemetry: SpyCheckboxTelemetry(),
            onChange: { _ in }
        )
        _ = Checkbox(defaultChecked: true, label: "Uncontrolled", size: .small, onChange: { _ in })
        _ = Checkbox(isChecked: .constant(true), label: "Bound")
        _ = Checkbox(isChecked: .constant(false))
        XCTAssertEqual(Checkbox.surfaceSlug, "Checkbox")
    }

    func testSubviewsCompose() {
        let resolved = CheckboxProjection.resolve(
            input: input(isIndeterminate: true, label: "Sentry mode"),
            internalChecked: true
        )
        _ = CheckboxRow(resolved: resolved, reduceMotion: false)
        _ = CheckboxIndicator(resolved: resolved, reduceMotion: true)
        _ = CheckboxLabel(text: resolved.labelText ?? "")
    }
}

// MARK: - Strings facade (P1/S10)

final class CheckboxStringsTests: XCTestCase {
    func testFacadeFallbacksResolve() {
        XCTAssertEqual(CheckboxStrings.string("checkbox.accessibility.unlabeled", "Checkbox"), "Checkbox")
        XCTAssertEqual(CheckboxStrings.string("checkbox.accessibility.checked", "Checked"), "Checked")
        XCTAssertEqual(
            CheckboxStrings.string("checkbox.accessibility.unchecked", "Not checked"),
            "Not checked"
        )
        XCTAssertEqual(CheckboxStrings.string("checkbox.accessibility.mixed", "Mixed"), "Mixed")
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
private final class SpyCheckboxTelemetry: CheckboxTelemetry, @unchecked Sendable {
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
