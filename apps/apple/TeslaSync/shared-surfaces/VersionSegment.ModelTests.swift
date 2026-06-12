//
//  VersionSegment.ModelTests.swift
//  TeslaSync — P4 shared surface · 0181 · VersionSegment (Apple)
//
//  State-holder coverage for ``VersionSegmentModel``: the P1/S11 `view.opened` telemetry (once +
//  idempotent), the phase transitions across every state (loading / empty / error / ready), the modal
//  open state (web `useState(open)`), the forwarded "open changelog" (closes the modal first, web
//  `setOpen(false); openChangelogModal()`) + "open release notes" handlers, the connection axis with the
//  one-shot stale auto-refresh (re-armed on return to live) and offline keeping the cached version, plus
//  the view + modal composition and the strings facade. The seams + polling source live in
//  VersionSegment.PollingTests.swift. Driven through the in-memory seams — no network, no real time.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Model (state-holder)

@MainActor
final class VersionSegmentModelTests: XCTestCase {
    private func makeModel(
        _ snapshot: VersionSegmentSnapshot,
        build: VersionSegmentBuildInfo = .dev,
        telemetry: VersionSegmentTelemetry = OSLogVersionSegmentTelemetry(),
        onOpenChangelog: (@MainActor () -> Void)? = nil,
        onOpenReleaseNotes: (@MainActor () -> Void)? = nil
    ) -> (VersionSegmentModel, InMemoryVersionSegmentSource) {
        let source = InMemoryVersionSegmentSource(initial: snapshot)
        let model = VersionSegmentModel(
            source: source,
            buildInfo: build,
            telemetry: telemetry,
            onOpenChangelog: onOpenChangelog,
            onOpenReleaseNotes: onOpenReleaseNotes
        )
        return (model, source)
    }

    private func ready(_ connection: VersionSegmentConnection = .live) -> VersionSegmentSnapshot {
        VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "2026.6.2"), connection: connection)
    }

    private let noBuild = VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyVersionSegmentTelemetry()
        let (model, source) = makeModel(ready(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(model.data?.appVersion, "2026.6.2")
        XCTAssertEqual(spy.surfaces, [VersionSegmentSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyVersionSegmentTelemetry()
        let (model, _) = makeModel(ready(), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, [VersionSegmentSurface.slug])
    }

    func testLoadingPhaseWhenNoBuildVersion() {
        let (model, _) = makeModel(VersionSegmentSnapshot(isLoading: true), build: noBuild)
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testErrorPhaseWhenNoBuildVersion() {
        let (model, _) = makeModel(VersionSegmentSnapshot(errorMessage: "boom"), build: noBuild)
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testEmptyPhaseWhenNoBuildVersion() {
        let (model, _) = makeModel(VersionSegmentSnapshot(), build: noBuild)
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testPushFromLoadingToReady() {
        let (model, source) = makeModel(VersionSegmentSnapshot(isLoading: true), build: noBuild)
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(ready())
        XCTAssertEqual(model.phase, .ready)
    }

    func testModalOpenCloseToggles() {
        let (model, _) = makeModel(ready())
        model.start()
        XCTAssertFalse(model.isModalPresented)
        model.openModal()
        XCTAssertTrue(model.isModalPresented)
        model.closeModal()
        XCTAssertFalse(model.isModalPresented)
    }

    func testOpenChangelogClosesModalAndForwards() {
        var opened = 0
        let (model, _) = makeModel(ready(), onOpenChangelog: { opened += 1 })
        model.start()
        model.openModal()
        model.openChangelog()
        XCTAssertFalse(model.isModalPresented)
        XCTAssertEqual(opened, 1)
    }

    func testOpenReleaseNotesForwards() {
        var opened = 0
        let (model, _) = makeModel(ready(), onOpenReleaseNotes: { opened += 1 })
        model.start()
        model.openReleaseNotes()
        XCTAssertEqual(opened, 1)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(ready())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ready(.stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ready(.stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let (model, source) = makeModel(ready())
        model.start()
        source.push(ready(.stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ready())
        XCTAssertEqual(model.connection, .live)
        source.push(ready(.stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineKeepsCachedVersionAndDoesNotAutoRefresh() {
        let (model, source) = makeModel(ready())
        model.start()
        source.push(ready(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .ready)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(ready())
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopHaltsAndReArms() {
        let (model, source) = makeModel(ready())
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }
}

// MARK: - Views + modal (every branch composes)

@MainActor
final class VersionSegmentViewTests: XCTestCase {
    private func model(
        _ snapshot: VersionSegmentSnapshot,
        build: VersionSegmentBuildInfo = .dev
    ) -> VersionSegmentModel {
        VersionSegmentModel(source: InMemoryVersionSegmentSource(initial: snapshot), buildInfo: build)
    }

    func testSurfaceComposesForEveryPhase() {
        let noBuild = VersionSegmentBuildInfo(buildVersion: nil, buildSHA: nil)
        let ready = VersionSegmentSnapshot(versionInfo: VersionInfo(appVersion: "1"))
        _ = VersionSegment(model: model(VersionSegmentSnapshot(isLoading: true), build: noBuild))
        _ = VersionSegment(model: model(VersionSegmentSnapshot(), build: noBuild))
        _ = VersionSegment(model: model(VersionSegmentSnapshot(errorMessage: "x"), build: noBuild))
        _ = VersionSegment(model: model(ready))
        _ = VersionSegment(model: model(ready), iconOnly: true)
    }

    func testProductionInitComposes() {
        _ = VersionSegment(
            versionProbe: ScriptedVersionInfoProbe([.info(VersionInfo(appVersion: "1.0"))]),
            updateProbe: ScriptedUpdateCheckProbe([.result(UpdateCheckResult(updateAvailable: false))]),
            changelog: InMemoryChangelogObserver()
        )
    }

    func testLeafChromeAndReadyCompose() {
        _ = VersionSegmentLoadingView()
        _ = VersionSegmentEmptyView {}
        _ = VersionSegmentErrorView(message: "x") {}
        for connection in VersionSegmentConnection.allCases {
            _ = VersionSegmentFreshnessChip(connection: connection, onRefresh: {})
        }
    }

    func testModalContentComposes() throws {
        let resolved = VersionSegmentProjection.resolve(VersionSegmentInput(
            snapshot: VersionSegmentSnapshot(
                versionInfo: VersionInfo(
                    appVersion: "1.0",
                    chartVersion: "1.4.0",
                    goVersion: "go1.25",
                    os: "linux",
                    arch: "arm64",
                    uptimeSeconds: 90000
                ),
                updateCheck: UpdateCheckResult(updateAvailable: true, latest: "2.0", message: "fixes"),
                changelogUnseenCount: 2
            ),
            buildInfo: VersionSegmentBuildInfo(buildVersion: "1.0", buildSHA: "abc")
        ))
        _ = try VersionSegmentModalContent(
            data: XCTUnwrap(resolved.data), connection: .stale,
            onOpenChangelog: {}, onOpenReleaseNotes: {}, onClose: {}, onRefresh: {}
        )
        _ = try VersionSegmentReadyView(data: XCTUnwrap(resolved.data), iconOnly: false) {}
    }
}

// MARK: - Strings facade (P1/S10) — web keys

final class VersionSegmentStringsTests: XCTestCase {
    private func assertKey(_ key: String, _ value: String) {
        XCTAssertEqual(VersionSegmentStrings.string(key, value), value)
    }

    func testWebKeyFallbacks() {
        assertKey("statusBar.version.modalTitle", "About this build")
        assertKey("statusBar.version.tooltip", "TeslaSync version")
        assertKey("statusBar.version.appVersion", "App version")
        assertKey("statusBar.version.commit", "Commit")
        assertKey("statusBar.version.chart", "Helm chart")
        assertKey("statusBar.version.go", "Go runtime")
        assertKey("statusBar.version.platform", "Platform")
        assertKey("statusBar.version.uptimeLabel", "Server uptime")
        assertKey("changelog.openModal", "What's new")
        assertKey("statusBar.version.changelog", "Release notes")
        assertKey("statusBar.version.close", "Close")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyVersionSegmentTelemetry: VersionSegmentTelemetry, @unchecked Sendable {
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
