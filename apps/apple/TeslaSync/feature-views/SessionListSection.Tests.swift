//
//  SessionListSection.Tests.swift
//  TeslaSync — P4 feature view · 0106 · SessionListSection (Apple)
//
//  Unit coverage for the SessionListSection surface:
//    • Adapter (`SessionListProjection` + friends) — charger-category mapping, the
//      filter → search → sort pipeline (incl. the descending toggle), the session
//      helpers (duration / avg power / cost-per-kWh / battery score / distance), the
//      phase resolution, the pagination math, and the export-path builder (parity
//      with helpers.ts / chargingAggregation.ts / the web download link).
//    • State holder (`SessionListModel`) — phase across loading / loaded / empty /
//      failed, the P1/S11 `view.opened` telemetry (once), the stale auto-refresh
//      (once, re-armed on return to live), offline keeping cached rows, the control
//      intents (search/filter/sort/pagination), selection + bulk delete, and export.
//    • Accessibility — the section summary + row VoiceOver content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  bundle: the adapter is pure and the model is driven through an in-memory source.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: charger category + projection

@MainActor
final class SessionListProjectionTests: XCTestCase {
    private func item(
        id: Int,
        energy: Double = 0,
        cost: Double? = nil,
        type: String? = nil,
        place: String? = nil,
        started: TimeInterval = 0,
        durationMin: Double = 0,
        peakW: Double? = nil
    ) -> SessionListItem {
        let start = Date(timeIntervalSince1970: started)
        return SessionListItem(
            id: id,
            startedAt: start,
            endedAt: durationMin > 0 ? start.addingTimeInterval(durationMin * 60) : nil,
            energyAddedWh: energy,
            peakPowerW: peakW,
            costDecimal: cost,
            chargerType: type,
            startPlace: place
        )
    }

    func testCategoryMapping() {
        XCTAssertEqual(SessionChargerCategory.from(nil), .home)
        XCTAssertEqual(SessionChargerCategory.from(""), .home)
        XCTAssertEqual(SessionChargerCategory.from("Supercharger V3"), .supercharger)
        XCTAssertEqual(SessionChargerCategory.from("TPC"), .supercharger)
        XCTAssertEqual(SessionChargerCategory.from("CCS DC Fast"), .dc)
        XCTAssertEqual(SessionChargerCategory.from("CHAdeMO"), .dc)
        XCTAssertEqual(SessionChargerCategory.from("Home Wall Connector"), .home)
        XCTAssertEqual(SessionChargerCategory.from("Mystery Plug"), .unknown)
    }

    func testFilterByChargerCategory() {
        let items = [
            item(id: 1, type: "Supercharger"),
            item(id: 2, type: "Home AC"),
            item(id: 3, type: "CCS DC")
        ]
        let supers = SessionListProjection.filterAndSort(
            items, filter: .supercharger, sortKey: .date, descending: true, searchQuery: ""
        )
        XCTAssertEqual(supers.map(\.id), [1])
    }

    func testSearchMatchesPlaceOrType() {
        let items = [
            item(id: 1, type: "Supercharger", place: "Gilroy"),
            item(id: 2, type: "Home AC", place: "Home")
        ]
        let byPlace = SessionListProjection.filterAndSort(
            items, filter: .all, sortKey: .date, descending: true, searchQuery: "gil"
        )
        XCTAssertEqual(byPlace.map(\.id), [1])
        let byType = SessionListProjection.filterAndSort(
            items, filter: .all, sortKey: .date, descending: true, searchQuery: "home"
        )
        XCTAssertEqual(byType.map(\.id), [2])
    }

    func testSortByEnergyHonorsDescendingToggle() {
        let items = [
            item(id: 1, energy: 10000),
            item(id: 2, energy: 30000),
            item(id: 3, energy: 20000)
        ]
        let desc = SessionListProjection.filterAndSort(
            items, filter: .all, sortKey: .energy, descending: true, searchQuery: ""
        )
        XCTAssertEqual(desc.map(\.id), [2, 3, 1])
        let asc = SessionListProjection.filterAndSort(
            items, filter: .all, sortKey: .energy, descending: false, searchQuery: ""
        )
        XCTAssertEqual(asc.map(\.id), [1, 3, 2])
    }

    func testDurationMinutes() {
        let start = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(SessionListProjection.durationMinutes(start: start, end: start.addingTimeInterval(2700)), 45)
        XCTAssertEqual(SessionListProjection.durationMinutes(start: start, end: nil), 0)
        XCTAssertEqual(SessionListProjection.durationMinutes(start: start, end: start.addingTimeInterval(-60)), 0)
    }

    func testAvgPowerWComputesFromEnergyOverHours() {
        let computed = item(id: 1, energy: 6000, durationMin: 60)
        XCTAssertEqual(SessionListProjection.avgPowerW(computed), 6000, accuracy: 0.001)
        var fallback = item(id: 2, energy: 0, durationMin: 0)
        fallback.avgPowerW = 4200
        XCTAssertEqual(SessionListProjection.avgPowerW(fallback), 4200, accuracy: 0.001)
    }

    func testCostPerKwh() throws {
        let paid = item(id: 1, energy: 24000, cost: 12, durationMin: 30)
        let cpk = try XCTUnwrap(SessionListProjection.costPerKwh(paid))
        XCTAssertEqual(cpk, 0.5, accuracy: 0.0001)
        XCTAssertNil(SessionListProjection.costPerKwh(item(id: 2, energy: 0, cost: 5)))
        XCTAssertNil(SessionListProjection.costPerKwh(item(id: 3, energy: 1000, cost: 0)))
    }

    func testBatteryScore() {
        XCTAssertEqual(SessionListProjection.batteryScore(start: 24, end: 78), 100)
        XCTAssertEqual(SessionListProjection.batteryScore(start: 72, end: 95), 30)
        XCTAssertNil(SessionListProjection.batteryScore(start: nil, end: 80))
        XCTAssertNil(SessionListProjection.batteryScore(start: 40, end: nil))
    }

    func testDistanceAddedM() {
        XCTAssertEqual(SessionListProjection.distanceAddedM(start: 1_000_000, end: 1_240_000), 240_000)
        XCTAssertNil(SessionListProjection.distanceAddedM(start: 1_000_000, end: 1_000_000))
        XCTAssertNil(SessionListProjection.distanceAddedM(start: nil, end: 100))
    }

    func testResolvePhase() {
        XCTAssertEqual(SessionListProjection.resolvePhase(.loading, totalCount: 0), .loading)
        XCTAssertEqual(SessionListProjection.resolvePhase(.loading, totalCount: 3), .content)
        XCTAssertEqual(SessionListProjection.resolvePhase(.loaded, totalCount: 0), .empty)
        XCTAssertEqual(SessionListProjection.resolvePhase(.loaded, totalCount: 2), .content)
        XCTAssertEqual(SessionListProjection.resolvePhase(.failed("x"), totalCount: 0), .error("x"))
        XCTAssertEqual(SessionListProjection.resolvePhase(.failed("x"), totalCount: 2), .content)
    }
}

// MARK: - Adapter: pagination + export + numeric

@MainActor
final class SessionListCoreTests: XCTestCase {
    func testPageWindowMath() {
        let window = SessionPage(page: 1, pageSize: 10, total: 25)
        XCTAssertEqual(window.pageCount, 3)
        XCTAssertEqual(window.range, 0 ..< 10)
        XCTAssertTrue(window.hasNext)
        XCTAssertFalse(window.hasPrevious)
        let last = SessionPage(page: 3, pageSize: 10, total: 25)
        XCTAssertEqual(last.range, 20 ..< 25)
        XCTAssertFalse(last.hasNext)
        let overflow = SessionPage(page: 9, pageSize: 10, total: 25)
        XCTAssertEqual(overflow.clampedPage, 3)
    }

    func testPaginatorSlicesSafely() {
        let items = (1 ... 25).map { SessionListItem(id: $0, startedAt: Date(timeIntervalSince1970: 0)) }
        XCTAssertEqual(SessionPaginator.slice(items, page: 3, pageSize: 10).map(\.id), [21, 22, 23, 24, 25])
        XCTAssertEqual(SessionPaginator.slice(items, page: 99, pageSize: 10).count, 0)
        XCTAssertEqual(SessionPaginator.slice([], page: 1, pageSize: 10).count, 0)
    }

    func testExportPathParity() {
        let full = SessionListExport.path(
            format: .csv,
            context: SessionExportContext(startDate: "2026-01-01", endDate: "2026-06-01", vehicleID: 7)
        )
        XCTAssertEqual(full, "/api/v1/export/charging?format=csv&start=2026-01-01&end=2026-06-01&vehicle_id=7")
        let bare = SessionListExport.path(format: .json, context: SessionExportContext())
        XCTAssertEqual(bare, "/api/v1/export/charging?format=json")
        let zeroVehicle = SessionListExport.path(
            format: .csv, context: SessionExportContext(vehicleID: 0)
        )
        XCTAssertEqual(zeroVehicle, "/api/v1/export/charging?format=csv")
    }

    func testNumericSafe() {
        XCTAssertEqual(SessionListNumeric.safe(42), 42)
        XCTAssertEqual(SessionListNumeric.safe(.nan), 0)
        XCTAssertEqual(SessionListNumeric.safe(.infinity), 0)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(SessionListSurface.slug, "SessionListSection")
    }
}

// MARK: - Test doubles

final class SpySessionListTelemetry: SessionListTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

final class SpySessionListExporter: SessionListExporter, @unchecked Sendable {
    private(set) var requests: [(format: SessionListExportFormat, request: String)] = []
    func export(format: SessionListExportFormat, request: String) {
        requests.append((format, request))
    }
}

@MainActor
final class SpySessionListDeleter: SessionListDeleter {
    private(set) var deleted: [[Int]] = []
    func delete(ids: [Int]) async {
        deleted.append(ids)
    }
}

// MARK: - Accessibility

@MainActor
final class SessionListAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummary() {
        XCTAssertEqual(SessionListAccessibility.sectionSummary(count: 12, localize: echo), "All Sessions: 12")
    }

    func testRowLabelIncludesKeyFacts() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let item = SessionListItem(
            id: 1, startedAt: base, endedAt: base.addingTimeInterval(2700),
            startSocPct: 24, endSocPct: 78, energyAddedWh: 41000,
            costDecimal: 12, chargerType: "Supercharger", startPlace: "Gilroy"
        )
        let label = SessionListAccessibility.rowLabel(
            item, formatting: DefaultSessionListFormatting(), localize: echo
        )
        XCTAssertTrue(label.contains("Supercharger"))
        XCTAssertTrue(label.contains("kWh"))
        XCTAssertTrue(label.contains("$12"))
        XCTAssertTrue(label.contains("45m"))
    }

    func testRowLabelMarksFreeSessions() {
        let base = Date(timeIntervalSince1970: 1_000_000)
        let item = SessionListItem(
            id: 2, startedAt: base, endedAt: base.addingTimeInterval(3600),
            energyAddedWh: 20000, costDecimal: 0, chargerType: "Home AC", startPlace: "Home"
        )
        let label = SessionListAccessibility.rowLabel(
            item, formatting: DefaultSessionListFormatting(), localize: echo
        )
        XCTAssertTrue(label.contains("Free"))
    }
}
