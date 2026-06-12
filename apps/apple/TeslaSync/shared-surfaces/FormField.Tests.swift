//
//  FormField.Tests.swift
//  TeslaSync — P4 shared surface · 0154 · FormField (Apple)
//
//  Unit coverage for the FormField surface:
//    • Adapter — the pure `FormFieldProjection` across every web branch (error hides
//      hint, whitespace collapses to no message, required / fieldID passthrough) and
//      the `FormFieldMessage` accessors.
//    • Accessibility — the VoiceOver field-label composition (the required suffix).
//    • State holder — the `FormFieldModel` lifecycle (seed → start → push → stop) and
//      the P1/S11 `view.opened` telemetry slug.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryFormFieldSource`, and the telemetry is
//  captured by a spy so the `view.opened` contract is asserted without an os_log
//  round-trip.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Projection (port of FormField.tsx body)

final class FormFieldProjectionTests: XCTestCase {
    func testNoErrorNoHintRendersNoMessage() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(label: "Signal"))
        XCTAssertEqual(resolved.message, .none)
        XCTAssertEqual(resolved.label, "Signal")
        XCTAssertFalse(resolved.isRequired)
    }

    func testHintOnlyRendersHint() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(label: "Signal", hint: "0–100 percent"))
        XCTAssertEqual(resolved.message, .hint("0–100 percent"))
    }

    func testErrorOnlyRendersError() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(label: "Signal", error: "Required"))
        XCTAssertEqual(resolved.message, .error("Required"))
    }

    func testErrorHidesHint() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(
            label: "Signal",
            hint: "0–100 percent",
            error: "Must be a number"
        ))
        XCTAssertEqual(resolved.message, .error("Must be a number"))
        XCTAssertNotEqual(resolved.message, .hint("0–100 percent"))
    }

    func testWhitespaceErrorCollapsesToHintThenNone() {
        let withHint = FormFieldProjection.resolve(FormFieldInput(
            label: "Signal",
            hint: "help",
            error: "   "
        ))
        XCTAssertEqual(withHint.message, .hint("help"), "a blank error must not win over a real hint")

        let withoutHint = FormFieldProjection.resolve(FormFieldInput(label: "Signal", error: "\n\t "))
        XCTAssertEqual(withoutHint.message, .none, "a blank error must not render an empty alert row")
    }

    func testWhitespaceHintCollapsesToNone() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(label: "Signal", hint: "   "))
        XCTAssertEqual(resolved.message, .none)
    }

    func testRequiredAndFieldIDPassThrough() {
        let resolved = FormFieldProjection.resolve(FormFieldInput(
            label: "Signal",
            required: true,
            fieldID: "signal_name"
        ))
        XCTAssertTrue(resolved.isRequired)
        XCTAssertEqual(resolved.fieldID, "signal_name")
    }

    func testMessageAccessors() {
        XCTAssertTrue(FormFieldMessage.error("x").isError)
        XCTAssertFalse(FormFieldMessage.hint("x").isError)
        XCTAssertFalse(FormFieldMessage.none.isError)
        XCTAssertEqual(FormFieldMessage.error("boom").text, "boom")
        XCTAssertEqual(FormFieldMessage.hint("tip").text, "tip")
        XCTAssertNil(FormFieldMessage.none.text)
    }
}

// MARK: - Accessibility (VoiceOver field label)

final class FormFieldAccessibilityTests: XCTestCase {
    func testRequiredAppendsTheLocalizedWord() {
        let label = FormFieldAccessibility.fieldLabel(label: "Signal", required: true, requiredWord: "required")
        XCTAssertEqual(label, "Signal, required")
    }

    func testOptionalUsesTheBareLabel() {
        let label = FormFieldAccessibility.fieldLabel(label: "Signal", required: false, requiredWord: "required")
        XCTAssertEqual(label, "Signal")
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(FormFieldSurface.slug, "FormField")
    }
}

// MARK: - State holder + telemetry (P1/S8 + P1/S11)

@MainActor
final class FormFieldModelTests: XCTestCase {
    func testSeedsResolvedFromInitialBeforeStart() {
        let input = FormFieldInput(label: "Signal", required: true, hint: "help")
        let model = FormFieldModel(
            source: InMemoryFormFieldSource(initial: input),
            initial: input,
            telemetry: SpyFormFieldTelemetry()
        )
        XCTAssertEqual(model.resolved.label, "Signal")
        XCTAssertTrue(model.resolved.isRequired)
        XCTAssertEqual(model.resolved.message, .hint("help"))
    }

    func testStartReplaysInitialAndEmitsViewOpenedOnce() {
        let spy = SpyFormFieldTelemetry()
        let source = InMemoryFormFieldSource(initial: FormFieldInput(label: "Signal"))
        let model = FormFieldModel(source: source, initial: FormFieldInput(label: "Signal"), telemetry: spy)

        model.start()
        model.start()

        XCTAssertEqual(source.startCount, 1, "start must be idempotent")
        XCTAssertEqual(spy.openedSurfaces, ["FormField"], "view.opened must fire exactly once with the slug")
    }

    func testPushRecomputesProjection() {
        let source = InMemoryFormFieldSource(initial: FormFieldInput(label: "Signal"))
        let model = FormFieldModel(
            source: source,
            initial: FormFieldInput(label: "Signal"),
            telemetry: SpyFormFieldTelemetry()
        )
        model.start()

        source.push(FormFieldInput(label: "Signal", required: true, error: "Required"))
        XCTAssertEqual(model.resolved.message, .error("Required"))
        XCTAssertTrue(model.resolved.isRequired)

        source.push(FormFieldInput(label: "Signal", hint: "ok now"))
        XCTAssertEqual(model.resolved.message, .hint("ok now"))
        XCTAssertFalse(model.resolved.isRequired)
    }

    func testStopHaltsTheSource() {
        let source = InMemoryFormFieldSource(initial: FormFieldInput(label: "Signal"))
        let model = FormFieldModel(
            source: source,
            initial: FormFieldInput(label: "Signal"),
            telemetry: SpyFormFieldTelemetry()
        )
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Views (per-state compose contract — every web branch renders)

/// Constructs the surface and its leaves in every render branch of the web source
/// (bare, required, hint, error-hides-hint) plus both initializers and every message
/// case, the parity of the web "renders the label / child / hint / error" tests. This
/// is the repo's per-state view test: with no pixel-snapshot harness wired, asserting
/// each state composes (the value + its `body` type) is the deterministic equivalent.
@MainActor
final class FormFieldViewTests: XCTestCase {
    private func model(_ input: FormFieldInput) -> FormFieldModel {
        FormFieldModel(
            source: InMemoryFormFieldSource(initial: input),
            initial: input,
            telemetry: SpyFormFieldTelemetry()
        )
    }

    func testConvenienceInitComposesEveryState() {
        _ = FormField(label: "Signal") { Text(verbatim: "control") }
        _ = FormField(label: "Signal", required: true) { Text(verbatim: "control") }
        _ = FormField(label: "Signal", required: true, hint: "help") { Text(verbatim: "control") }
        _ = FormField(
            label: "Signal",
            required: true,
            hint: "help",
            error: "Signal is required."
        ) { Text(verbatim: "control") }
        _ = FormField(label: "Signal", fieldID: "signal_name") { Text(verbatim: "control") }
    }

    func testModelInitComposes() {
        let field = FormField(model: model(FormFieldInput(label: "Signal", required: true))) {
            Text(verbatim: "control")
        }
        XCTAssertEqual(FormField<Text>.surfaceSlug, "FormField")
        _ = field.body
    }

    func testLabelRowComposesRequiredAndOptional() {
        _ = FormFieldLabelView(label: "Signal", isRequired: false, requiredWord: "required").body
        _ = FormFieldLabelView(label: "Signal", isRequired: true, requiredWord: "required").body
    }

    func testMessageRowComposesEveryCase() {
        _ = FormFieldMessageView(message: .none).body
        _ = FormFieldMessageView(message: .hint("0–100 percent")).body
        _ = FormFieldMessageView(message: .error("Required")).body
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without
/// an os_log round-trip. Single-threaded test usage only.
private final class SpyFormFieldTelemetry: FormFieldTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
