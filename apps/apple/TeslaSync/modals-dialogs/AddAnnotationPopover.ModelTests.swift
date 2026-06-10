//
//  AddAnnotationPopover.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0002 · AddAnnotationPopover (Apple)
//
//  State-holder coverage for `AddAnnotationModel`: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across loading / loaded-empty / failed (incl. the inline-error
//  envelope when a cached context survives a failed reload), the date re-sync from the context
//  timestamp (web `useEffect`), the submit guard + draft delegation (web `onAdd`) with field reset,
//  cancel (web `onCancel`), the stale auto-refresh (once, re-armed on return to live), and offline
//  keeping the form. Driven through the in-memory source — no persistence.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpyAddAnnotationTelemetry: AddAnnotationTelemetry, @unchecked Sendable {
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

/// Records the submitted drafts + the cancel calls.
private final class SpyAddAnnotationController: AddAnnotationController, @unchecked Sendable {
    private let lock = NSLock()
    private var submitted: [AddAnnotationDraft] = []
    private var cancels = 0

    func submit(draft: AddAnnotationDraft) {
        lock.lock()
        submitted.append(draft)
        lock.unlock()
    }

    func cancel() {
        lock.lock()
        cancels += 1
        lock.unlock()
    }

    var drafts: [AddAnnotationDraft] {
        lock.lock()
        defer { lock.unlock() }
        return submitted
    }

    var cancelCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return cancels
    }
}

@MainActor
final class AddAnnotationModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryAddAnnotationSource,
        telemetry: SpyAddAnnotationTelemetry = SpyAddAnnotationTelemetry(),
        controller: SpyAddAnnotationController = SpyAddAnnotationController()
    ) -> AddAnnotationModel {
        AddAnnotationModel(
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: passthroughLocalize
        )
    }

    private func fixedContext(_ editable: Bool = false) -> AddAnnotationDraftContext {
        AddAnnotationDraftContext(timestamp: "2024-05-18T14:30:00Z", editableDate: editable)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyAddAnnotationTelemetry()
        let source = InMemoryAddAnnotationSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["AddAnnotationPopover"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryAddAnnotationSource(initial: AddAnnotationUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.categoryOptions.count, 6)
    }

    func testLoadedNoContextResolvesEmpty() {
        let source = InMemoryAddAnnotationSource(initial: AddAnnotationUpdate(status: .loaded))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedNoContextResolvesError() {
        let source = InMemoryAddAnnotationSource(initial: AddAnnotationUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.phase, .error("timeout"))
        XCTAssertNil(model.inlineErrorMessage)
    }

    func testFailedWithContextKeepsContentAndSurfacesInlineError() {
        let loaded = AddAnnotationUpdate(status: .loaded, context: fixedContext())
        let source = InMemoryAddAnnotationSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(AddAnnotationUpdate(status: .failed("stale read"), context: fixedContext()))
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.inlineErrorMessage, "stale read")
    }

    func testDateSyncedFromContextTimestamp() {
        let source = InMemoryAddAnnotationSource(
            initial: AddAnnotationUpdate(status: .loaded, context: fixedContext(true))
        )
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.editedDate, "2024-05-18")
        XCTAssertTrue(model.editableDate)
        XCTAssertEqual(model.occurredAt, "2024-05-18T00:00:00Z")
    }

    func testDateResyncsOnlyWhenTimestampChanges() {
        let source = InMemoryAddAnnotationSource(
            initial: AddAnnotationUpdate(status: .loaded, context: fixedContext(true))
        )
        let model = makeModel(source: source)
        model.start()
        model.editedDate = "2024-01-01"
        // Same timestamp re-push must NOT clobber the user's edit.
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(true)))
        XCTAssertEqual(model.editedDate, "2024-01-01")
        // A new anchor timestamp DOES re-sync.
        let next = AddAnnotationDraftContext(timestamp: "2024-07-04T00:00:00Z", editableDate: true)
        source.push(AddAnnotationUpdate(status: .loaded, context: next))
        XCTAssertEqual(model.editedDate, "2024-07-04")
    }

    func testSubmitDelegatesValidatedDraftAndResetsFields() {
        let controller = SpyAddAnnotationController()
        let source = InMemoryAddAnnotationSource(
            initial: AddAnnotationUpdate(status: .loaded, context: fixedContext())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.label = "  Battery replaced  "
        model.category = .maintenance
        model.annotationDescription = " swapped pack "
        XCTAssertTrue(model.canSubmit)
        model.submit()
        XCTAssertEqual(controller.drafts.count, 1)
        XCTAssertEqual(controller.drafts.first?.label, "Battery replaced")
        XCTAssertEqual(controller.drafts.first?.category, .maintenance)
        XCTAssertEqual(controller.drafts.first?.description, "swapped pack")
        XCTAssertEqual(controller.drafts.first?.occurredAt, "2024-05-18T14:30:00Z")
        // Fields reset to web defaults.
        XCTAssertEqual(model.label, "")
        XCTAssertEqual(model.category, .milestone)
        XCTAssertEqual(model.annotationDescription, "")
    }

    func testSubmitNoOpWhenLabelEmpty() {
        let controller = SpyAddAnnotationController()
        let source = InMemoryAddAnnotationSource(
            initial: AddAnnotationUpdate(status: .loaded, context: fixedContext())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.label = "   "
        XCTAssertFalse(model.canSubmit)
        model.submit()
        XCTAssertTrue(controller.drafts.isEmpty)
    }

    func testCancelResetsFieldsAndDelegates() {
        let controller = SpyAddAnnotationController()
        let source = InMemoryAddAnnotationSource(
            initial: AddAnnotationUpdate(status: .loaded, context: fixedContext())
        )
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.label = "Draft"
        model.category = .issue
        model.cancel()
        XCTAssertEqual(controller.cancelCount, 1)
        XCTAssertEqual(model.label, "")
        XCTAssertEqual(model.category, .milestone)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let loaded = AddAnnotationUpdate(status: .loaded, context: fixedContext())
        let source = InMemoryAddAnnotationSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(), connection: .stale))
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(), connection: .live))
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let loaded = AddAnnotationUpdate(status: .loaded, context: fixedContext())
        let source = InMemoryAddAnnotationSource(initial: loaded)
        let model = makeModel(source: source)
        model.start()
        source.push(AddAnnotationUpdate(status: .loaded, context: fixedContext(), connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }
}
