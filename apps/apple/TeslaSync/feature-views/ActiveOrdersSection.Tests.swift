//
//  ActiveOrdersSection.Tests.swift
//  TeslaSync — P4 feature view · 0196 · ActiveOrdersSection (Apple)
//
//  Pure-adapter + accessibility coverage for the ActiveOrdersSection surface:
//    • `OrdersStatus` — the status tone classification + humanized label (web
//      `orderStatusVariant` / `formatOrderStatus`), including DELIVER precedence.
//    • `OrdersProjection` — the row projection + the content / two-empty / loading /
//      error phase resolution.
//    • `OrdersDateFormat` — ISO parsing + the "—" em-dash fallback contract.
//    • `OrdersAccessibility` — the section summary + per-card VoiceOver label.
//  The state-holder tests live in `.ModelTests`. No network, no bundle.
//

import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures (used here + in `.ModelTests`)

enum OrdersFixture {
    /// Model 3, in production, a delivery date, no VIN, upgradable.
    static let inProduction = TeslaOrderDTO(
        id: 1,
        orderID: "RN401234567",
        model: "Model 3",
        status: "IN_PRODUCTION",
        deliveryDate: "2026-04-15",
        vin: nil,
        isUpgradable: true
    )

    /// Model Y, ready for delivery, a delivery date + VIN, not upgradable.
    static let readyForDelivery = TeslaOrderDTO(
        id: 2,
        orderID: "RN409876543",
        model: "Model Y",
        status: "READY_FOR_DELIVERY",
        deliveryDate: "2026-05-02",
        vin: "5YJ3E1EA7PF000000",
        isUpgradable: false
    )
}

// MARK: - Adapter: status tone + label

@MainActor
final class OrdersStatusTests: XCTestCase {
    func testToneMatchesWebVariantMapping() {
        XCTAssertEqual(OrdersStatus.tone("DELIVERED"), .success)
        XCTAssertEqual(OrdersStatus.tone("READY_FOR_PICKUP"), .info)
        XCTAssertEqual(OrdersStatus.tone("IN_TRANSPORT"), .info)
        XCTAssertEqual(OrdersStatus.tone("CANCELED"), .danger)
        XCTAssertEqual(OrdersStatus.tone("REJECTED"), .danger)
        XCTAssertEqual(OrdersStatus.tone("PENDING"), .warning)
        XCTAssertEqual(OrdersStatus.tone("ORDERED"), .warning)
        XCTAssertEqual(OrdersStatus.tone("BOOKED"), .neutral)
        XCTAssertEqual(OrdersStatus.tone(""), .neutral)
    }

    func testDeliverTakesPrecedenceLikeWeb() {
        // Web checks `includes('DELIVER')` before `includes('READY')`, so a
        // "READY_FOR_DELIVERY" status resolves to success, not info.
        XCTAssertEqual(OrdersStatus.tone("READY_FOR_DELIVERY"), .success)
    }

    func testToneIsCaseInsensitive() {
        XCTAssertEqual(OrdersStatus.tone("delivered"), .success)
        XCTAssertEqual(OrdersStatus.tone("Pending"), .warning)
    }

    func testLabelHumanizesLikeWeb() {
        XCTAssertEqual(OrdersStatus.label("IN_PRODUCTION"), "In Production")
        XCTAssertEqual(OrdersStatus.label("READY_FOR_DELIVERY"), "Ready For Delivery")
        XCTAssertEqual(OrdersStatus.label("DELIVERED"), "Delivered")
        XCTAssertEqual(OrdersStatus.label("model_3"), "Model 3")
    }

    func testLabelEmptyUsesEmDash() {
        XCTAssertEqual(OrdersStatus.label(""), "—")
    }
}

// MARK: - Adapter: projection

@MainActor
final class OrdersProjectionTests: XCTestCase {
    func testRowsMapEveryFieldAndPreserveOrder() {
        let rows = OrdersProjection.rows(from: [OrdersFixture.inProduction, OrdersFixture.readyForDelivery])
        XCTAssertEqual(rows.map(\.orderID), ["RN401234567", "RN409876543"])
        XCTAssertEqual(rows.first?.modelName, "Model 3")
        XCTAssertEqual(rows.first?.statusLabel, "In Production")
        XCTAssertEqual(rows.first?.statusTone, .neutral)
        XCTAssertEqual(rows.first?.isUpgradable, true)
        XCTAssertNil(rows.first?.vin)
        XCTAssertEqual(rows.last?.vin, "5YJ3E1EA7PF000000")
        XCTAssertEqual(rows.last?.deliveryDateISO, "2026-05-02")
        XCTAssertEqual(rows.last?.statusTone, .success)
    }

    func testEmptyModelNameFallsBackToEmDash() {
        let order = TeslaOrderDTO(id: 9, orderID: "RN9", model: "", status: "BOOKED")
        let rows = OrdersProjection.rows(from: [order])
        XCTAssertEqual(rows.first?.modelName, "—")
    }

    func testRowIdentityIsOrderReference() {
        let rows = OrdersProjection.rows(from: [OrdersFixture.inProduction])
        XCTAssertEqual(rows.first?.id, "RN401234567")
    }

    func testResolvePhase() {
        XCTAssertEqual(OrdersProjection.resolvePhase(.loading, count: 0, hasFetchedAt: false), .loading)
        XCTAssertEqual(OrdersProjection.resolvePhase(.loaded, count: 3, hasFetchedAt: true), .content)
        XCTAssertEqual(OrdersProjection.resolvePhase(.loaded, count: 0, hasFetchedAt: true), .emptyFetched)
        XCTAssertEqual(OrdersProjection.resolvePhase(.loaded, count: 0, hasFetchedAt: false), .emptyNoData)
        XCTAssertEqual(OrdersProjection.resolvePhase(.failed("boom"), count: 0, hasFetchedAt: true), .error("boom"))
    }
}

// MARK: - Adapter: date formatting

@MainActor
final class OrdersDateFormatTests: XCTestCase {
    private let locale = Locale(identifier: "en_US")
    private let zone = TimeZone.gmt

    func testParseAcceptsIsoAndDateOnly() {
        XCTAssertNotNil(OrdersDateFormat.parse("2026-04-15T09:30:00.500Z"))
        XCTAssertNotNil(OrdersDateFormat.parse("2026-04-15T09:30:00Z"))
        XCTAssertNotNil(OrdersDateFormat.parse("2026-04-15"))
    }

    func testParseRejectsEmptyAndGarbage() {
        XCTAssertNil(OrdersDateFormat.parse(""))
        XCTAssertNil(OrdersDateFormat.parse("not-a-date"))
    }

    func testDateTimeRendersDateAndTime() {
        let date = OrdersDateFormat.parse("2026-04-15T09:30:00Z")
        let label = OrdersDateFormat.dateTime(date, locale: locale, timeZone: zone)
        XCTAssertTrue(label.contains("2026"))
        XCTAssertTrue(label.contains("Apr"))
    }

    func testDeliveryDateRendersDateOnly() {
        let label = OrdersDateFormat.date("2026-05-02", locale: locale, timeZone: zone)
        XCTAssertTrue(label.contains("2026"))
        XCTAssertTrue(label.contains("May"))
    }

    func testEmDashForMissingOrInvalid() {
        XCTAssertEqual(OrdersDateFormat.dateTime(nil, locale: locale, timeZone: zone), "—")
        XCTAssertEqual(OrdersDateFormat.date(nil, locale: locale, timeZone: zone), "—")
        XCTAssertEqual(OrdersDateFormat.date("garbage", locale: locale, timeZone: zone), "—")
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ActiveOrdersSurface.slug, "ActiveOrdersSection")
        XCTAssertEqual(ActiveOrdersSection.surfaceSlug, "ActiveOrdersSection")
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor
final class OrdersAccessibilityTests: XCTestCase {
    /// English-fallback localizer (bundle-free).
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testSectionSummaryWithOrders() {
        let rows = OrdersProjection.rows(from: [OrdersFixture.inProduction, OrdersFixture.readyForDelivery])
        let summary = OrdersAccessibility.sectionSummary(rows: rows, hasFetchedAt: true, localize: echo)
        XCTAssertTrue(summary.contains("Active Orders: 2"))
    }

    func testSectionSummaryEmptyFetchedUsesNoOrders() {
        let summary = OrdersAccessibility.sectionSummary(rows: [], hasFetchedAt: true, localize: echo)
        XCTAssertTrue(summary.contains("No active orders found."))
    }

    func testSectionSummaryEmptyNoDataUsesNoData() {
        let summary = OrdersAccessibility.sectionSummary(rows: [], hasFetchedAt: false, localize: echo)
        XCTAssertTrue(summary.contains("No order data yet"))
    }

    func testCardLabelIncludesEveryPresentField() throws {
        let row = try XCTUnwrap(OrdersProjection.rows(from: [OrdersFixture.readyForDelivery]).first)
        let label = OrdersAccessibility.cardLabel(row, deliveryText: "May 2, 2026", localize: echo)
        XCTAssertTrue(label.contains("Model Y"))
        XCTAssertTrue(label.contains("Ready For Delivery"))
        XCTAssertTrue(label.contains("Order ID RN409876543"))
        XCTAssertTrue(label.contains("VIN 5YJ3E1EA7PF000000"))
        XCTAssertTrue(label.contains("Delivery Date May 2, 2026"))
    }

    func testCardLabelOmitsAbsentFieldsAndFlagsUpgradable() throws {
        let row = try XCTUnwrap(OrdersProjection.rows(from: [OrdersFixture.inProduction]).first)
        let label = OrdersAccessibility.cardLabel(row, deliveryText: nil, localize: echo)
        XCTAssertTrue(label.contains("Upgradable"))
        XCTAssertFalse(label.contains("VIN"))
        XCTAssertFalse(label.contains("Delivery Date"))
    }
}
