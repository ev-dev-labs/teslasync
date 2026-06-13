//
//  Select.Tests.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The view-composition + accessibility + facade half of the coverage (the pure projection lives in
//  Select.AdapterTests.swift and the holder + telemetry in Select.ModelTests.swift; split to keep each file
//  within the SwiftLint length budget):
//    • Views — the public `FormSelect` surface + every subview compose in each real branch (labelled, help,
//      prompt, error, hint, disabled options, sizes, required, disabled control, empty leaf).
//    • Accessibility — the control's spoken name folds in "required"; the error / hint captions carry their
//      described-by element ids; the empty leaf exposes a non-blank accessible value.
//    • Strings — the surface's owned a11y keys resolve through the P1/S10 facade with the English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - View composition (every real branch composes)

@MainActor
final class SelectViewCompositionTests: XCTestCase {
    private let options: [SelectOptionInput] = [
        SelectOptionInput(value: "model-3", label: "Model 3"),
        SelectOptionInput(value: "model-x", label: "Model X", isDisabled: true)
    ]

    func testSurfaceComposesForEveryBranch() {
        _ = FormSelect(options: options, label: "Vehicle")
        _ = FormSelect(options: options, selection: "model-3", label: "Vehicle", prompt: "Choose…")
        _ = FormSelect(options: options, label: "Vehicle", help: HelpIconInput(content: "Pick one"))
        _ = FormSelect(options: options, label: "Vehicle", error: "Required", required: true)
        _ = FormSelect(options: options, label: "Vehicle", hint: "Paired only")
        _ = FormSelect(options: options, label: "Small", size: .small)
        _ = FormSelect(options: options, label: "Large", size: .large)
        _ = FormSelect(options: options, label: "Vehicle", disabled: true)
        _ = FormSelect(options: [], label: "Vehicle")
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = SelectModel(
            input: SelectInput(options: options, label: "Vehicle", isRequired: true),
            selection: "model-3",
            telemetry: OSLogSelectTelemetry()
        )
        _ = FormSelect(model: injected)
        XCTAssertEqual(FormSelect.surfaceSlug, "Select")
    }

    func testSubviewsCompose() {
        let projection = SelectProjector.resolve(
            input: SelectInput(options: options, label: "Vehicle", prompt: "Choose…"),
            emptyText: "No options available",
            untitled: "Select",
            requiredWord: "required"
        )
        let style = SelectSizeStyle.resolve(for: .medium)
        _ = SelectTriggerLabel(title: "Model 3", isMuted: false, font: style.font)
        _ = SelectCaption(text: "Required", kind: .error, elementID: "vehicle-error")
        _ = SelectCaption(text: "Paired only", kind: .hint, elementID: "vehicle-hint")
        _ = SelectMenuRowLabel(title: "Model 3", isSelected: true)
        _ = SelectMenuContent(projection: projection, selection: "model-3", onSelect: { _ in })
        _ = SelectEmptyControl(projection: projection, style: style)
    }

    func testSizeStyleMapsEveryScale() {
        XCTAssertEqual(SelectSizeStyle.resolve(for: .small).controlSize, .small)
        XCTAssertEqual(SelectSizeStyle.resolve(for: .medium).controlSize, .regular)
        XCTAssertEqual(SelectSizeStyle.resolve(for: .large).controlSize, .large)
        XCTAssertEqual(SelectSizeStyle.resolve(for: .auto).controlSize, .regular)
    }
}

// MARK: - Accessibility

@MainActor
final class SelectAccessibilityTests: XCTestCase {
    private let options: [SelectOptionInput] = [SelectOptionInput(value: "a", label: "Alpha")]

    private func projection(_ input: SelectInput) -> SelectProjection {
        SelectProjector.resolve(
            input: input,
            emptyText: "No options available",
            untitled: "Select",
            requiredWord: "required"
        )
    }

    func testRequiredControlFoldsRequiredIntoSpokenName() {
        let result = projection(SelectInput(options: options, label: "Vehicle", isRequired: true))
        XCTAssertEqual(result.accessibilityLabel, "Vehicle required")
    }

    func testUnlabelledControlUsesUntitledSpokenName() {
        let result = projection(SelectInput(options: options))
        XCTAssertEqual(result.accessibilityLabel, "Select")
    }

    func testErrorCaptionCarriesDescribedByID() {
        let result = projection(SelectInput(options: options, label: "Vehicle", error: "Required"))
        XCTAssertEqual(result.errorID, "vehicle-error")
        XCTAssertEqual(result.describedByID, "vehicle-error")
        XCTAssertTrue(result.isInvalid)
    }

    func testHintCaptionCarriesDescribedByID() {
        let result = projection(SelectInput(options: options, label: "Vehicle", hint: "Paired only"))
        XCTAssertEqual(result.hintID, "vehicle-hint")
        XCTAssertEqual(result.describedByID, "vehicle-hint")
    }

    func testEmptyLeafExposesNonBlankValue() {
        let result = projection(SelectInput(options: [], label: "Vehicle"))
        XCTAssertTrue(result.isEmpty)
        XCTAssertFalse(result.emptyText.isEmpty, "the empty leaf never presents a blank value")
    }
}

// MARK: - Strings facade (P1/S10)

final class SelectStringsTests: XCTestCase {
    func testEmptyLeafFallback() {
        XCTAssertEqual(SelectStrings.empty, "No options available")
    }

    func testUntitledFallback() {
        XCTAssertEqual(SelectStrings.untitled, "Select")
    }

    func testRequiredFallback() {
        XCTAssertEqual(SelectStrings.required, "required")
    }

    func testTableName() {
        XCTAssertEqual(SelectStrings.table, "Select")
    }
}
