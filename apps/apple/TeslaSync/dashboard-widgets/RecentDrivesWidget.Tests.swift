//
//  RecentDrivesWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0079 · RecentDrivesWidget (Apple)
//
//  Unit coverage for the RecentDrivesWidget surface:
//    • Adapter (cached → projection) — `RecentDrivesProjector` value parity with the web widget's
//      numeric + date pipeline (convertDistanceFromSI, fmtNumber/fmtInt, `?`/`—` fallbacks,
//      formatDateShort).
//    • State holder — `RecentDrivesModel` phase resolution across loading / empty / error / content,
//      plus the P1/S11 `view.opened` telemetry, refresh + stale auto-refresh wiring.
//    • Registry — canonical `recent-drives` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store: the
//  model is driven by `InMemoryRecentDrivesSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum RecentDrivesFixture {
    /// A deterministic 2026-06-07 12:00 UTC instant so `dateShort` is stable across runners.
    static let date: Date = {
        var components = DateComponents()
        components.year = 2026
        components.month = 6
        components.day = 7
        components.hour = 12
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC") ?? .gmt
        return calendar.date(from: components) ?? Date(timeIntervalSince1970: 0)
    }()

    static let utc = TimeZone(identifier: "UTC") ?? .gmt

    static let drives: [RecentDriveDTO] = [
        RecentDriveDTO(id: 1, distanceM: 16093.44, durationS: 1500, startSocPct: 82, endSocPct: 67, startTs: date),
        RecentDriveDTO(id: 2, distanceM: 1000, durationS: 1530, startSocPct: 67, endSocPct: nil, startTs: nil)
    ]
}

// MARK: - Adapter: cached DTO → projection (port parity with the web widget)

final class RecentDrivesAdapterTests: XCTestCase {
    func testProjectionMiles() {
        let units = RecentDrivesUnitPrefs(distance: .miles, localeIdentifier: "en_US")
        let projection = RecentDrivesProjector.project(
            drives: RecentDrivesFixture.drives,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )

        XCTAssertEqual(projection.rows.count, 2)

        let first = projection.rows[0]
        XCTAssertEqual(first.id, 1)
        // 16093.44 m / 1609.344 = 10.0 mi → fmtNumber(_, 1) = "10.0".
        XCTAssertEqual(first.distanceValue, "10.0")
        XCTAssertEqual(first.distanceUnit, "mi")
        XCTAssertEqual(first.distanceText, "10.0 mi")
        // 1500 s / 60 = 25 min · 82% → 67%.
        XCTAssertEqual(first.detailText, "25 min · 82% → 67%")
        XCTAssertEqual(first.dateText, "Jun 7")
        XCTAssertEqual(first.accessibilityLabel, "10.0 mi, 25 min · 82% → 67%, Jun 7")
    }

    func testProjectionKilometers() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let projection = RecentDrivesProjector.project(
            drives: RecentDrivesFixture.drives,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )

        let first = projection.rows[0]
        // 16093.44 m / 1000 = 16.09344 km → "16.1".
        XCTAssertEqual(first.distanceValue, "16.1")
        XCTAssertEqual(first.distanceUnit, "km")
    }

    func testFeetConversionAndGrouping() {
        let units = RecentDrivesUnitPrefs(distance: .feet, localeIdentifier: "en_US")
        let drive = RecentDriveDTO(id: 9, distanceM: 304.8, durationS: 0, startSocPct: 50, endSocPct: 50)
        let row = RecentDrivesProjector.project(
            drive: drive,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )
        // 304.8 m / 0.3048 = 1000 ft → "1,000.0".
        XCTAssertEqual(row.distanceValue, "1,000.0")
        XCTAssertEqual(row.distanceUnit, "ft")
    }

    func testDurationRoundsHalfAwayFromZero() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        // Second fixture drive: 1530 s / 60 = 25.5 → "26"; end SoC nil → "?"; nil date → "—".
        let projection = RecentDrivesProjector.project(
            drives: RecentDrivesFixture.drives,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )
        let second = projection.rows[1]
        XCTAssertEqual(second.detailText, "26 min · 67% → ?%")
        XCTAssertEqual(second.dateText, "—")
    }

    func testNilQuantitiesFallBackLikeWeb() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let drive = RecentDriveDTO(id: 3) // all nil
        let row = RecentDrivesProjector.project(
            drive: drive,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )
        XCTAssertEqual(row.distanceValue, "0.0")
        XCTAssertEqual(row.detailText, "0 min · ?% → ?%")
        XCTAssertEqual(row.dateText, "—")
    }

    func testFractionalSocRendersLikeJsNumber() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let drive = RecentDriveDTO(id: 4, distanceM: 0, durationS: 0, startSocPct: 80.5, endSocPct: 79)
        let row = RecentDrivesProjector.project(
            drive: drive,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )
        XCTAssertEqual(row.detailText, "0 min · 80.5% → 79%")
    }

    func testNonFiniteDistanceCollapsesToZero() {
        XCTAssertEqual(convertRecentDrivesDistanceFromSI(.nan, to: .kilometers), 0)
        XCTAssertEqual(convertRecentDrivesDistanceFromSI(.infinity, to: .miles), 0)
        XCTAssertEqual(RecentDrivesFormat.number(.infinity, decimals: 1), "0.0")
    }

    func testProjectorCapsAtFiveRows() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let many = (1 ... 8).map { RecentDriveDTO(id: Int64($0), distanceM: 1000, durationS: 600) }
        let projection = RecentDrivesProjector.project(drives: many, units: units, copy: .fallback)
        XCTAssertEqual(projection.rows.count, 5)
        XCTAssertEqual(projection.rows.first?.id, 1)
        XCTAssertEqual(projection.rows.last?.id, 5)
    }

    func testCopyIsLocalizableViaInjection() {
        let units = RecentDrivesUnitPrefs(distance: .kilometers, localeIdentifier: "en_US")
        let copy = RecentDrivesCopy(tripDetailFormat: "%1$@m · %2$@→%3$@", socUnknown: "·", noDate: "n/a")
        let drive = RecentDriveDTO(id: 7, distanceM: 1000, durationS: 600, startSocPct: nil, endSocPct: nil)
        let row = RecentDrivesProjector.project(
            drive: drive,
            units: units,
            copy: copy,
            timeZone: RecentDrivesFixture.utc
        )
        XCTAssertEqual(row.detailText, "10m · ·→·")
        XCTAssertEqual(row.dateText, "n/a")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

final class RecentDrivesPhaseTests: XCTestCase {
    func testResolvePhaseMatrix() {
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(RecentDrivesModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }
}

@MainActor
final class RecentDrivesModelTests: XCTestCase {
    private func makeModel(
        _ update: RecentDrivesUpdate,
        telemetry: RecentDrivesTelemetry = OSLogRecentDrivesTelemetry()
    ) -> (RecentDrivesModel, InMemoryRecentDrivesSource) {
        let source = InMemoryRecentDrivesSource(initial: update)
        let model = RecentDrivesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(RecentDrivesUpdate(status: .loading, drives: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithEmptyArrayShowsEmpty() {
        let (model, _) = makeModel(RecentDrivesUpdate(status: .loaded, drives: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.projection.isEmpty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(RecentDrivesUpdate(status: .failed("boom"), drives: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let drives = [RecentDriveDTO(id: 1, distanceM: 1000, durationS: 600)]
        let (model, _) = makeModel(RecentDrivesUpdate(status: .failed("net"), drives: drives))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.rows.count, 1)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyRecentDrivesTelemetry()
        let (model, source) = makeModel(RecentDrivesUpdate(status: .loading, drives: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [RecentDrivesWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(RecentDrivesUpdate(status: .loaded, drives: []))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let drives = [RecentDriveDTO(id: 1, distanceM: 1000, durationS: 600)]
        let (model, source) = makeModel(RecentDrivesUpdate(status: .loaded, drives: drives))
        model.start()

        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RecentDrivesUpdate(status: .loaded, connection: .stale, isFetching: true, drives: drives))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(RecentDrivesUpdate(status: .loaded, connection: .stale, isFetching: false, drives: drives))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(RecentDrivesUpdate(status: .loading, drives: nil))
        model.start()
        source.push(
            RecentDrivesUpdate(
                status: .loaded,
                connection: .offline,
                drives: [RecentDriveDTO(id: 7, distanceM: 2000, durationS: 1200)],
                units: RecentDrivesUnitPrefs(distance: .miles),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.units.distance, .miles)
        XCTAssertEqual(model.projection.rows.count, 1)
    }
}

// MARK: - Registry parity

final class RecentDrivesRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = RecentDrivesWidget.registration
        XCTAssertEqual(registration.id, "recent-drives")
        XCTAssertEqual(registration.category, "driving")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
        XCTAssertEqual(RecentDrivesWidget.surfaceSlug, "RecentDrivesWidget")
    }

    func testClampHonorsMinAndMax() {
        let registration = RecentDrivesWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)), DashboardWidgetSize(cols: 2, rows: 2))
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

final class RecentDrivesAccessibilityTests: XCTestCase {
    func testSummaryIncludesTitleAndEveryRow() {
        let units = RecentDrivesUnitPrefs(distance: .miles, localeIdentifier: "en_US")
        let projection = RecentDrivesProjector.project(
            drives: RecentDrivesFixture.drives,
            units: units,
            copy: .fallback,
            timeZone: RecentDrivesFixture.utc
        )
        let summary = RecentDrivesAccessibility.summary(for: projection, title: "Recent Drives")
        XCTAssertTrue(summary.hasPrefix("Recent Drives"))
        XCTAssertTrue(summary.contains("10.0 mi, 25 min · 82% → 67%, Jun 7"))
        // Second fixture row: 1000 m / 1609.344 = 0.6 mi, 1530 s → 26 min, end SoC nil → "?", nil date → "—".
        XCTAssertTrue(summary.contains("0.6 mi, 26 min · 67% → ?%, —"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyRecentDrivesTelemetry: RecentDrivesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
