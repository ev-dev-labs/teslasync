//
//  MediaNavigationPanel.Tests.swift
//  TeslaSync — P4 feature view · 0282 · MediaNavigationPanel (Apple)
//
//  Unit coverage for the MediaNavigationPanel surface:
//    • Adapter — the `cleanNil` scrubber, the number / int formatters (ports of
//      numberFormat.ts), the SI meters → km / mi / ft conversion (port of
//      convertDistanceFromSI), the playback-status colour branch, and the per-section
//      projection (cached → projection).
//    • State holder — `MediaNavProjector` across loading / empty / error / data, plus
//      the `MediaNavigationModel` wiring, the P1/S11 `view.opened` telemetry, and the
//      stale auto-refresh transition.
//    • Accessibility — the VoiceOver summary + the section spoken summaries + the
//      title / artist fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryMediaNavSource`, and the locale is
//  injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

private func metricUnits(precision: Int? = nil) -> MediaNavUnits {
    MediaNavUnits(distance: .kilometers, precision: precision, locale: "en_US")
}

private func imperialUnits(precision: Int? = nil) -> MediaNavUnits {
    MediaNavUnits(distance: .miles, precision: precision, locale: "en_US")
}

@MainActor
final class MediaNavigationPanelTests: XCTestCase {
    // MARK: - cleanNil (port of lib/cleanNil.ts)

    func testCleanNilScrubsGoNilLiteralsAndEmpty() {
        XCTAssertNil(MediaNavText.cleanNil(nil))
        XCTAssertNil(MediaNavText.cleanNil(""))
        XCTAssertNil(MediaNavText.cleanNil("<nil>"))
        XCTAssertNil(MediaNavText.cleanNil("nil"))
        XCTAssertNil(MediaNavText.cleanNil("null"))
    }

    func testCleanNilKeepsMeaningfulText() {
        XCTAssertEqual(MediaNavText.cleanNil("Spotify"), "Spotify")
        XCTAssertEqual(MediaNavText.cleanNil("Queen"), "Queen")
        // A space is truthy + not a nil-literal in the web source — preserved verbatim.
        XCTAssertEqual(MediaNavText.cleanNil(" "), " ")
    }

    // MARK: - Number / int formatting (ports of numberFormat.ts)

    func testNumberUsesGroupingFixedDigitsAndHalfUp() {
        XCTAssertEqual(MediaNavFormat.number(18.5, decimals: 2, locale: enUS), "18.50")
        XCTAssertEqual(MediaNavFormat.number(60695.538, decimals: 2, locale: enUS), "60,695.54")
        XCTAssertEqual(MediaNavFormat.number(1.005, decimals: 2, locale: enUS), "1.01")
    }

    func testIntRoundsHalfUpToZeroDecimals() {
        XCTAssertEqual(MediaNavFormat.int(23, locale: enUS), "23")
        XCTAssertEqual(MediaNavFormat.int(23.6, locale: enUS), "24")
        XCTAssertEqual(MediaNavFormat.int(1234.5, locale: enUS), "1,235")
    }

    func testNumberCoercesNonFiniteToZero() {
        XCTAssertEqual(MediaNavFormat.number(.infinity, decimals: 2, locale: enUS), "0.00")
        XCTAssertEqual(MediaNavFormat.int(.nan, locale: enUS), "0")
    }

    // MARK: - Distance conversion (ports of convertDistanceFromSI)

    func testDistanceUnitConversionMatchesWeb() {
        XCTAssertEqual(MediaNavDistanceUnit.kilometers.fromMeters(18500), 18.5, accuracy: 0.0001)
        XCTAssertEqual(MediaNavDistanceUnit.miles.fromMeters(18500), 11.495321, accuracy: 0.0001)
        XCTAssertEqual(MediaNavDistanceUnit.feet.fromMeters(18500), 60695.538058, accuracy: 0.0001)
    }

    func testDistanceUnitLabelAndInit() {
        XCTAssertEqual(MediaNavDistanceUnit.kilometers.label, "km")
        XCTAssertEqual(MediaNavDistanceUnit.miles.label, "mi")
        XCTAssertEqual(MediaNavDistanceUnit.feet.label, "ft")
        XCTAssertEqual(MediaNavDistanceUnit(label: "mi"), .miles)
        XCTAssertEqual(MediaNavDistanceUnit(label: "ft"), .feet)
        XCTAssertEqual(MediaNavDistanceUnit(label: "km"), .kilometers)
        XCTAssertEqual(MediaNavDistanceUnit(label: "furlong"), .kilometers) // default
    }

    func testDistanceDisplayFormatsValueAndLabel() {
        XCTAssertEqual(MediaNavFormat.distance(meters: 18500, units: metricUnits()), "18.50 km")
        XCTAssertEqual(MediaNavFormat.distance(meters: 18500, units: imperialUnits()), "11.50 mi")
        XCTAssertEqual(
            MediaNavFormat.distance(meters: 18500, units: metricUnits(precision: 1)),
            "18.5 km"
        )
    }

    // MARK: - Playback-status badge (web colour branch)

    func testPlaybackBadgeMapsWebTernary() {
        XCTAssertEqual(MediaPlaybackBadge.from("Playing"), .playing)
        XCTAssertEqual(MediaPlaybackBadge.from("Paused"), .paused)
        XCTAssertEqual(MediaPlaybackBadge.from("Stopped"), .neutral)
        XCTAssertEqual(MediaPlaybackBadge.from(nil), .neutral)
    }

    // MARK: - Media projection (cached → projection)

    func testProjectionFormatsNowPlaying() {
        let media = MediaNavMedia(
            nowPlayingTitle: "Bohemian Rhapsody",
            nowPlayingArtist: "Queen",
            playbackSource: "Spotify",
            playbackStatus: "Playing"
        )
        let projection = MediaNavProjection.make(media: media, location: nil, units: metricUnits())
        guard let nowPlaying = projection.nowPlaying else {
            return XCTFail("expected a now-playing projection")
        }
        XCTAssertEqual(nowPlaying.title, "Bohemian Rhapsody")
        XCTAssertEqual(nowPlaying.artist, "Queen")
        XCTAssertEqual(nowPlaying.source, "Spotify")
        XCTAssertEqual(nowPlaying.statusLabel, "Playing")
        XCTAssertEqual(nowPlaying.statusBadge, .playing)
        XCTAssertNil(projection.navigation)
    }

    func testProjectionScrubsNilLiteralsInMedia() {
        let media = MediaNavMedia(
            nowPlayingTitle: "<nil>",
            nowPlayingArtist: "nil",
            playbackSource: "null",
            playbackStatus: ""
        )
        let projection = MediaNavProjection.make(media: media, location: nil, units: metricUnits())
        guard let nowPlaying = projection.nowPlaying else {
            return XCTFail("expected a now-playing projection")
        }
        XCTAssertNil(nowPlaying.title)
        XCTAssertNil(nowPlaying.artist)
        XCTAssertNil(nowPlaying.source)
        XCTAssertNil(nowPlaying.statusLabel)
        XCTAssertEqual(nowPlaying.statusBadge, .neutral)
    }

    func testProjectionMediaAbsentIsNilSubProjection() {
        let projection = MediaNavProjection.make(
            media: nil,
            location: MediaNavLocation(locatedAtHome: true),
            units: metricUnits()
        )
        XCTAssertNil(projection.nowPlaying)
        XCTAssertNotNil(projection.navigation)
    }

    // MARK: - Navigation projection

    func testProjectionFormatsActiveDestinationMetric() {
        let location = MediaNavLocation(
            destinationName: "Supercharger — Fremont",
            milesToArrival: 18500,
            minutesToArrival: 23
        )
        let projection = MediaNavProjection.make(media: nil, location: location, units: metricUnits())
        guard let destination = projection.navigation?.destination else {
            return XCTFail("expected an active destination")
        }
        XCTAssertEqual(destination.name, "Supercharger — Fremont")
        XCTAssertEqual(destination.distanceText, "18.50 km")
        XCTAssertEqual(destination.etaMinutes, "23")
        XCTAssertEqual(projection.navigation?.places, [])
    }

    func testProjectionUsesImperialDistance() {
        let location = MediaNavLocation(destinationName: "Work", milesToArrival: 18500)
        let projection = MediaNavProjection.make(media: nil, location: location, units: imperialUnits())
        XCTAssertEqual(projection.navigation?.destination?.distanceText, "11.50 mi")
        XCTAssertNil(projection.navigation?.destination?.etaMinutes)
    }

    func testProjectionScrubsDestinationNilLiteralToNoDestination() {
        let location = MediaNavLocation(destinationName: "<nil>", locatedAtHome: true)
        let projection = MediaNavProjection.make(media: nil, location: location, units: metricUnits())
        XCTAssertNil(projection.navigation?.destination)
        XCTAssertEqual(projection.navigation?.places, [.home])
    }

    func testProjectionPlacesPreserveHomeWorkFavoriteOrder() {
        let location = MediaNavLocation(
            locatedAtHome: true,
            locatedAtWork: true,
            locatedAtFavorite: true
        )
        let projection = MediaNavProjection.make(media: nil, location: location, units: metricUnits())
        XCTAssertEqual(projection.navigation?.places, [.home, .work, .favorite])
    }

    func testProjectionLocationAbsentIsNilSubProjection() {
        let projection = MediaNavProjection.make(
            media: MediaNavMedia(nowPlayingTitle: "x"),
            location: nil,
            units: metricUnits()
        )
        XCTAssertNotNil(projection.nowPlaying)
        XCTAssertNil(projection.navigation)
    }

    // MARK: - Projector (loading / empty / error / data precedence)

    func testProjectorErrorTakesPrecedence() {
        let input = MediaNavInput(
            media: MediaNavMedia(nowPlayingTitle: "x"),
            errorMessage: "boom"
        )
        guard case let .error(message) = MediaNavProjector.resolve(input).phase else {
            return XCTFail("expected .error")
        }
        XCTAssertEqual(message, "boom")
    }

    func testProjectorLoadingWhenFetching() {
        let input = MediaNavInput(media: MediaNavMedia(nowPlayingTitle: "x"), isLoading: true)
        XCTAssertEqual(MediaNavProjector.resolve(input).phase, .loading)
    }

    func testProjectorEmptyWhenBothSnapshotsAbsent() {
        XCTAssertEqual(MediaNavProjector.resolve(MediaNavInput(media: nil, location: nil)).phase, .empty)
    }

    func testProjectorDataWhenOnlyLocationPresent() {
        let input = MediaNavInput(media: nil, location: MediaNavLocation(locatedAtHome: true))
        guard case let .data(projection) = MediaNavProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        // Proves the web "No media data" branch is reachable inside the data phase.
        XCTAssertNil(projection.nowPlaying)
        XCTAssertNotNil(projection.navigation)
    }

    func testProjectorDataWhenOnlyMediaPresent() {
        let input = MediaNavInput(media: MediaNavMedia(nowPlayingTitle: "x"), location: nil)
        guard case let .data(projection) = MediaNavProjector.resolve(input).phase else {
            return XCTFail("expected .data")
        }
        XCTAssertNotNil(projection.nowPlaying)
        XCTAssertNil(projection.navigation)
    }
}

// MARK: - Model + accessibility coverage

@MainActor
final class MediaNavigationPanelModelTests: XCTestCase {
    // MARK: - Model wiring + telemetry (P1/S11 view.opened)

    func testModelStartEmitsViewOpenedSlugOnce() {
        let spy = SpyMediaNavTelemetry()
        let model = MediaNavigationModel(source: InMemoryMediaNavSource(), telemetry: spy)
        model.start()
        model.start() // idempotent
        XCTAssertEqual(spy.openedSurfaces, ["MediaNavigationPanel"])
        XCTAssertEqual(MediaNavigationPanel.surfaceSlug, "MediaNavigationPanel")
    }

    func testModelAppliesPushedSnapshot() {
        let source = InMemoryMediaNavSource()
        let model = MediaNavigationModel(source: source, telemetry: SpyMediaNavTelemetry())
        model.start()
        source.push(MediaNavInput(
            media: MediaNavMedia(nowPlayingTitle: "Take Five", playbackStatus: "Paused"),
            units: metricUnits()
        ))
        guard case let .data(projection) = model.phase else {
            return XCTFail("expected .data after push")
        }
        XCTAssertEqual(projection.nowPlaying?.title, "Take Five")
        XCTAssertEqual(projection.nowPlaying?.statusBadge, .paused)
        XCTAssertEqual(model.connection, .live)
    }

    func testModelStartStopRefreshForwardToSource() {
        let source = InMemoryMediaNavSource()
        let model = MediaNavigationModel(source: source, telemetry: SpyMediaNavTelemetry())
        model.start()
        model.refresh()
        model.stop()
        XCTAssertEqual(source.startCount, 1)
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testModelAutoRefreshesOnceOnStaleTransition() {
        let source = InMemoryMediaNavSource()
        let model = MediaNavigationModel(source: source, telemetry: SpyMediaNavTelemetry())
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(MediaNavInput(media: MediaNavMedia(nowPlayingTitle: "x"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "stale transition triggers one auto-refresh")
        source.push(MediaNavInput(media: MediaNavMedia(nowPlayingTitle: "x"), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "staying stale does not re-refresh")
        XCTAssertEqual(model.connection, .stale)
    }

    // MARK: - Accessibility

    func testAccessibilitySummaryComposesParts() {
        XCTAssertEqual(
            MediaNavAccessibility.summary(nowPlaying: "Take Five, Queen", navigation: "Supercharger"),
            "Take Five, Queen, Supercharger"
        )
    }

    func testNowPlayingSpokenSummaryUsesFallbacks() {
        let scrubbed = MediaNavProjection.make(
            media: MediaNavMedia(nowPlayingTitle: nil, nowPlayingArtist: nil),
            location: nil,
            units: metricUnits()
        ).nowPlaying
        XCTAssertEqual(
            MediaNavNowPlayingSection.spokenSummary(scrubbed),
            "Nothing playing, Unknown artist"
        )
        XCTAssertEqual(
            MediaNavNowPlayingSection.spokenSummary(nil),
            "No media data"
        )
    }

    func testNowPlayingTitleAndArtistFallbacks() {
        let present = MediaNavNowPlaying(
            title: "Take Five",
            artist: "Brubeck",
            source: nil,
            statusLabel: nil,
            statusBadge: .neutral
        )
        XCTAssertEqual(MediaNavNowPlayingSection.titleText(present), "Take Five")
        XCTAssertEqual(MediaNavNowPlayingSection.artistText(present), "Brubeck")

        let blank = MediaNavNowPlaying(
            title: nil,
            artist: nil,
            source: nil,
            statusLabel: nil,
            statusBadge: .neutral
        )
        XCTAssertEqual(MediaNavNowPlayingSection.titleText(blank), "Nothing playing")
        XCTAssertEqual(MediaNavNowPlayingSection.artistText(blank), "Unknown artist")
    }

    func testNavigationSpokenSummaryBranches() {
        let withDestination = MediaNavNavigation(
            destination: MediaNavDestination(name: "Supercharger", distanceText: nil, etaMinutes: nil),
            places: []
        )
        XCTAssertEqual(MediaNavNavigationSection.spokenSummary(withDestination), "Supercharger")

        let noDestination = MediaNavNavigation(destination: nil, places: [.home])
        XCTAssertEqual(MediaNavNavigationSection.spokenSummary(noDestination), "No active destination")

        XCTAssertEqual(MediaNavNavigationSection.spokenSummary(nil), "No location data")
    }

    // MARK: - Place chip metadata

    func testPlaceChipKeysAndSymbols() {
        XCTAssertEqual(MediaNavPlace.home.labelKey, "telemetry.placeHome")
        XCTAssertEqual(MediaNavPlace.work.labelKey, "telemetry.placeWork")
        XCTAssertEqual(MediaNavPlace.favorite.labelKey, "telemetry.placeFavorite")
        XCTAssertEqual(MediaNavPlace.home.fallback, "Home")
        XCTAssertEqual(MediaNavPlace.work.fallback, "Work")
        XCTAssertEqual(MediaNavPlace.favorite.fallback, "Favorite")
        XCTAssertEqual(MediaNavPlace.home.systemImage, "house.fill")
    }
}

// MARK: - Test doubles

/// Records the surfaces opened so the `view.opened` contract can be asserted without
/// an `os_log` round-trip. Single-threaded test usage only.
private final class SpyMediaNavTelemetry: MediaNavTelemetry, @unchecked Sendable {
    private(set) var openedSurfaces: [String] = []

    func viewOpened(surface: String) {
        openedSurfaces.append(surface)
    }
}
