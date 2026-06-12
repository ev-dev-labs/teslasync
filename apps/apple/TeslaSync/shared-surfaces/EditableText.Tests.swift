//
//  EditableText.Tests.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  Adapter + engine + projection + seam coverage for the EditableText surface — the Swift port of the
//  web suite (components/ui/EditableText.test.tsx behaviour):
//    • normalise — trim, the canonical server value.
//    • clamp — maxLength enforcement (cap / under-cap / nil / non-positive).
//    • liveValidationMessage — no validator / empty-silent / validator surfaces.
//    • decideCommit — no-op / empty / custom validator / skip-resubmit / proceed (web guard order).
//    • saveErrorMessage — surface error message / LocalizedError / generic fallback / blank fallback.
//    • displayContent + displayText — value / prompt / "Not set" selection + spoken text (a11y).
//    • resolve — error / loading / ready-empty / ready-populated (web branches + P4 leaf).
//    • Seams — Live (start / update / save-writeback / save-rethrow-without-mutation) + InMemory
//      (records saves / armed error / echo / push).
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store — each assertion reads
//  the pure core or the in-memory seam directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Normalise (web normalise)

final class EditableTextFieldNormaliseTests: XCTestCase {
    func testTrimsLeadingAndTrailingWhitespace() {
        XCTAssertEqual(EditableTextFieldEngine.normalise("  Home  "), "Home")
        XCTAssertEqual(EditableTextFieldEngine.normalise("\n\tGarage\n"), "Garage")
    }

    func testEmptyAndWhitespaceOnlyNormaliseToEmpty() {
        XCTAssertEqual(EditableTextFieldEngine.normalise(""), "")
        XCTAssertEqual(EditableTextFieldEngine.normalise("   "), "")
    }
}

// MARK: - Clamp (web <input maxLength>)

final class EditableTextFieldClampTests: XCTestCase {
    func testClampsToMaxLength() {
        XCTAssertEqual(EditableTextFieldEngine.clamp("abcdef", maxLength: 3), "abc")
    }

    func testUnderCapLeftUnchanged() {
        XCTAssertEqual(EditableTextFieldEngine.clamp("ab", maxLength: 3), "ab")
        XCTAssertEqual(EditableTextFieldEngine.clamp("abc", maxLength: 3), "abc")
    }

    func testNilOrNonPositiveMeansNoCap() {
        XCTAssertEqual(EditableTextFieldEngine.clamp("abcdef", maxLength: nil), "abcdef")
        XCTAssertEqual(EditableTextFieldEngine.clamp("abcdef", maxLength: 0), "abcdef")
        XCTAssertEqual(EditableTextFieldEngine.clamp("abcdef", maxLength: -2), "abcdef")
    }

    func testClampCountsGraphemes() {
        // A multi-scalar emoji is one grapheme — a cap of 1 keeps it whole.
        XCTAssertEqual(EditableTextFieldEngine.clamp("👩‍👧‍👦x", maxLength: 1), "👩‍👧‍👦")
    }
}

// MARK: - Live validation (web handleInputChange)

final class EditableTextFieldLiveValidationTests: XCTestCase {
    func testNoValidatorNeverSurfaces() {
        XCTAssertNil(EditableTextFieldEngine.liveValidationMessage(for: "anything", validate: nil))
    }

    func testEmptyTrimmedStaysSilent() {
        let validate: (String) -> String? = { _ in "always" }
        XCTAssertNil(EditableTextFieldEngine.liveValidationMessage(for: "", validate: validate))
        XCTAssertNil(EditableTextFieldEngine.liveValidationMessage(for: "   ", validate: validate))
    }

    func testNonEmptySurfacesValidatorResult() {
        let validate: (String) -> String? = { $0 == "bad" ? "Nope" : nil }
        XCTAssertEqual(EditableTextFieldEngine.liveValidationMessage(for: "bad", validate: validate), "Nope")
        XCTAssertNil(EditableTextFieldEngine.liveValidationMessage(for: "good", validate: validate))
    }

    func testValidatorReceivesTrimmedValue() {
        var seen: String?
        let validate: (String) -> String? = { seen = $0; return nil }
        _ = EditableTextFieldEngine.liveValidationMessage(for: "  spaced  ", validate: validate)
        XCTAssertEqual(seen, "spaced")
    }
}

// MARK: - Commit decision (web commitDraft guard order)

final class EditableTextFieldDecideCommitTests: XCTestCase {
    private let empty = "Value cannot be empty"

    func testUnchangedIsNoOp() {
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "  Home ", value: "Home", lastSubmitted: nil, validate: nil, emptyMessage: empty
        )
        XCTAssertEqual(decision, .noOp)
    }

    func testEmptyDraftAgainstNonEmptyValueIsInvalid() {
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "   ", value: "Home", lastSubmitted: nil, validate: nil, emptyMessage: empty
        )
        XCTAssertEqual(decision, .invalid(empty))
    }

    func testEmptyDraftAgainstEmptyValueIsNoOpNotInvalid() {
        // Both empty after trim → unchanged wins before the empty guard (web order).
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "  ", value: "", lastSubmitted: nil, validate: nil, emptyMessage: empty
        )
        XCTAssertEqual(decision, .noOp)
    }

    func testCustomValidatorBlocks() {
        let validate: (String) -> String? = { $0 == "Bad" ? "Reserved name" : nil }
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "Bad", value: "Home", lastSubmitted: nil, validate: validate, emptyMessage: empty
        )
        XCTAssertEqual(decision, .invalid("Reserved name"))
    }

    func testEmptyGuardRunsBeforeCustomValidator() {
        // An empty draft yields the built-in empty message even if a validator exists.
        let validate: (String) -> String? = { _ in "custom" }
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "", value: "Home", lastSubmitted: nil, validate: validate, emptyMessage: empty
        )
        XCTAssertEqual(decision, .invalid(empty))
    }

    func testIdenticalToLastSubmittedSkips() {
        let decision = EditableTextFieldEngine.decideCommit(
            draft: " Renamed ", value: "Home", lastSubmitted: "Renamed", validate: nil, emptyMessage: empty
        )
        XCTAssertEqual(decision, .skipResubmit)
    }

    func testValidChangedNewProceedsWithNormalisedValue() {
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "  Renamed  ", value: "Home", lastSubmitted: nil, validate: nil, emptyMessage: empty
        )
        XCTAssertEqual(decision, .proceed("Renamed"))
    }

    func testEmptyValidatorMessageDoesNotBlock() {
        // A validator returning "" is treated as valid (web `if (v)` is falsy for empty string).
        let validate: (String) -> String? = { _ in "" }
        let decision = EditableTextFieldEngine.decideCommit(
            draft: "Renamed", value: "Home", lastSubmitted: nil, validate: validate, emptyMessage: empty
        )
        XCTAssertEqual(decision, .proceed("Renamed"))
    }
}

// MARK: - Save error message (web err.message ?? saveFailed)

final class EditableTextFieldSaveErrorMessageTests: XCTestCase {
    private struct CustomLocalized: LocalizedError {
        let errorDescription: String?
    }

    private struct Bare: Error {}

    func testSurfaceErrorMessageUsed() {
        let message = EditableTextFieldEngine.saveErrorMessage(
            from: EditableTextFieldSaveError("Name already taken"), fallback: "Save failed"
        )
        XCTAssertEqual(message, "Name already taken")
    }

    func testBlankSurfaceErrorFallsBack() {
        let message = EditableTextFieldEngine.saveErrorMessage(
            from: EditableTextFieldSaveError("   "), fallback: "Save failed"
        )
        XCTAssertEqual(message, "Save failed")
    }

    func testLocalizedErrorDescriptionUsed() {
        let message = EditableTextFieldEngine.saveErrorMessage(
            from: CustomLocalized(errorDescription: "Server rejected"), fallback: "Save failed"
        )
        XCTAssertEqual(message, "Server rejected")
    }

    func testGenericErrorFallsBack() {
        let message = EditableTextFieldEngine.saveErrorMessage(from: Bare(), fallback: "Save failed")
        XCTAssertEqual(message, "Save failed")
    }
}

// MARK: - Display content + spoken text (web visibleText / isPrompt + a11y)

final class EditableTextFieldDisplayContentTests: XCTestCase {
    func testNonEmptyValueShowsValue() {
        XCTAssertEqual(
            EditableTextFieldEngine.displayContent(value: "Home", prompt: "Untitled"),
            .value("Home")
        )
    }

    func testEmptyWithPromptShowsPrompt() {
        XCTAssertEqual(
            EditableTextFieldEngine.displayContent(value: "", prompt: "Untitled"),
            .prompt("Untitled")
        )
    }

    func testEmptyWithoutPromptShowsNotSet() {
        XCTAssertEqual(EditableTextFieldEngine.displayContent(value: "", prompt: nil), .notSet)
        XCTAssertEqual(EditableTextFieldEngine.displayContent(value: "", prompt: ""), .notSet)
    }

    func testSpokenTextMatchesContent() {
        XCTAssertEqual(
            EditableTextFieldEngine.displayText(content: .value("Home"), notSet: "Not set"), "Home"
        )
        XCTAssertEqual(
            EditableTextFieldEngine.displayText(content: .prompt("Untitled"), notSet: "Not set"),
            "Untitled"
        )
        XCTAssertEqual(
            EditableTextFieldEngine.displayText(content: .notSet, notSet: "Not set"), "Not set"
        )
    }
}

// MARK: - Resolve (web render branches + P4 leaf)

final class EditableTextFieldResolveTests: XCTestCase {
    func testErrorMessageProjectsErrorPhase() {
        let resolved = EditableTextFieldEngine.resolve(
            EditableTextFieldInput(ariaLabel: "Name", errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testWhitespaceErrorMessageDoesNotProjectError() {
        let resolved = EditableTextFieldEngine.resolve(
            EditableTextFieldInput(value: "Home", ariaLabel: "Name", errorMessage: "   ")
        )
        XCTAssertEqual(resolved.phase, .ready)
    }

    func testLoadingProjectsLoadingPhase() {
        let resolved = EditableTextFieldEngine.resolve(
            EditableTextFieldInput(ariaLabel: "Name", isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testReadyPopulatedCarriesDisplayFields() {
        let resolved = EditableTextFieldEngine.resolve(
            EditableTextFieldInput(
                value: "Home",
                ariaLabel: "Rename geofence",
                prompt: "Untitled",
                maxLength: 40,
                variant: .heading
            )
        )
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertEqual(resolved.displayContent, .value("Home"))
        XCTAssertEqual(resolved.ariaLabel, "Rename geofence")
        XCTAssertEqual(resolved.inputPrompt, "Untitled")
        XCTAssertEqual(resolved.variant, .heading)
        XCTAssertEqual(resolved.maxLength, 40)
        XCTAssertFalse(resolved.isEmptyValue)
    }

    func testReadyEmptyIsEmptyValueAndNotSet() {
        let resolved = EditableTextFieldEngine.resolve(EditableTextFieldInput(ariaLabel: "Name"))
        XCTAssertEqual(resolved.phase, .ready)
        XCTAssertTrue(resolved.isEmptyValue)
        XCTAssertEqual(resolved.displayContent, .notSet)
        XCTAssertEqual(resolved.inputPrompt, "")
    }

    func testReadyCarriesDisabled() {
        let resolved = EditableTextFieldEngine.resolve(
            EditableTextFieldInput(value: "Home", ariaLabel: "Name", isDisabled: true)
        )
        XCTAssertTrue(resolved.isDisabled)
    }
}

// MARK: - Live source (web controlled value + async onSave)

@MainActor
final class EditableTextFieldLiveSourceTests: XCTestCase {
    func testStartEmitsCurrent() {
        let source = LiveEditableTextFieldSource(
            value: EditableTextFieldInput(value: "Home", ariaLabel: "Name")
        )
        var seen: EditableTextFieldInput?
        source.onUpdate = { seen = $0 }
        source.start()
        XCTAssertEqual(seen?.value, "Home")
    }

    func testUpdateReEmits() {
        let source = LiveEditableTextFieldSource()
        var seen: [String] = []
        source.onUpdate = { seen.append($0.value) }
        source.update(EditableTextFieldInput(value: "A", ariaLabel: "Name"))
        source.update(EditableTextFieldInput(value: "B", ariaLabel: "Name"))
        XCTAssertEqual(seen, ["A", "B"])
    }

    func testSaveSuccessStoresValueInvokesOnSaveAndReEmits() async throws {
        var savedTo: String?
        let source = LiveEditableTextFieldSource(
            value: EditableTextFieldInput(value: "Home", ariaLabel: "Name"),
            onSave: { savedTo = $0 }
        )
        var emitted: [String] = []
        source.onUpdate = { emitted.append($0.value) }
        try await source.save("Renamed")
        XCTAssertEqual(savedTo, "Renamed")
        XCTAssertEqual(emitted, ["Renamed"])
    }

    func testSaveRethrowsAndDoesNotMutateValue() async {
        let source = LiveEditableTextFieldSource(
            value: EditableTextFieldInput(value: "Home", ariaLabel: "Name"),
            onSave: { _ in throw EditableTextFieldSaveError("nope") }
        )
        var emitted: [String] = []
        source.onUpdate = { emitted.append($0.value) }
        do {
            try await source.save("Renamed")
            XCTFail("expected throw")
        } catch {
            XCTAssertTrue(error is EditableTextFieldSaveError)
        }
        // The canonical value is unchanged (no emit on failure) — the web rollback.
        XCTAssertEqual(emitted, [])
        source.start()
        XCTAssertEqual(emitted, ["Home"])
    }
}

// MARK: - In-memory source (previews + tests)

@MainActor
final class EditableTextFieldInMemorySourceTests: XCTestCase {
    func testStartCountsAndEmitsInitial() {
        let source = InMemoryEditableTextFieldSource(
            initial: EditableTextFieldInput(value: "Home", ariaLabel: "Name")
        )
        var seen: String?
        source.onUpdate = { seen = $0.value }
        source.start()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(seen, "Home")
    }

    func testSaveRecordsValue() async throws {
        let source = InMemoryEditableTextFieldSource()
        try await source.save("Renamed")
        XCTAssertEqual(source.saved, ["Renamed"])
    }

    func testArmedSaveErrorThrowsAndRecordsNothing() async {
        let source = InMemoryEditableTextFieldSource()
        source.saveError = EditableTextFieldSaveError("boom")
        do {
            try await source.save("Renamed")
            XCTFail("expected throw")
        } catch {
            XCTAssertEqual((error as? EditableTextFieldSaveError)?.message, "boom")
        }
        XCTAssertEqual(source.saved, [])
    }

    func testEchoSavedValueReEmits() async throws {
        let source = InMemoryEditableTextFieldSource(
            initial: EditableTextFieldInput(value: "Home", ariaLabel: "Name")
        )
        source.echoSavedValue = true
        var emitted: [String] = []
        source.onUpdate = { emitted.append($0.value) }
        try await source.save("Renamed")
        XCTAssertEqual(emitted, ["Renamed"])
    }

    func testPushEmits() {
        let source = InMemoryEditableTextFieldSource()
        var seen: String?
        source.onUpdate = { seen = $0.value }
        source.push(EditableTextFieldInput(value: "Pushed", ariaLabel: "Name"))
        XCTAssertEqual(seen, "Pushed")
    }
}
