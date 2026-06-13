//
//  RecentActivity.Vehicles.Tests.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  Adapter coverage for the vehicles "Recent Activity" surface: the pure formatting + projection
//  (`VehicleRecentActivityFormat` / `VehicleRecentActivityProjection`) measured against the web
//  golden vectors — distance / energy / duration / SoC formatting, the relative + absolute timestamp
//  bodies, the drive / charge row shaping (value + suffix, the slice(0, 5) cap, the SoC guard), and
//  the load-status → phase matrix. The state-holder + accessibility coverage lives in
//  RecentActivity.Vehicles.ModelTests.swift. These run in the TeslaSync(/-macOS) XCTest targets.
//

import XCTest
@testable import TeslaSync

// MARK: - Formatting (web fmtInt / AnimatedNumber / convert*FromSI / TimeStamp)

final class VehicleRecentActivityFormatTests: XCTestCase {
    private let enUS = Locale(identifier: "en-US")
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testNumberRoundsHalfUpAndGuardsNonFinite() {
        XCTAssertEqual(VehicleRecentActivityFormat.number(10.04, decimals: 1, locale: enUS), "10.0")
        XCTAssertEqual(VehicleRecentActivityFormat.number(31.35, decimals: 1, locale: enUS), "31.4")
        XCTAssertEqual(VehicleRecentActivityFormat.number(.nan, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(VehicleRecentActivityFormat.int(1234, locale: enUS), "1,234")
    }

    func testDistanceFromSIMatchesWebConverters() {
        XCTAssertEqual(VehicleRecentActivityFormat.distanceFromSI(16093.44, divisor: 1609.344), 10.0, accuracy: 1e-9)
        XCTAssertEqual(VehicleRecentActivityFormat.distanceFromSI(1000, divisor: 1000), 1.0, accuracy: 1e-9)
        XCTAssertEqual(VehicleRecentActivityFormat.distanceFromSI(500, divisor: 0), 500, accuracy: 1e-9)
    }

    func testEnergyKwhFromWh() {
        XCTAssertEqual(VehicleRecentActivityFormat.energyKwhFromWh(31400), 31.4, accuracy: 1e-9)
        XCTAssertEqual(VehicleRecentActivityFormat.energyKwhFromWh(.infinity), 0, accuracy: 1e-9)
    }

    func testDurationBody() {
        XCTAssertEqual(VehicleRecentActivityFormat.duration(seconds: 5400, locale: enUS), "1h 30m")
        XCTAssertEqual(VehicleRecentActivityFormat.duration(seconds: 720, locale: enUS), "0h 12m")
        XCTAssertEqual(VehicleRecentActivityFormat.duration(seconds: 2640, locale: enUS), "0h 44m")
        XCTAssertEqual(VehicleRecentActivityFormat.duration(seconds: .nan, locale: enUS), "0h 0m")
    }

    func testSocRange() {
        XCTAssertEqual(VehicleRecentActivityFormat.socRange(start: 80, end: 60), "80% → 60%")
        XCTAssertEqual(VehicleRecentActivityFormat.socRange(start: nil, end: 84), "?% → 84%")
    }

    func testRelativeTimeBuckets() {
        let now = Date(timeIntervalSince1970: 1_733_580_000)
        func ago(_ seconds: Double) -> String {
            VehicleRecentActivityFormat.relative(
                from: now.addingTimeInterval(-seconds), relativeTo: now, locale: enUS, localize: echo
            )
        }
        XCTAssertEqual(ago(30), "Just now")
        XCTAssertEqual(ago(300), "5m ago")
        XCTAssertEqual(ago(3 * 3600), "3h ago")
        XCTAssertEqual(ago(3 * 86400), "3d ago")
        XCTAssertFalse(ago(30 * 86400).hasSuffix("ago"), "beyond a week falls back to the absolute date")
    }
}

// MARK: - Projection (drive / charge rows + phase)

final class VehicleRecentActivityProjectionTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_733_580_000)
    private let echo: (String, String) -> String = { _, fallback in fallback }

    private func imperial(_ style: VehicleRecentActivityTimeStyle = .relative) -> VehicleRecentActivityUnits {
        VehicleRecentActivityUnits(
            distanceUnit: "mi", distanceDivisor: 1609.344, timeStyle: style, localeIdentifier: "en-US"
        )
    }

    private func drive(_ id: String, soc: (Int?, Int?), minutesAgo: Double) -> VehicleRecentActivityDrive {
        VehicleRecentActivityDrive(
            id: id, distanceM: 16093.44, durationS: 5400, startSocPct: soc.0, endSocPct: soc.1,
            startedAt: now.addingTimeInterval(-minutesAgo * 60)
        )
    }

    private func charge(_ id: String, end: Int?) -> VehicleRecentActivityCharge {
        VehicleRecentActivityCharge(
            id: id, energyAddedWh: 31400, durationS: 2640, startSocPct: 44, endSocPct: end,
            startedAt: now.addingTimeInterval(-3600)
        )
    }

    func testDriveRowShape() throws {
        let rows = VehicleRecentActivityProjection.driveRows(
            drives: [drive("d1", soc: (80, 60), minutesAgo: 10)], units: imperial(), now: now, localize: echo
        )
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row.id, "drive-d1")
        XCTAssertEqual(row.kind, .drive)
        XCTAssertEqual(row.value, "10.0 mi")
        XCTAssertEqual(row.durationText, "1h 30m")
        XCTAssertEqual(row.socRange, "80% → 60%")
        XCTAssertEqual(row.timeText, "10m ago")
        XCTAssertEqual(row.routeID, "d1")
    }

    func testDriveRowOmitsSocWhenEitherSideMissing() {
        let rows = VehicleRecentActivityProjection.driveRows(
            drives: [drive("d1", soc: (80, nil), minutesAgo: 10)], units: imperial(), now: now, localize: echo
        )
        XCTAssertNil(rows.first?.socRange)
    }

    func testChargeRowShape() throws {
        let rows = VehicleRecentActivityProjection.chargeRows(
            charges: [charge("c1", end: 80)], units: imperial(), now: now, localize: echo
        )
        let row = try XCTUnwrap(rows.first)
        XCTAssertEqual(row.id, "charge-c1")
        XCTAssertEqual(row.kind, .charge)
        XCTAssertEqual(row.value, "31.4 kWh")
        XCTAssertEqual(row.durationText, "0h 44m")
        XCTAssertEqual(row.socRange, "44% → 80%")
    }

    func testChargeRowOmitsSocWhenEndMissing() {
        let rows = VehicleRecentActivityProjection.chargeRows(
            charges: [charge("c1", end: nil)], units: imperial(), now: now, localize: echo
        )
        XCTAssertNil(rows.first?.socRange)
    }

    func testRowLimitCapsAtFiveInSourceOrder() {
        let drives = (0 ..< 9).map { drive("d\($0)", soc: (80, 60), minutesAgo: Double($0 + 1)) }
        let rows = VehicleRecentActivityProjection.driveRows(
            drives: drives,
            units: imperial(),
            now: now,
            localize: echo
        )
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(rows.first?.routeID, "d0")
        XCTAssertEqual(rows.last?.routeID, "d4")
    }

    func testAbsoluteTimeStyleSwapsPrimaryAndAlternate() {
        let relativeRow = VehicleRecentActivityProjection.driveRows(
            drives: [drive("d1", soc: (80, 60), minutesAgo: 10)], units: imperial(.relative), now: now, localize: echo
        ).first
        let absoluteRow = VehicleRecentActivityProjection.driveRows(
            drives: [drive("d1", soc: (80, 60), minutesAgo: 10)], units: imperial(.absolute), now: now, localize: echo
        ).first
        XCTAssertEqual(relativeRow?.timeText, "10m ago")
        XCTAssertEqual(absoluteRow?.alternateTimeText, "10m ago")
        XCTAssertNotEqual(absoluteRow?.timeText, "10m ago")
        XCTAssertFalse(absoluteRow?.timeText.isEmpty ?? true)
    }

    func testHasDataAndPhaseMatrix() {
        XCTAssertFalse(VehicleRecentActivityProjection.hasData(drives: [], charges: []))
        XCTAssertTrue(VehicleRecentActivityProjection.hasData(
            drives: [drive("d1", soc: (1, 2), minutesAgo: 1)],
            charges: []
        ))
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.loading, hasData: false), .loading)
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.loading, hasData: true), .content)
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.loaded, hasData: false), .empty)
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.loaded, hasData: true), .content)
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.empty, hasData: true), .empty)
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(VehicleRecentActivityProjection.resolvePhase(.failed("x"), hasData: true), .content)
    }
}
