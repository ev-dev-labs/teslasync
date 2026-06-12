//
//  CopyButton.ModelTests.swift
//  TeslaSync — P4 shared surface · 0207 · CopyButton (Apple)
//
//  Telemetry + copy-flow coverage split out of `…Tests.swift` (one concern per file): the P1/S11
//  `view.opened` emission seam (emitted exactly once on first appearance; never double-counted), the
//  stable diagnostics slug, and the `CopyButtonModel` behaviour — the web `handleCopy` flow
//  reproduced verbatim: write the current text to the clipboard, flip to the "Copied" confirmation +
//  invoke `onCopy` + announce the success toast (when `withToast`), arm the reset, and the `catch`
//  branch (failed write → error toast when `withToast`, no `onCopy`, stays resting). Covers the
//  `withToast` opt-in gate (no toast either way when off), the graceful no-presenter degrade, and the
//  auto-reset of the transient flag. Driven by spies + the in-memory clipboard; no network, no store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class CopyButtonDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyCopyButtonTelemetry()
        let emitted = CopyButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [CopyButtonMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyCopyButtonTelemetry()
        var emitted = CopyButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = CopyButtonDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [CopyButtonMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyCopyButtonTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [CopyButtonMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(CopyButtonMeta.surfaceSlug, "CopyButton")
        XCTAssertEqual(CopyButton.surfaceSlug, "CopyButton")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogCopyButtonTelemetry().viewOpened(surface: CopyButtonMeta.surfaceSlug)
    }
}

// MARK: - Model copy flow (web handleCopy)

@MainActor final class CopyButtonModelTests: XCTestCase {
    func testCurrentTextReflectsProvider() {
        XCTAssertEqual(makeModel(text: "VIN-123").currentText, "VIN-123")
    }

    func testCopyTextWritesCurrentTextToClipboard() {
        let clipboard = InMemoryCopyButtonClipboard()
        let model = makeModel(text: "sk-token-abc", clipboard: clipboard)
        model.copyText()
        XCTAssertEqual(clipboard.writes, ["sk-token-abc"])
    }

    func testCopyTextResolvesTextFreshOnEachCopy() {
        var live = "first"
        let model = CopyButtonModel(
            textProvider: ResolvingCopyButtonTextSource { live },
            clipboard: InMemoryCopyButtonClipboard()
        )
        XCTAssertEqual(model.currentText, "first")
        live = "second"
        XCTAssertEqual(model.currentText, "second", "the text source resolves fresh on each read")
    }

    func testCopyTextSuccessSetsCopiedInvokesOnCopyAndAnnouncesSuccess() {
        let toast = SpyCopyButtonToast()
        let onCopy = CallCounter()
        let model = makeModel(
            text: "payload",
            clipboard: InMemoryCopyButtonClipboard(succeeds: true),
            toast: toast,
            withToast: true,
            onCopy: { onCopy.increment() }
        )
        model.copyText()
        XCTAssertTrue(model.copied)
        XCTAssertEqual(onCopy.count, 1, "onCopy fires exactly once on a successful copy")
        XCTAssertEqual(toast.events.count, 1)
        XCTAssertEqual(toast.events.first?.severity, .success)
        XCTAssertEqual(toast.events.first?.message, "Copied to clipboard")
    }

    func testCopyTextSuccessWithoutWithToastSkipsToastButStillCopies() {
        let toast = SpyCopyButtonToast()
        let onCopy = CallCounter()
        let model = makeModel(
            text: "payload",
            clipboard: InMemoryCopyButtonClipboard(succeeds: true),
            toast: toast,
            withToast: false,
            onCopy: { onCopy.increment() }
        )
        model.copyText()
        XCTAssertTrue(model.copied)
        XCTAssertEqual(onCopy.count, 1)
        XCTAssertTrue(toast.events.isEmpty, "withToast=false suppresses the toast (web default)")
    }

    func testCopyTextFailureAnnouncesErrorDoesNotCopyOrCallOnCopy() {
        let toast = SpyCopyButtonToast()
        let onCopy = CallCounter()
        let model = makeModel(
            text: "payload",
            clipboard: InMemoryCopyButtonClipboard(succeeds: false),
            toast: toast,
            withToast: true,
            onCopy: { onCopy.increment() }
        )
        model.copyText()
        XCTAssertFalse(model.copied, "a failed write stays in the resting state (web `catch`)")
        XCTAssertEqual(onCopy.count, 0, "onCopy never fires on a failed copy")
        XCTAssertEqual(toast.events.first?.severity, .error)
        XCTAssertEqual(toast.events.first?.message, "Failed to copy")
    }

    func testCopyTextFailureWithoutWithToastSkipsToast() {
        let toast = SpyCopyButtonToast()
        let model = makeModel(
            text: "payload",
            clipboard: InMemoryCopyButtonClipboard(succeeds: false),
            toast: toast,
            withToast: false
        )
        model.copyText()
        XCTAssertFalse(model.copied)
        XCTAssertTrue(toast.events.isEmpty, "withToast=false suppresses the error toast too")
    }

    func testCopyTextWithoutPresenterStillWritesClipboard() {
        let clipboard = InMemoryCopyButtonClipboard()
        let model = makeModel(text: "payload", clipboard: clipboard, toast: nil, withToast: true)
        model.copyText()
        XCTAssertEqual(clipboard.writes.count, 1, "copy runs even without a toast presenter")
        XCTAssertTrue(model.copied)
    }

    func testCopiedRevertsAfterAutoResetDelay() async throws {
        let model = makeModel(
            text: "payload",
            clipboard: InMemoryCopyButtonClipboard(),
            autoResetDelay: .milliseconds(20)
        )
        model.copyText()
        XCTAssertTrue(model.copied)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertFalse(model.copied, "the transient confirmation reverts after the reset delay")
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    text: String = "payload",
    clipboard: any CopyButtonClipboard = InMemoryCopyButtonClipboard(),
    toast: (any CopyButtonToastPresenter)? = nil,
    withToast: Bool = false,
    onCopy: (@MainActor () -> Void)? = nil,
    telemetry: any CopyButtonTelemetry = OSLogCopyButtonTelemetry(),
    autoResetDelay: Duration = .seconds(2)
) -> CopyButtonModel {
    CopyButtonModel(
        textProvider: StaticCopyButtonTextSource(text),
        clipboard: clipboard,
        toast: toast,
        withToast: withToast,
        onCopy: onCopy,
        telemetry: telemetry,
        autoResetDelay: autoResetDelay
    )
}

/// A trivial `@MainActor` counter so the `onCopy` callback's invocation count can be asserted.
@MainActor private final class CallCounter {
    private(set) var count = 0
    func increment() {
        count += 1
    }
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyCopyButtonTelemetry: CopyButtonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toast announcements the model emits so the copy-outcome mapping can be asserted.
@MainActor private final class SpyCopyButtonToast: CopyButtonToastPresenter {
    private(set) var events: [(severity: CopyButtonToastSeverity, message: String)] = []
    func presentToast(severity: CopyButtonToastSeverity, message: String) {
        events.append((severity, message))
    }
}
