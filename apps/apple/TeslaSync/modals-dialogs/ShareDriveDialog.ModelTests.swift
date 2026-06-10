//
//  ShareDriveDialog.ModelTests.swift
//  TeslaSync — P4 modal / dialog · 0028 · ShareDriveDialog (Apple)
//
//  State-holder coverage for `ShareDriveModel`: the P1/S11 `view.opened` telemetry (once + idempotent),
//  the links phase transitions (loading / loaded-empty / failed, incl. the inline-error envelope when a
//  cached list survives a failed reload), the create lifecycle (web `handleCreate` → request build →
//  result panel on success / inline error on failure, guarded while pending), the result-panel copy +
//  "Create another link", the revoke lifecycle (per-row spinner, success refetch, failure inline,
//  guarded, and spinner cleared when the row drops from a later snapshot), the row copy, the close
//  reset (web `handleClose`), the stale auto-refresh (once, re-armed on return to live), offline keeping
//  the list, and the row display projection. Driven through the in-memory source + spies — no network.
//

import XCTest
@testable import TeslaSync

/// Identity localizer for deterministic copy in assertions.
private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

/// A fixed clock so the row expiry projection is deterministic (2026-01-01 12:00:00 UTC).
private let fixedNow = Date(timeIntervalSince1970: 1_767_268_800)

/// Records the `view.opened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam.
private final class SpyShareDriveTelemetry: ShareDriveTelemetry, @unchecked Sendable {
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

/// Records the copied strings (web `CopyButton`). Lock-guarded for the `Sendable` clipboard seam.
private final class SpyShareDriveClipboard: ShareDriveClipboard, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    func copy(_ text: String) {
        lock.lock()
        storage.append(text)
        lock.unlock()
    }

    var copied: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }
}

/// Returns a constant marker so the expiry-text test can assert the date is threaded through.
private struct FixedShareDriveDateFormatting: ShareDriveDateFormatting {
    func medium(_: Date) -> String {
        "FMT"
    }
}

/// Records the create / revoke calls and lets a test drive the deferred mutation results.
@MainActor
private final class SpyShareDriveController: ShareDriveController {
    var onCreateResult: (@MainActor (ShareCreateOutcome) -> Void)?
    var onRevokeResult: (@MainActor (ShareRevokeOutcome) -> Void)?
    private(set) var creates: [(input: CreateShareInput, driveId: String)] = []
    private(set) var revokes: [String] = []

    func create(input: CreateShareInput, driveId: String) {
        creates.append((input, driveId))
    }

    func revoke(token: String) {
        revokes.append(token)
    }

    func completeCreate(_ outcome: ShareCreateOutcome) {
        onCreateResult?(outcome)
    }

    func completeRevoke(_ outcome: ShareRevokeOutcome) {
        onRevokeResult?(outcome)
    }
}

@MainActor
final class ShareDriveModelTests: XCTestCase {
    private func makeModel(
        source: InMemoryShareDriveSource,
        telemetry: SpyShareDriveTelemetry = SpyShareDriveTelemetry(),
        controller: SpyShareDriveController = SpyShareDriveController(),
        clipboard: SpyShareDriveClipboard = SpyShareDriveClipboard()
    ) -> ShareDriveModel {
        ShareDriveModel(
            driveId: "42",
            source: source,
            telemetry: telemetry,
            controller: controller,
            clipboard: clipboard,
            urlBuilder: DefaultShareDriveURLBuilder(origin: "https://x.test"),
            dates: FixedShareDriveDateFormatting(),
            localize: passthroughLocalize,
            now: { fixedNow }
        )
    }

    private func link(_ id: Int, token: String) -> ShareLink {
        ShareLink(id: id, token: token, title: nil, views: 0, expiresAt: nil)
    }

    private func loaded(_ links: [ShareLink]) -> ShareDriveUpdate {
        ShareDriveUpdate(status: .loaded, links: links)
    }

    // MARK: Lifecycle / phases

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyShareDriveTelemetry()
        let source = InMemoryShareDriveSource()
        let model = makeModel(source: source, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["ShareDriveDialog"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testLoadingThenContent() {
        let source = InMemoryShareDriveSource(initial: ShareDriveUpdate(status: .loading))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.linksPhase, .loading)
        source.push(loaded([link(1, token: "abc")]))
        XCTAssertEqual(model.linksPhase, .content)
        XCTAssertEqual(model.rows.count, 1)
    }

    func testLoadedEmptyResolvesEmpty() {
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.linksPhase, .empty)
    }

    func testFailedNoLinksResolvesError() {
        let source = InMemoryShareDriveSource(initial: ShareDriveUpdate(status: .failed("timeout")))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.linksPhase, .error("timeout"))
        XCTAssertNil(model.inlineLoadError)
    }

    func testFailedWithCachedLinksKeepsContentAndSurfacesInlineError() {
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source)
        model.start()
        source.push(ShareDriveUpdate(status: .failed("stale read"), links: [link(1, token: "abc")]))
        XCTAssertEqual(model.linksPhase, .content)
        XCTAssertEqual(model.inlineLoadError, "stale read")
    }

    // MARK: Create (web handleCreate)

    func testGenerateDelegatesInputAndEntersCreating() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.title = "Trip"
        model.includeSpeed = false
        model.includeTelemetry = true
        model.expiry = .days7
        model.generate()
        XCTAssertTrue(model.isCreating)
        XCTAssertNil(model.createError)
        XCTAssertEqual(controller.creates.count, 1)
        XCTAssertEqual(controller.creates.first?.driveId, "42")
        XCTAssertEqual(
            controller.creates.first?.input,
            CreateShareInput(title: "Trip", includeSpeed: false, includeTelemetry: true, expiresInDays: 7)
        )
        XCTAssertFalse(model.hasResult)
    }

    func testGenerateSuccessSetsShareURLAndRefreshes() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.generate()
        XCTAssertEqual(source.refreshCount, 0)
        controller.completeCreate(.success(token: "tok9"))
        XCTAssertFalse(model.isCreating)
        XCTAssertTrue(model.hasResult)
        XCTAssertEqual(model.shareURL, "https://x.test/s/tok9")
        XCTAssertEqual(model.resultURL, "https://x.test/s/tok9")
        XCTAssertEqual(source.refreshCount, 1) // web invalidateQueries → list refetch
    }

    func testGenerateFailureSurfacesErrorAndStaysForm() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.generate()
        controller.completeCreate(.failure("Server rejected the request"))
        XCTAssertFalse(model.isCreating)
        XCTAssertEqual(model.createError, "Server rejected the request")
        XCTAssertFalse(model.hasResult)
    }

    func testGenerateGuardedWhilePending() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.generate()
        model.generate()
        XCTAssertEqual(controller.creates.count, 1)
    }

    func testCreateAnotherResetsResultPanel() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.generate()
        controller.completeCreate(.success(token: "tok9"))
        XCTAssertTrue(model.hasResult)
        model.createAnother()
        XCTAssertFalse(model.hasResult)
        XCTAssertNil(model.shareURL)
    }

    func testCopyResultURLAndRowURLCopyViaClipboard() {
        let controller = SpyShareDriveController()
        let clipboard = SpyShareDriveClipboard()
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source, controller: controller, clipboard: clipboard)
        model.start()
        model.generate()
        controller.completeCreate(.success(token: "tok9"))
        model.copyResultURL()
        model.copyRowURL("abc")
        XCTAssertEqual(clipboard.copied, ["https://x.test/s/tok9", "https://x.test/s/abc"])
    }

    // MARK: Revoke (web handleRevoke)

    func testRevokeEntersRevokingAndDelegates() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.revoke("abc")
        XCTAssertTrue(model.isRevoking("abc"))
        XCTAssertEqual(controller.revokes, ["abc"])
    }

    func testRevokeSuccessClearsSpinnerAndRefreshes() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.revoke("abc")
        controller.completeRevoke(.success(token: "abc"))
        XCTAssertFalse(model.isRevoking("abc"))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testRevokeFailureClearsSpinnerAndSetsActionError() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.revoke("abc")
        controller.completeRevoke(.failure(token: "abc", message: "Revoke failed"))
        XCTAssertFalse(model.isRevoking("abc"))
        XCTAssertEqual(model.actionError, "Revoke failed")
    }

    func testRevokeGuardedWhileInFlight() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.revoke("abc")
        model.revoke("abc")
        XCTAssertEqual(controller.revokes.count, 1)
    }

    func testRevokeSpinnerClearedWhenRowDropsFromSnapshot() {
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc"), link(2, token: "def")]))
        let model = makeModel(source: source)
        model.start()
        model.revoke("abc")
        XCTAssertTrue(model.isRevoking("abc"))
        source.push(loaded([link(2, token: "def")]))
        XCTAssertFalse(model.isRevoking("abc"))
    }

    // MARK: Close (web handleClose)

    func testCloseResetsResultAndTitleAndFinishes() {
        let controller = SpyShareDriveController()
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source, controller: controller)
        model.start()
        model.title = "Trip"
        model.generate()
        controller.completeCreate(.success(token: "tok9"))
        model.close()
        XCTAssertFalse(model.hasResult)
        XCTAssertEqual(model.title, "")
        XCTAssertTrue(model.didFinish)
    }

    // MARK: Freshness

    func testStaleAutoRefreshesOnceThenReArms() {
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ShareDriveUpdate(status: .loaded, links: [link(1, token: "abc")], connection: .stale))
        source.push(ShareDriveUpdate(status: .loaded, links: [link(1, token: "abc")], connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ShareDriveUpdate(status: .loaded, links: [link(1, token: "abc")], connection: .live))
        source.push(ShareDriveUpdate(status: .loaded, links: [link(1, token: "abc")], connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsContentAndDoesNotRefresh() {
        let source = InMemoryShareDriveSource(initial: loaded([link(1, token: "abc")]))
        let model = makeModel(source: source)
        model.start()
        source.push(ShareDriveUpdate(status: .loaded, links: [link(1, token: "abc")], connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.linksPhase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    // MARK: Row display projection

    func testRowsProjectionReflectsExpiryAndURL() {
        let links = [
            ShareLink(id: 1, token: "abc", title: "Trip", views: 5, expiresAt: fixedNow.addingTimeInterval(3600)),
            ShareLink(id: 2, token: "def", title: nil, views: 0, expiresAt: fixedNow.addingTimeInterval(-3600))
        ]
        let source = InMemoryShareDriveSource(initial: loaded(links))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.rows.count, 2)
        XCTAssertEqual(model.rows[0].shareURL, "https://x.test/s/abc")
        XCTAssertEqual(model.rows[0].expiry, .active(fixedNow.addingTimeInterval(3600)))
        XCTAssertEqual(model.rows[1].expiry, .expired)
        XCTAssertTrue(model.rows[1].isUntitled)
    }

    func testRowDisplayTextHelpers() {
        let source = InMemoryShareDriveSource(initial: loaded([]))
        let model = makeModel(source: source)
        model.start()
        XCTAssertEqual(model.viewsText(5), "5 views")
        XCTAssertEqual(model.expiryText(.expired), "Expired")
        XCTAssertEqual(model.expiryText(.none), "No expiry")
        XCTAssertEqual(model.expiryText(.active(fixedNow)), "Expires FMT")
        let untitled = ShareLinkRow(id: 1, token: "abc", title: nil, views: 0, expiry: .none, shareURL: "x")
        XCTAssertEqual(model.rowTitle(untitled), "Untitled share")
    }
}
