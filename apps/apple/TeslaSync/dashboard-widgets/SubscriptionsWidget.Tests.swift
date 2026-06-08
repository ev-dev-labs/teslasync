//
//  SubscriptionsWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0097 · SubscriptionsWidget (Apple)
//
//  Unit coverage for the SubscriptionsWidget surface:
//    • Adapter (cached → projection) — `SubscriptionsProjectionBuilder` parity
//      with the web SubscriptionsWidget.tsx data pipeline (asString, daysUntil,
//      date formatting, known-type extraction, the array fallback + dedup,
//      active rules, next-expiry derivation).
//    • State holder — `SubscriptionsModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Registry — canonical `subscriptions` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemorySubscriptionsSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private enum SubscriptionsFixture {
    /// A fixed reference instant (2026-06-01T00:00:00Z) so expiry-derived values
    /// are deterministic.
    static let now: Date = {
        var comps = DateComponents()
        comps.year = 2026
        comps.month = 6
        comps.day = 1
        comps.timeZone = TimeZone(identifier: "UTC")
        return Calendar(identifier: .gregorian).date(from: comps) ?? Date(timeIntervalSince1970: 0)
    }()

    /// Date rendering in UTC so assertions match the raw ISO calendar day.
    static let format = SubscriptionsFormatting(localeIdentifier: "en_US", timeZoneIdentifier: "UTC")

    /// Identity localizer — returns the English fallback (web catalog default).
    static let localize: SubscriptionsLocalize = { _, fallback in fallback }
}

// MARK: - Adapter: cached envelope → projection (parity with the web pipeline)

final class SubscriptionsAdapterTests: XCTestCase {
    private let now = SubscriptionsFixture.now
    private let format = SubscriptionsFixture.format
    private let localize = SubscriptionsFixture.localize

    func testAsStringCoercion() {
        XCTAssertEqual(SubscriptionsValue.string("Owned").asString, "Owned")
        XCTAssertNil(SubscriptionsValue.string("").asString)
        XCTAssertEqual(SubscriptionsValue.number(12).asString, "12")
        XCTAssertEqual(SubscriptionsValue.number(12.5).asString, "12.5")
        XCTAssertNil(SubscriptionsValue.bool(true).asString)
        XCTAssertNil(SubscriptionsValue.null.asString)
    }

    func testDaysUntilCeilingAndInvalid() {
        XCTAssertEqual(SubscriptionsProjectionBuilder.daysUntil("2026-06-11T00:00:00Z", now: now), 10)
        XCTAssertEqual(SubscriptionsProjectionBuilder.daysUntil("2026-06-01T12:00:00Z", now: now), 1)
        XCTAssertEqual(SubscriptionsProjectionBuilder.daysUntil("2026-05-22T00:00:00Z", now: now), -10)
        XCTAssertNil(SubscriptionsProjectionBuilder.daysUntil(nil, now: now))
        XCTAssertNil(SubscriptionsProjectionBuilder.daysUntil("not-a-date", now: now))
    }

    func testDateTextMediumAndInvalid() {
        XCTAssertEqual(SubscriptionsProjectionBuilder.dateText("2026-09-15T00:00:00Z", format: format), "Sep 15, 2026")
        XCTAssertEqual(SubscriptionsProjectionBuilder.dateText(nil, format: format), "—")
        XCTAssertEqual(SubscriptionsProjectionBuilder.dateText("nope", format: format), "—")
    }

    func testKnownTypesExtractedAndAbsentSkipped() {
        let data: [String: SubscriptionsValue] = [
            "premium_connectivity": .bool(true),
            "premium_connectivity_expiry_date": .string("2026-07-01T00:00:00Z"),
            "premium_connectivity_renewal": .string("Auto-renew"),
            "full_self_driving": .bool(true),
            "enhanced_autopilot": .bool(false),
            "data_sharing": .string("")
        ]
        let parsed = SubscriptionsProjectionBuilder.parseSubscriptions(data, now: now, localize: localize)
        XCTAssertEqual(parsed.map(\.name), ["Premium Connectivity", "Full Self-Driving"])
        XCTAssertEqual(parsed[0].active, true)
        XCTAssertEqual(parsed[0].daysLeft, 30)
        XCTAssertEqual(parsed[0].renewalType, "Auto-renew")
        XCTAssertEqual(parsed[1].expiryDate, nil)
        XCTAssertNil(parsed[1].daysLeft)
        XCTAssertEqual(parsed[1].active, true)
    }

    func testExpiryDecidesActiveWhenNoFlagTruthiness() {
        let expired: [String: SubscriptionsValue] = [
            "premium_connectivity": .bool(true),
            "premium_connectivity_expiry": .string("2026-05-01T00:00:00Z")
        ]
        let parsed = SubscriptionsProjectionBuilder.parseSubscriptions(expired, now: now, localize: localize)
        XCTAssertEqual(parsed.count, 1)
        XCTAssertEqual(parsed[0].active, false)
    }

    func testArrayFallbackDedupAndUnknownName() {
        let data: [String: SubscriptionsValue] = [
            "premium_connectivity": .bool(true),
            "subscriptions": .array([
                .object(["name": .string("premium connectivity"), "status": .string("active")]),
                .object(["type": .string("Roadside"), "expiry_date": .string("2026-06-21T00:00:00Z")]),
                .object(["status": .string("expired"), "expiry_date": .string("2026-05-01T00:00:00Z")]),
                .string("garbage")
            ])
        ]
        let parsed = SubscriptionsProjectionBuilder.parseSubscriptions(data, now: now, localize: localize)
        XCTAssertEqual(parsed.map(\.name), ["Premium Connectivity", "Roadside", "Unknown"])
        XCTAssertEqual(parsed[1].active, true)
        XCTAssertEqual(parsed[1].daysLeft, 20)
        XCTAssertEqual(parsed[2].active, false)
    }

    func testArrayItemStatusWinsOverExpiry() {
        let data: [String: SubscriptionsValue] = [
            "subscriptions": .array([
                .object(["name": .string("A"), "status": .string("Active"), "expiry_date": .string("2020-01-01")]),
                .object(["name": .string("B"), "status": .string("cancelled")]),
                .object(["name": .string("C")])
            ])
        ]
        let parsed = SubscriptionsProjectionBuilder.parseSubscriptions(data, now: now, localize: localize)
        XCTAssertEqual(parsed[0].active, true)
        XCTAssertEqual(parsed[1].active, false)
        XCTAssertEqual(parsed[2].active, true)
    }

    func testBuildDerivesCountNextExpiryAndValues() {
        let data: [String: SubscriptionsValue] = [
            "premium_connectivity": .bool(true),
            "premium_connectivity_expiry_date": .string("2026-09-01T00:00:00Z"),
            "standard_connectivity": .bool(true),
            "standard_connectivity_expiry_date": .string("2026-06-21T00:00:00Z"),
            "data_sharing": .bool(true)
        ]
        let projection = SubscriptionsProjectionBuilder.build(data: data, now: now, format: format, localize: localize)
        XCTAssertEqual(projection.activeCount, 3)
        XCTAssertEqual(projection.nextExpiry?.name, "Standard Connectivity")
        XCTAssertEqual(projection.nextExpiryText, "Jun 21, 2026")
        XCTAssertEqual(projection.rows.first { $0.name == "Premium Connectivity" }?.valueText, "Sep 1, 2026")
        XCTAssertEqual(projection.rows.first { $0.name == "Data Sharing" }?.valueText, "—")
        XCTAssertTrue(projection.hasData)
    }

    func testRenewalUsedAsValueWhenNoExpiry() {
        let data: [String: SubscriptionsValue] = [
            "full_self_driving": .bool(true),
            "full_self_driving_renewal": .string("Owned")
        ]
        let projection = SubscriptionsProjectionBuilder.build(data: data, now: now, format: format, localize: localize)
        XCTAssertEqual(projection.rows.first?.valueText, "Owned")
        XCTAssertNil(projection.nextExpiry)
    }

    func testBuildEmptyEnvelope() {
        let projection = SubscriptionsProjectionBuilder.build(data: nil, now: now, format: format, localize: localize)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.activeCount, 0)
        XCTAssertTrue(projection.rows.isEmpty)
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class SubscriptionsModelTests: XCTestCase {
    private func dataUpdate(
        status: SubscriptionsLoadStatus,
        connection: SubscriptionsConnection = .live
    ) -> SubscriptionsUpdate {
        SubscriptionsUpdate(
            status: status,
            connection: connection,
            data: ["full_self_driving": .bool(true)],
            format: .default,
            now: SubscriptionsFixture.now,
            updatedAt: SubscriptionsFixture.now
        )
    }

    private func makeModel(
        _ update: SubscriptionsUpdate,
        telemetry: SubscriptionsTelemetry = OSLogSubscriptionsTelemetry()
    ) -> (SubscriptionsModel, InMemorySubscriptionsSource) {
        let source = InMemorySubscriptionsSource(initial: update)
        let model = SubscriptionsModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(SubscriptionsUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(SubscriptionsUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(SubscriptionsUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertEqual(loading.projection.rows.first?.name, "Full Self-Driving")

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySubscriptionsTelemetry()
        let (model, source) = makeModel(SubscriptionsUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SubscriptionsWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SubscriptionsUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(SubscriptionsUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.activeCount, 1)
    }
}

// MARK: - Registry parity

final class SubscriptionsRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SubscriptionsWidget.registration
        XCTAssertEqual(registration.id, "subscriptions")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SubscriptionsWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 8)), DashboardWidgetSize(cols: 2, rows: 8))
    }
}

// MARK: - Accessibility summary content

final class SubscriptionsAccessibilityTests: XCTestCase {
    private let now = SubscriptionsFixture.now
    private let format = SubscriptionsFixture.format
    private let localize = SubscriptionsFixture.localize

    func testSummaryIncludesCountAndPerRowStatus() {
        let data: [String: SubscriptionsValue] = [
            "premium_connectivity": .bool(true),
            "premium_connectivity_expiry_date": .string("2026-09-01T00:00:00Z"),
            "subscriptions": .array([
                .object(["name": .string("Satellite"), "status": .string("expired")])
            ])
        ]
        let projection = SubscriptionsProjectionBuilder.build(data: data, now: now, format: format, localize: localize)
        let summary = SubscriptionsAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("1 active"))
        XCTAssertTrue(summary.contains("Premium Connectivity: Active"))
        XCTAssertTrue(summary.contains("Satellite: Expired"))
    }

    func testSummaryEmpty() {
        XCTAssertEqual(SubscriptionsAccessibility.summary(for: .empty), "No subscriptions")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySubscriptionsTelemetry: SubscriptionsTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
