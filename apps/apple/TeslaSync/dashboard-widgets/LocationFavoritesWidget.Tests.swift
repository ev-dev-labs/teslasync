//
//  LocationFavoritesWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0059 · LocationFavoritesWidget (Apple)
//
//  Unit coverage for the LocationFavoritesWidget surface:
//    • Adapter (cached → projection) — `LocationFavoritesProjection` presence
//      precedence + ranked-item sort/slice/format parity with the web source's
//      `locationBadge()` + `items` `useMemo`, plus the `fmtInt` / `formatRelative`
//      formatter ports.
//    • State holder — `LocationFavoritesModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring + freshness/destination projection.
//    • Registry — canonical `location-favorites` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryLocationFavoritesSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesBefore(_ minutes: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-minutes * 60))
}

private func daysBefore(_ days: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-days * 86400))
}

// MARK: - Adapter: cached DTO → projection (parity with the web source)

@MainActor final class LocationFavoritesProjectionTests: XCTestCase {
    func testPresencePrecedenceMatchesWeb() {
        let both = LocationFavoritesSnapshot(locatedAtHome: true, locatedAtWork: true)
        XCTAssertEqual(LocationFavoritesProjection.presence(for: both), .home)

        let work = LocationFavoritesSnapshot(locatedAtWork: true)
        XCTAssertEqual(LocationFavoritesProjection.presence(for: work), .work)

        let favorite = LocationFavoritesSnapshot(locatedAtFavorite: true)
        XCTAssertEqual(LocationFavoritesProjection.presence(for: favorite), .favorite)

        XCTAssertEqual(LocationFavoritesProjection.presence(for: nil), .other)
        XCTAssertEqual(LocationFavoritesProjection.presence(for: LocationFavoritesSnapshot()), .other)
    }

    func testPresenceEmojiAndToneMatchWeb() {
        XCTAssertEqual(LocationPresence.home.emoji, "🏠")
        XCTAssertEqual(LocationPresence.work.emoji, "🏢")
        XCTAssertEqual(LocationPresence.favorite.emoji, "⭐")
        XCTAssertEqual(LocationPresence.other.emoji, "📍")

        XCTAssertEqual(LocationPresence.home.tone, .success)
        XCTAssertEqual(LocationPresence.other.tone, .warning)
        XCTAssertEqual(LocationPresence.work.tone, .neutral)
        XCTAssertEqual(LocationPresence.favorite.tone, .neutral)
    }

    func testRankedItemsSortDescendingAndSlice() {
        let locations = [
            LocationFavoritesLocation(id: "a", addressName: "A", visitCount: 5),
            LocationFavoritesLocation(id: "b", addressName: "B", visitCount: 142),
            LocationFavoritesLocation(id: "c", addressName: "C", visitCount: 37),
            LocationFavoritesLocation(id: "d", addressName: "D", visitCount: 88)
        ]
        let items = LocationFavoritesProjection.rankedItems(from: locations, limit: 3, now: fixedNow, locale: enUS)
        XCTAssertEqual(items.map(\.id), ["b", "d", "c"])
        XCTAssertEqual(items.map(\.value), [142, 88, 37])
        XCTAssertEqual(items.map(\.label), ["B", "D", "C"])
    }

    func testRankedItemFormattedValueComposesCountAndRelative() {
        let location = LocationFavoritesLocation(
            id: "x",
            addressName: "Depot",
            visitCount: 1234,
            lastVisited: daysBefore(2)
        )
        let items = LocationFavoritesProjection.rankedItems(from: [location], limit: 5, now: fixedNow, locale: enUS)
        XCTAssertEqual(items.first?.formattedValue, "1,234× · 2d ago")
    }

    func testRankedItemMissingFieldsUseDashAndZero() {
        let location = LocationFavoritesLocation(id: "x")
        let items = LocationFavoritesProjection.rankedItems(from: [location], limit: 5, now: fixedNow, locale: enUS)
        XCTAssertEqual(items.first?.label, "—")
        XCTAssertEqual(items.first?.value, 0)
        XCTAssertEqual(items.first?.formattedValue, "0× · —")
    }

    func testRelativeFormatterBuckets() {
        XCTAssertEqual(LocationFavoritesRelativeFormatter.string(for: nil, now: fixedNow, locale: enUS), "—")
        XCTAssertEqual(
            LocationFavoritesRelativeFormatter.string(
                for: fixedNow.addingTimeInterval(-30),
                now: fixedNow,
                locale: enUS
            ),
            "just now"
        )
        XCTAssertEqual(
            LocationFavoritesRelativeFormatter.string(for: minutesBefore(5), now: fixedNow, locale: enUS),
            "5m ago"
        )
        XCTAssertEqual(
            LocationFavoritesRelativeFormatter.string(for: minutesBefore(180), now: fixedNow, locale: enUS),
            "3h ago"
        )
        XCTAssertEqual(
            LocationFavoritesRelativeFormatter.string(for: daysBefore(2), now: fixedNow, locale: enUS),
            "2d ago"
        )
        let absolute = LocationFavoritesRelativeFormatter.string(for: daysBefore(10), now: fixedNow, locale: enUS)
        XCTAssertFalse(absolute.contains("ago"))
        XCTAssertFalse(absolute.isEmpty)
    }

    func testIntFormatterGroupsThousands() {
        XCTAssertEqual(LocationFavoritesIntFormatter.string(1_234_567, locale: enUS), "1,234,567")
        XCTAssertEqual(LocationFavoritesIntFormatter.string(0, locale: enUS), "0")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class LocationFavoritesModelTests: XCTestCase {
    private func makeModel(
        _ update: LocationFavoritesUpdate,
        telemetry: LocationFavoritesTelemetry = OSLogLocationFavoritesTelemetry()
    ) -> (LocationFavoritesModel, InMemoryLocationFavoritesSource) {
        let source = InMemoryLocationFavoritesSource(initial: update)
        let model = LocationFavoritesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(LocationFavoritesUpdate(status: .loading, locations: [], snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(LocationFavoritesUpdate(status: .loaded, locations: [], snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(LocationFavoritesUpdate(status: .failed("boom"), locations: [], snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testSnapshotPresentShowsContentEvenWhileLoadingOrFailed() {
        let snapshot = LocationFavoritesSnapshot(locatedAtHome: true)
        let (loading, _) = makeModel(LocationFavoritesUpdate(status: .loading, snapshot: snapshot))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(LocationFavoritesUpdate(status: .failed("net"), snapshot: snapshot))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testFavoritesPresentShowsContent() {
        let locations = [LocationFavoritesLocation(id: "1", addressName: "Home", visitCount: 3)]
        let (model, _) = makeModel(LocationFavoritesUpdate(status: .loaded, locations: locations, snapshot: nil))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.hasFavorites)
        XCTAssertEqual(model.presence, .other)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyLocationFavoritesTelemetry()
        let (model, source) = makeModel(LocationFavoritesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [LocationFavoritesWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(LocationFavoritesUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(LocationFavoritesUpdate(status: .loading))
        model.start()
        source.push(
            LocationFavoritesUpdate(
                status: .loaded,
                connection: .offline,
                locations: [
                    LocationFavoritesLocation(id: "1", addressName: "A", visitCount: 4),
                    LocationFavoritesLocation(id: "2", addressName: "B", visitCount: 99)
                ],
                snapshot: LocationFavoritesSnapshot(locatedAtHome: true, destinationName: "Office"),
                updatedAt: fixedNow
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.presence, .home)
        XCTAssertEqual(model.destinationName, "Office")
        XCTAssertEqual(model.favorites.first?.value, 99)
        XCTAssertEqual(model.updatedAt, fixedNow)
    }

    func testDestinationNameIsTrimmedAndBlanksDropped() {
        let (blank, _) = makeModel(
            LocationFavoritesUpdate(status: .loaded, snapshot: LocationFavoritesSnapshot(destinationName: "   "))
        )
        blank.start()
        XCTAssertNil(blank.destinationName)

        let (named, _) = makeModel(
            LocationFavoritesUpdate(status: .loaded, snapshot: LocationFavoritesSnapshot(destinationName: "  Home  "))
        )
        named.start()
        XCTAssertEqual(named.destinationName, "Home")
    }

    func testFavoritesAreLimitedToMaxRows() {
        let locations = (1 ... 8).map {
            LocationFavoritesLocation(id: "\($0)", addressName: "L\($0)", visitCount: $0)
        }
        let (model, _) = makeModel(LocationFavoritesUpdate(status: .loaded, locations: locations))
        model.start()
        XCTAssertEqual(model.favorites.count, LocationFavoritesModel.maxRows)
        XCTAssertEqual(model.favorites.first?.value, 8)
    }
}

// MARK: - Registry parity

@MainActor final class LocationFavoritesRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = LocationFavoritesWidget.registration
        XCTAssertEqual(registration.id, "location-favorites")
        XCTAssertEqual(registration.category, "maps")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(LocationFavoritesWidget.surfaceSlug, "LocationFavoritesWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = LocationFavoritesWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 10)),
            DashboardWidgetSize(cols: 3, rows: 10)
        )
    }
}

// MARK: - Accessibility summary content

@MainActor final class LocationFavoritesAccessibilityTests: XCTestCase {
    func testSummaryIncludesPresenceDestinationAndCount() {
        let summary = LocationFavoritesAccessibility.summary(
            presence: .home,
            favoritesCount: 3,
            destinationName: "Office"
        )
        XCTAssertTrue(summary.contains("Home"))
        XCTAssertTrue(summary.contains("Navigating to Office"))
        XCTAssertTrue(summary.contains("3 favorite locations"))
    }

    func testSummaryHandlesNoFavoritesAndNoDestination() {
        let summary = LocationFavoritesAccessibility.summary(
            presence: .other,
            favoritesCount: 0,
            destinationName: nil
        )
        XCTAssertTrue(summary.contains("Other"))
        XCTAssertTrue(summary.contains("No favorite locations"))
        XCTAssertFalse(summary.contains("Navigating to"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyLocationFavoritesTelemetry: LocationFavoritesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
