//
//  MediaHistoryWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0062 · MediaHistoryWidget (Apple)
//
//  Unit coverage for the MediaHistoryWidget surface:
//    • Adapter (cached → projection) — `MediaHistoryBuilder` / `MediaTrack`
//      parity with the web `feedItems` memo + `WidgetEventFeed`.
//    • State holder — `MediaHistoryModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `media-history` metadata + size clamping.
//    • Accessibility — the VoiceOver row label content + relative-time copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryMediaHistorySource`. The pure
//  adapter subset is also proven by the executed host harness in the gate log.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (port parity with the web feed build)

@MainActor final class MediaHistoryAdapterTests: XCTestCase {
    func testSourceLabelSpecialCasesUSB() {
        XCTAssertEqual(MediaHistoryBuilder.sourceLabel("usb"), "USB")
        XCTAssertEqual(MediaHistoryBuilder.sourceLabel("USB"), "USB")
    }

    func testSourceLabelCapitalizesFirstCharacter() {
        XCTAssertEqual(MediaHistoryBuilder.sourceLabel("spotify"), "Spotify")
        XCTAssertEqual(MediaHistoryBuilder.sourceLabel("bluetooth"), "Bluetooth")
        XCTAssertEqual(MediaHistoryBuilder.sourceLabel("FM"), "FM")
    }

    func testMakeTrackAppliesWebFallbacks() {
        let track = MediaHistoryBuilder.makeTrack(from: MediaTrackInput(id: "1"))
        XCTAssertEqual(track.title, "—")
        XCTAssertEqual(track.artist, "—")
        XCTAssertNil(track.sourceLabel)
        XCTAssertFalse(track.isPlaying)
        XCTAssertFalse(track.hasTrack)
        XCTAssertEqual(track.timestamp, Date(timeIntervalSince1970: 0))
    }

    func testMakeTrackDetectsPlayingCaseInsensitively() {
        let playing = MediaHistoryBuilder.makeTrack(from: MediaTrackInput(id: "1", playbackStatus: "Playing"))
        XCTAssertTrue(playing.isPlaying)
        let paused = MediaHistoryBuilder.makeTrack(from: MediaTrackInput(id: "2", playbackStatus: "Paused"))
        XCTAssertFalse(paused.isPlaying)
    }

    func testMakeTrackBuildsTitleLineAndSourceLabel() {
        let track = MediaHistoryBuilder.makeTrack(
            from: MediaTrackInput(id: "1", title: "Redbone", artist: "Childish Gambino", source: "usb")
        )
        XCTAssertEqual(track.titleLine, "Redbone — Childish Gambino")
        XCTAssertEqual(track.sourceLabel, "USB")
        XCTAssertTrue(track.hasTrack)
    }

    func testFeedTracksSortNewestFirstAndCap() {
        let now = Date()
        let inputs = (0 ..< 15).map { idx in
            MediaTrackInput(id: "\(idx)", title: "T\(idx)", timestamp: now.addingTimeInterval(Double(idx) * 60))
        }
        let feed = MediaHistoryBuilder.feedTracks(from: MediaHistoryBuilder.makeTracks(from: inputs))
        XCTAssertEqual(feed.count, MediaHistoryBuilder.feedLimit)
        XCTAssertEqual(feed.first?.id, "14")
        XCTAssertEqual(feed.last?.id, "5")
    }

    func testLatestTrackIsFirstInInputOrder() {
        let tracks = MediaHistoryBuilder.makeTracks(from: [
            MediaTrackInput(id: "a", title: "First"),
            MediaTrackInput(id: "b", title: "Second")
        ])
        XCTAssertEqual(MediaHistoryBuilder.latestTrack(from: tracks)?.id, "a")
        XCTAssertNil(MediaHistoryBuilder.latestTrack(from: []))
    }

    func testRelativeTimeBuckets() {
        let now = Date()
        XCTAssertEqual(MediaHistoryBuilder.relativeTime(for: now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(MediaHistoryBuilder.relativeTime(for: now.addingTimeInterval(-300), now: now), .minutes(5))
        XCTAssertEqual(MediaHistoryBuilder.relativeTime(for: now.addingTimeInterval(-7200), now: now), .hours(2))
        guard case .absolute = MediaHistoryBuilder.relativeTime(for: now.addingTimeInterval(-90000), now: now) else {
            return XCTFail("expected absolute bucket for ages over 24h")
        }
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class MediaHistoryModelTests: XCTestCase {
    private func makeModel(
        _ update: MediaHistoryUpdate,
        telemetry: MediaHistoryTelemetry = OSLogMediaHistoryTelemetry()
    ) -> (MediaHistoryModel, InMemoryMediaHistorySource) {
        let source = InMemoryMediaHistorySource(initial: update)
        let model = MediaHistoryModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutTracksShowsLoading() {
        let (model, _) = makeModel(MediaHistoryUpdate(status: .loading, tracks: []))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutTracksShowsEmpty() {
        let (model, _) = makeModel(MediaHistoryUpdate(status: .loaded, tracks: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MediaHistoryUpdate(status: .failed("boom"), tracks: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testTracksPresentShowContentEvenWhileFetchingOrFailed() {
        let rows = [MediaTrackInput(id: "1", title: "Song")]
        let (loading, _) = makeModel(MediaHistoryUpdate(status: .loading, tracks: rows))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(MediaHistoryUpdate(status: .failed("net"), tracks: rows))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMediaHistoryTelemetry()
        let (model, source) = makeModel(MediaHistoryUpdate(status: .loading, tracks: []), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MediaHistoryWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MediaHistoryUpdate(status: .loaded, tracks: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(MediaHistoryUpdate(status: .loading, tracks: []))
        model.start()
        let row = MediaTrackInput(
            id: "1",
            title: "Song",
            artist: "Artist",
            source: "usb",
            playbackStatus: "playing",
            timestamp: Date()
        )
        source.push(MediaHistoryUpdate(status: .loaded, connection: .offline, tracks: [row], updatedAt: Date()))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.latestTrack?.titleLine, "Song — Artist")
        XCTAssertEqual(model.latestTrack?.sourceLabel, "USB")
        XCTAssertTrue(model.latestTrack?.isPlaying ?? false)
    }
}

// MARK: - Registry parity

@MainActor final class MediaHistoryRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MediaHistoryWidget.registration
        XCTAssertEqual(registration.id, "media-history")
        XCTAssertEqual(registration.category, "media")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MediaHistoryWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)),
            DashboardWidgetSize(cols: 1, rows: 2)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)),
            DashboardWidgetSize(cols: 2, rows: 8)
        )
    }
}

// MARK: - Accessibility + relative-time copy

@MainActor final class MediaHistoryAccessibilityTests: XCTestCase {
    func testRowLabelIncludesTrackSourceAndPlaying() {
        let track = MediaHistoryBuilder.makeTrack(
            from: MediaTrackInput(
                id: "1",
                title: "Song",
                artist: "Artist",
                source: "usb",
                playbackStatus: "playing",
                timestamp: Date()
            )
        )
        let label = MediaHistoryAccessibility.rowLabel(for: track)
        XCTAssertTrue(label.contains("Song — Artist"))
        XCTAssertTrue(label.contains("USB"))
        XCTAssertTrue(label.contains("Now playing"))
    }

    func testRowLabelOmitsPlayingWhenPaused() {
        let track = MediaHistoryBuilder.makeTrack(
            from: MediaTrackInput(id: "1", title: "Song", artist: "Artist", playbackStatus: "paused", timestamp: Date())
        )
        XCTAssertFalse(MediaHistoryAccessibility.rowLabel(for: track).contains("Now playing"))
    }

    func testRelativeLabelLocalizesBuckets() {
        XCTAssertEqual(MediaHistoryStrings.relativeTimeLabel(.justNow), "Just now")
        XCTAssertEqual(MediaHistoryStrings.relativeTimeLabel(.minutes(5)), "5m ago")
        XCTAssertEqual(MediaHistoryStrings.relativeTimeLabel(.hours(2)), "2h ago")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMediaHistoryTelemetry: MediaHistoryTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
