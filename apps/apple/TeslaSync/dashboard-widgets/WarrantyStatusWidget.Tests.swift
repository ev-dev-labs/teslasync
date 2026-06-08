//
//  WarrantyStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0113 · WarrantyStatusWidget (Apple)
//
//  Unit coverage for the WarrantyStatusWidget surface:
//    • Adapter (envelope → projection) — `WarrantyProjectionBuilder` parity with the
//      web WarrantyStatusWidget.tsx data pipeline (narrowing, daysUntil, variant,
//      distance, number, date, the metric bars, the coverage detail entries).
//    • State holder — `WarrantyModel` phase resolution across loading / empty /
//      error / content, plus the P1/S11 `view.opened` telemetry + source wiring.
//    • Registry — canonical `warranty-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryWarrantySource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: envelope → projection (parity with the web data pipeline)

final class WarrantyAdapterTests: XCTestCase {
    private let format = WarrantyFormatting(
        distanceUnit: "mi",
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )

    /// Fixed reference "now" so day-count assertions are deterministic.
    private let now = ISO8601DateFormatter().date(from: "2024-01-01T00:00:00Z")!

    func testAsStringNarrowing() {
        XCTAssertNil(WarrantyProjectionBuilder.asString(nil))
        XCTAssertNil(WarrantyProjectionBuilder.asString(.null))
        XCTAssertNil(WarrantyProjectionBuilder.asString(.string("")))
        XCTAssertNil(WarrantyProjectionBuilder.asString(.bool(true)))
        XCTAssertEqual(WarrantyProjectionBuilder.asString(.string("2026-01-01")), "2026-01-01")
        XCTAssertEqual(WarrantyProjectionBuilder.asString(.number(15)), "15")
    }

    func testAsNumberNarrowing() {
        XCTAssertNil(WarrantyProjectionBuilder.asNumber(.null))
        XCTAssertNil(WarrantyProjectionBuilder.asNumber(.bool(true)))
        XCTAssertNil(WarrantyProjectionBuilder.asNumber(.number(.infinity)))
        XCTAssertEqual(WarrantyProjectionBuilder.asNumber(.number(42)), 42)
        XCTAssertEqual(WarrantyProjectionBuilder.asNumber(.string("1.5")), 1.5)
        // JS `Number('') === 0`.
        XCTAssertEqual(WarrantyProjectionBuilder.asNumber(.string("")), 0)
        XCTAssertNil(WarrantyProjectionBuilder.asNumber(.string("abc")))
    }

    func testFirstStringNullishChain() {
        // JSON null falls through to the next key.
        let withNull = WarrantyDataInput([
            "warranty_expiry_date": .null,
            "expiry_date": .string("2026-01-01")
        ])
        XCTAssertEqual(
            WarrantyProjectionBuilder.firstString(
                withNull,
                ["warranty_expiry_date", "expiry_date", "basic_expiry_date"]
            ),
            "2026-01-01"
        )
        // A present-but-empty string stops the `??` chain, then narrows to nil.
        let withEmpty = WarrantyDataInput([
            "warranty_expiry_date": .string(""),
            "expiry_date": .string("2026-01-01")
        ])
        XCTAssertNil(
            WarrantyProjectionBuilder.firstString(
                withEmpty,
                ["warranty_expiry_date", "expiry_date", "basic_expiry_date"]
            )
        )
    }

    func testDaysUntilCeilAndInvalid() {
        XCTAssertEqual(WarrantyProjectionBuilder.daysUntil("2024-01-31T00:00:00Z", now: now), 30)
        XCTAssertEqual(WarrantyProjectionBuilder.daysUntil("2023-12-25T00:00:00Z", now: now), -7)
        XCTAssertNil(WarrantyProjectionBuilder.daysUntil(nil, now: now))
        XCTAssertNil(WarrantyProjectionBuilder.daysUntil("not-a-date", now: now))
    }

    func testStatusVariantThresholds() {
        XCTAssertEqual(WarrantyProjectionBuilder.statusVariant(nil), .error)
        XCTAssertEqual(WarrantyProjectionBuilder.statusVariant(0), .error)
        XCTAssertEqual(WarrantyProjectionBuilder.statusVariant(-5), .error)
        XCTAssertEqual(WarrantyProjectionBuilder.statusVariant(90), .warning)
        XCTAssertEqual(WarrantyProjectionBuilder.statusVariant(91), .success)
    }

    func testConvertDistanceFromSIPerUnit() {
        XCTAssertEqual(WarrantyProjectionBuilder.convertDistanceFromSI(1000, to: "km"), 1, accuracy: 0.0001)
        XCTAssertEqual(WarrantyProjectionBuilder.convertDistanceFromSI(1609.344, to: "mi"), 1, accuracy: 0.0001)
        XCTAssertEqual(WarrantyProjectionBuilder.convertDistanceFromSI(0.3048, to: "ft"), 1, accuracy: 0.0001)
        // Unknown unit falls back to miles (web type only emits km/mi/ft).
        XCTAssertEqual(WarrantyProjectionBuilder.convertDistanceFromSI(1609.344, to: "xx"), 1, accuracy: 0.0001)
    }

    func testDecimalStringFormatting() {
        XCTAssertEqual(WarrantyProjectionBuilder.decimalString(1234.6, fractionDigits: 0, locale: "en_US"), "1,235")
        XCTAssertEqual(WarrantyProjectionBuilder.decimalString(.nan, fractionDigits: 0, locale: "en_US"), "0")
        XCTAssertEqual(WarrantyProjectionBuilder.decimalString(50, fractionDigits: 0, locale: "en_US"), "50")
    }

    func testDateMediumAndMonthYear() {
        XCTAssertEqual(WarrantyProjectionBuilder.dateMedium("2024-04-04T10:00:00Z", format: format), "Apr 4, 2024")
        XCTAssertEqual(WarrantyProjectionBuilder.dateMedium(nil, format: format), "—")
        XCTAssertEqual(WarrantyProjectionBuilder.dateMedium("garbage", format: format), "—")
        // Coverage month-year is tz-naive (pinned UTC) so a date-only value keeps its
        // own calendar month.
        XCTAssertEqual(WarrantyProjectionBuilder.monthYear("2025-06-01", format: format), "Jun 2025")
    }

    func testFractionEdgeCases() {
        XCTAssertEqual(WarrantyProjectionBuilder.fraction(value: 1, max: 2), 0.5, accuracy: 0.0001)
        XCTAssertEqual(WarrantyProjectionBuilder.fraction(value: 5, max: 2), 1, accuracy: 0.0001)
        XCTAssertEqual(WarrantyProjectionBuilder.fraction(value: -1, max: 2), 0, accuracy: 0.0001)
        // value / 0 (positive) saturates; otherwise empty.
        XCTAssertEqual(WarrantyProjectionBuilder.fraction(value: 3, max: 0), 1, accuracy: 0.0001)
        XCTAssertEqual(WarrantyProjectionBuilder.fraction(value: 0, max: 0), 0, accuracy: 0.0001)
    }

    func testCoverageTruthiness() {
        XCTAssertFalse(WarrantyProjectionBuilder.isTruthyCoverage(.null))
        XCTAssertFalse(WarrantyProjectionBuilder.isTruthyCoverage(.bool(false)))
        XCTAssertFalse(WarrantyProjectionBuilder.isTruthyCoverage(.string("")))
        XCTAssertTrue(WarrantyProjectionBuilder.isTruthyCoverage(.bool(true)))
        XCTAssertTrue(WarrantyProjectionBuilder.isTruthyCoverage(.string("yes")))
        // Web semantics: 0 is not loose-null/false/'' so it IS covered.
        XCTAssertTrue(WarrantyProjectionBuilder.isTruthyCoverage(.number(0)))
    }

    func testBuildEmptyWhenNoData() {
        let projection = WarrantyProjectionBuilder.build(data: nil, format: format, now: now)
        XCTAssertFalse(projection.hasData)
        XCTAssertTrue(projection.entries.isEmpty)
        XCTAssertNil(projection.timeMetric)
        XCTAssertNil(projection.mileageMetric)
    }

    func testBuildFullProjection() {
        let data = WarrantyDataInput([
            "warranty_expiry_date": .string("2027-01-01T00:00:00Z"),
            "warranty_start_date": .string("2021-01-01T00:00:00Z"),
            "mileage_limit_mi": .number(80467),
            "current_mileage_mi": .number(40233),
            "basic": .bool(true),
            "basic_expiry_date": .string("2025-06-01"),
            "body": .string("yes")
        ])
        let projection = WarrantyProjectionBuilder.build(data: data, format: format, now: now)

        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.daysRemaining, 1096)
        XCTAssertEqual(projection.headlineText, "1,096")
        XCTAssertEqual(projection.statusVariant, .success)
        XCTAssertEqual(projection.statusBadge.label.key, "widget.warranty.active")

        // Time metric: ~half the 6-year window elapsed.
        let time = try? XCTUnwrap(projection.timeMetric)
        XCTAssertEqual(time?.fraction ?? 0, 0.5, accuracy: 0.01)
        XCTAssertEqual(time?.label.key, "widget.warranty.timeRemaining")

        // Mileage metric: 40233/80467 ≈ 0.5 ⇒ success; 25 mi remaining.
        let mileage = try? XCTUnwrap(projection.mileageMetric)
        XCTAssertEqual(mileage?.variant, .success)
        XCTAssertEqual(mileage?.valueText, "25")
        if case let .symbol(symbol) = mileage?.unit {
            XCTAssertEqual(symbol, "mi")
        } else {
            XCTFail("expected symbol unit")
        }

        // Entries: expiry, days, mileage limit, current mileage, basic, body.
        XCTAssertEqual(projection.entries.count, 6)
        XCTAssertEqual(projection.entries[0].label.key, "widget.warranty.expiryDate")
        XCTAssertEqual(projection.entries[0].badge?.label.key, "widget.warranty.active")
        XCTAssertEqual(projection.entries[2].label.key, "widget.warranty.mileageLimit")
        if case let .text(value) = projection.entries[2].value {
            XCTAssertEqual(value, "50 mi")
        } else {
            XCTFail("limit text")
        }

        // Coverage "basic" has an expiry → month-year + Covered badge.
        let basic = try? XCTUnwrap(projection.entries.first { $0.id == "coverage-basic" })
        if case let .text(value) = basic?.value {
            XCTAssertEqual(value, "Jun 2025")
        } else {
            XCTFail("basic month-year")
        }
        XCTAssertEqual(basic?.badge?.label.key, "widget.warranty.covered")

        // Coverage "body" is truthy with no expiry → "Included" + Covered.
        let body = try? XCTUnwrap(projection.entries.first { $0.id == "coverage-body" })
        if case let .localized(ref) = body?.value {
            XCTAssertEqual(ref.key, "widget.warranty.included")
        } else {
            XCTFail("body included")
        }
    }

    func testExpiredAndMileageOverLimitVariants() {
        let data = WarrantyDataInput([
            "warranty_expiry_date": .string("2023-06-01T00:00:00Z"), // before `now`
            "mileage_limit_mi": .number(1000),
            "current_mileage_mi": .number(950) // ratio 0.95 > 0.9 ⇒ error
        ])
        let projection = WarrantyProjectionBuilder.build(data: data, format: format, now: now)
        XCTAssertEqual(projection.statusVariant, .error)
        XCTAssertEqual(projection.statusBadge.label.key, "widget.warranty.expired")
        XCTAssertEqual(projection.headlineText, "0") // max(daysRemaining, 0)
        XCTAssertEqual(projection.mileageMetric?.variant, .error)
    }

    func testExpiredCoverageBadge() {
        let data = WarrantyDataInput([
            "basic": .bool(true),
            "basic_expiry_date": .string("2023-01-01T00:00:00Z") // past
        ])
        let projection = WarrantyProjectionBuilder.build(data: data, format: format, now: now)
        let basic = try? XCTUnwrap(projection.entries.first { $0.id == "coverage-basic" })
        XCTAssertEqual(basic?.badge?.label.key, "widget.warranty.expired")
        XCTAssertEqual(basic?.badge?.variant, .error)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class WarrantyModelTests: XCTestCase {
    private func dataUpdate(
        status: WarrantyLoadStatus,
        connection: WarrantyConnection = .live
    ) -> WarrantyUpdate {
        WarrantyUpdate(
            status: status,
            connection: connection,
            data: WarrantyDataInput(["warranty_expiry_date": .string("2030-01-01T00:00:00Z")]),
            format: .default,
            updatedAt: Date()
        )
    }

    private func makeModel(
        _ update: WarrantyUpdate,
        telemetry: WarrantyTelemetry = OSLogWarrantyTelemetry()
    ) -> (WarrantyModel, InMemoryWarrantySource) {
        let source = InMemoryWarrantySource(initial: update)
        let model = WarrantyModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(WarrantyUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(WarrantyUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(WarrantyUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertTrue(loading.projection.hasData)

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyWarrantyTelemetry()
        let (model, source) = makeModel(WarrantyUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [WarrantyStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WarrantyUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(WarrantyUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertTrue(model.projection.hasData)
    }
}

// MARK: - Registry parity

final class WarrantyRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = WarrantyStatusWidget.registration
        XCTAssertEqual(registration.id, "warranty-status")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = WarrantyStatusWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)), DashboardWidgetSize(cols: 2, rows: 8))
    }

    func testSurfaceSlugIsStable() {
        XCTAssertEqual(WarrantyStatusWidget.surfaceSlug, "WarrantyStatusWidget")
    }
}

// MARK: - Accessibility summary content

final class WarrantyAccessibilityTests: XCTestCase {
    private let format = WarrantyFormatting(
        distanceUnit: "mi",
        localeIdentifier: "en_US",
        timeZoneIdentifier: "America/Los_Angeles"
    )
    private let now = ISO8601DateFormatter().date(from: "2024-01-01T00:00:00Z")!

    func testSummaryIncludesStatusMileageAndCoverage() {
        let data = WarrantyDataInput([
            "warranty_expiry_date": .string("2027-01-01T00:00:00Z"),
            "warranty_start_date": .string("2021-01-01T00:00:00Z"),
            "mileage_limit_mi": .number(80467),
            "current_mileage_mi": .number(40233),
            "basic": .bool(true),
            "basic_expiry_date": .string("2025-06-01")
        ])
        let projection = WarrantyProjectionBuilder.build(data: data, format: format, now: now)
        let summary = WarrantyAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Active"))
        XCTAssertTrue(summary.contains("1,096 days left"))
        XCTAssertTrue(summary.contains("Mileage Remaining: 25 mi"))
        XCTAssertTrue(summary.contains("Covered"))
    }

    func testSummaryEmpty() {
        XCTAssertEqual(WarrantyAccessibility.summary(for: .empty), "No warranty data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWarrantyTelemetry: WarrantyTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
