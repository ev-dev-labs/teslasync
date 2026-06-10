//
//  FlagEditDrawer.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0019 · FlagEditDrawer (Apple)
//
//  State-holder coverage for `FlagEditDrawerModel`, split across two classes for the lint body
//  budget: `FlagEditDrawerModelTests` covers the `view.opened` telemetry, the body-phase / visibility
//  machine (request presents, none hides, pinned suppresses), the create / edit seeding, the form
//  reset on a new flag (and the `saving`-only no-reset), and the inline-error envelope;
//  `FlagEditDrawerModelCommandTests` covers the save gate, the save command (trimmed delegation +
//  gate guards), cancel / dismiss, and the stale / offline freshness arms. Driven through the
//  in-memory source — no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Test doubles

/// Records the `view.opened` surfaces. Lock-guarded for the `Sendable` telemetry seam.
private final class SpyFlagEditDrawerTelemetry: FlagEditDrawerTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// One recorded `onSave` payload.
private struct RecordedSave: Equatable {
    let key: String
    let value: FlagEditJSONValue
    let reason: String
}

/// Records save / close calls for assertion.
private final class RecordingFlagEditDrawerController: FlagEditDrawerController, @unchecked Sendable {
    private let lock = NSLock()
    private var savesStore: [RecordedSave] = []
    private var closes = 0

    func save(key: String, value: FlagEditJSONValue, reason: String) {
        lock.lock()
        savesStore.append(RecordedSave(key: key, value: value, reason: reason))
        lock.unlock()
    }

    func close() {
        lock.withLock { closes += 1 }
    }

    var saves: [RecordedSave] {
        lock.lock()
        defer { lock.unlock() }
        return savesStore
    }

    var closeCount: Int {
        lock.withLock { closes }
    }
}

// MARK: - Fixtures (file-private so both test classes share them)

@MainActor
private func makeFlagEditModel(
    source: InMemoryFlagEditDrawerSource,
    pinned: Bool = false,
    telemetry: SpyFlagEditDrawerTelemetry = SpyFlagEditDrawerTelemetry(),
    controller: RecordingFlagEditDrawerController = RecordingFlagEditDrawerController()
) -> FlagEditDrawerModel {
    FlagEditDrawerModel(
        source: source,
        pinned: pinned,
        telemetry: telemetry,
        controller: controller,
        localize: { _, fallback in fallback }
    )
}

private func editInitial(key: String = "feature.flag") -> FlagEditInitial {
    FlagEditInitial(key: key, value: .object(["enabled": .bool(true)]))
}

private func loadedUpdate(
    _ request: FlagEditRequest?,
    connection: FlagEditConnection = .live
) -> FlagEditDrawerUpdate {
    FlagEditDrawerUpdate(status: .loaded, request: request, connection: connection)
}

// MARK: - Telemetry / phases / visibility / seeding

@MainActor
final class FlagEditDrawerModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyFlagEditDrawerTelemetry()
        let source = InMemoryFlagEditDrawerSource()
        let model = makeFlagEditModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["FlagEditDrawer"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testCreateRequestPresentsEmptyForm() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: nil)))
        let model = makeFlagEditModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(model.mode, .create)
        XCTAssertEqual(model.keyInput, "")
        XCTAssertEqual(model.valueInput, "")
        XCTAssertFalse(model.keyDisabled)
        XCTAssertEqual(model.titleText, "Create flag")
    }

    func testEditRequestSeedsFormAndLocksKey() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: editInitial())))
        let model = makeFlagEditModel(source: source)
        model.start()
        XCTAssertEqual(model.mode, .edit)
        XCTAssertEqual(model.keyInput, "feature.flag")
        XCTAssertTrue(model.keyDisabled)
        XCTAssertTrue(model.showsImmutableNote)
        XCTAssertEqual(model.titleText, "Edit flag \"feature.flag\"")
        XCTAssertEqual(FlagEditDrawerProjection.parseValue(model.valueInput), .valid(.object(["enabled": .bool(true)])))
    }

    func testNoRequestHidesWhenNotPinned() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(nil))
        let model = makeFlagEditModel(source: source)
        model.start()
        XCTAssertEqual(model.visibility, .hidden)
        XCTAssertEqual(model.phase, .empty)
    }

    func testLoadingThenContent() {
        let source = InMemoryFlagEditDrawerSource(initial: FlagEditDrawerUpdate(status: .loading))
        let model = makeFlagEditModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(loadedUpdate(FlagEditRequest(initial: nil)))
        XCTAssertEqual(model.phase, .content)
    }

    func testFailedNoRequestResolvesError() {
        let source = InMemoryFlagEditDrawerSource(
            initial: FlagEditDrawerUpdate(status: .failed("timeout"), request: nil)
        )
        let model = makeFlagEditModel(source: source, pinned: true)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithRequestKeepsContentAndSurfacesInlineError() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: editInitial())))
        let model = makeFlagEditModel(source: source)
        model.start()
        source.push(FlagEditDrawerUpdate(
            status: .failed("stale read"),
            request: FlagEditRequest(initial: editInitial())
        ))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testNewFlagReseedsForm() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: editInitial())))
        let model = makeFlagEditModel(source: source)
        model.start()
        model.keyInput = "edited"
        model.reason = "typed reason"
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial(key: "other.flag"))))
        XCTAssertEqual(model.keyInput, "other.flag")
        XCTAssertEqual(model.reason, "")
    }

    func testSavingToggleDoesNotReseed() {
        let initial = editInitial()
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: initial)))
        let model = makeFlagEditModel(source: source)
        model.start()
        model.reason = "because"
        source.push(loadedUpdate(FlagEditRequest(initial: initial, saving: true)))
        XCTAssertEqual(model.reason, "because")
        XCTAssertTrue(model.isSaving)
    }
}

// MARK: - Save gate / commands / freshness

@MainActor
final class FlagEditDrawerModelCommandTests: XCTestCase {
    func testCanSaveGate() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: nil)))
        let model = makeFlagEditModel(source: source)
        model.start()
        XCTAssertFalse(model.canSave)
        model.keyInput = "feature.x"
        model.valueInput = "{\"a\": 1}"
        model.reason = "why"
        XCTAssertTrue(model.canSave)
        model.valueInput = "{bad"
        XCTAssertFalse(model.canSave)
        XCTAssertEqual(model.valueErrorMessage?.hasPrefix("Invalid JSON: "), true)
    }

    func testSaveDelegatesTrimmedPayload() {
        let controller = RecordingFlagEditDrawerController()
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: nil)))
        let model = makeFlagEditModel(source: source, controller: controller)
        model.start()
        model.keyInput = "  feature.x  "
        model.valueInput = "{\"a\": 1}"
        model.reason = "  why  "
        model.save()
        XCTAssertEqual(controller.saves, [
            RecordedSave(key: "feature.x", value: .object(["a": .number(1)]), reason: "why")
        ])
    }

    func testSaveIsNoOpWhenGateClosed() {
        let controller = RecordingFlagEditDrawerController()
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: nil)))
        let model = makeFlagEditModel(source: source, controller: controller)
        model.start()
        model.keyInput = "feature.x"
        model.valueInput = "{bad"
        model.reason = "why"
        model.save()
        XCTAssertTrue(controller.saves.isEmpty)
    }

    func testSaveIsNoOpWhileSaving() {
        let controller = RecordingFlagEditDrawerController()
        let request = FlagEditRequest(initial: editInitial(), saving: true)
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(request))
        let model = makeFlagEditModel(source: source, controller: controller)
        model.start()
        model.reason = "why"
        model.save()
        XCTAssertTrue(controller.saves.isEmpty)
    }

    func testCancelAndDismissDelegateClose() {
        let controller = RecordingFlagEditDrawerController()
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: nil)))
        let model = makeFlagEditModel(source: source, controller: controller)
        model.start()
        model.cancel()
        model.dismiss()
        XCTAssertEqual(controller.closeCount, 2)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: editInitial())))
        let model = makeFlagEditModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial()), connection: .stale))
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial()), connection: .live))
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial()), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryFlagEditDrawerSource(initial: loadedUpdate(FlagEditRequest(initial: editInitial())))
        let model = makeFlagEditModel(source: source)
        model.start()
        source.push(loadedUpdate(FlagEditRequest(initial: editInitial()), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.visibility, .presented)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
