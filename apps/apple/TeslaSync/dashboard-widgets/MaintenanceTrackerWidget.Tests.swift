//
//  MaintenanceTrackerWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0061 · MaintenanceTrackerWidget (Apple)
//
//  Unit coverage for the MaintenanceTrackerWidget surface:
//    • Adapter (cached → projection) — `MaintenanceProjectionBuilder` parity with
//      the web MaintenanceTrackerWidget.tsx data pipeline (urgency, distance,
//      currency, date, sort, timeline mapping).
//    • State holder — `MaintenanceModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `maintenance-tracker` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryMaintenanceSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection (parity with the web data pipeline)

final class MaintenanceAdapterTests: XCTestCase {
    private let format = MaintenanceFormatting(
        distanceUnit: "mi",
        currencySymbol: "$",
        currencyPrecision: 0,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    func testUrgencyThresholds() {
        XCTAssertEqual(MaintenanceProjectionBuilder.urgency(forIntervalMonths: -1), .overdue)
        XCTAssertEqual(MaintenanceProjectionBuilder.urgency(forIntervalMonths: 0), .overdue)
        XCTAssertEqual(MaintenanceProjectionBuilder.urgency(forIntervalMonths: 3), .soon)
        XCTAssertEqual(MaintenanceProjectionBuilder.urgency(forIntervalMonths: 3.0001), .good)
        XCTAssertEqual(MaintenanceProjectionBuilder.urgency(forIntervalMonths: 24), .good)
    }

    func testConvertDistanceFromSIPerUnit() {
        XCTAssertEqual(MaintenanceProjectionBuilder.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 0.0001)
        XCTAssertEqual(MaintenanceProjectionBuilder.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 0.0001)
        XCTAssertEqual(MaintenanceProjectionBuilder.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 0.0001)
        // Unknown unit falls back to miles (web type only emits km/mi/ft).
        XCTAssertEqual(MaintenanceProjectionBuilder.convertDistanceFromSI(1609.344, to: "xx"), 1, accuracy: 0.0001)
    }

    func testDistanceTextReplicatesWebArithmetic() {
        // Web: fmtNumber(convertDistanceFromSI(km * 0.621371, 'mi'), 0) + ' mi'.
        // 40000 km → 40000*0.621371 / 1609.344 ≈ 15.44 → "15 mi".
        XCTAssertEqual(MaintenanceProjectionBuilder.distanceText(fromKm: 40000, format: format), "15 mi")
        XCTAssertEqual(MaintenanceProjectionBuilder.distanceText(fromKm: 0, format: format), "0 mi")
    }

    func testDecimalAndCurrencyFormatting() {
        XCTAssertEqual(MaintenanceProjectionBuilder.decimalString(1234.6, fractionDigits: 0, locale: "en_US"), "1,235")
        XCTAssertEqual(MaintenanceProjectionBuilder.decimalString(.nan, fractionDigits: 0, locale: "en_US"), "0")
        XCTAssertEqual(MaintenanceProjectionBuilder.currencyText(80, format: format), "$80")
    }

    func testDateTextMediumAndInvalid() {
        XCTAssertEqual(MaintenanceProjectionBuilder.dateText("2024-04-04T10:00:00Z", format: format), "Apr 4, 2024")
        XCTAssertEqual(MaintenanceProjectionBuilder.dateText(nil, format: format), "—")
        XCTAssertEqual(MaintenanceProjectionBuilder.dateText("not-a-date", format: format), "—")
        XCTAssertNotNil(MaintenanceProjectionBuilder.parseDate("2024-04-04"))
    }

    func testNextServicePicksSoonestWithCostGuard() {
        let items = [
            MaintenanceItemInput(
                id: "brake",
                name: "Brake Fluid",
                intervalKm: 40000,
                intervalMonths: 24,
                estimatedCostUsd: 0
            ),
            MaintenanceItemInput(
                id: "tires",
                name: "Tire Rotation",
                intervalKm: 10000,
                intervalMonths: 2,
                estimatedCostUsd: 80
            )
        ]
        let next = MaintenanceProjectionBuilder.nextService(from: items, format: format)
        XCTAssertEqual(next?.name, "Tire Rotation")
        XCTAssertEqual(next?.urgency, .soon)
        XCTAssertEqual(next?.monthsText, "2")
        XCTAssertEqual(next?.costText, "$80")

        // Zero / non-positive cost is suppressed (web `> 0` guard).
        let zeroCost = MaintenanceProjectionBuilder.nextService(
            from: [MaintenanceItemInput(id: "brake", name: "Brake Fluid", intervalMonths: 24, estimatedCostUsd: 0)],
            format: format
        )
        XCTAssertNil(zeroCost?.costText)
    }

    func testNextServiceNilNameFallsBackToDash() {
        let next = MaintenanceProjectionBuilder.nextService(
            from: [MaintenanceItemInput(id: "x1", name: nil, intervalMonths: 1)],
            format: format
        )
        XCTAssertEqual(next?.name, "—")
    }

    func testRecentTimelineSortsDescTopThreeAndLooksUpName() {
        let items = [
            MaintenanceItemInput(id: "tires", name: "Tire Rotation"),
            MaintenanceItemInput(id: "cabin", name: "Cabin Air Filter")
        ]
        let records = [
            ServiceRecordInput(itemId: "cabin", date: "2024-01-15T10:00:00Z", odometerKm: 18000, notes: ""),
            ServiceRecordInput(
                itemId: "tires",
                date: "2024-04-04T10:00:00Z",
                odometerKm: 22000,
                notes: "Rotated + balanced"
            ),
            ServiceRecordInput(itemId: "tires", date: "2023-09-01T10:00:00Z", odometerKm: 12000, notes: "Old"),
            ServiceRecordInput(itemId: "tires", date: "2022-01-01T10:00:00Z", odometerKm: 5000, notes: "Oldest")
        ]
        let timeline = MaintenanceProjectionBuilder.recentTimeline(maintenance: items, records: records, format: format)
        XCTAssertEqual(timeline.count, 3)
        XCTAssertEqual(timeline.first?.title, "Tire Rotation")
        XCTAssertEqual(timeline.first?.time, "Apr 4, 2024")
        // Odometer 22000 km → "8 mi", notes present → middot-joined subtitle.
        XCTAssertEqual(timeline.first?.subtitle, "8 mi · Rotated + balanced")
        // timeline[1] is the cabin record (18000 km, empty notes) → distance-only.
        XCTAssertEqual(timeline[1].title, "Cabin Air Filter")
        XCTAssertEqual(timeline[1].subtitle, "7 mi")
    }

    func testTimelineUnknownItemIdFallsBackToItemId() {
        let timeline = MaintenanceProjectionBuilder.recentTimeline(
            maintenance: [],
            records: [ServiceRecordInput(itemId: "ghost", date: "2024-04-04T10:00:00Z", odometerKm: 0, notes: nil)],
            format: format
        )
        XCTAssertEqual(timeline.first?.title, "ghost")
    }

    func testBuildHasDataFlag() {
        XCTAssertFalse(MaintenanceProjectionBuilder.build(maintenance: [], records: [], format: format).hasData)
        let withItems = MaintenanceProjectionBuilder.build(
            maintenance: [MaintenanceItemInput(id: "tires", name: "Tire Rotation", intervalMonths: 2)],
            records: [],
            format: format
        )
        XCTAssertTrue(withItems.hasData)
        XCTAssertNotNil(withItems.next)
        XCTAssertFalse(withItems.hasRecords)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class MaintenanceModelTests: XCTestCase {
    private func dataUpdate(
        status: MaintenanceLoadStatus,
        connection: MaintenanceConnection = .live
    ) -> MaintenanceUpdate {
        MaintenanceUpdate(
            status: status,
            connection: connection,
            maintenance: [MaintenanceItemInput(id: "tires", name: "Tire Rotation", intervalMonths: 2)],
            records: [],
            format: .default,
            updatedAt: Date()
        )
    }

    private func makeModel(
        _ update: MaintenanceUpdate,
        telemetry: MaintenanceTelemetry = OSLogMaintenanceTelemetry()
    ) -> (MaintenanceModel, InMemoryMaintenanceSource) {
        let source = InMemoryMaintenanceSource(initial: update)
        let model = MaintenanceModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(MaintenanceUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(MaintenanceUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MaintenanceUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertNotNil(loading.projection.next)

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMaintenanceTelemetry()
        let (model, source) = makeModel(MaintenanceUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MaintenanceTrackerWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MaintenanceUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(MaintenanceUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.next?.name, "Tire Rotation")
    }
}

// MARK: - Registry parity

final class MaintenanceRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MaintenanceTrackerWidget.registration
        XCTAssertEqual(registration.id, "maintenance-tracker")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MaintenanceTrackerWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
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

// MARK: - Accessibility summary content

final class MaintenanceAccessibilityTests: XCTestCase {
    private let format = MaintenanceFormatting(
        distanceUnit: "mi",
        currencySymbol: "$",
        currencyPrecision: 0,
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    func testSummaryIncludesNextServiceUrgencyAndRecordCount() {
        let projection = MaintenanceProjectionBuilder.build(
            maintenance: [MaintenanceItemInput(
                id: "tires",
                name: "Tire Rotation",
                intervalKm: 10000,
                intervalMonths: 2,
                estimatedCostUsd: 80
            )],
            records: [ServiceRecordInput(
                itemId: "tires",
                date: "2024-04-04T10:00:00Z",
                odometerKm: 22000,
                notes: "Done"
            )],
            format: format
        )
        let summary = MaintenanceAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Next Service"))
        XCTAssertTrue(summary.contains("Tire Rotation"))
        XCTAssertTrue(summary.contains("Soon"))
        XCTAssertTrue(summary.contains("Every 2 mo"))
        XCTAssertTrue(summary.contains("1 recent service records"))
    }

    func testSummaryEmptyAndNoRecords() {
        XCTAssertEqual(
            MaintenanceAccessibility.summary(for: .empty),
            "No maintenance data"
        )
        let itemsOnly = MaintenanceProjectionBuilder.build(
            maintenance: [MaintenanceItemInput(id: "tires", name: "Tire Rotation", intervalMonths: 2)],
            records: [],
            format: format
        )
        XCTAssertTrue(MaintenanceAccessibility.summary(for: itemsOnly).contains("No service records yet"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMaintenanceTelemetry: MaintenanceTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
