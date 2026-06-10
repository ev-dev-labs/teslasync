//
//  Modal.ModelTests.swift
//  TeslaSync — P4 modal/dialog · 0014 · Modal (Apple)
//
//  State-holder coverage for `ModalModel`: the P1/S11 `view.opened` telemetry (once + idempotent,
//  re-armed after stop), the body-phase propagation across loading / data / empty / failed, the
//  dismiss command delegation (web `onClose` — controller hand-off + local `isPresented` collapse),
//  the stale auto-refresh (once, re-armed on return to live), offline keeping the cached body, and
//  the derived labelling (web `aria-labelledby` vs `aria-label`). Driven through the in-memory source
//  — no network.
//

import XCTest
@testable import TeslaSync

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam
/// under Swift 6 strict concurrency.
private final class SpyModalTelemetry: ModalTelemetry, @unchecked Sendable {
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

/// Records the dismiss hand-offs.
private final class SpyModalDismissController: ModalDismissController, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0

    func dismiss() {
        lock.lock()
        count += 1
        lock.unlock()
    }

    var dismissCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }
}

@MainActor
final class ModalModelTests: XCTestCase {
    private func makeModel(
        title: String? = "Modal",
        ariaLabel: String? = nil,
        source: InMemoryModalSource,
        telemetry: SpyModalTelemetry = SpyModalTelemetry(),
        controller: SpyModalDismissController = SpyModalDismissController()
    ) -> ModalModel {
        ModalModel(
            title: title,
            ariaLabel: ariaLabel,
            source: source,
            telemetry: telemetry,
            controller: controller,
            localize: { _, fallback in fallback }
        )
    }

    private func loaded(_ connection: ModalConnection = .live, hasContent: Bool = true) -> ModalUpdate {
        ModalUpdate(status: .loaded, hasContent: hasContent, connection: connection)
    }

    // MARK: Telemetry

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyModalTelemetry()
        let source = InMemoryModalSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["Modal"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStopThenStartReemitsViewOpened() {
        let spy = SpyModalTelemetry()
        let source = InMemoryModalSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["Modal", "Modal"])
    }

    // MARK: Body-phase propagation

    func testLoadingThenDataPropagates() {
        let source = InMemoryModalSource(initial: ModalUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.bodyPhase, .loading)
        source.push(loaded())
        XCTAssertEqual(model.bodyPhase, .data)
        XCTAssertEqual(model.bodyAccessibilitySummary, "Dialog content")
    }

    func testLoadedWithoutContentResolvesEmpty() {
        let source = InMemoryModalSource(initial: loaded(hasContent: false))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.bodyPhase, .empty)
    }

    func testFailedResolvesError() {
        let source = InMemoryModalSource(initial: ModalUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.bodyPhase, .error("timeout"))
    }

    // MARK: Dismiss (web onClose)

    func testCloseDelegatesAndCollapsesPresentation() {
        let controller = SpyModalDismissController()
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(source: source, controller: controller)
        model.start()
        XCTAssertTrue(model.isPresented)
        model.close()
        XCTAssertEqual(controller.dismissCount, 1)
        XCTAssertFalse(model.isPresented)
    }

    // MARK: Refresh / freshness

    func testRefreshDelegatesToSource() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsBodyAndDoesNotRefresh() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(source: source)
        model.start()
        source.push(loaded(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.bodyPhase, .data)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Derived labelling (web aria-labelledby vs aria-label)

    func testTitledModelExposesHeaderAndLabel() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(title: "Battery", source: source)
        model.start()
        XCTAssertTrue(model.showsHeader)
        XCTAssertEqual(model.label, .titled("Battery"))
        XCTAssertEqual(model.accessibilityLabel, "Battery")
    }

    func testAnonymousModelHidesHeaderAndUsesAriaLabel() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(title: nil, ariaLabel: "Quick action", source: source)
        model.start()
        XCTAssertFalse(model.showsHeader)
        XCTAssertEqual(model.label, .anonymous("Quick action"))
        XCTAssertEqual(model.accessibilityLabel, "Quick action")
    }

    func testUntitledModelFallsBackToGenericLabel() {
        let source = InMemoryModalSource(initial: loaded())
        let model = makeModel(title: nil, source: source)
        model.start()
        XCTAssertFalse(model.showsHeader)
        XCTAssertEqual(model.label, .untitled)
        XCTAssertEqual(model.accessibilityLabel, "Dialog")
    }
}
