//
//  Select.ModelTests.swift
//  TeslaSync — P4 shared surface · 0225 · Select (Apple)
//
//  Telemetry + interaction coverage split out of Select.Tests.swift (one concern per file): the P1/S11
//  `view.opened` emission (emitted exactly once on first appearance; never re-emitted after stop/start), the
//  stable diagnostics slug, and the ``SelectModel`` behaviour — the native peer of the web controlled
//  `value` / `onChange`: selecting an option forwards the value + flips the selection, a disabled option
//  cannot be chosen (web `<option disabled>`), the prompt value `""` is allowed (web `<option value="">`), an
//  unchanged selection is a no-op (no duplicate `onChange`), and the derived helpers (selectedOption,
//  displayTitle, isShowingPrompt) track the selection. Driven by spies; no network, no store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics (P1/S11 view.opened)

@MainActor
final class SelectModelTelemetryTests: XCTestCase {
    private let options: [SelectOptionInput] = [SelectOptionInput(value: "a", label: "Alpha")]

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpySelectTelemetry()
        let model = SelectModel(input: SelectInput(options: options), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SelectSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpySelectTelemetry()
        let model = SelectModel(input: SelectInput(options: options), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [SelectSurface.slug], "view.opened fires once per instance")
    }

    func testSlugIsStable() {
        XCTAssertEqual(SelectSurface.slug, "Select")
        XCTAssertEqual(FormSelect.surfaceSlug, "Select")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogSelectTelemetry().viewOpened(surface: SelectSurface.slug)
    }
}

// MARK: - Model interaction (web controlled value / onChange)

@MainActor
final class SelectModelInteractionTests: XCTestCase {
    private let options: [SelectOptionInput] = [
        SelectOptionInput(value: "model-3", label: "Model 3"),
        SelectOptionInput(value: "model-x", label: "Model X", isDisabled: true),
        SelectOptionInput(value: "model-y", label: "Model Y")
    ]

    private func model(
        selection: String = "",
        prompt: String? = nil,
        onChange: (@MainActor (String) -> Void)? = nil
    ) -> SelectModel {
        SelectModel(
            input: SelectInput(options: options, label: "Vehicle", prompt: prompt),
            selection: selection,
            onChange: onChange
        )
    }

    func testProjectionDerivesFromInput() {
        let holder = model()
        XCTAssertTrue(holder.projection.showsLabel)
        XCTAssertEqual(holder.projection.resolvedID, "vehicle")
    }

    func testSelectForwardsOnChangeAndUpdatesSelection() {
        let recorder = SelectChangeRecorder()
        let holder = model(onChange: { recorder.record($0) })
        holder.select("model-y")
        XCTAssertEqual(holder.selection, "model-y")
        XCTAssertEqual(recorder.values, ["model-y"])
    }

    func testSelectIgnoresDisabledOption() {
        let recorder = SelectChangeRecorder()
        let holder = model(selection: "model-3", onChange: { recorder.record($0) })
        holder.select("model-x")
        XCTAssertEqual(holder.selection, "model-3", "a disabled option cannot be chosen (web `<option disabled>`)")
        XCTAssertTrue(recorder.values.isEmpty)
    }

    func testSelectAllowsPromptEmptyValue() {
        let recorder = SelectChangeRecorder()
        let holder = model(selection: "model-3", prompt: "Choose…", onChange: { recorder.record($0) })
        holder.select("")
        XCTAssertEqual(holder.selection, "")
        XCTAssertEqual(recorder.values, [""], "the prompt value `\"\"` is selectable (web `<option value=\"\">`)")
    }

    func testSelectIsNoOpForUnchangedSelection() {
        let recorder = SelectChangeRecorder()
        let holder = model(selection: "model-3", onChange: { recorder.record($0) })
        holder.select("model-3")
        XCTAssertTrue(recorder.values.isEmpty, "no duplicate onChange for an unchanged selection")
    }

    func testSelectedOptionReflectsSelection() {
        let holder = model(selection: "model-y")
        XCTAssertEqual(holder.selectedOption?.label, "Model Y")
    }

    func testDisplayTitleReflectsSelection() {
        let holder = model(selection: "model-y")
        XCTAssertEqual(holder.displayTitle, "Model Y")
    }

    func testDisplayTitleFallsBackToPromptWhenUnselected() {
        let holder = model(selection: "", prompt: "Choose…")
        XCTAssertEqual(holder.displayTitle, "Choose…")
        XCTAssertTrue(holder.isShowingPrompt)
    }

    func testIsShowingPromptFalseWhenSelected() {
        let holder = model(selection: "model-3", prompt: "Choose…")
        XCTAssertFalse(holder.isShowingPrompt)
    }

    func testUpdateReplacesInputAndReDerives() {
        let holder = model()
        XCTAssertFalse(holder.projection.isRequired)
        holder.update(SelectInput(options: options, label: "Vehicle", isRequired: true))
        XCTAssertTrue(holder.input.isRequired)
        XCTAssertTrue(holder.projection.isRequired)
    }

    func testUpdateIsNoOpForUnchangedInput() {
        let input = SelectInput(options: options, label: "Vehicle")
        let holder = SelectModel(input: input)
        holder.update(input)
        XCTAssertEqual(holder.input, input)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpySelectTelemetry: SelectTelemetry, @unchecked Sendable {
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

/// Records the values forwarded through the `onChange` callback so the controlled-value contract is testable.
@MainActor
private final class SelectChangeRecorder {
    private(set) var values: [String] = []

    func record(_ value: String) {
        values.append(value)
    }
}
