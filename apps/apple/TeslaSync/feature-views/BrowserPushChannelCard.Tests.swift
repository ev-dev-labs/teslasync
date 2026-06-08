//
//  BrowserPushChannelCard.Tests.swift
//  TeslaSync — P4 feature view · 0181 · BrowserPushChannelCard (Apple)
//
//  Adapter + projection + phase + model + accessibility coverage for the
//  BrowserPushChannelCard surface. Each test ports a web computation or branch:
//  the `disabledReason` four-way, the status-badge map, the `formatRelative` port,
//  the per-device `rows.map` projection, the render-phase resolution, the model's
//  effect forwarding + one-shot `view.opened`, and the VoiceOver summaries. These
//  run in the TeslaSync(/-macOS) XCTest targets — no network, no real store.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Test helpers

private enum BrowserPushFixture {
    /// Fixed reference clock (2023-11-14T22:13:20Z) for deterministic relative times.
    static let now = Date(timeIntervalSince1970: 1_700_000_000)
    static let locale = Locale(identifier: "en_US_POSIX")
    static let utc = TimeZone(identifier: "UTC")!

    /// Renders an ISO-8601 timestamp `seconds` before the reference clock.
    static func iso(secondsAgo seconds: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = utc
        return formatter.string(from: now.addingTimeInterval(-seconds))
    }
}

// MARK: - disabledReason (web four-way)

@MainActor
final class BrowserPushUnsupportedReasonTests: XCTestCase {
    func testAvailableReturnsNil() {
        XCTAssertNil(BrowserPushUnsupportedReason.resolve(BrowserPushCapability()))
    }

    func testNotificationsUnsupportedWins() {
        let capability = BrowserPushCapability(
            notificationsSupported: false,
            pushSupported: false,
            serverConfigured: false,
            permission: .denied
        )
        XCTAssertEqual(BrowserPushUnsupportedReason.resolve(capability), .notificationsUnsupported)
    }

    func testServerDisabledRequiresKeyQuerySettled() {
        let settled = BrowserPushCapability(pushSupported: false, serverConfigured: false, keyLoading: false)
        XCTAssertEqual(BrowserPushUnsupportedReason.resolve(settled), .serverDisabled)
    }

    func testKeyStillLoadingFallsThroughToPushApi() {
        // Web: the serverDisabled branch is gated on `!keyLoading`.
        let loading = BrowserPushCapability(pushSupported: false, serverConfigured: false, keyLoading: true)
        XCTAssertEqual(BrowserPushUnsupportedReason.resolve(loading), .pushApiUnsupported)
    }

    func testPushApiUnsupportedWhenServerConfigured() {
        let capability = BrowserPushCapability(pushSupported: false, serverConfigured: true)
        XCTAssertEqual(BrowserPushUnsupportedReason.resolve(capability), .pushApiUnsupported)
    }

    func testPermissionDeniedWhenOtherwiseSupported() {
        let capability = BrowserPushCapability(permission: .denied)
        XCTAssertEqual(BrowserPushUnsupportedReason.resolve(capability), .permissionDenied)
    }

    func testEveryReasonHasKeyAndFallback() {
        for reason in BrowserPushUnsupportedReason.allCases {
            XCTAssertTrue(reason.key.hasPrefix("webpush.unsupported."))
            XCTAssertFalse(reason.fallback.isEmpty)
            XCTAssertEqual(reason.text(.echo), reason.fallback)
        }
    }
}

// MARK: - Status badge

@MainActor
final class BrowserPushStatusTests: XCTestCase {
    func testUnavailableWinsOverSubscription() {
        let status = BrowserPushStatus.resolve(reason: .permissionDenied, isSubscribed: true)
        XCTAssertEqual(status, .unavailable)
        XCTAssertEqual(status.tone, .warning)
        XCTAssertEqual(status.key, "webpush.status.unsupported")
    }

    func testActiveWhenSubscribed() {
        let status = BrowserPushStatus.resolve(reason: nil, isSubscribed: true)
        XCTAssertEqual(status, .active)
        XCTAssertEqual(status.tone, .success)
        XCTAssertEqual(status.fallback, "Active on this device")
    }

    func testNotSubscribedOtherwise() {
        let status = BrowserPushStatus.resolve(reason: nil, isSubscribed: false)
        XCTAssertEqual(status, .notSubscribed)
        XCTAssertEqual(status.tone, .neutral)
        XCTAssertEqual(status.key, "webpush.status.notSubscribed")
    }
}

// MARK: - formatRelative port

@MainActor
final class BrowserPushRelativeTimeTests: XCTestCase {
    private func format(_ iso: String?) -> String {
        BrowserPushRelativeTime.format(
            iso,
            now: BrowserPushFixture.now,
            locale: BrowserPushFixture.locale,
            timeZone: BrowserPushFixture.utc,
            localize: .echo
        )
    }

    func testNilAndInvalidAreDash() {
        XCTAssertEqual(format(nil), "—")
        XCTAssertEqual(format("not-a-date"), "—")
    }

    func testJustNowUnderAMinute() {
        XCTAssertEqual(format(BrowserPushFixture.iso(secondsAgo: 30)), "just now")
    }

    func testMinutesHoursDays() {
        XCTAssertEqual(format(BrowserPushFixture.iso(secondsAgo: 5 * 60)), "5m ago")
        XCTAssertEqual(format(BrowserPushFixture.iso(secondsAgo: 3 * 3600)), "3h ago")
        XCTAssertEqual(format(BrowserPushFixture.iso(secondsAgo: 2 * 86400)), "2d ago")
    }

    func testOlderThanAWeekFallsBackToAbsoluteDate() {
        let label = format(BrowserPushFixture.iso(secondsAgo: 10 * 86400))
        XCTAssertNotEqual(label, "—")
        XCTAssertNotEqual(label, "just now")
        XCTAssertFalse(label.hasSuffix("ago"))
    }
}

// MARK: - Device projection (web rows.map)

@MainActor
final class BrowserPushDeviceProjectionTests: XCTestCase {
    private func project(_ row: BrowserPushDeviceRow, currentEndpoint: String? = nil) -> BrowserPushDeviceProjection {
        BrowserPushDeviceProjection.make(
            row: row,
            currentEndpoint: currentEndpoint,
            now: BrowserPushFixture.now,
            localize: .echo
        )
    }

    func testUnknownAgentFallback() {
        let projection = project(BrowserPushDeviceRow(id: 1, endpoint: "e", userAgent: nil))
        XCTAssertEqual(projection.agentLabel, "Unknown browser")
    }

    func testKnownAgentPreserved() {
        let projection = project(BrowserPushDeviceRow(id: 1, endpoint: "e", userAgent: "Safari 18"))
        XCTAssertEqual(projection.agentLabel, "Safari 18")
    }

    func testCurrentDeviceFlag() {
        let row = BrowserPushDeviceRow(id: 1, endpoint: "this", userAgent: "x")
        XCTAssertTrue(project(row, currentEndpoint: "this").isCurrentDevice)
        XCTAssertFalse(project(row, currentEndpoint: "other").isCurrentDevice)
        XCTAssertFalse(project(row, currentEndpoint: nil).isCurrentDevice)
    }

    func testNeverUsedWhenNoTimestamp() {
        let projection = project(BrowserPushDeviceRow(id: 1, endpoint: "e", lastUsedAt: nil))
        XCTAssertEqual(projection.lastUsedLabel, "Not yet used")
    }

    func testLastUsedInterpolatesRelativeTime() {
        let iso = BrowserPushFixture.iso(secondsAgo: 5 * 60)
        let projection = project(BrowserPushDeviceRow(id: 1, endpoint: "e", lastUsedAt: iso))
        XCTAssertEqual(projection.lastUsedLabel, "Last used 5m ago")
    }
}

// MARK: - Render-phase resolution

@MainActor
final class BrowserPushPhaseTests: XCTestCase {
    private func phase(_ update: BrowserPushChannelCardUpdate) -> BrowserPushChannelCardModel.Phase {
        BrowserPushChannelCardModel.resolvePhase(update)
    }

    private let device = BrowserPushDeviceRow(id: 1, endpoint: "e", userAgent: "x")

    func testInitialLoadingWithoutCapabilityIsSkeleton() {
        XCTAssertEqual(phase(BrowserPushChannelCardUpdate(status: .loading)), .loading)
    }

    func testLoadingWithCachedCapabilityKeepsContent() {
        let update = BrowserPushChannelCardUpdate(
            status: .loading,
            capability: BrowserPushCapability(),
            devices: [device]
        )
        XCTAssertEqual(phase(update), .loaded)
    }

    func testLoadedWithDevicesIsLoaded() {
        let update = BrowserPushChannelCardUpdate(
            status: .loaded,
            capability: BrowserPushCapability(),
            devices: [device]
        )
        XCTAssertEqual(phase(update), .loaded)
    }

    func testLoadedWithNoDevicesIsEmpty() {
        let update = BrowserPushChannelCardUpdate(
            status: .loaded,
            capability: BrowserPushCapability(),
            devices: []
        )
        XCTAssertEqual(phase(update), .empty)
    }

    func testFailedWithoutCacheIsError() {
        XCTAssertEqual(phase(BrowserPushChannelCardUpdate(status: .failed("boom"))), .error("boom"))
    }

    func testFailedWithCacheKeepsContent() {
        let update = BrowserPushChannelCardUpdate(
            status: .failed("boom"),
            capability: BrowserPushCapability(),
            devices: [device]
        )
        XCTAssertEqual(phase(update), .loaded)
    }
}

// MARK: - View-model (lifecycle + effect forwarding + telemetry)

@MainActor
final class BrowserPushChannelCardModelTests: XCTestCase {
    /// A bound model + the in-memory source/telemetry doubles driving it.
    private struct Harness {
        let model: BrowserPushChannelCardModel
        let source: InMemoryBrowserPushChannelCardSource
        let telemetry: SpyBrowserPushChannelCardTelemetry
    }

    private func makeHarness(
        initial: BrowserPushChannelCardUpdate? = nil,
        telemetry: SpyBrowserPushChannelCardTelemetry = SpyBrowserPushChannelCardTelemetry()
    ) -> Harness {
        let source = InMemoryBrowserPushChannelCardSource(initial: initial)
        let model = BrowserPushChannelCardModel(
            source: source,
            telemetry: telemetry,
            localize: .echo,
            now: { BrowserPushFixture.now }
        )
        return Harness(model: model, source: source, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.start()
        XCTAssertEqual(harness.telemetry.surfaces, ["BrowserPushChannelCard"])
    }

    func testStartAppliesInitialSnapshot() {
        let update = BrowserPushChannelCardUpdate(
            status: .loaded,
            capability: BrowserPushCapability(isSubscribed: true),
            devices: [BrowserPushDeviceRow(id: 1, endpoint: "e", userAgent: "x")]
        )
        let harness = makeHarness(initial: update)
        harness.model.start()
        XCTAssertEqual(harness.model.phase, .loaded)
        XCTAssertEqual(harness.model.status, .active)
        XCTAssertNil(harness.model.unsupportedReason)
        XCTAssertEqual(harness.model.deviceProjections.count, 1)
    }

    func testUnsupportedSnapshotProjectsReasonAndStatus() {
        let update = BrowserPushChannelCardUpdate(
            status: .loaded,
            capability: BrowserPushCapability(permission: .denied),
            devices: []
        )
        let harness = makeHarness()
        harness.model.start()
        harness.source.push(update)
        XCTAssertEqual(harness.model.unsupportedReason, .permissionDenied)
        XCTAssertEqual(harness.model.status, .unavailable)
        XCTAssertEqual(harness.model.phase, .empty)
    }

    func testEffectsForwardToSource() {
        let harness = makeHarness()
        harness.model.enable()
        harness.model.disable()
        harness.model.remove(endpoint: "gone")
        harness.model.refresh()
        XCTAssertEqual(harness.source.enableCount, 1)
        XCTAssertEqual(harness.source.disableCount, 1)
        XCTAssertEqual(harness.source.removedEndpoints, ["gone"])
        XCTAssertEqual(harness.source.refreshCount, 1)
    }

    func testStopHaltsAndAllowsRestart() {
        let harness = makeHarness()
        harness.model.start()
        harness.model.stop()
        harness.model.start()
        XCTAssertEqual(harness.source.startCount, 2)
        XCTAssertEqual(harness.source.stopCount, 1)
        XCTAssertEqual(harness.telemetry.surfaces.count, 2)
    }

    func testSurfaceSlugMatchesView() {
        XCTAssertEqual(BrowserPushChannelCardSurface.slug, "BrowserPushChannelCard")
        XCTAssertEqual(BrowserPushChannelCard.surfaceSlug, BrowserPushChannelCardSurface.slug)
    }
}

// MARK: - Accessibility summaries

@MainActor
final class BrowserPushAccessibilityTests: XCTestCase {
    func testHeaderLabelCombinesTitleAndStatus() {
        let label = BrowserPushChannelCardAccessibility.headerLabel(status: .active, localize: .echo)
        XCTAssertTrue(label.contains("Browser push"))
        XCTAssertTrue(label.contains("Active on this device"))
    }

    func testDeviceLabelIncludesThisDeviceMarker() {
        let projection = BrowserPushDeviceProjection.make(
            row: BrowserPushDeviceRow(id: 1, endpoint: "this", userAgent: "Safari", lastUsedAt: nil),
            currentEndpoint: "this",
            now: BrowserPushFixture.now,
            localize: .echo
        )
        let label = BrowserPushChannelCardAccessibility.deviceLabel(projection, localize: .echo)
        XCTAssertTrue(label.contains("Safari"))
        XCTAssertTrue(label.contains("(this device)"))
        XCTAssertTrue(label.contains("Not yet used"))
    }

    func testRemoveAndToggleLabels() {
        XCTAssertEqual(BrowserPushChannelCardAccessibility.removeLabel(.echo), "Remove this device")
        XCTAssertEqual(
            BrowserPushChannelCardAccessibility.toggleLabel(isSubscribed: true, localize: .echo),
            "Disable on this device"
        )
        XCTAssertEqual(
            BrowserPushChannelCardAccessibility.toggleLabel(isSubscribed: false, localize: .echo),
            "Enable on this device"
        )
    }
}

// MARK: - Telemetry spy

/// Thread-safe recording sink for the `view.opened` contract. The model emits on the
/// main actor; the lock keeps the spy `Sendable` without an actor hop in the seam.
private final class SpyBrowserPushChannelCardTelemetry: BrowserPushChannelCardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }

    func viewOpened(surface: String) {
        lock.lock()
        recorded.append(surface)
        lock.unlock()
    }
}
