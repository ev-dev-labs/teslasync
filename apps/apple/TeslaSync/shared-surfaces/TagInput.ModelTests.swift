//
//  TagInput.ModelTests.swift
//  TeslaSync — P4 shared surface · 0160 · TagInput (Apple)
//
//  State-holder coverage for `TagInputModel` plus its seams: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / ready / error), the typed-separator /
//  Enter / blur commit paths, Backspace-removes-last, chip removal, the duplicate / cap / validation
//  rejection branches with their polite announcements (web live region) + the rotating dedupe padding, the
//  lowercase storage, the connection axis (live / stale / offline) with the one-shot stale auto-refresh
//  (re-armed on return to live) and offline keeping the tags, and the stop / restart wiring. Driven
//  through the in-memory seam — no network.
//

import XCTest
@testable import TeslaSync

@MainActor
final class TagInputModelTests: XCTestCase {
    private func snapshot(
        tags: [String] = [],
        maxTags: Int? = nil,
        lowercase: Bool = false,
        disabled: Bool = false,
        isLoading: Bool = false,
        errorMessage: String? = nil,
        connection: TagInputConnection = .live
    ) -> TagInputSnapshot {
        TagInputSnapshot(
            tags: tags,
            label: "Tags",
            maxTags: maxTags,
            separators: [.comma],
            lowercase: lowercase,
            disabled: disabled,
            isLoading: isLoading,
            errorMessage: errorMessage,
            connection: connection
        )
    }

    private func makeModel(
        _ input: TagInputSnapshot,
        validate: ((String) -> String?)? = nil,
        telemetry: TagInputTelemetry = OSLogTagInputTelemetry(),
        announcer: TagInputAnnouncer = OSLogTagInputAnnouncer()
    ) -> (TagInputModel, InMemoryTagInputSource) {
        let source = InMemoryTagInputSource(initial: input)
        let model = TagInputModel(
            source: source,
            validate: validate,
            telemetry: telemetry,
            announcer: announcer
        )
        return (model, source)
    }

    // MARK: Lifecycle + telemetry

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyTagInputTelemetry()
        let (model, source) = makeModel(snapshot(tags: ["a", "b"]), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.tags, ["a", "b"])
        XCTAssertEqual(spy.surfaces, [TagInputMeta.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(snapshot(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorInputProjectsErrorPhase() {
        let (model, _) = makeModel(snapshot(errorMessage: "boom"))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyInitialRendersReadyEmpty() {
        let (model, _) = makeModel(snapshot())
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertTrue(model.resolved.isEmpty)
        XCTAssertEqual(model.editingText, "")
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(snapshot(tags: ["a"]))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(TagInputMeta.surfaceSlug, "TagInput")
    }

    // MARK: Editing (web handleInputChange / Enter / blur)

    func testUpdatePendingWithoutSeparatorStoresText() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.updatePending("foo")
        XCTAssertEqual(model.editingText, "foo")
        XCTAssertTrue(model.resolved.isEmpty)
        XCTAssertTrue(source.committed.isEmpty)
    }

    func testTypedSeparatorCommitsAndKeepsRemainder() {
        let spy = SpyTagInputAnnouncer()
        let (model, source) = makeModel(snapshot(), announcer: spy)
        model.start()
        model.updatePending("foo,bar")
        XCTAssertEqual(model.resolved.tags, ["foo"])
        XCTAssertEqual(model.editingText, "bar")
        XCTAssertEqual(source.committed.last, ["foo"])
        XCTAssertTrue(spy.messages.last?.contains("Tag added") == true)
    }

    func testSubmitCommitsPendingAndClears() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.updatePending("highway")
        model.submit()
        XCTAssertEqual(model.resolved.tags, ["highway"])
        XCTAssertEqual(model.editingText, "")
        XCTAssertEqual(source.committed.last, ["highway"])
    }

    func testCommitPendingIfNeededIgnoresBlank() {
        let (model, source) = makeModel(snapshot())
        model.start()
        model.updatePending("   ")
        model.commitPendingIfNeeded()
        XCTAssertTrue(model.resolved.isEmpty)
        XCTAssertTrue(source.committed.isEmpty)
    }

    func testCommitPendingIfNeededCommitsNonBlank() {
        let (model, _) = makeModel(snapshot())
        model.start()
        model.updatePending("weekend")
        model.commitPendingIfNeeded()
        XCTAssertEqual(model.resolved.tags, ["weekend"])
        XCTAssertEqual(model.editingText, "")
    }

    func testSequentialAddsAccumulate() {
        let (model, _) = makeModel(snapshot())
        model.start()
        model.updatePending("a,")
        model.updatePending("b,")
        XCTAssertEqual(model.resolved.tags, ["a", "b"])
    }

    // MARK: Backspace (web Backspace at empty field)

    func testBackspaceRemovesLastWhenEmpty() {
        let spy = SpyTagInputAnnouncer()
        let (model, source) = makeModel(snapshot(tags: ["a", "b"]), announcer: spy)
        model.start()
        model.backspaceAtStart()
        XCTAssertEqual(model.resolved.tags, ["a"])
        XCTAssertEqual(source.committed.last, ["a"])
        XCTAssertTrue(spy.messages.last?.contains("Removed b") == true)
    }

    func testBackspaceNoOpWhenPendingPresent() {
        let (model, source) = makeModel(snapshot(tags: ["a"]))
        model.start()
        model.updatePending("x")
        model.backspaceAtStart()
        XCTAssertEqual(model.resolved.tags, ["a"])
        XCTAssertTrue(source.committed.isEmpty)
    }

    // MARK: Chip removal

    func testRemoveTagCommitsAndAnnounces() {
        let spy = SpyTagInputAnnouncer()
        let (model, source) = makeModel(snapshot(tags: ["a", "b", "c"]), announcer: spy)
        model.start()
        model.removeTag(at: 1)
        XCTAssertEqual(model.resolved.tags, ["a", "c"])
        XCTAssertEqual(source.committed.last, ["a", "c"])
        XCTAssertTrue(spy.messages.last?.contains("Removed b") == true)
    }

    func testRemoveTagIgnoredWhenDisabled() {
        let (model, source) = makeModel(snapshot(tags: ["a"], disabled: true))
        model.start()
        model.removeTag(at: 0)
        XCTAssertEqual(model.resolved.tags, ["a"])
        XCTAssertTrue(source.committed.isEmpty)
    }

    // MARK: Rejection branches

    func testDuplicateAnnouncedNotCommitted() {
        let spy = SpyTagInputAnnouncer()
        let (model, source) = makeModel(snapshot(tags: ["foo"]), announcer: spy)
        model.start()
        model.updatePending("foo,")
        XCTAssertEqual(model.resolved.tags, ["foo"])
        XCTAssertTrue(source.committed.isEmpty)
        XCTAssertTrue(spy.messages.last?.contains("already added") == true)
    }

    func testCapBlocksAndAnnounces() {
        let spy = SpyTagInputAnnouncer()
        let (model, source) = makeModel(snapshot(tags: ["a", "b"], maxTags: 2), announcer: spy)
        model.start()
        XCTAssertTrue(model.resolved.isDisabled)
        model.updatePending("c,")
        XCTAssertEqual(model.resolved.tags, ["a", "b"])
        XCTAssertTrue(source.committed.isEmpty)
        XCTAssertTrue(spy.messages.last?.contains("Tag limit reached") == true)
    }

    func testValidationErrorBlocksAndClearsOnEdit() {
        let validate: (String) -> String? = { $0.count < 2 ? "Too short" : nil }
        let (model, source) = makeModel(snapshot(), validate: validate)
        model.start()
        model.updatePending("a,")
        XCTAssertEqual(model.errorText, "Too short")
        XCTAssertTrue(source.committed.isEmpty)
        model.updatePending("ab")
        XCTAssertNil(model.errorText)
        XCTAssertEqual(model.editingText, "ab")
    }

    func testLowercaseStored() {
        let (model, _) = makeModel(snapshot(lowercase: true))
        model.start()
        model.updatePending("FooBar,")
        XCTAssertEqual(model.resolved.tags, ["foobar"])
    }

    // MARK: Announcement dedupe padding

    func testRepeatedAddAnnouncementsRotatePadding() {
        let spy = SpyTagInputAnnouncer()
        let (model, _) = makeModel(snapshot(), announcer: spy)
        model.start()
        model.updatePending("a,")
        model.updatePending("b,")
        XCTAssertEqual(spy.messages.count, 2)
        XCTAssertNotEqual(spy.messages[0], spy.messages[1])
    }

    // MARK: Connection axis (P4 leaf)

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(snapshot(tags: ["a"], connection: .live))
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(snapshot(tags: ["a"], connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        source.push(snapshot(tags: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(snapshot(tags: ["a"], connection: .live))
        model.start()
        source.push(snapshot(tags: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(snapshot(tags: ["a"], connection: .live))
        XCTAssertEqual(model.connection, .live)
        source.push(snapshot(tags: ["a"], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsTagsAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(snapshot(tags: ["a"], connection: .live))
        model.start()
        source.push(snapshot(tags: ["a"], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.resolved.tags, ["a"])
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(snapshot(tags: ["a"]))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyTagInputTelemetry: TagInputTelemetry, @unchecked Sendable {
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

/// Records the polite announcements the model posts (the web live-region writes), so the spoken text is
/// asserted without driving the real assistive technology.
@MainActor
private final class SpyTagInputAnnouncer: TagInputAnnouncer {
    private(set) var messages: [String] = []

    func announce(_ message: String) {
        messages.append(message)
    }
}
