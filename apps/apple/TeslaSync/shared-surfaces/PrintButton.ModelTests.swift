//
//  PrintButton.ModelTests.swift
//  TeslaSync — P4 shared surface · 0223 · PrintButton (Apple)
//
//  Telemetry + print-flow coverage split out of `…Tests.swift` (one concern per file): the P1/S11
//  `view.opened` emission seam (emitted exactly once on first appearance; never double-counted), the
//  stable diagnostics slug, and the `PrintButtonModel` behaviour — the web `handleClick` flow
//  reproduced verbatim: open the print dialog after the optional awaited `beforePrint`, run
//  `beforePrint` before the dialog, skip the dialog (and reset the guard) when `beforePrint` throws
//  (web `catch`), and ignore a re-entrant activation while a print is in flight (web
//  `if (printing) return`). Also covers the platform presenter seam (the injected-action path +
//  the published request count) and the in-memory presenter's success / failure result. Driven by
//  spies + the in-memory presenter; no network, no store, no real print server.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class PrintButtonDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyPrintButtonTelemetry()
        let emitted = PrintButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [PrintButtonMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyPrintButtonTelemetry()
        var emitted = PrintButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = PrintButtonDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [PrintButtonMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyPrintButtonTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [PrintButtonMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(PrintButtonMeta.surfaceSlug, "PrintButton")
        XCTAssertEqual(PrintButton.surfaceSlug, "PrintButton")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogPrintButtonTelemetry().viewOpened(surface: PrintButtonMeta.surfaceSlug)
    }
}

// MARK: - Model print flow (web handleClick)

@MainActor final class PrintButtonModelTests: XCTestCase {
    func testPerformPrintOpensDialog() async {
        let presenter = InMemoryPrintPresenter()
        let model = makeModel(presenter: presenter)
        await model.performPrint()
        XCTAssertEqual(presenter.presentCount, 1, "the print dialog opened (web `window.print()`)")
        XCTAssertFalse(model.isPrinting, "the guard is cleared after the print resolves")
    }

    func testBeforePrintRunsBeforeTheDialog() async {
        let recorder = CallRecorder()
        let presenter = RecordingPrintPresenter(recorder: recorder)
        let model = makeModel(presenter: presenter, beforePrint: { recorder.record("before") })
        await model.performPrint()
        XCTAssertEqual(
            recorder.events,
            ["before", "present"],
            "the setup hook is awaited before the dialog opens (web `await beforePrint()`)"
        )
    }

    func testThrownBeforePrintSkipsTheDialog() async {
        let presenter = InMemoryPrintPresenter()
        let model = makeModel(presenter: presenter, beforePrint: { throw PrintButtonTestError.boom })
        await model.performPrint()
        XCTAssertEqual(presenter.presentCount, 0, "a thrown beforePrint skips the dialog (web `catch`)")
        XCTAssertFalse(model.isPrinting, "the guard is reset after a failed beforePrint")
    }

    func testNoBeforePrintOpensDialogDirectly() async {
        let presenter = InMemoryPrintPresenter()
        let model = makeModel(presenter: presenter, beforePrint: nil)
        await model.performPrint()
        XCTAssertEqual(presenter.presentCount, 1)
    }

    func testGuardIsResetEvenWhenPresenterReportsFailure() async {
        let presenter = InMemoryPrintPresenter(succeeds: false)
        let model = makeModel(presenter: presenter)
        await model.performPrint()
        XCTAssertEqual(presenter.presentCount, 1, "the dialog was requested")
        XCTAssertFalse(model.isPrinting, "the guard is cleared regardless of the platform result")
    }

    func testReentrantPrintDuringBeforePrintIsGuarded() async {
        let presenter = InMemoryPrintPresenter()
        let holder = ModelHolder()
        // The setup hook re-enters the print flow while `isPrinting` is already true; the guard must
        // make that nested call a no-op (web `if (printing) return`), so only the outer print opens
        // the dialog — and the recursion never runs away.
        let model = PrintButtonModel(
            presenter: presenter,
            beforePrint: { await holder.model?.performPrint() }
        )
        holder.model = model
        await model.performPrint()
        XCTAssertEqual(presenter.presentCount, 1, "the re-entrant print was guarded (web parity)")
        XCTAssertFalse(model.isPrinting)
    }

    func testRequestPrintOpensDialogFromTheFireAndForgetEntry() async {
        let presenter = InMemoryPrintPresenter()
        let model = makeModel(presenter: presenter)
        model.requestPrint()
        // The view's tap spawns the awaited flow; yield the scheduler until it completes.
        for _ in 0 ..< 100 where presenter.presentCount == 0 {
            await Task.yield()
        }
        XCTAssertEqual(presenter.presentCount, 1)
        XCTAssertFalse(model.isPrinting)
    }
}

// MARK: - Print presenter seams (native parity of window.print())

@MainActor final class PrintButtonPresenterTests: XCTestCase {
    func testSystemPresenterUsesInjectedActionAndPublishesRequest() {
        let recorder = CallRecorder()
        let presenter = SystemPrintPresenter(printAction: {
            recorder.record("print")
            return true
        })
        XCTAssertEqual(presenter.requestCount, 0)
        XCTAssertTrue(presenter.present(), "the injected action reports success")
        XCTAssertEqual(recorder.events, ["print"], "the injected print action ran")
        XCTAssertEqual(presenter.requestCount, 1, "the request is published for host observers")
    }

    func testInMemoryPresenterReportsConfiguredResult() {
        let ok = InMemoryPrintPresenter(succeeds: true)
        XCTAssertTrue(ok.present())
        XCTAssertEqual(ok.presentCount, 1)

        let unavailable = InMemoryPrintPresenter(succeeds: false)
        XCTAssertFalse(unavailable.present())
        XCTAssertEqual(unavailable.presentCount, 1)
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    presenter: any PrintPresenting = InMemoryPrintPresenter(),
    beforePrint: (@MainActor () async throws -> Void)? = nil,
    telemetry: any PrintButtonTelemetry = OSLogPrintButtonTelemetry()
) -> PrintButtonModel {
    PrintButtonModel(presenter: presenter, beforePrint: beforePrint, telemetry: telemetry)
}

/// A surface error used to drive the `beforePrint` failure branch.
private enum PrintButtonTestError: Error {
    case boom
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyPrintButtonTelemetry: PrintButtonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records an ordered event log on the main actor (for the beforePrint-before-present assertion).
@MainActor private final class CallRecorder {
    private(set) var events: [String] = []
    func record(_ event: String) {
        events.append(event)
    }
}

/// An in-memory presenter that appends to a shared recorder so call ordering can be asserted.
@MainActor private final class RecordingPrintPresenter: PrintPresenting {
    private let recorder: CallRecorder
    private(set) var presentCount = 0

    init(recorder: CallRecorder) {
        self.recorder = recorder
    }

    @discardableResult
    func present() -> Bool {
        presentCount += 1
        recorder.record("present")
        return true
    }
}

/// Holds a late-bound model reference so a `beforePrint` hook can re-enter the print flow (the
/// re-entrancy-guard test).
@MainActor private final class ModelHolder {
    var model: PrintButtonModel?
}
