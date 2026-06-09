//
//  JourneyDetailsPanel.Tests.swift
//  TeslaSync — P4 feature view · 0144 · JourneyDetailsPanel (Apple)
//
//  Unit + UI coverage for the drive-detail journey panel surface:
//    • Adapter (cached → projection) — `JourneyDetailsFormat` number/date/coordinate/battery parity
//      with the web `fmtNumber` / `formatDateTime` and the signed-latitude/abs-longitude coordinate
//      quirk, plus the `JourneyDetailsProjector` address / coordinate / no-address / in-progress
//      branches.
//    • State holder — `JourneyDetailsModel` phase resolution across loading / empty / error /
//      content, projection recompute, refresh delegation, the stale auto-refresh guard, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver per-column summary.
//    • View — every render state (loading / content / coordinate / in-progress / empty / error /
//      stale / offline) materializes.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryJourneyDetailsSource`); the view tests render through `ImageRenderer`. Timestamps are
//  built in a fixed timezone so the formatted assertions are stable on any host.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum JourneyFixture {
    static let laPrefs = JourneyFormatPrefs(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles",
        decimalPrecision: 2
    )

    /// A wall-clock instant in a fixed zone so the formatted output is deterministic across hosts.
    static func instant(
        year: Int,
        month: Int,
        day: Int,
        hour: Int,
        minute: Int,
        zone: String = "America/Los_Angeles"
    ) -> Date {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: zone) ?? .current
        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        components.hour = hour
        components.minute = minute
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }

    /// 2026-04-04, 14:30 → 15:10 in America/Los_Angeles (PDT).
    static func addressDrive(ended: Bool = true) -> JourneyDriveDTO {
        let start = instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
        return JourneyDriveDTO(
            startAddress: "Home",
            startTimestamp: start,
            startBatteryPercent: 82,
            endAddress: ended ? "Office" : nil,
            endTimestamp: ended ? instant(year: 2026, month: 4, day: 4, hour: 15, minute: 10) : nil,
            endBatteryPercent: ended ? 64 : nil
        )
    }

    static func coordinateDrive() -> JourneyDriveDTO {
        let start = instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
        return JourneyDriveDTO(
            startLatitude: 37.3318,
            startLongitude: -122.0312,
            startTimestamp: start,
            startBatteryPercent: 80,
            endLatitude: -33.8688,
            endLongitude: 151.2093,
            endTimestamp: instant(year: 2026, month: 4, day: 4, hour: 15, minute: 10),
            endBatteryPercent: 61
        )
    }
}

// MARK: - Adapter: number / date / coordinate / battery formatting (web parity)

@MainActor final class JourneyDetailsFormatTests: XCTestCase {
    private let start = JourneyFixture.instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)

    func testNumberGroupsAndPins2Decimals() {
        XCTAssertEqual(JourneyDetailsFormat.number(37.3318, prefs: JourneyFixture.laPrefs), "37.33")
        XCTAssertEqual(JourneyDetailsFormat.number(1234.5, prefs: JourneyFixture.laPrefs), "1,234.50")
    }

    func testNumberHonorsPrecisionPref() {
        let prefs = JourneyFormatPrefs(localeIdentifier: "en_US", timeZoneIdentifier: nil, decimalPrecision: 4)
        XCTAssertEqual(JourneyDetailsFormat.number(122.0312, prefs: prefs), "122.0312")
    }

    func testDateTimeRendersInVehicleZone() {
        let text = JourneyDetailsFormat.dateTime(start, prefs: JourneyFixture.laPrefs)
        XCTAssertTrue(text.contains("Apr 4, 2026"), "expected medium date, got \(text)")
        XCTAssertTrue(text.contains("2:30"), "expected the time, got \(text)")
        XCTAssertTrue(text.contains("PM"), "expected PM marker, got \(text)")
    }

    func testDateTimeRendersLocaleTwentyFourHour() {
        let prefs = JourneyFormatPrefs(localeIdentifier: "de_DE", timeZoneIdentifier: "America/Los_Angeles")
        XCTAssertTrue(JourneyDetailsFormat.dateTime(start, prefs: prefs).contains("14:30"))
    }

    func testNilDateRendersWebEmptyMarker() {
        XCTAssertEqual(JourneyDetailsFormat.dateTime(nil, prefs: JourneyFixture.laPrefs), "—")
    }

    func testCoordinateHemispheresAndSignedLatAbsLon() {
        // Northern/Western: latitude keeps its sign convention via N, longitude is abs'd then W.
        XCTAssertEqual(
            JourneyDetailsFormat.coordinate(latitude: 37.3318, longitude: -122.0312, prefs: JourneyFixture.laPrefs),
            "37.33°N, 122.03°W"
        )
        // Southern/Eastern: the web QUIRK — latitude is NOT abs'd so it keeps its minus sign with "S".
        XCTAssertEqual(
            JourneyDetailsFormat.coordinate(latitude: -33.8688, longitude: 151.2093, prefs: JourneyFixture.laPrefs),
            "-33.87°S, 151.21°E"
        )
    }

    func testBatteryKnownAndUnknown() {
        XCTAssertEqual(JourneyDetailsFormat.battery(82), "82")
        XCTAssertEqual(JourneyDetailsFormat.battery(0), "0")
        XCTAssertEqual(JourneyDetailsFormat.battery(nil), "?")
    }
}

// MARK: - Adapter: projector (web branch-for-branch)

@MainActor final class JourneyDetailsProjectorTests: XCTestCase {
    private func project(_ drive: JourneyDriveDTO) -> JourneyDetailsProjection {
        JourneyDetailsProjector.project(drive: drive, prefs: JourneyFixture.laPrefs)
    }

    func testAddressDriveUsesAddressesAndBattery() {
        let projection = project(JourneyFixture.addressDrive())
        XCTAssertEqual(projection.start.primaryText, "Home")
        XCTAssertFalse(projection.start.isCoordinate)
        XCTAssertEqual(projection.start.batteryValue, "82")
        XCTAssertEqual(projection.destination.primaryText, "Office")
        XCTAssertEqual(projection.destination.batteryValue, "64")
        XCTAssertEqual(projection.start.tone, .start)
        XCTAssertEqual(projection.destination.tone, .destination)
    }

    func testCoordinateDriveRendersMonospacedCoordinates() {
        let projection = project(JourneyFixture.coordinateDrive())
        XCTAssertEqual(projection.start.primaryText, "37.33°N, 122.03°W")
        XCTAssertTrue(projection.start.isCoordinate)
        XCTAssertEqual(projection.destination.primaryText, "-33.87°S, 151.21°E")
        XCTAssertTrue(projection.destination.isCoordinate)
    }

    func testZeroOrNilCoordinateFallsBackToNoAddress() {
        // JS `lat && lon` truthiness: a 0 latitude is falsy and short-circuits to the fallback.
        let drive = JourneyDriveDTO(startLatitude: 0, startLongitude: 10, startTimestamp: Date())
        let projection = project(drive)
        XCTAssertEqual(projection.start.primaryText, "No address data")
        XCTAssertFalse(projection.start.isCoordinate)
    }

    func testFinishedDriveWithoutAddressShowsNoAddress() {
        let drive = JourneyDriveDTO(
            startAddress: "Home",
            startTimestamp: JourneyFixture.instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30),
            endTimestamp: JourneyFixture.instant(year: 2026, month: 4, day: 4, hour: 15, minute: 10)
        )
        let projection = project(drive)
        XCTAssertEqual(projection.destination.primaryText, "No address data")
        XCTAssertTrue(projection.destination.timestampText.contains("Apr 4, 2026"))
    }

    func testInProgressDriveFallsBackForDestination() {
        let projection = project(JourneyFixture.addressDrive(ended: false))
        XCTAssertEqual(projection.destination.primaryText, "In progress")
        XCTAssertEqual(projection.destination.timestampText, "In progress")
        XCTAssertEqual(projection.destination.batteryValue, "?")
    }

    func testStartTimestampAlwaysFormatted() {
        let projection = project(JourneyFixture.addressDrive(ended: false))
        XCTAssertTrue(projection.start.timestampText.contains("Apr 4, 2026"), projection.start.timestampText)
    }

    func testAccessibilitySummaryComposesLabelLocationTimestampBattery() {
        let projection = project(JourneyFixture.addressDrive())
        let summary = JourneyDetailsAccessibility.summary(for: projection.start)
        XCTAssertTrue(summary.hasPrefix("Start: Home. "), summary)
        XCTAssertTrue(summary.contains("Apr 4, 2026"), summary)
        XCTAssertTrue(summary.hasSuffix("Battery 82%"), summary)
    }
}

// MARK: - State holder: phases

@MainActor final class JourneyDetailsPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(JourneyDetailsModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }
}

// MARK: - State holder: wiring + refresh + telemetry

@MainActor final class JourneyDetailsModelTests: XCTestCase {
    private func makeModel(
        _ update: JourneyDetailsUpdate,
        telemetry: JourneyDetailsTelemetry = OSLogJourneyDetailsTelemetry()
    ) -> (JourneyDetailsModel, InMemoryJourneyDetailsSource) {
        let source = InMemoryJourneyDetailsSource(initial: update)
        let model = JourneyDetailsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        connection: JourneyConnection = .live,
        isFetching: Bool = false
    ) -> JourneyDetailsUpdate {
        JourneyDetailsUpdate(
            status: .loaded,
            connection: connection,
            isFetching: isFetching,
            drive: JourneyFixture.addressDrive(),
            prefs: JourneyFixture.laPrefs,
            updatedAt: Date()
        )
    }

    func testInitialContentProjectsBothEndpoints() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.start.primaryText, "Home")
        XCTAssertEqual(model.projection?.destination.primaryText, "Office")
    }

    func testEmptyHasNoProjection() {
        let (model, _) = makeModel(JourneyDetailsUpdate(status: .empty, drive: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertNil(model.projection)
    }

    func testCachedContentStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            JourneyDetailsUpdate(
                status: .failed("net"),
                connection: .offline,
                drive: JourneyFixture.addressDrive(),
                prefs: JourneyFixture.laPrefs
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testFreshnessTracksUpdates() {
        let (model, source) = makeModel(JourneyDetailsUpdate(status: .loading))
        model.start()
        source.push(loaded(connection: .stale, isFetching: true))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertTrue(model.isFetching)
        XCTAssertNotNil(model.updatedAt)
    }

    func testRefreshDelegates() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndIdle() {
        let (model, source) = makeModel(loaded())
        model.start()
        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(connection: .stale, isFetching: false))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
        source.push(loaded(connection: .stale, isFetching: true))
        model.autoRefreshIfStale() // stale + fetching → guarded
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(loaded(connection: .offline))
        model.start()
        model.autoRefreshIfStale()
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyJourneyDetailsTelemetry()
        let (model, source) = makeModel(JourneyDetailsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [JourneyDetailsSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor final class JourneyDetailsViewStateTests: XCTestCase {
        private func renders(_ update: JourneyDetailsUpdate) -> Bool {
            let source = InMemoryJourneyDetailsSource(initial: update)
            let model = JourneyDetailsModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: JourneyDetailsPanel(model: model).frame(width: 520, height: 260))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func loaded(
            drive: JourneyDriveDTO = JourneyFixture.addressDrive(),
            connection: JourneyConnection = .live
        ) -> JourneyDetailsUpdate {
            JourneyDetailsUpdate(
                status: .loaded,
                connection: connection,
                drive: drive,
                prefs: JourneyFixture.laPrefs,
                updatedAt: Date()
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testCoordinateContentRenders() {
            XCTAssertTrue(renders(loaded(drive: JourneyFixture.coordinateDrive())))
        }

        func testInProgressRenders() {
            XCTAssertTrue(renders(loaded(drive: JourneyFixture.addressDrive(ended: false))))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(JourneyDetailsUpdate(status: .empty, drive: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(JourneyDetailsUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(JourneyDetailsUpdate(status: .failed("offline"))))
        }

        func testStaleRenders() {
            XCTAssertTrue(renders(loaded(connection: .stale)))
        }

        func testOfflineRenders() {
            XCTAssertTrue(renders(loaded(connection: .offline)))
        }
    }
#endif

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyJourneyDetailsTelemetry: JourneyDetailsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
