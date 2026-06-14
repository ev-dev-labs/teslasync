//
//  Input.Tests.swift
//  TeslaSync — P4 shared surface · 0217 · Input (Apple)
//
//  Coverage for the Input surface's resolved view-state, state-holder, and views:
//    • Projection — the deterministic per-input "snapshot": the empty-string normalization (web
//      truthiness), the optional label / help / icon / suffix presence, the error branch (invalid +
//      error border + message that suppresses the hint), the hint branch, the mutually-exclusive
//      describedby target (web `aria-describedby`), the child element ids, the size / secure /
//      disabled passthrough, and the accessible name + hint routed through the injected i18n facade.
//    • Model — the projection on init, `sync` adoption + idempotence, `isInvalid`, and the once-only
//      `view.opened` telemetry.
//    • Views — the public surface (both initializers, the icon / suffix regions) + the subviews
//      compose (signature contract).
//    • Strings — the a11y copy resolves through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and no real store, so each
//  assertion reads the pure projection / model directly. The pure meta / size / accessibility coverage
//  lives in Input.AdapterTests.swift.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private func input(
    identifier: String = "charge-limit",
    label: String? = "Charge limit",
    helpText: String? = nil,
    helpFieldName: String = "charge-limit",
    placeholder: String? = nil,
    error: String? = nil,
    hint: String? = nil,
    hasIcon: Bool = false,
    hasSuffix: Bool = false,
    size: InputFieldSize = .medium,
    isRequired: Bool = false,
    isDisabled: Bool = false,
    isSecure: Bool = false
) -> InputFieldInput {
    InputFieldInput(
        identifier: identifier,
        label: label,
        helpText: helpText,
        helpFieldName: helpFieldName,
        placeholder: placeholder,
        error: error,
        hint: hint,
        hasIcon: hasIcon,
        hasSuffix: hasSuffix,
        size: size,
        isRequired: isRequired,
        isDisabled: isDisabled,
        isSecure: isSecure
    )
}

// MARK: - Projection (deterministic per-input snapshot + pure derivations)

final class InputFieldProjectionTests: XCTestCase {
    func testNonEmptyNormalizesBlankToNil() {
        XCTAssertNil(InputFieldProjection.nonEmpty(nil))
        XCTAssertNil(InputFieldProjection.nonEmpty(""))
        XCTAssertEqual(InputFieldProjection.nonEmpty("hi"), "hi")
    }

    func testResolveDefaultBranch() {
        let resolved = InputFieldProjection.resolve(input: input(label: nil), strings: InputFieldStrings.string)
        XCTAssertNil(resolved.labelText)
        XCTAssertFalse(resolved.showsLabel)
        XCTAssertFalse(resolved.showsHelp)
        XCTAssertFalse(resolved.showsError)
        XCTAssertFalse(resolved.showsHint)
        XCTAssertFalse(resolved.isInvalid)
        XCTAssertFalse(resolved.hasLeadingIcon)
        XCTAssertFalse(resolved.hasTrailingSuffix)
        XCTAssertNil(resolved.accessibilityDescribedByID)
        XCTAssertNil(resolved.accessibilityHint)
        XCTAssertEqual(resolved.accessibilityLabel, "Input field")
    }

    func testResolveLabeledRequiredAndHelp() {
        let resolved = InputFieldProjection.resolve(
            input: input(helpText: "Stops charging here.", isRequired: true),
            strings: InputFieldStrings.string
        )
        XCTAssertEqual(resolved.labelText, "Charge limit")
        XCTAssertTrue(resolved.showsLabel)
        XCTAssertTrue(resolved.isRequired)
        XCTAssertEqual(resolved.helpText, "Stops charging here.")
        XCTAssertTrue(resolved.showsHelp)
        XCTAssertEqual(resolved.helpAccessibilityLabel, "Help for charge-limit")
        XCTAssertEqual(resolved.accessibilityLabel, "Charge limit required")
    }

    func testResolveIconAndSuffixPresence() {
        let resolved = InputFieldProjection.resolve(input: input(hasIcon: true, hasSuffix: true))
        XCTAssertTrue(resolved.hasLeadingIcon)
        XCTAssertTrue(resolved.hasTrailingSuffix)
    }

    func testResolveErrorBranchSuppressesHintAndMarksInvalid() {
        let resolved = InputFieldProjection.resolve(
            input: input(error: "Too low", hint: "Between 50 and 100"),
            strings: InputFieldStrings.string
        )
        XCTAssertEqual(resolved.errorText, "Too low")
        XCTAssertTrue(resolved.showsError)
        XCTAssertTrue(resolved.isInvalid)
        XCTAssertTrue(resolved.borderIsError)
        XCTAssertNil(resolved.hintText, "web `{hint && !error}` — the error suppresses the hint")
        XCTAssertFalse(resolved.showsHint)
        XCTAssertEqual(resolved.accessibilityDescribedByID, "charge-limit-error")
        XCTAssertEqual(resolved.accessibilityHint, "Error: Too low")
    }

    func testResolveHintBranch() {
        let resolved = InputFieldProjection.resolve(
            input: input(hint: "Between 50 and 100"),
            strings: InputFieldStrings.string
        )
        XCTAssertEqual(resolved.hintText, "Between 50 and 100")
        XCTAssertTrue(resolved.showsHint)
        XCTAssertFalse(resolved.isInvalid)
        XCTAssertFalse(resolved.borderIsError)
        XCTAssertEqual(resolved.accessibilityDescribedByID, "charge-limit-hint")
        XCTAssertEqual(resolved.accessibilityHint, "Between 50 and 100")
    }

    func testResolveNormalizesEmptyStrings() {
        let resolved = InputFieldProjection.resolve(
            input: input(label: "", helpText: "", placeholder: "", error: "", hint: ""),
            strings: InputFieldStrings.string
        )
        XCTAssertNil(resolved.labelText)
        XCTAssertNil(resolved.helpText)
        XCTAssertNil(resolved.placeholder)
        XCTAssertNil(resolved.errorText)
        XCTAssertNil(resolved.hintText)
        XCTAssertEqual(resolved.accessibilityLabel, "Input field")
    }

    func testResolveElementIDs() {
        let resolved = InputFieldProjection.resolve(input: input(identifier: "vin"))
        XCTAssertEqual(resolved.identifier, "vin")
        XCTAssertEqual(resolved.errorElementID, "vin-error")
        XCTAssertEqual(resolved.hintElementID, "vin-hint")
        XCTAssertEqual(resolved.helpElementID, "vin-help")
    }

    func testResolveSizeSecureDisabledPassThrough() {
        let resolved = InputFieldProjection.resolve(
            input: input(size: .large, isDisabled: true, isSecure: true)
        )
        XCTAssertEqual(resolved.size, .large)
        XCTAssertEqual(resolved.metrics.fontPointSize, 16, accuracy: 0.0001)
        XCTAssertTrue(resolved.isDisabled)
        XCTAssertTrue(resolved.isSecure)
    }

    func testResolvePlaceholderBecomesNameWhenUnlabeled() {
        let resolved = InputFieldProjection.resolve(
            input: input(label: nil, placeholder: "Search vehicles"),
            strings: InputFieldStrings.string
        )
        XCTAssertEqual(resolved.placeholder, "Search vehicles")
        XCTAssertEqual(resolved.accessibilityLabel, "Search vehicles")
    }
}

// MARK: - Model (state-holder)

@MainActor
final class InputFieldModelTests: XCTestCase {
    func testInitResolvesProjection() {
        let model = InputFieldModel(input: input(error: "Bad"), telemetry: spy())
        XCTAssertTrue(model.isInvalid)
        XCTAssertEqual(model.resolved.errorText, "Bad")
        XCTAssertEqual(model.input.identifier, "charge-limit")
    }

    func testSyncAdoptsNewInput() {
        let model = InputFieldModel(input: input(), telemetry: spy())
        XCTAssertFalse(model.isInvalid)
        model.sync(input(error: "Now invalid", hint: "ignored"))
        XCTAssertTrue(model.isInvalid)
        XCTAssertEqual(model.resolved.errorText, "Now invalid")
        XCTAssertNil(model.resolved.hintText, "the error suppresses the hint after sync")
    }

    func testSyncIsIdempotentForUnchangedSnapshot() {
        let model = InputFieldModel(input: input(label: "Stable"), telemetry: spy())
        model.sync(input(label: "Stable"))
        XCTAssertEqual(model.resolved.labelText, "Stable")
    }

    func testStartEmitsViewOpenedOnce() {
        let telemetry = spy()
        let model = InputFieldModel(input: input(), telemetry: telemetry)
        model.start()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [InputFieldMeta.surfaceSlug])
    }

    func testStopIsSafeAndDoesNotReEmit() {
        let telemetry = spy()
        let model = InputFieldModel(input: input(), telemetry: telemetry)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.surfaces, [InputFieldMeta.surfaceSlug])
    }

    private func spy() -> SpyInputFieldTelemetry {
        SpyInputFieldTelemetry()
    }
}

// MARK: - Views (every form composes — signature contract)

@MainActor
final class InputFieldViewTests: XCTestCase {
    func testPublicSurfaceComposes() {
        _ = InputField(text: .constant(""), label: "Charge limit", placeholder: "80")
        _ = InputField(
            text: .constant("x"),
            label: "Label",
            help: "Help",
            helpFor: "field",
            placeholder: "ph",
            error: "Error",
            hint: "Hint",
            size: .large,
            isRequired: true,
            isDisabled: true,
            isSecure: true,
            id: "explicit-id",
            telemetry: SpyInputFieldTelemetry()
        )
        _ = InputField(text: .constant(""), label: "Find", icon: { Image(systemName: "magnifyingglass") })
        _ = InputField(text: .constant(""), label: "Range", suffix: { Text(verbatim: "km") })
        XCTAssertEqual(InputField<EmptyView, EmptyView>.surfaceSlug, "Input")
    }

    func testSurfaceComposesFromInjectedModel() {
        let model = InputFieldModel(input: input(label: "Injected"), telemetry: SpyInputFieldTelemetry())
        _ = InputField(text: .constant(""), model: model)
    }

    func testSubviewsCompose() {
        let resolved = InputFieldProjection.resolve(input: input(helpText: "Help", error: "Bad", hasIcon: true))
        _ = InputFieldLabelRow(resolved: resolved)
        _ = InputFieldMessage(resolved: resolved)
        _ = InputFieldHelpButton(text: "Help", accessibilityLabel: resolved.helpAccessibilityLabel)
        _ = InputFieldControl(
            resolved: resolved,
            text: .constant(""),
            reduceMotion: false,
            icon: Image(systemName: "magnifyingglass"),
            suffix: EmptyView()
        )
        _ = InputFieldControl(
            resolved: InputFieldProjection.resolve(input: input(hasSuffix: true, isSecure: true)),
            text: .constant("secret"),
            reduceMotion: true,
            icon: EmptyView(),
            suffix: Text(verbatim: "km")
        )
    }
}

// MARK: - Strings facade (P1/S10)

final class InputFieldStringsTests: XCTestCase {
    func testFacadeFallbacksResolve() {
        XCTAssertEqual(InputFieldStrings.string("input.accessibility.unlabeled", "Input field"), "Input field")
        XCTAssertEqual(InputFieldStrings.string("input.accessibility.required", "required"), "required")
        XCTAssertEqual(InputFieldStrings.string("input.accessibility.errorFormat", "Error: %@"), "Error: %@")
        XCTAssertEqual(InputFieldStrings.string("input.accessibility.helpFor", "Help for %@"), "Help for %@")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyInputFieldTelemetry: InputFieldTelemetry, @unchecked Sendable {
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
