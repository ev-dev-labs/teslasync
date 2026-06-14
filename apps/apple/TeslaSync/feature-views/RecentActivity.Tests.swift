//
//  RecentActivity.Tests.swift
//  TeslaSync — P4 feature view · 0130 · RecentActivity (Apple)
//
//  Adapter unit coverage (cached → projection) for the RecentActivity surface:
//    • `RecentActivityFormat` number / int / currency / SI conversion / soc / time-ago parity
//      with the web `fmtNumber` / `fmtInt` / `<Currency>` / `convertDistanceFromSI` /
//      `convertEnergyFromSI` / `formatTimeAgo`.
//    • `RecentActivityProjection` activity-feed / battery-trend / fleet-performance projection
//      (titles, subtitles, ordering, the 8-row timeline cap, the battery reverse + default, the
//      raw counts / currency / CO₂ / efficiency rows) + content/empty/loading/error phase
//      resolution.
//
//  The state-holder + accessibility coverage lives in RecentActivity.ModelTests.swift. These run
//  in the TeslaSync(/-macOS) XCTest targets with no network and no bundle: the adapter is pure.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: formatting (web fmtNumber / Currency / SI / formatTimeAgo parity)

@MainActor final class RecentActivityFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testNumberRoundsHalfAwayAndGuardsNonFinite() {
        XCTAssertEqual(RecentActivityFormat.number(11.3711, decimals: 1, locale: enUS), "11.4")
        XCTAssertEqual(RecentActivityFormat.number(495.768, decimals: 0, locale: enUS), "496")
        XCTAssertEqual(RecentActivityFormat.number(.nan, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(RecentActivityFormat.number(.infinity, decimals: 0, locale: enUS), "0")
    }

    func testNumberIsLocaleAware() {
        XCTAssertEqual(RecentActivityFormat.number(16.09344, decimals: 1, locale: enUS), "16.1")
        let de = RecentActivityFormat.number(16.09344, decimals: 1, locale: Locale(identifier: "de-DE"))
        XCTAssertTrue(de.contains(",1"), "expected a decimal comma in de-DE, got \(de)")
    }

    func testIntGroupsThousands() {
        XCTAssertEqual(RecentActivityFormat.int(1234, locale: enUS), "1,234")
        XCTAssertEqual(RecentActivityFormat.int(496, locale: enUS), "496")
    }

    func testCurrencyPrefixesSymbolAtTwoPlaces() {
        XCTAssertEqual(RecentActivityFormat.currency(9.4, symbol: "$", decimals: 2, locale: enUS), "$9.40")
        XCTAssertEqual(RecentActivityFormat.currency(612, symbol: "$", decimals: 2, locale: enUS), "$612.00")
        XCTAssertEqual(
            RecentActivityFormat.currency(.nan, symbol: "$", decimals: 2, locale: enUS),
            RecentActivityFormat.emDash
        )
    }

    func testDistanceFromSIMatchesWebConverter() {
        XCTAssertEqual(RecentActivityFormat.distanceFromSI(1609.344, unit: "mi"), 1.0, accuracy: 1e-9)
        XCTAssertEqual(RecentActivityFormat.distanceFromSI(1000, unit: "km"), 1.0, accuracy: 1e-9)
        XCTAssertEqual(RecentActivityFormat.distanceFromSI(.nan, unit: "mi"), 0)
    }

    func testEnergyKwhFromWh() {
        XCTAssertEqual(RecentActivityFormat.energyKwhFromWh(31400), 31.4, accuracy: 1e-9)
        XCTAssertEqual(RecentActivityFormat.energyKwhFromWh(.infinity), 0)
    }

    func testSocAndRange() {
        XCTAssertEqual(RecentActivityFormat.soc(80), "80%")
        XCTAssertEqual(RecentActivityFormat.soc(nil), "?%")
        XCTAssertEqual(RecentActivityFormat.socRange(start: 80, end: 60), "80% → 60%")
        XCTAssertEqual(RecentActivityFormat.socRange(start: nil, end: nil), "?% → ?%")
    }

    func testTimeAgoMatchesWebThresholds() {
        let now = Date(timeIntervalSince1970: 1_733_580_000)
        func ago(_ seconds: Double) -> String {
            RecentActivityFormat.timeAgo(
                from: now.addingTimeInterval(-seconds),
                relativeTo: now,
                locale: enUS,
                localize: echo
            )
        }
        XCTAssertEqual(ago(30), "Just now")
        XCTAssertEqual(ago(5 * 60), "5m ago")
        XCTAssertEqual(ago(59 * 60), "59m ago")
        XCTAssertEqual(ago(3 * 3600), "3h ago")
        XCTAssertEqual(ago(23 * 3600), "23h ago")
        XCTAssertEqual(ago(3 * 86400), "3d ago")
        XCTAssertEqual(ago(6 * 86400), "6d ago")
    }

    func testTimeAgoBeyondAWeekFallsBackToShortDate() {
        let now = Date(timeIntervalSince1970: 1_733_580_000)
        let old = now.addingTimeInterval(-10 * 86400)
        XCTAssertEqual(
            RecentActivityFormat.timeAgo(from: old, relativeTo: now, locale: enUS, localize: echo),
            RecentActivityFormat.dateShort(old, locale: enUS)
        )
    }
}

// MARK: - Adapter: activity feed projection

@MainActor final class RecentActivityProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let now = Date(timeIntervalSince1970: 1_733_580_000)

    private func imperial() -> RecentActivityUnits {
        RecentActivityUnits(
            distanceUnit: "mi",
            efficiencyUnit: "Wh/mi",
            efficiencyFactor: 1.609344,
            currencySymbol: "$",
            localeIdentifier: "en-US"
        )
    }

    func testDriveRowTitleAndSubtitle() {
        let drive = RecentActivityDrive(
            id: "d1",
            distanceM: 16093.44,
            durationS: 5400,
            startSocPct: 80,
            endSocPct: 60,
            startedAt: now.addingTimeInterval(-600)
        )
        let items = RecentActivityProjection.activityItems(
            drives: [drive], charges: [], units: imperial(), now: now, localize: echo
        )
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].kind, .drive)
        XCTAssertEqual(items[0].title, "10.0 mi drive")
        XCTAssertEqual(items[0].subtitle, "1h 30m · 80% → 60%")
        XCTAssertEqual(items[0].timeAgo, "10m ago")
    }

    func testChargeRowWithAndWithoutCost() {
        let withCost = RecentActivityCharge(
            id: "c1", energyAddedWh: 31400, startSocPct: 44, endSocPct: 80, cost: 9.4,
            startedAt: now.addingTimeInterval(-3600)
        )
        let withoutCost = RecentActivityCharge(
            id: "c2", energyAddedWh: 7800, startSocPct: 71, endSocPct: 84, cost: nil,
            startedAt: now.addingTimeInterval(-7200)
        )
        let items = RecentActivityProjection.activityItems(
            drives: [], charges: [withCost, withoutCost], units: imperial(), now: now, localize: echo
        )
        XCTAssertEqual(items[0].title, "31.4 kWh charged")
        XCTAssertEqual(items[0].subtitle, "44% → 80% · $9.40")
        XCTAssertEqual(items[1].subtitle, "71% → 84%")
    }

    func testFeedSortsNewestFirstAcrossKinds() {
        let oldDrive = RecentActivityDrive(
            id: "d", distanceM: 1000, durationS: 600, startSocPct: 50, endSocPct: 48,
            startedAt: now.addingTimeInterval(-9000)
        )
        let newCharge = RecentActivityCharge(
            id: "c", energyAddedWh: 1000, startSocPct: 48, endSocPct: 55, cost: nil,
            startedAt: now.addingTimeInterval(-600)
        )
        let items = RecentActivityProjection.activityItems(
            drives: [oldDrive], charges: [newCharge], units: imperial(), now: now, localize: echo
        )
        XCTAssertEqual(items.map(\.kind), [.charge, .drive])
    }

    func testTimelineCapsAtEight() {
        let drives = (0 ..< 7).map { index in
            RecentActivityDrive(
                id: "d\(index)", distanceM: 1000, durationS: 600, startSocPct: 50, endSocPct: 40,
                startedAt: now.addingTimeInterval(-Double(index) * 600)
            )
        }
        let charges = (0 ..< 3).map { index in
            RecentActivityCharge(
                id: "c\(index)", energyAddedWh: 1000, startSocPct: 40, endSocPct: 60, cost: nil,
                startedAt: now.addingTimeInterval(-Double(index) * 300)
            )
        }
        let items = RecentActivityProjection.activityItems(
            drives: drives, charges: charges, units: imperial(), now: now, localize: echo
        )
        XCTAssertEqual(items.count, 10)
        XCTAssertEqual(RecentActivityProjection.timeline(items).count, 8)
    }

    func testDriveTitleHonorsKilometers() {
        let metric = RecentActivityUnits(
            distanceUnit: "km", efficiencyUnit: "Wh/km", efficiencyFactor: 1,
            currencySymbol: "$", localeIdentifier: "en-US"
        )
        let drive = RecentActivityDrive(
            id: "d", distanceM: 16093.44, durationS: 0, startSocPct: 90, endSocPct: 88, startedAt: now
        )
        let items = RecentActivityProjection.activityItems(
            drives: [drive], charges: [], units: metric, now: now, localize: echo
        )
        XCTAssertEqual(items[0].title, "16.1 km drive")
    }
}

// MARK: - Adapter: battery trend + performance + phase

@MainActor final class RecentActivityPanelProjectionTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func drive(_ id: String, end: Int?) -> RecentActivityDrive {
        RecentActivityDrive(id: id, distanceM: 0, durationS: 0, startSocPct: 0, endSocPct: end, startedAt: nil)
    }

    func testBatteryTrendReversesAndDefaultsMissingSoc() {
        let drives = [drive("a", end: 74), drive("b", end: 49), drive("c", end: nil)]
        let trend = RecentActivityProjection.batteryTrend(from: drives)
        XCTAssertEqual(trend.map(\.position), [0, 1, 2])
        XCTAssertEqual(trend.map(\.label), ["2", "1", "0"])
        XCTAssertEqual(trend.map(\.value), [50, 49, 74])
    }

    func testPerformanceRowsMatchWeb() {
        let analytics = RecentActivityAnalytics(
            totalDrives: 142,
            totalChargingSessions: 47,
            totalCost: 612,
            totalEnergyKwh: 1180.4,
            mostEfficientVehicle: RecentActivityEfficientVehicle(name: "Model 3 LR", efficiencyWhKm: 148)
        )
        let units = RecentActivityUnits(
            distanceUnit: "mi", efficiencyUnit: "Wh/mi", efficiencyFactor: 1.609344,
            currencySymbol: "$", localeIdentifier: "en-US"
        )
        let performance = RecentActivityProjection.performance(from: analytics, units: units)
        XCTAssertEqual(performance.metrics.map(\.id), ["drives", "charges", "cost", "co2"])
        XCTAssertEqual(performance.metrics.map(\.value), ["142", "47", "$612.00", "496 kg"])
        XCTAssertEqual(performance.metrics.map(\.tone), [.primary, .primary, .warning, .success])
        XCTAssertEqual(performance.mostEfficient?.name, "Model 3 LR")
        XCTAssertEqual(performance.mostEfficient?.value, "238 Wh/mi")
    }

    func testPerformanceDefaultsWhenAnalyticsAbsent() {
        let units = RecentActivityUnits(
            distanceUnit: "km", efficiencyUnit: "Wh/km", efficiencyFactor: 1,
            currencySymbol: "$", localeIdentifier: "en-US"
        )
        let performance = RecentActivityProjection.performance(from: nil, units: units)
        XCTAssertEqual(performance.metrics.map(\.value), ["0", "0", "$0.00", "0 kg"])
        XCTAssertNil(performance.mostEfficient)
    }

    func testHasDataAndPhaseMatrix() {
        XCTAssertFalse(RecentActivityProjection.hasData(drives: [], charges: [], analytics: nil))
        XCTAssertTrue(RecentActivityProjection.hasData(drives: [drive("a", end: 50)], charges: [], analytics: nil))
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.empty, hasData: false), .empty)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.empty, hasData: true), .empty)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.failed("e"), hasData: false), .error("e"))
        XCTAssertEqual(RecentActivityProjection.resolvePhase(.failed("e"), hasData: true), .content)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(RecentActivitySurface.slug, "RecentActivity")
        XCTAssertEqual(RecentActivity.surfaceSlug, "RecentActivity")
    }
}
