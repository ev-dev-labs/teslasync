//
//  EditableText.ModelTests.swift
//  TeslaSync — P4 shared surface · 0213 · EditableText (Apple)
//
//  State-holder coverage for `EditableTextFieldModel`: the `view.opened` telemetry (once), the phase
//  transitions (loading / ready / error), the edit session (start / cancel / clamp / live validation),
//  the async `commitDraft()` path (no-op / validation / skip-resubmit / success + announce / rejection /
//  in-flight guard), the web focus guard, and the connection axis. Driven through the in-memory + gated
//  seams — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (file scope so the helpers stay out of the test-class body budget)

@MainActor
private func input(
    _ value: String,
    ariaLabel: String = "Rename geofence",
    isDisabled: Bool = false,
    maxLength: Int? = nil,
    connection: EditableTextFieldConnection = .live,
    isLoading: Bool = false,
    errorMessage: String? = nil
) -> EditableTextFieldInput {
    EditableTextFieldInput(
        value: value,
        ariaLabel: ariaLabel,
        maxLength: maxLength,
        isDisabled: isDisabled,
        isLoading: isLoading,
        errorMessage: errorMessage,
        connection: connection
    )
}

@MainActor
private func makeModel(
    _ input: EditableTextFieldInput,
    validate: ((String) -> String?)? = nil,
    telemetry: EditableTextFieldTelemetry = OSLogEditableTextFieldTelemetry(),
    announcer: EditableTextFieldAnnouncer = OSLogEditableTextFieldAnnouncer()
) -> (EditableTextFieldModel, InMemoryEditableTextFieldSource) {
    let source = InMemoryEditableTextFieldSource(initial: input)
    let model = EditableTextFieldModel(
        source: source, validate: validate, telemetry: telemetry, announcer: announcer
    )
    return (model, source)
}

@MainActor
final class EditableTextFieldModelTests: XCTestCase {
    // MARK: Lifecycle + telemetry

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyEditableTextFieldTelemetry()
        let (model, source) = makeModel(input("Home"), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.draft, "Home")
        XCTAssertEqual(spy.surfaces, [EditableTextField.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(input("", isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(input("", errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(EditableTextField.surfaceSlug, "EditableText")
    }

    // MARK: Edit session (web startEdit / cancelEdit / handleInputChange)

    func testStartEditSeedsDraftAndClearsError() {
        let (model, _) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.draft, "Home")
        XCTAssertNil(model.errorText)
    }

    func testStartEditIgnoredWhenDisabled() {
        let (model, _) = makeModel(input("Home", isDisabled: true))
        model.start()
        model.startEdit()
        XCTAssertFalse(model.isEditing)
    }

    func testCancelEditRevertsDraft() {
        let (model, _) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("Edited")
        model.cancelEdit()
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(model.draft, "Home")
        XCTAssertNil(model.errorText)
    }

    func testUpdateDraftClampsToMaxLength() {
        let (model, _) = makeModel(input("Home", maxLength: 4))
        model.start()
        model.startEdit()
        model.updateDraft("Renamed")
        XCTAssertEqual(model.draft, "Rena")
    }

    func testUpdateDraftSurfacesLiveValidationButStaysSilentWhenEmpty() {
        let validate: (String) -> String? = { $0.count < 3 ? "Too short" : nil }
        let (model, _) = makeModel(input("Home"), validate: validate)
        model.start()
        model.startEdit()
        model.updateDraft("ab")
        XCTAssertEqual(model.errorText, "Too short")
        model.updateDraft("")
        XCTAssertNil(model.errorText)
        model.updateDraft("abc")
        XCTAssertNil(model.errorText)
    }

    // MARK: Commit (web commitDraft)

    func testCommitNoOpExitsWithoutSaving() async {
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("  Home ")
        let exited = await model.commitDraft()
        XCTAssertTrue(exited)
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(source.saved, [])
    }

    func testCommitEmptyBlocksAndStaysEditing() async {
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("   ")
        let exited = await model.commitDraft()
        XCTAssertFalse(exited)
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.errorText, EditableTextFieldStrings.emptyError)
        XCTAssertEqual(source.saved, [])
    }

    func testCommitCustomValidatorBlocks() async {
        let validate: (String) -> String? = { $0 == "Reserved" ? "Name in use" : nil }
        let (model, source) = makeModel(input("Home"), validate: validate)
        model.start()
        model.startEdit()
        model.updateDraft("Reserved")
        let exited = await model.commitDraft()
        XCTAssertFalse(exited)
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.errorText, "Name in use")
        XCTAssertEqual(source.saved, [])
    }

    func testCommitSuccessSavesExitsAndAnnounces() async {
        let announcer = RecordingEditableTextFieldAnnouncer()
        let (model, source) = makeModel(input("Home", ariaLabel: "Rename Home"), announcer: announcer)
        source.echoSavedValue = true
        model.start()
        model.startEdit()
        model.updateDraft("  Garage  ")
        let exited = await model.commitDraft()
        XCTAssertTrue(exited)
        XCTAssertFalse(model.isEditing)
        XCTAssertFalse(model.isSaving)
        XCTAssertNil(model.errorText)
        XCTAssertEqual(source.saved, ["Garage"])
        XCTAssertEqual(announcer.messages, [EditableTextFieldStrings.saved(label: "Rename Home")])
    }

    func testCommitRejectionSurfacesMessageAndKeepsEditing() async {
        let (model, source) = makeModel(input("Home"))
        source.saveError = EditableTextFieldSaveError("Name already taken")
        model.start()
        model.startEdit()
        model.updateDraft("Garage")
        let exited = await model.commitDraft()
        XCTAssertFalse(exited)
        XCTAssertTrue(model.isEditing)
        XCTAssertFalse(model.isSaving)
        XCTAssertEqual(model.errorText, "Name already taken")
    }

    func testCommitRejectionFallsBackWhenErrorHasNoMessage() async {
        struct Bare: Error {}
        let (model, source) = makeModel(input("Home"))
        source.saveError = Bare()
        model.start()
        model.startEdit()
        model.updateDraft("Garage")
        _ = await model.commitDraft()
        XCTAssertEqual(model.errorText, EditableTextFieldStrings.saveFailedError)
    }

    func testSkipResubmitDoesNotSaveTwice() async {
        // Echo off: the canonical value stays "Home", so a re-commit of the same submitted draft hits
        // the last-submitted guard (web Enter-then-blur double-fire) rather than the no-op guard.
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("Garage")
        let first = await model.commitDraft()
        let second = await model.commitDraft()
        XCTAssertTrue(first)
        XCTAssertTrue(second)
        XCTAssertEqual(source.saved, ["Garage"])
    }

    func testInFlightCommitGuardBlocksDuplicate() async {
        let source = GatedEditableTextFieldSource(initial: input("Home"))
        let model = EditableTextFieldModel(source: source)
        model.start()
        model.startEdit()
        model.updateDraft("Garage")

        let first = Task { await model.commitDraft() }
        await source.waitUntilSaving()
        XCTAssertTrue(model.isSaving)

        let second = await model.commitDraft()
        XCTAssertFalse(second, "a commit while one is in flight is rejected (web savingRef)")

        source.release()
        let firstResult = await first.value
        XCTAssertTrue(firstResult)
        XCTAssertFalse(model.isSaving)
        XCTAssertEqual(source.saved, ["Garage"])
    }

    func testShouldCommitOnBlurFalseWhenErrorShowing() async {
        let (model, _) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("   ")
        _ = await model.commitDraft()
        XCTAssertNotNil(model.errorText)
        XCTAssertFalse(model.shouldCommitOnBlur())
    }

    // MARK: Focus guard (web useEffect re-sync)

    func testExternalChangeWhileEditingDoesNotClobberDraft() {
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.startEdit()
        model.updateDraft("Typing")
        source.push(input("ExternalRename"))
        XCTAssertEqual(model.draft, "Typing")
    }

    func testExternalChangeWhileIdleReSyncsDraft() {
        let (model, source) = makeModel(input("Home"))
        model.start()
        XCTAssertEqual(model.draft, "Home")
        source.push(input("ExternalRename"))
        XCTAssertEqual(model.draft, "ExternalRename")
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(input("Home", connection: .live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(input("Home", connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(input("Home", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(input("Home", connection: .live))
        model.start()
        source.push(input("Home", connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(input("Home", connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(input("Home", connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsValueAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(input("Home", connection: .live))
        model.start()
        source.push(input("Home", connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(input("Home"))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyEditableTextFieldTelemetry: EditableTextFieldTelemetry, @unchecked Sendable {
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

/// Records the polite announcements the model posts on a successful save.
@MainActor
private final class RecordingEditableTextFieldAnnouncer: EditableTextFieldAnnouncer {
    private(set) var messages: [String] = []
    func announce(_ message: String) {
        messages.append(message)
    }
}

/// A source whose `save(_:)` suspends until the test releases it, so the in-flight duplicate-commit
/// guard can be exercised deterministically.
@MainActor
private final class GatedEditableTextFieldSource: EditableTextFieldSource {
    var onUpdate: (@MainActor (EditableTextFieldInput) -> Void)?
    private(set) var saved: [String] = []
    private var current: EditableTextFieldInput
    private var isSavingNow = false
    private var gate: CheckedContinuation<Void, Never>?
    private var savingWaiters: [CheckedContinuation<Void, Never>] = []

    init(initial: EditableTextFieldInput) {
        current = initial
    }

    func start() {
        onUpdate?(current)
    }

    func stop() {}
    func refresh() {}

    func save(_ value: String) async throws {
        isSavingNow = true
        for waiter in savingWaiters {
            waiter.resume()
        }
        savingWaiters.removeAll()
        await withCheckedContinuation { gate = $0 }
        saved.append(value)
        current.value = value
        isSavingNow = false
        onUpdate?(current)
    }

    func waitUntilSaving() async {
        if isSavingNow { return }
        await withCheckedContinuation { savingWaiters.append($0) }
    }

    /// Releases the parked `save(_:)` so it can complete.
    func release() {
        gate?.resume()
        gate = nil
    }
}
