//
//  DriveDetailHeader.Tests.swift
//  TeslaSync — P4 feature view · 0137 · DriveDetailHeader (Apple)
//
//  Unit + UI coverage for the drive-detail masthead surface:
//    • Adapter (cached → projection) — `DriveDetailHeaderFormat` date/time/timezone parity with the
//      web `formatDate`/`formatTime`/`tzAbbreviation`, the route-vs-fallback title condition, and the
//      `vehicleName · date · time tz [→ endTime]` subtitle composition.
//    • State holder — `DriveDetailHeaderModel` phase resolution across loading / empty / error /
//      content, projection recompute, refresh delegation, the stale auto-refresh guard, and the
//      P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver masthead summary.
//    • View — every render state (loading / empty / error / stale / offline / content) materializes.
//
//  The pure-logic tests run with no network and no real store (the model is driven by
//  `InMemoryDriveDetailHeaderSource`); the view tests render through `ImageRenderer`. Timestamps are
//  built in a fixed timezone so the formatted assertions are stable on any host.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum DriveHeaderFixture {
    static let laPrefs = DriveHeaderFormatPrefs(
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
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
    static func drive(
        startAddress: String? = "Home",
        endAddress: String? = "Office",
        ended: Bool = true
    ) -> DriveHeaderDTO {
        let start = instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)
        return DriveHeaderDTO(
            driveID: "8421",
            vehicleName: "Model 3",
            startAddress: startAddress,
            endAddress: endAddress,
            startTs: start,
            endTs: ended ? instant(year: 2026, month: 4, day: 4, hour: 15, minute: 10) : nil
        )
    }
}

// MARK: - Adapter: date / time / timezone formatting (web parity)

@MainActor
final class DriveDetailHeaderFormatTests: XCTestCase {
    private let start = DriveHeaderFixture.instant(year: 2026, month: 4, day: 4, hour: 14, minute: 30)

    func testDateMatchesWebMediumStyle() {
        XCTAssertEqual(DriveDetailHeaderFormat.date(start, prefs: DriveHeaderFixture.laPrefs), "Apr 4, 2026")
    }

    func testTimeRendersLocaleTwelveHour() {
        let text = DriveDetailHeaderFormat.time(start, prefs: DriveHeaderFixture.laPrefs)
        XCTAssertTrue(text.contains("2:30"), "expected 12h time, got \(text)")
        XCTAssertTrue(text.contains("PM"), "expected PM marker, got \(text)")
    }

    func testTimeRendersLocaleTwentyFourHour() {
        let prefs = DriveHeaderFormatPrefs(localeIdentifier: "de_DE", timeZoneIdentifier: "America/Los_Angeles")
        XCTAssertEqual(DriveDetailHeaderFormat.time(start, prefs: prefs), "14:30")
    }

    func testNilDateRendersWebEmptyMarker() {
        XCTAssertEqual(DriveDetailHeaderFormat.date(nil, prefs: DriveHeaderFixture.laPrefs), "—")
        XCTAssertEqual(DriveDetailHeaderFormat.time(nil, prefs: DriveHeaderFixture.laPrefs), "—")
    }

    func testTimeZoneAbbreviationResolvesWhenZonePresent() {
        XCTAssertEqual(DriveDetailHeaderFormat.timeZoneAbbreviation(start, prefs: DriveHeaderFixture.laPrefs), "PDT")
    }

    func testTimeZoneAbbreviationNilWithoutZoneOrDate() {
        let noZone = DriveHeaderFormatPrefs(localeIdentifier: "en_US", timeZoneIdentifier: nil)
        XCTAssertNil(DriveDetailHeaderFormat.timeZoneAbbreviation(start, prefs: noZone))
        XCTAssertNil(DriveDetailHeaderFormat.timeZoneAbbreviation(nil, prefs: DriveHeaderFixture.laPrefs))
    }
}

// MARK: - Adapter: projector (route/fallback title + subtitle)

@MainActor
final class DriveDetailHeaderProjectorTests: XCTestCase {
    private func project(_ drive: DriveHeaderDTO) -> DriveHeaderProjection {
        DriveDetailHeaderProjector.project(drive: drive, prefs: DriveHeaderFixture.laPrefs)
    }

    func testRouteTitleWhenBothAddressesPresent() {
        let projection = project(DriveHeaderFixture.drive())
        XCTAssertEqual(projection.routeTitle, "Home → Office")
        XCTAssertFalse(projection.usesFallbackTitle)
        XCTAssertEqual(projection.resolvedTitle, "Home → Office")
    }

    func testFallbackTitleWhenAddressMissingOrEmpty() {
        let missing = project(DriveHeaderFixture.drive(startAddress: nil))
        XCTAssertNil(missing.routeTitle)
        XCTAssertTrue(missing.usesFallbackTitle)
        XCTAssertEqual(missing.resolvedTitle, "Drive Details")

        let empty = project(DriveHeaderFixture.drive(endAddress: ""))
        XCTAssertNil(empty.routeTitle)
        XCTAssertTrue(empty.usesFallbackTitle)
    }

    func testSubtitleComposesVehicleDateTimeAndTz() {
        let projection = project(DriveHeaderFixture.drive())
        XCTAssertTrue(projection.subtitle.hasPrefix("Model 3 · Apr 4, 2026 · "), projection.subtitle)
        XCTAssertTrue(projection.subtitle.contains("PDT"), projection.subtitle)
        XCTAssertTrue(projection.subtitle.contains(" → "), projection.subtitle)
    }

    func testSubtitleOmitsEndTimeForInProgressDrive() {
        let projection = project(DriveHeaderFixture.drive(ended: false))
        XCTAssertNil(projection.endTimeText)
        XCTAssertFalse(projection.subtitle.contains(" → "), projection.subtitle)
    }

    func testDriveIdPropagated() {
        XCTAssertEqual(project(DriveHeaderFixture.drive()).driveID, "8421")
    }
}

// MARK: - State holder: phases + refresh + telemetry

@MainActor
final class DriveDetailHeaderModelTests: XCTestCase {
    private func makeModel(
        _ update: DriveDetailHeaderUpdate,
        telemetry: DriveDetailHeaderTelemetry = OSLogDriveDetailHeaderTelemetry()
    ) -> (DriveDetailHeaderModel, InMemoryDriveDetailHeaderSource) {
        let source = InMemoryDriveDetailHeaderSource(initial: update)
        let model = DriveDetailHeaderModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    private func loaded(
        connection: DriveHeaderConnection = .live,
        isFetching: Bool = false
    ) -> DriveDetailHeaderUpdate {
        DriveDetailHeaderUpdate(
            status: .loaded,
            connection: connection,
            isFetching: isFetching,
            drive: DriveHeaderFixture.drive(),
            prefs: DriveHeaderFixture.laPrefs,
            updatedAt: Date()
        )
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(DriveDetailHeaderModel.resolvePhase(status: .failed("e"), hasData: true), .content)
    }

    func testInitialContentProjectsMasthead() {
        let (model, _) = makeModel(loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection?.driveID, "8421")
        XCTAssertEqual(model.projection?.routeTitle, "Home → Office")
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(DriveDetailHeaderUpdate(status: .empty, drive: nil))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(DriveDetailHeaderUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(DriveDetailHeaderUpdate(status: .failed("boom")))
        failed.start()
        XCTAssertEqual(failed.phase, .error("boom"))
    }

    func testCachedMastheadStaysContentWhileFailing() {
        let (model, source) = makeModel(loaded())
        model.start()
        source.push(
            DriveDetailHeaderUpdate(
                status: .failed("net"),
                connection: .offline,
                drive: DriveHeaderFixture.drive(),
                prefs: DriveHeaderFixture.laPrefs
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .offline)
    }

    func testFreshnessTracksUpdates() {
        let (model, source) = makeModel(DriveDetailHeaderUpdate(status: .loading))
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

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyDriveDetailHeaderTelemetry()
        let (model, source) = makeModel(DriveDetailHeaderUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [DriveDetailHeaderSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }
}

// MARK: - Accessibility summary

@MainActor
final class DriveDetailHeaderAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleAndSubtitle() {
        let projection = DriveDetailHeaderProjector.project(
            drive: DriveHeaderFixture.drive(),
            prefs: DriveHeaderFixture.laPrefs
        )
        let summary = DriveDetailHeaderAccessibility.summary(for: projection)
        XCTAssertTrue(summary.hasPrefix("Home → Office. "), summary)
        XCTAssertTrue(summary.contains("Model 3 · Apr 4, 2026"), summary)
    }
}

// MARK: - View: per-state render smoke (every state materializes)

#if canImport(UIKit) || canImport(AppKit)
    @MainActor
    final class DriveDetailHeaderViewStateTests: XCTestCase {
        private func renders(_ update: DriveDetailHeaderUpdate) -> Bool {
            let source = InMemoryDriveDetailHeaderSource(initial: update)
            let model = DriveDetailHeaderModel(source: source)
            model.start()
            let renderer = ImageRenderer(content: DriveDetailHeader(model: model).frame(width: 520, height: 140))
            #if canImport(UIKit)
                return renderer.uiImage != nil
            #else
                return renderer.nsImage != nil
            #endif
        }

        private func loaded(connection: DriveHeaderConnection = .live) -> DriveDetailHeaderUpdate {
            DriveDetailHeaderUpdate(
                status: .loaded,
                connection: connection,
                drive: DriveHeaderFixture.drive(),
                prefs: DriveHeaderFixture.laPrefs,
                updatedAt: Date()
            )
        }

        func testContentRenders() {
            XCTAssertTrue(renders(loaded()))
        }

        func testFallbackTitleRenders() {
            XCTAssertTrue(renders(
                DriveDetailHeaderUpdate(
                    status: .loaded,
                    drive: DriveHeaderFixture.drive(startAddress: nil, endAddress: nil),
                    prefs: DriveHeaderFixture.laPrefs
                )
            ))
        }

        func testEmptyRenders() {
            XCTAssertTrue(renders(DriveDetailHeaderUpdate(status: .empty, drive: nil)))
        }

        func testLoadingRenders() {
            XCTAssertTrue(renders(DriveDetailHeaderUpdate(status: .loading)))
        }

        func testErrorRenders() {
            XCTAssertTrue(renders(DriveDetailHeaderUpdate(status: .failed("offline"))))
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
private final class SpyDriveDetailHeaderTelemetry: DriveDetailHeaderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
