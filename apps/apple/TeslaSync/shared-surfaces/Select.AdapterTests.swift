//
//  Select.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  The pure-core coverage for the form select (split from Select.Tests.swift to keep each file within the
//  SwiftLint length budget): the ``SelectProjector`` render decisions — JS string truthiness, the control-id
//  slug (web `label.toLowerCase().replace(/\s+/g, '-')`), the id resolution (web `id || slug(label)`), the
//  error / hint element ids, the described-by precedence (web `error ? …-error : hint ? …-hint : undefined`),
//  the help `for` fallback (web `help.for ?? selectId`), the accessible-name composition (label + required),
//  the trigger display title, the size mapping, and the whole-projection resolution across every real branch.
//  No SwiftUI, no network — the derivation is pure, so these run identically on iOS + macOS.
//

import XCTest
@testable import TeslaSync

// MARK: - Truthiness + slug + ids

final class SelectProjectorPrimitiveTests: XCTestCase {
    func testIsPresentMatchesJSStringTruthiness() {
        XCTAssertFalse(SelectProjector.isPresent(nil))
        XCTAssertFalse(SelectProjector.isPresent(""))
        XCTAssertTrue(SelectProjector.isPresent("x"))
        XCTAssertTrue(SelectProjector.isPresent(" "), "whitespace is truthy in JS, matching web `{prop && …}`")
    }

    func testSlugLowercasesAndHyphenatesWhitespace() {
        XCTAssertEqual(SelectProjector.slug(fromLabel: "Battery Health"), "battery-health")
    }

    func testSlugCollapsesWhitespaceRuns() {
        XCTAssertEqual(SelectProjector.slug(fromLabel: "Drive   Mode"), "drive-mode")
        XCTAssertEqual(SelectProjector.slug(fromLabel: "Tab\tSeparated"), "tab-separated")
    }

    func testResolveIDPrefersExplicitID() {
        XCTAssertEqual(SelectProjector.resolveID(explicitID: "custom-id", label: "Vehicle"), "custom-id")
    }

    func testResolveIDFallsBackToLabelSlug() {
        XCTAssertEqual(SelectProjector.resolveID(explicitID: nil, label: "Vehicle Type"), "vehicle-type")
    }

    func testResolveIDFallsBackToLabelWhenExplicitIDEmpty() {
        XCTAssertEqual(SelectProjector.resolveID(explicitID: "", label: "Vehicle"), "vehicle")
    }

    func testResolveIDIsNilWithoutIDOrLabel() {
        XCTAssertNil(SelectProjector.resolveID(explicitID: nil, label: nil))
        XCTAssertNil(SelectProjector.resolveID(explicitID: nil, label: ""))
    }

    func testErrorIDOnlyWhenErroredAndIDPresent() {
        XCTAssertEqual(SelectProjector.errorID(resolvedID: "vehicle", hasError: true), "vehicle-error")
        XCTAssertNil(SelectProjector.errorID(resolvedID: "vehicle", hasError: false))
        XCTAssertNil(SelectProjector.errorID(resolvedID: nil, hasError: true))
    }

    func testHintIDOnlyWhenHintShownAndIDPresent() {
        XCTAssertEqual(SelectProjector.hintID(resolvedID: "vehicle", showsHint: true), "vehicle-hint")
        XCTAssertNil(SelectProjector.hintID(resolvedID: "vehicle", showsHint: false))
        XCTAssertNil(SelectProjector.hintID(resolvedID: nil, showsHint: true))
    }

    func testDescribedByPrefersErrorOverHint() {
        XCTAssertEqual(
            SelectProjector.describedByID(errorID: "v-error", hintID: "v-hint"),
            "v-error",
            "web `error ? …-error : hint ? …-hint`"
        )
        XCTAssertEqual(SelectProjector.describedByID(errorID: nil, hintID: "v-hint"), "v-hint")
        XCTAssertNil(SelectProjector.describedByID(errorID: nil, hintID: nil))
    }
}

// MARK: - Help `for` fallback + accessible name + display title

final class SelectProjectorDerivationTests: XCTestCase {
    func testResolveHelpKeepsExplicitForID() {
        let help = HelpIconInput(content: "Help", forID: "explicit")
        let resolved = SelectProjector.resolveHelp(help, resolvedID: "vehicle")
        XCTAssertEqual(resolved?.forID, "explicit")
    }

    func testResolveHelpFallsBackToControlID() {
        let help = HelpIconInput(content: "Help")
        let resolved = SelectProjector.resolveHelp(help, resolvedID: "vehicle")
        XCTAssertEqual(resolved?.forID, "vehicle", "web `help.for ?? selectId`")
    }

    func testResolveHelpIsNilWhenAbsent() {
        XCTAssertNil(SelectProjector.resolveHelp(nil, resolvedID: "vehicle"))
    }

    func testAccessibilityLabelUsesVisibleLabel() {
        let label = SelectProjector.accessibilityLabel(
            label: "Vehicle",
            isRequired: false,
            untitled: "Select",
            requiredWord: "required"
        )
        XCTAssertEqual(label, "Vehicle")
    }

    func testAccessibilityLabelAppendsRequired() {
        let label = SelectProjector.accessibilityLabel(
            label: "Vehicle",
            isRequired: true,
            untitled: "Select",
            requiredWord: "required"
        )
        XCTAssertEqual(label, "Vehicle required")
    }

    func testAccessibilityLabelFallsBackToUntitled() {
        let label = SelectProjector.accessibilityLabel(
            label: nil,
            isRequired: true,
            untitled: "Select",
            requiredWord: "required"
        )
        XCTAssertEqual(label, "Select required")
    }

    private let options: [SelectOptionInput] = [
        SelectOptionInput(value: "a", label: "Alpha"),
        SelectOptionInput(value: "b", label: "Bravo")
    ]

    func testDisplayTitlePrefersSelectedOption() {
        let title = SelectProjector.displayTitle(
            options: options,
            selection: "b",
            prompt: "Pick…",
            untitled: "Select"
        )
        XCTAssertEqual(title, "Bravo")
    }

    func testDisplayTitleFallsBackToPromptWhenUnmatched() {
        let title = SelectProjector.displayTitle(
            options: options,
            selection: "",
            prompt: "Pick…",
            untitled: "Select"
        )
        XCTAssertEqual(title, "Pick…")
    }

    func testDisplayTitleFallsBackToFirstOptionWithoutPrompt() {
        let title = SelectProjector.displayTitle(
            options: options,
            selection: "",
            prompt: nil,
            untitled: "Select"
        )
        XCTAssertEqual(title, "Alpha")
    }

    func testDisplayTitleFallsBackToUntitledWhenEmpty() {
        let title = SelectProjector.displayTitle(
            options: [],
            selection: "",
            prompt: nil,
            untitled: "Select"
        )
        XCTAssertEqual(title, "Select")
    }
}

// MARK: - Whole-projection resolution (every real branch)

final class SelectProjectorResolveTests: XCTestCase {
    private let options: [SelectOptionInput] = [
        SelectOptionInput(value: "model-3", label: "Model 3"),
        SelectOptionInput(value: "model-x", label: "Model X", isDisabled: true)
    ]

    private func resolve(_ input: SelectInput) -> SelectProjection {
        SelectProjector.resolve(
            input: input,
            emptyText: "No options available",
            untitled: "Select",
            requiredWord: "required"
        )
    }

    func testLabelledRequiredErroredProjection() {
        let projection = resolve(SelectInput(
            options: options,
            label: "Vehicle",
            error: "Required field",
            hint: "ignored when errored",
            size: .large,
            isRequired: true
        ))
        XCTAssertTrue(projection.showsLabel)
        XCTAssertEqual(projection.resolvedID, "vehicle")
        XCTAssertTrue(projection.isRequired)
        XCTAssertTrue(projection.showsError)
        XCTAssertTrue(projection.isInvalid)
        XCTAssertEqual(projection.errorText, "Required field")
        XCTAssertEqual(projection.errorID, "vehicle-error")
        XCTAssertFalse(projection.showsHint, "an error suppresses the hint (web `hint && !error`)")
        XCTAssertNil(projection.hintText)
        XCTAssertEqual(projection.describedByID, "vehicle-error")
        XCTAssertEqual(projection.accessibilityLabel, "Vehicle required")
        XCTAssertEqual(projection.size, .large)
    }

    func testHintShownWhenNoError() {
        let projection = resolve(SelectInput(options: options, label: "Vehicle", hint: "Paired only"))
        XCTAssertTrue(projection.showsHint)
        XCTAssertEqual(projection.hintText, "Paired only")
        XCTAssertEqual(projection.hintID, "vehicle-hint")
        XCTAssertEqual(projection.describedByID, "vehicle-hint")
        XCTAssertFalse(projection.showsError)
        XCTAssertFalse(projection.isInvalid)
    }

    func testPromptAndHelpProjection() {
        let projection = resolve(SelectInput(
            options: options,
            label: "Vehicle",
            help: HelpIconInput(content: "Pick one"),
            prompt: "Choose…"
        ))
        XCTAssertTrue(projection.showsPrompt)
        XCTAssertEqual(projection.prompt, "Choose…")
        XCTAssertTrue(projection.showsHelp)
        XCTAssertEqual(projection.help?.forID, "vehicle", "help `for` defaults to the control id")
    }

    func testEmptyOptionsLeaf() {
        let projection = resolve(SelectInput(options: [], label: "Vehicle"))
        XCTAssertTrue(projection.isEmpty)
        XCTAssertEqual(projection.emptyText, "No options available")
        XCTAssertEqual(projection.options.count, 0)
    }

    func testUnlabelledProjectionHasNoIDAndUntitledName() {
        let projection = resolve(SelectInput(options: options))
        XCTAssertFalse(projection.showsLabel)
        XCTAssertNil(projection.resolvedID)
        XCTAssertNil(projection.describedByID)
        XCTAssertEqual(projection.accessibilityLabel, "Select")
    }

    func testOptionDisabledFlagSurvives() {
        let projection = resolve(SelectInput(options: options))
        XCTAssertEqual(projection.options[1].value, "model-x")
        XCTAssertTrue(projection.options[1].isDisabled)
    }

    func testSizeFromWebMapping() {
        XCTAssertEqual(SelectSize.fromWeb("sm"), .small)
        XCTAssertEqual(SelectSize.fromWeb("md"), .medium)
        XCTAssertEqual(SelectSize.fromWeb("lg"), .large)
        XCTAssertEqual(SelectSize.fromWeb("auto"), .auto)
        XCTAssertEqual(SelectSize.fromWeb("???"), .medium, "unknown folds to the web default `md`")
    }
}
