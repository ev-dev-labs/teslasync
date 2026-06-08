//
//  MediaNowPlayingWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0063 · MediaNowPlayingWidget (Apple)
//
//  Unit coverage for the MediaNowPlayingWidget surface:
//    • Adapter (cached → projection) — `MediaProjectionBuilder` parity with the
//      web view-local derivations + `formatDurationClock`.
//    • State holder — `MediaNowPlayingModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + wiring.
//    • Registry — canonical `media-now-playing` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryMediaNowPlayingSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (web view-local parity)

@MainActor final class MediaNowPlayingAdapterTests: XCTestCase {
    func testNilSnapshotProducesNilProjection() {
        XCTAssertNil(MediaProjectionBuilder.build(from: nil))
    }

    func testTitleAndArtistFallBackToDash() {
        let media = MediaProjectionBuilder.build(from: MediaSnapshotInput())
        XCTAssertEqual(media?.title, "—")
        XCTAssertEqual(media?.artist, "—")
        XCTAssertNil(media?.album)
        XCTAssertNil(media?.source)
    }

    func testSourceCoalescesPlaybackSourceThenStation() {
        let viaSource = MediaProjectionBuilder.build(
            from: MediaSnapshotInput(nowPlayingStation: "KEXP", playbackSource: "Spotify")
        )
        XCTAssertEqual(viaSource?.source, "Spotify")

        let viaStation = MediaProjectionBuilder.build(from: MediaSnapshotInput(nowPlayingStation: "KEXP"))
        XCTAssertEqual(viaStation?.source, "KEXP")

        let blankFallsThrough = MediaProjectionBuilder.build(
            from: MediaSnapshotInput(nowPlayingStation: "KEXP", playbackSource: "   ")
        )
        XCTAssertEqual(blankFallsThrough?.source, "KEXP")
    }

    func testIsPlayingMatchesStatusExactly() throws {
        XCTAssertTrue(try XCTUnwrap(MediaProjectionBuilder.build(from: MediaSnapshotInput(playbackStatus: "Playing"))?
                .isPlaying))
        XCTAssertFalse(try XCTUnwrap(MediaProjectionBuilder.build(from: MediaSnapshotInput(playbackStatus: "Paused"))?
                .isPlaying))
        XCTAssertFalse(try XCTUnwrap(MediaProjectionBuilder.build(from: MediaSnapshotInput())?.isPlaying))
    }

    func testVolumeMaxDefaultsToEleven() {
        let media = MediaProjectionBuilder.build(from: MediaSnapshotInput(audioVolume: 11))
        XCTAssertEqual(media?.volumeMax, 11)
        XCTAssertEqual(media?.volumeFraction, 1)
        XCTAssertTrue(media?.hasVolume == true)
    }

    func testProgressFractionAndGuards() {
        let playing = MediaProjectionBuilder.build(
            from: MediaSnapshotInput(nowPlayingDurationMs: 200_000, nowPlayingElapsedMs: 50000)
        )
        XCTAssertTrue(playing?.hasProgress == true)
        XCTAssertEqual(playing?.progressFraction ?? 0, 0.25, accuracy: 0.0001)

        let noDuration = MediaProjectionBuilder.build(from: MediaSnapshotInput(nowPlayingElapsedMs: 50000))
        XCTAssertFalse(noDuration?.hasProgress == true)
        XCTAssertEqual(noDuration?.progressFraction, 0)

        let overrun = MediaProjectionBuilder.build(
            from: MediaSnapshotInput(nowPlayingDurationMs: 100, nowPlayingElapsedMs: 999)
        )
        XCTAssertEqual(overrun?.progressFraction, 1)
    }

    func testFormatDurationClock() {
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(0), "0:00")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(9000), "0:09")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(96000), "1:36")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(244_000), "4:04")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(nil), "—")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(-5), "—")
        XCTAssertEqual(MediaProjectionBuilder.formatDurationClock(.infinity), "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class MediaNowPlayingModelTests: XCTestCase {
    private func makeModel(
        _ update: MediaNowPlayingUpdate,
        telemetry: MediaNowPlayingTelemetry = OSLogMediaNowPlayingTelemetry()
    ) -> (MediaNowPlayingModel, InMemoryMediaNowPlayingSource) {
        let source = InMemoryMediaNowPlayingSource(initial: update)
        let model = MediaNowPlayingModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutSnapshotShowsLoading() {
        let (model, _) = makeModel(MediaNowPlayingUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutSnapshotShowsEmpty() {
        let (model, _) = makeModel(MediaNowPlayingUpdate(status: .loaded, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MediaNowPlayingUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSnapshotPresentShowsContentEvenWhileFetchingOrFailed() {
        let snapshot = MediaSnapshotInput(nowPlayingTitle: "Song")
        let (loading, _) = makeModel(MediaNowPlayingUpdate(status: .loading, snapshot: snapshot))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.media?.title, "Song")

        let (failed, _) = makeModel(MediaNowPlayingUpdate(status: .failed("net"), snapshot: snapshot))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMediaTelemetry()
        let (model, source) = makeModel(MediaNowPlayingUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MediaNowPlayingWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MediaNowPlayingUpdate(status: .loaded, snapshot: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(MediaNowPlayingUpdate(status: .loading))
        model.start()
        source.push(
            MediaNowPlayingUpdate(
                status: .loaded,
                connection: .offline,
                vehicle: MediaVehicle(id: 3, displayName: "Cybertruck"),
                snapshot: MediaSnapshotInput(nowPlayingTitle: "Cached", playbackStatus: "Playing"),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.media?.title, "Cached")
        XCTAssertTrue(model.media?.isPlaying == true)
    }
}

// MARK: - Registry parity

@MainActor final class MediaNowPlayingRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MediaNowPlayingWidget.registration
        XCTAssertEqual(registration.id, "media-now-playing")
        XCTAssertEqual(registration.category, "media")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MediaNowPlayingWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 6)),
            DashboardWidgetSize(cols: 3, rows: 6)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class MediaNowPlayingAccessibilityTests: XCTestCase {
    func testSummaryIncludesTrackPlayStateAndSource() {
        let media = MediaNowPlaying(
            title: "Midnight City",
            artist: "M83",
            source: "Spotify",
            status: "Playing"
        )
        let summary = MediaNowPlayingAccessibility.summary(for: media)
        XCTAssertTrue(summary.contains("Midnight City"))
        XCTAssertTrue(summary.contains("M83"))
        XCTAssertTrue(summary.contains("Playing"))
        XCTAssertTrue(summary.contains("Spotify"))
    }

    func testSummaryOmitsPlayingWhenPaused() {
        let media = MediaNowPlaying(title: "Song", artist: "Artist", status: "Paused")
        let summary = MediaNowPlayingAccessibility.summary(for: media)
        XCTAssertFalse(summary.contains("Playing"))
    }

    func testSummaryHandlesNoMedia() {
        XCTAssertEqual(MediaNowPlayingAccessibility.summary(for: nil), "Nothing playing")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMediaTelemetry: MediaNowPlayingTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
