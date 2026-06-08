//
//  NotificationSettings.ModelTests.swift
//  TeslaSync — P4 feature view · 0208 · NotificationSettings (Apple)
//
//  State-holder coverage for the NotificationSettings surface (split out of NotificationSettings.Tests.swift
//  to keep each file within the line-length budget): `NotificationSettingsModel` phase resolution, the
//  P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring, offline-keeps-content, and every
//  mutation round-trip. Driven by `InMemoryNotificationSettingsSource`; no network, no real store. Shares
//  the `NotificationFixture` helpers declared in NotificationSettings.Tests.swift (same test module).
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: model wiring, telemetry, mutations

@MainActor final class NotificationSettingsModelTests: XCTestCase {
    private func makeModel(
        _ update: NotificationSettingsUpdate,
        telemetry: NotificationSettingsTelemetry = OSLogNotificationSettingsTelemetry()
    ) -> (NotificationSettingsModel, InMemoryNotificationSettingsSource) {
        let source = InMemoryNotificationSettingsSource(
            status: update.status,
            input: update.input,
            connection: update.connection,
            updatedAt: update.updatedAt
        )
        let model = NotificationSettingsModel(source: source, telemetry: telemetry, copy: .fallback)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(NotificationSettingsUpdate(status: .loading, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithDataShowsContent() {
        let (model, _) = makeModel(NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input()))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasContent)
        XCTAssertEqual(model.projection.channels.count, 7)
        XCTAssertTrue(model.projection.showsEventPrefs)
    }

    func testLoadedWithNilInputShowsEmpty() {
        let (model, _) = makeModel(NotificationSettingsUpdate(status: .loaded, input: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertEqual(model.projection, .empty)
    }

    func testFailedShowsErrorEvenWithCachedData() {
        let (model, _) = makeModel(
            NotificationSettingsUpdate(status: .failed("boom"), input: NotificationFixture.input())
        )
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyNotificationSettingsTelemetry()
        let (model, source) = makeModel(NotificationSettingsUpdate(status: .loading, input: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [NotificationSettings.surfaceSlug])
        XCTAssertEqual(spy.surfaces, ["NotificationSettings"])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(NotificationSettingsUpdate(status: .loaded, input: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testStaleAutoRefreshesOnceUntilLive() {
        let (model, source) = makeModel(
            NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input())
        )
        model.start()
        XCTAssertEqual(source.refreshCount, 0) // live → no refresh

        source.push(NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input(), connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1) // stale → one auto-refresh

        source.push(NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1) // still stale → no repeat

        source.push(NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input(), connection: .live))
        source.push(NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input(), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2) // re-armed after going live → refresh again
    }

    func testOfflineKeepsContentWithoutRefresh() {
        let (model, source) = makeModel(
            NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input())
        )
        model.start()
        source.push(
            NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input(), connection: .offline)
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testSetAlertsRoundTripsThroughSource() {
        let (model, _) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(authorization: .granted)
            )
        )
        model.start()
        XCTAssertTrue(model.projection.eventPrefs.alerts)
        model.setAlerts(false)
        XCTAssertFalse(model.projection.eventPrefs.alerts)
        model.setExportCompletions(false)
        XCTAssertFalse(model.projection.eventPrefs.exportCompletions)
    }

    func testSetSoundsEnabledUndimsChannels() {
        let (model, _) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: false))
            )
        )
        model.start()
        XCTAssertFalse(model.projection.soundsEnabled)
        XCTAssertTrue(model.projection.channels.allSatisfy(\.isDimmed))
        model.setSoundsEnabled(true)
        XCTAssertTrue(model.projection.soundsEnabled)
        XCTAssertTrue(model.projection.channels.allSatisfy { !$0.isDimmed })
        XCTAssertTrue(model.projection.showsAutoplayHint)
    }

    func testSetSoundChannelFlipsGate() {
        let (model, _) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: true))
            )
        )
        model.start()
        XCTAssertFalse(NotificationFixture.channel(model.projection, .infoAlert).isOn)
        model.setSoundChannel(.infoAlert, true)
        XCTAssertTrue(NotificationFixture.channel(model.projection, .infoAlert).isOn)
    }

    func testSetVolumeClampsAndRecomputesPercent() {
        let (model, _) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(soundPrefs: NotificationSoundPrefs(enabled: true, volume: 0.6))
            )
        )
        model.start()
        XCTAssertEqual(model.projection.volumePercent, 60)
        model.setVolume(0.25)
        XCTAssertEqual(model.projection.volumePercent, 25)
        model.setVolume(5) // clamps to 1.0
        XCTAssertEqual(model.projection.volumePercent, 100)
    }

    func testRequestAuthorizationGrantsAndRecords() {
        let (model, source) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(authorization: .notDetermined)
            )
        )
        model.start()
        XCTAssertFalse(model.projection.showsEventPrefs)
        model.requestAuthorization()
        XCTAssertEqual(source.authorizationRequests, 1)
        XCTAssertEqual(model.projection.authorization, .granted)
        XCTAssertTrue(model.projection.showsEventPrefs)
    }

    func testTestSoundRecordsChannel() {
        let (model, source) = makeModel(
            NotificationSettingsUpdate(status: .loaded, input: NotificationFixture.input())
        )
        model.start()
        model.testSound(.chargeComplete)
        model.testSound(.criticalAlert)
        XCTAssertEqual(source.testedChannels, [.chargeComplete, .criticalAlert])
    }

    func testTabBadgeNoOpWhenSettingsMissing() {
        // Web `updateTabSetting` early-returns when `!settings`; the native source mirrors that guard.
        let (model, _) = makeModel(
            NotificationSettingsUpdate(
                status: .loaded,
                input: NotificationFixture.input(tabSettings: nil)
            )
        )
        model.start()
        XCTAssertFalse(model.projection.tabSettingsEditable)
        model.setTabBadge(false)
        XCTAssertTrue(model.projection.tabBadgeEnabled) // unchanged (default on)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyNotificationSettingsTelemetry: NotificationSettingsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
