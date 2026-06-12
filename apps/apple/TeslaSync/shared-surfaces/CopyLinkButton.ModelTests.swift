//
//  CopyLinkButton.ModelTests.swift
//  TeslaSync — P4 shared surface · 0168 · CopyLinkButton (Apple)
//
//  Telemetry + copy-flow coverage split out of `…Tests.swift` (one concern per file): the P1/S11
//  `view.opened` emission seam (emitted exactly once on first appearance; never double-counted), the
//  stable diagnostics slug, and the `CopyLinkButtonModel` behaviour — the web `handleClick` flow
//  reproduced verbatim: read the ambient URL, write it to the clipboard, flip to the "Copied"
//  confirmation + success toast, arm the reset, and the `catch` / unavailable-URL → error-toast
//  branches (incl. the graceful no-presenter degrade and the auto-reset of the transient flag).
//  Driven by spies + the in-memory clipboard; no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Diagnostics emission seam (P1/S11 view.opened)

@MainActor final class CopyLinkButtonDiagnosticsTests: XCTestCase {
    func testOpenIfNeededEmitsOnce() {
        let spy = SpyCopyLinkButtonTelemetry()
        let emitted = CopyLinkButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [CopyLinkButtonMeta.surfaceSlug])
    }

    func testOpenIfNeededDoesNotDoubleEmit() {
        let spy = SpyCopyLinkButtonTelemetry()
        var emitted = CopyLinkButtonDiagnostics.openIfNeeded(alreadyEmitted: false, telemetry: spy)
        emitted = CopyLinkButtonDiagnostics.openIfNeeded(alreadyEmitted: emitted, telemetry: spy)
        XCTAssertTrue(emitted)
        XCTAssertEqual(spy.surfaces, [CopyLinkButtonMeta.surfaceSlug])
    }

    func testModelMarkAppearedEmitsOnceAcrossRepeatedAppearances() {
        let spy = SpyCopyLinkButtonTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, [CopyLinkButtonMeta.surfaceSlug])
    }

    func testSlugIsStable() {
        XCTAssertEqual(CopyLinkButtonMeta.surfaceSlug, "CopyLinkButton")
        XCTAssertEqual(CopyLinkButton.surfaceSlug, "CopyLinkButton")
    }

    func testOSLogTelemetryIsInvokable() {
        OSLogCopyLinkButtonTelemetry().viewOpened(surface: CopyLinkButtonMeta.surfaceSlug)
    }
}

// MARK: - Model copy flow (web handleClick)

@MainActor final class CopyLinkButtonModelTests: XCTestCase {
    func testCanCopyReflectsURL() {
        XCTAssertTrue(makeModel(url: "https://teslasync.app/drives").canCopy)
        XCTAssertFalse(makeModel(url: "").canCopy)
    }

    func testCopyLinkWritesCurrentURLToClipboard() {
        let clipboard = InMemoryCopyLinkClipboard()
        let model = makeModel(url: "https://teslasync.app/map?z=12", clipboard: clipboard)
        model.copyLink()
        XCTAssertEqual(clipboard.writes, ["https://teslasync.app/map?z=12"])
    }

    func testCopyLinkSuccessSetsCopiedAndAnnouncesSuccess() {
        let toast = SpyCopyLinkButtonToast()
        let model = makeModel(
            url: "https://teslasync.app/notifications",
            clipboard: InMemoryCopyLinkClipboard(succeeds: true),
            toast: toast
        )
        model.copyLink()
        XCTAssertTrue(model.copied)
        XCTAssertEqual(toast.events.count, 1)
        XCTAssertEqual(toast.events.first?.severity, .success)
        XCTAssertEqual(toast.events.first?.message, "Link copied to clipboard")
    }

    func testCopyLinkFailureAnnouncesErrorAndDoesNotSetCopied() {
        let toast = SpyCopyLinkButtonToast()
        let model = makeModel(
            url: "https://teslasync.app/notifications",
            clipboard: InMemoryCopyLinkClipboard(succeeds: false),
            toast: toast
        )
        model.copyLink()
        XCTAssertFalse(model.copied, "a failed write stays in the resting state (web `catch`)")
        XCTAssertEqual(toast.events.first?.severity, .error)
        XCTAssertEqual(toast.events.first?.message, "Could not copy link")
    }

    func testCopyLinkEmptyURLAnnouncesErrorAndSkipsClipboard() {
        let toast = SpyCopyLinkButtonToast()
        let clipboard = InMemoryCopyLinkClipboard()
        let model = makeModel(url: "", clipboard: clipboard, toast: toast)
        model.copyLink()
        XCTAssertFalse(model.copied)
        XCTAssertTrue(clipboard.writes.isEmpty, "an unavailable URL never reaches the pasteboard")
        XCTAssertEqual(toast.events.first?.severity, .error)
    }

    func testCopyLinkWithoutPresenterStillWritesClipboard() {
        let clipboard = InMemoryCopyLinkClipboard()
        let model = makeModel(url: "https://teslasync.app/x", clipboard: clipboard, toast: nil)
        model.copyLink()
        XCTAssertEqual(clipboard.writes.count, 1, "copy runs even without a toast presenter")
        XCTAssertTrue(model.copied)
    }

    func testCopiedRevertsAfterAutoResetDelay() async throws {
        let model = makeModel(
            url: "https://teslasync.app/x",
            clipboard: InMemoryCopyLinkClipboard(),
            autoResetDelay: .milliseconds(20)
        )
        model.copyLink()
        XCTAssertTrue(model.copied)
        try await Task.sleep(for: .milliseconds(150))
        XCTAssertFalse(model.copied, "the transient confirmation reverts after the reset delay")
    }
}

// MARK: - Helpers + test doubles

@MainActor
private func makeModel(
    url: String = "https://teslasync.app/drives",
    clipboard: any CopyLinkClipboard = InMemoryCopyLinkClipboard(),
    toast: (any CopyLinkButtonToastPresenter)? = nil,
    telemetry: any CopyLinkButtonTelemetry = OSLogCopyLinkButtonTelemetry(),
    autoResetDelay: Duration = .seconds(2)
) -> CopyLinkButtonModel {
    CopyLinkButtonModel(
        urlProvider: StaticCopyLinkURLSource(url),
        clipboard: clipboard,
        toast: toast,
        telemetry: telemetry,
        autoResetDelay: autoResetDelay
    )
}

/// Records `view.opened` surfaces so the telemetry contract can be asserted.
private final class SpyCopyLinkButtonTelemetry: CopyLinkButtonTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// Records the toast announcements the model emits so the copy-outcome mapping can be asserted.
@MainActor private final class SpyCopyLinkButtonToast: CopyLinkButtonToastPresenter {
    private(set) var events: [(severity: CopyLinkButtonToastSeverity, message: String)] = []
    func presentToast(severity: CopyLinkButtonToastSeverity, message: String) {
        events.append((severity, message))
    }
}
