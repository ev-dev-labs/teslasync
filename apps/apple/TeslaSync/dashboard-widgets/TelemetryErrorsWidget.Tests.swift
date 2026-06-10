//
//  TelemetryErrorsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0100 · TelemetryErrorsWidget (Apple)
//
//  Unit coverage for the TelemetryErrorsWidget surface:
//    • Adapter (cached → projection) — `TelemetryErrorsWidgetProjection` parity with
//      the web `aggregated` useMemo + active-VIN / hasData / isRecent
//      derivations, plus the fmtInt / formatRelative / ISO-8601 formatters.
//    • State holder — `TelemetryErrorsWidgetModel` phase resolution across loading /
//      empty / error / content, freshness + projection tracking, plus the
//      P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `telemetry-errors` metadata + size clamping.
//    • Accessibility — the VoiceOver summary + row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `TelemetryErrorsWidgetInMemoryTelemetryErrorsSource`.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: cached payload → projection (parity with the web useMemo)

@MainActor final class TelemetryErrorsWidgetProjectionTests: XCTestCase {
    func testActiveVINCountCountsOnlyActive() {
        let vins = [
            TelemetryErrorVIN(id: 1, vin: "a", active: true),
            TelemetryErrorVIN(id: 2, vin: "b", active: false),
            TelemetryErrorVIN(id: 3, vin: "c", active: true)
        ]
        XCTAssertEqual(TelemetryErrorsWidgetProjection.activeVINCount(vins), 2)
    }

    func testHasDataReflectsEitherList() {
        XCTAssertFalse(TelemetryErrorsWidgetProjection.hasData(vins: [], errors: []))
        XCTAssertTrue(TelemetryErrorsWidgetProjection.hasData(
            vins: [TelemetryErrorVIN(id: 1, vin: "a", active: false)],
            errors: []
        ))
        XCTAssertTrue(TelemetryErrorsWidgetProjection.hasData(vins: [], errors: [TelemetryErrorEntry(id: 1, vin: "a")]))
    }

    func testAggregateEmptyYieldsNoRows() {
        XCTAssertTrue(TelemetryErrorsWidgetProjection.aggregate([], unknownLabel: "Unknown").isEmpty)
    }

    func testAggregateGroupsByVINAndCodeAndSumsCount() {
        let errors = [
            TelemetryErrorEntry(id: 1, vin: "a", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 100)),
            TelemetryErrorEntry(id: 2, vin: "a", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 300)),
            TelemetryErrorEntry(id: 3, vin: "a", errorCode: "Y", reportedAt: Date(timeIntervalSince1970: 200))
        ]
        let rows = TelemetryErrorsWidgetProjection.aggregate(errors, unknownLabel: "Unknown")
        XCTAssertEqual(rows.count, 2)
        let x = rows.first { $0.errorCode == "X" }
        XCTAssertEqual(x?.count, 2)
        XCTAssertEqual(x?.lastSeen, Date(timeIntervalSince1970: 300))
    }

    func testAggregateUsesReportedAtThenFetchedAt() {
        let entry = TelemetryErrorEntry(
            id: 1,
            vin: "a",
            errorCode: "X",
            reportedAt: nil,
            fetchedAt: Date(timeIntervalSince1970: 500)
        )
        let rows = TelemetryErrorsWidgetProjection.aggregate([entry], unknownLabel: "Unknown")
        XCTAssertEqual(rows.first?.lastSeen, Date(timeIntervalSince1970: 500))
    }

    func testAggregateNilCodeUsesUnknownLabelButStableKey() {
        // Two nil-code rows for the same VIN collapse into one "Unknown" row.
        let errors = [
            TelemetryErrorEntry(id: 1, vin: "a", errorCode: nil, reportedAt: Date(timeIntervalSince1970: 100)),
            TelemetryErrorEntry(id: 2, vin: "a", errorCode: nil, reportedAt: Date(timeIntervalSince1970: 200))
        ]
        let rows = TelemetryErrorsWidgetProjection.aggregate(errors, unknownLabel: "Unknown")
        XCTAssertEqual(rows.count, 1)
        XCTAssertEqual(rows.first?.errorCode, "Unknown")
        XCTAssertEqual(rows.first?.count, 2)
    }

    func testAggregateSortsNewestFirstWithUndatedLast() {
        let errors = [
            TelemetryErrorEntry(id: 1, vin: "old", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 100)),
            TelemetryErrorEntry(id: 2, vin: "new", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 900)),
            TelemetryErrorEntry(id: 3, vin: "undated", errorCode: "X", reportedAt: nil, fetchedAt: nil)
        ]
        let rows = TelemetryErrorsWidgetProjection.aggregate(errors, unknownLabel: "Unknown")
        XCTAssertEqual(rows.map(\.vin), ["new", "old", "undated"])
    }

    func testAggregateStableOnUndatedTies() {
        // Both undated → insertion order preserved (web Map order under a stable sort).
        let errors = [
            TelemetryErrorEntry(id: 1, vin: "first", errorCode: "X"),
            TelemetryErrorEntry(id: 2, vin: "second", errorCode: "Y")
        ]
        let rows = TelemetryErrorsWidgetProjection.aggregate(errors, unknownLabel: "Unknown")
        XCTAssertEqual(rows.map(\.vin), ["first", "second"])
    }

    func testIsRecentWithinOneHour() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertTrue(TelemetryErrorsWidgetProjection.isRecent(now.addingTimeInterval(-1800), now: now))
        XCTAssertFalse(TelemetryErrorsWidgetProjection.isRecent(now.addingTimeInterval(-3601), now: now))
        XCTAssertFalse(TelemetryErrorsWidgetProjection.isRecent(nil, now: now))
    }
}

// MARK: - Status verdict

@MainActor final class TelemetryErrorsStatusTests: XCTestCase {
    func testResolveAndLabel() {
        XCTAssertEqual(TelemetryErrorsStatus.resolve(activeVINCount: 0), .healthy)
        XCTAssertEqual(TelemetryErrorsStatus.resolve(activeVINCount: 3), .errors)
        XCTAssertEqual(TelemetryErrorsStatus.errors.label, "Errors")
        XCTAssertEqual(TelemetryErrorsStatus.healthy.label, "Healthy")
    }
}

// MARK: - Formatters: fmtInt / formatRelative / ISO parse parity

@MainActor final class TelemetryErrorsWidgetFormatTests: XCTestCase {
    func testIntGrouping() {
        XCTAssertEqual(TelemetryErrorsWidgetFormat.int(18234, locale: enUS), "18,234")
        XCTAssertEqual(TelemetryErrorsWidgetFormat.int(0, locale: enUS), "0")
    }

    func testRelativeBuckets() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-300), now: now), .minutes(5))
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-3 * 3600), now: now), .hours(3))
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-2 * 86400), now: now), .days(2))
        let old = now.addingTimeInterval(-10 * 86400)
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(old, now: now), .absolute(old))
    }

    func testRelativeBoundaries() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-59), now: now), .justNow)
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-60), now: now), .minutes(1))
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-3600), now: now), .hours(1))
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relative(now.addingTimeInterval(-86400), now: now), .days(1))
    }

    func testRelativeTextResolvesBuckets() {
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relativeText(.justNow), "just now")
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relativeText(.minutes(5)), "5m ago")
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relativeText(.hours(3)), "3h ago")
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relativeText(.days(2)), "2d ago")
    }

    func testRelativeTextForNilIsEmDash() {
        XCTAssertEqual(TelemetryErrorsWidgetFormat.relativeText(for: nil), "—")
    }

    func testISOTimestampParse() {
        XCTAssertNotNil(TelemetryErrorsTimestamp.parse("2026-06-07T18:30:00Z"))
        XCTAssertNotNil(TelemetryErrorsTimestamp.parse("2026-06-07T18:30:00.250Z"))
        XCTAssertNil(TelemetryErrorsTimestamp.parse(nil))
        XCTAssertNil(TelemetryErrorsTimestamp.parse(""))
        XCTAssertNil(TelemetryErrorsTimestamp.parse("not-a-date"))
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor final class TelemetryErrorsWidgetModelTests: XCTestCase {
    private func makeModel(
        _ update: TelemetryErrorsUpdate,
        telemetry: TelemetryErrorsWidgetTelemetry = TelemetryErrorsWidgetOSLogTelemetryErrorsTelemetry()
    ) -> (TelemetryErrorsWidgetModel, TelemetryErrorsWidgetInMemoryTelemetryErrorsSource) {
        let source = TelemetryErrorsWidgetInMemoryTelemetryErrorsSource(initial: update)
        let model = TelemetryErrorsWidgetModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(TelemetryErrorsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(TelemetryErrorsUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(TelemetryErrorsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let vins = [TelemetryErrorVIN(id: 1, vin: "v", active: true)]
        let (loading, _) = makeModel(TelemetryErrorsUpdate(status: .loading, vins: vins))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(TelemetryErrorsUpdate(status: .failed("net"), vins: vins))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = TErrSpyTelemetryErrorsTelemetry()
        let (model, source) = makeModel(TelemetryErrorsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [TelemetryErrorsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(TelemetryErrorsUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testFreshnessProjectionAndStatusTrackUpdates() {
        let (model, source) = makeModel(TelemetryErrorsUpdate(status: .loading))
        model.start()
        source.push(
            TelemetryErrorsUpdate(
                status: .loaded,
                freshness: .offline,
                vins: [
                    TelemetryErrorVIN(id: 1, vin: "a", active: true),
                    TelemetryErrorVIN(id: 2, vin: "b", active: false)
                ],
                errors: [
                    TelemetryErrorEntry(id: 1, vin: "a", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 10)),
                    TelemetryErrorEntry(id: 2, vin: "a", errorCode: "X", reportedAt: Date(timeIntervalSince1970: 20))
                ],
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.activeVINCount, 1)
        XCTAssertEqual(model.status, .errors)
        XCTAssertEqual(model.aggregates.count, 1)
        XCTAssertEqual(model.aggregates.first?.count, 2)
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(TelemetryErrorsWidgetModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(TelemetryErrorsWidgetModel.isCompact(DashboardWidgetSize(cols: 2, rows: 4)))
    }
}

// MARK: - Registry parity

@MainActor final class TelemetryErrorsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = TelemetryErrorsWidget.registration
        XCTAssertEqual(registration.id, "telemetry-errors")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = TelemetryErrorsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility summary + row label content

@MainActor final class TelemetryErrorsWidgetAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatusAndCount() {
        let summary = TelemetryErrorsWidgetAccessibility.summary(activeVINCount: 3, status: .errors)
        XCTAssertTrue(summary.contains("Errors"))
        XCTAssertTrue(summary.contains("3"))
    }

    func testHealthySummaryReflectsHealthy() {
        let summary = TelemetryErrorsWidgetAccessibility.summary(activeVINCount: 0, status: .healthy)
        XCTAssertTrue(summary.contains("Healthy"))
    }

    func testRowLabelIncludesVINCodeCountAndRecent() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        let aggregate = TelemetryErrorAggregate(
            vin: "5YJ3E1EA7KF000001",
            errorCode: "VEHICLE_OFFLINE",
            count: 4,
            lastSeen: now.addingTimeInterval(-120)
        )
        let label = TelemetryErrorsWidgetAccessibility.rowLabel(for: aggregate, isRecent: true, now: now)
        XCTAssertTrue(label.contains("5YJ3E1EA7KF000001"))
        XCTAssertTrue(label.contains("VEHICLE_OFFLINE"))
        XCTAssertTrue(label.contains("4"))
        XCTAssertTrue(label.contains("recent"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class TErrSpyTelemetryErrorsTelemetry: TelemetryErrorsWidgetTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
