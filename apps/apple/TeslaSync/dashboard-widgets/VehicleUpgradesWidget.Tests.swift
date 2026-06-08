//
//  VehicleUpgradesWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0110 · VehicleUpgradesWidget (Apple)
//
//  Unit coverage for the VehicleUpgradesWidget surface:
//    • Adapter (cached → projection) — `UpgradesProjectionBuilder` parity with the
//      web VehicleUpgradesWidget.tsx pipeline (parseUpgrades array/keyed fallbacks,
//      asString coercion, eligible count, daysUntil, active filter, nearest expiry,
//      date formatting).
//    • State holder — `VehicleUpgradesModel` phase resolution across loading /
//      empty / error / content, plus the P1/S11 `view.opened` telemetry + source
//      wiring.
//    • Registry — canonical `vehicle-upgrades` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content for each state.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryUpgradesSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached envelope → projection (parity with the web pipeline)

@MainActor
final class UpgradesAdapterTests: XCTestCase {
    /// Fixed reference clock so the share-link expiry math is deterministic.
    private let now = ISO8601DateFormatter().date(from: "2024-06-01T00:00:00Z")!

    private func makeFormat() -> UpgradesFormatting {
        UpgradesFormatting(
            currencySymbol: "$",
            localeIdentifier: "en_US",
            timeZoneIdentifier: "America/Los_Angeles",
            now: now
        )
    }

    func testAsStringCoercion() {
        XCTAssertNil(UpgradeScalar.absent.asString)
        XCTAssertNil(UpgradeScalar.text("").asString)
        XCTAssertEqual(UpgradeScalar.text("Boost").asString, "Boost")
        XCTAssertEqual(UpgradeScalar.number(199).asString, "199")
        XCTAssertEqual(UpgradeScalar.number(9.99).asString, "9.99")
    }

    func testParseUpgradesListBranchFallbacks() {
        let envelope = UpgradeEnvelope.list([
            UpgradesAdapterTests.upgrade(name: "Acceleration Boost", price: .text("2000"), eligible: true),
            UpgradesAdapterTests.upgrade(title: "Premium Connectivity", cost: .number(9.99), eligible: false),
            RawUpgrade(eligible: nil)
        ])
        let parsed = UpgradesProjectionBuilder.parseUpgrades(envelope)
        XCTAssertEqual(parsed.count, 3)
        // name ?? title ?? "Unknown Upgrade"
        XCTAssertEqual(parsed[0].name, "Acceleration Boost")
        XCTAssertEqual(parsed[1].name, "Premium Connectivity")
        XCTAssertEqual(parsed[2].name, "Unknown Upgrade")
        // price ?? cost
        XCTAssertEqual(parsed[0].price, "2000")
        XCTAssertEqual(parsed[1].price, "9.99")
        XCTAssertNil(parsed[2].price)
        // eligible !== false (missing flag is eligible)
        XCTAssertTrue(parsed[0].eligible)
        XCTAssertFalse(parsed[1].eligible)
        XCTAssertTrue(parsed[2].eligible)
    }

    func testParseUpgradesKeyedFallbackUsesKeyNotTitle() {
        let envelope = UpgradeEnvelope.keyed([
            RawUpgradeEntry(
                key: "fsd",
                upgrade: RawUpgrade(title: .text("ignored"), price: .text("12000"), eligible: true)
            ),
            RawUpgradeEntry(key: "seats", upgrade: RawUpgrade(name: .text("Heated Seats"), eligible: false))
        ])
        let parsed = UpgradesProjectionBuilder.parseUpgrades(envelope)
        // Keyed branch resolves name ?? key (it never consults title).
        XCTAssertEqual(parsed[0].name, "fsd")
        XCTAssertEqual(parsed[0].price, "12000")
        XCTAssertEqual(parsed[1].name, "Heated Seats")
        XCTAssertFalse(parsed[1].eligible)
    }

    func testParseUpgradesNoneIsEmpty() {
        XCTAssertTrue(UpgradesProjectionBuilder.parseUpgrades(.none).isEmpty)
    }

    func testEligibleCount() {
        let parsed = [
            ParsedUpgrade(name: "a", eligible: true),
            ParsedUpgrade(name: "b", eligible: false),
            ParsedUpgrade(name: "c", eligible: true)
        ]
        XCTAssertEqual(UpgradesProjectionBuilder.eligibleCount(parsed), 2)
    }

    func testDaysUntilCeilAndInvalid() {
        XCTAssertEqual(UpgradesProjectionBuilder.daysUntil("2024-06-06T00:00:00Z", now: now), 5)
        XCTAssertEqual(UpgradesProjectionBuilder.daysUntil("2024-05-01T00:00:00Z", now: now), -31)
        XCTAssertNil(UpgradesProjectionBuilder.daysUntil(nil, now: now))
        XCTAssertNil(UpgradesProjectionBuilder.daysUntil("not-a-date", now: now))
    }

    func testActiveShareLinksFilter() {
        let links = [
            ShareLinkInput(id: "expired", expiresAt: "2024-05-01T00:00:00Z"),
            ShareLinkInput(id: "soon", expiresAt: "2024-06-06T00:00:00Z"),
            ShareLinkInput(id: "never", expiresAt: nil),
            ShareLinkInput(id: "bad", expiresAt: "not-a-date")
        ]
        let active = UpgradesProjectionBuilder.activeShareLinks(links, now: now)
        // Expired drops; never / unparseable / future stay.
        XCTAssertEqual(active.map(\.id), ["soon", "never", "bad"])
    }

    func testNearestExpiryPicksSoonestWithExpiry() {
        let links = [
            ShareLinkInput(id: "never", expiresAt: nil),
            ShareLinkInput(id: "later", expiresAt: "2024-06-21T00:00:00Z"),
            ShareLinkInput(id: "soon", expiresAt: "2024-06-06T00:00:00Z")
        ]
        let active = UpgradesProjectionBuilder.activeShareLinks(links, now: now)
        let nearest = UpgradesProjectionBuilder.nearestExpiry(active, now: now)
        XCTAssertEqual(nearest?.id, "soon")
    }

    func testNearestExpiryNilWhenNoActiveLinkHasExpiry() {
        let links = [ShareLinkInput(id: "never", expiresAt: nil), ShareLinkInput(id: "blank", expiresAt: "")]
        let active = UpgradesProjectionBuilder.activeShareLinks(links, now: now)
        XCTAssertEqual(active.count, 2)
        XCTAssertNil(UpgradesProjectionBuilder.nearestExpiry(active, now: now))
    }

    func testDateTextMediumAndInvalid() {
        let format = makeFormat()
        // 2024-06-06T00:00Z is 2024-06-05 17:00 in America/Los_Angeles.
        XCTAssertEqual(UpgradesProjectionBuilder.dateText("2024-06-06T00:00:00Z", format: format), "Jun 5, 2024")
        XCTAssertEqual(UpgradesProjectionBuilder.dateText(nil, format: format), "—")
        XCTAssertEqual(UpgradesProjectionBuilder.dateText("not-a-date", format: format), "—")
    }

    func testBuildProducesFullProjection() {
        let format = makeFormat()
        let envelope = UpgradeEnvelope.list([
            UpgradesAdapterTests.upgrade(name: "Acceleration Boost", price: .text("2000"), eligible: true),
            UpgradesAdapterTests.upgrade(name: "FSD", price: .text("12000"), eligible: false)
        ])
        let links = [
            ShareLinkInput(id: "expired", expiresAt: "2024-05-01T00:00:00Z"),
            ShareLinkInput(id: "soon", expiresAt: "2024-06-06T00:00:00Z"),
            ShareLinkInput(id: "never", expiresAt: nil)
        ]
        let projection = UpgradesProjectionBuilder.build(envelope: envelope, shareLinks: links, format: format)
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.upgrades.count, 2)
        XCTAssertEqual(projection.eligibleCount, 1)
        XCTAssertEqual(projection.activeShareLinkCount, 2)
        XCTAssertEqual(projection.nearestExpiryText, "Jun 5, 2024")
        XCTAssertEqual(projection.currencySymbol, "$")
        XCTAssertTrue(projection.hasUpgrades)
        XCTAssertTrue(projection.hasActiveShareLinks)
    }

    func testBuildEmptyHasNoData() {
        let projection = UpgradesProjectionBuilder.build(envelope: .none, shareLinks: [], format: makeFormat())
        XCTAssertFalse(projection.hasData)
        XCTAssertFalse(projection.hasUpgrades)
        XCTAssertFalse(projection.hasActiveShareLinks)
        XCTAssertNil(projection.nearestExpiryText)
    }

    private static func upgrade(
        name: String? = nil,
        title: String? = nil,
        price: UpgradeScalar = .absent,
        cost: UpgradeScalar = .absent,
        eligible: Bool?
    ) -> RawUpgrade {
        RawUpgrade(
            name: name.map(UpgradeScalar.text) ?? .absent,
            title: title.map(UpgradeScalar.text) ?? .absent,
            price: price,
            cost: cost,
            eligible: eligible
        )
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor
final class VehicleUpgradesModelTests: XCTestCase {
    private func dataUpdate(
        status: UpgradesLoadStatus,
        connection: UpgradesConnection = .live
    ) -> VehicleUpgradesUpdate {
        VehicleUpgradesUpdate(
            status: status,
            connection: connection,
            envelope: .list([RawUpgrade(name: .text("Acceleration Boost"), eligible: true)]),
            shareLinks: [],
            format: .default,
            updatedAt: Date()
        )
    }

    private func makeModel(
        _ update: VehicleUpgradesUpdate,
        telemetry: UpgradesTelemetry = OSLogUpgradesTelemetry()
    ) -> (VehicleUpgradesModel, InMemoryUpgradesSource) {
        let source = InMemoryUpgradesSource(initial: update)
        let model = VehicleUpgradesModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(VehicleUpgradesUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(VehicleUpgradesUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(VehicleUpgradesUpdate(status: .failed("boom")))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileLoadingOrFailed() {
        let (loading, _) = makeModel(dataUpdate(status: .loading))
        loading.start()
        XCTAssertEqual(loading.phase, .content)
        XCTAssertTrue(loading.projection.hasUpgrades)

        let (failed, _) = makeModel(dataUpdate(status: .failed("net")))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testShareLinksOnlyCountsAsData() {
        let update = VehicleUpgradesUpdate(
            status: .loaded,
            envelope: .none,
            shareLinks: [ShareLinkInput(id: "1", expiresAt: nil)]
        )
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertFalse(model.projection.hasUpgrades)
        XCTAssertTrue(model.projection.hasActiveShareLinks)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyUpgradesTelemetry()
        let (model, source) = makeModel(VehicleUpgradesUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleUpgradesWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(VehicleUpgradesUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndProjectionTrackUpdates() {
        let (model, source) = makeModel(VehicleUpgradesUpdate(status: .loading))
        model.start()
        source.push(dataUpdate(status: .loaded, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.upgrades.first?.name, "Acceleration Boost")
    }
}

// MARK: - Registry parity

@MainActor
final class UpgradesRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VehicleUpgradesWidget.registration
        XCTAssertEqual(registration.id, "vehicle-upgrades")
        XCTAssertEqual(registration.category, "vehicle")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VehicleUpgradesWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 3, rows: 8)), DashboardWidgetSize(cols: 3, rows: 8))
    }
}

// MARK: - Accessibility summary content

@MainActor
final class UpgradesAccessibilityTests: XCTestCase {
    private let now = ISO8601DateFormatter().date(from: "2024-06-01T00:00:00Z")!

    func testSummaryIncludesUpgradeCountsAndNearestExpiry() {
        let format = UpgradesFormatting(timeZoneIdentifier: "America/Los_Angeles", now: now)
        let projection = UpgradesProjectionBuilder.build(
            envelope: .list([
                RawUpgrade(name: .text("Acceleration Boost"), eligible: true),
                RawUpgrade(name: .text("FSD"), eligible: false)
            ]),
            shareLinks: [ShareLinkInput(id: "soon", expiresAt: "2024-06-06T00:00:00Z")],
            format: format
        )
        let summary = UpgradesAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("2 upgrades available"))
        XCTAssertTrue(summary.contains("1 eligible"))
        XCTAssertTrue(summary.contains("1 active share links"))
        XCTAssertTrue(summary.contains("Nearest expiry: Jun 5, 2024"))
    }

    func testSummaryEmptyBranches() {
        let summary = UpgradesAccessibility.summary(for: .empty)
        XCTAssertTrue(summary.contains("All upgrades applied"))
        XCTAssertTrue(summary.contains("No active share links"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyUpgradesTelemetry: UpgradesTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
