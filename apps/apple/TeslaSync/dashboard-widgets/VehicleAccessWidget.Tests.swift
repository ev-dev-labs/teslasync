//
//  VehicleAccessWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0106 · VehicleAccessWidget (Apple)
//
//  Unit coverage for the VehicleAccessWidget surface:
//    • Adapter (cached → projection) — `VehicleAccessProjector` parity with the web `useMemo`
//      pipeline (driver label name→email→dash, Owner/Driver badge, invitation
//      Pending/Accepted/Expired badge, mobile-enabled badge, the `hasAnyData` render predicate).
//    • Formatter — `dateShort`, ported from web dateFormat.ts.
//    • State holder — `VehicleAccessModel` phases, P1/S11 `view.opened` telemetry, refresh + stale
//      auto-refresh, and the coalesced freshness flags.
//    • Registry / Layout / Accessibility parity.
//
//  These run in the TeslaSync(/-macOS) XCTest targets; the model is driven by
//  `InMemoryVehicleAccessSource` (no network, no real store).
//

import XCTest
@testable import TeslaSync

private let utc = TimeZone(identifier: "UTC")!

private func drv(
    _ id: Int,
    name: String? = nil,
    email: String? = nil,
    role: String? = nil,
    at: String? = nil
) -> VehicleAccessDriverDTO {
    VehicleAccessDriverDTO(id: id, driverName: name, driverEmail: email, role: role, fetchedAt: at)
}

private func inv(_ id: Int, by: String? = nil, status: String, at: String? = nil) -> VehicleAccessInvitationDTO {
    VehicleAccessInvitationDTO(id: id, createdBy: by, status: status, createdAt: at)
}

private func project(
    drivers: [VehicleAccessDriverDTO] = [],
    invitations: [VehicleAccessInvitationDTO] = [],
    mobile: Bool? = nil
) -> VehicleAccessProjection {
    VehicleAccessProjector.project(drivers: drivers, invitations: invitations, mobileEnabled: mobile, timeZone: utc)
}

private let sampleDrivers = [
    drv(1, name: "Alex", role: "owner", at: "2024-06-09T12:00:00Z"),
    drv(2, name: "Sam", role: "driver", at: "2024-05-28T09:30:00Z")
]

private let sampleInvitations = [
    inv(10, by: "alex@example.com", status: "pending", at: "2024-06-01T08:00:00Z"),
    inv(11, by: "owner@example.com", status: "expired", at: "2024-04-15T18:45:00Z")
]

// MARK: - Adapter: cached DTOs → projection (port parity with the web widget)

@MainActor final class VehicleAccessAdapterTests: XCTestCase {
    func testDriverEntriesMatchWebPipeline() {
        let result = project(drivers: sampleDrivers, mobile: true)
        XCTAssertEqual(result.driverEntries.map(\.id), ["driver-1", "driver-2"])
        XCTAssertEqual(result.driverEntries.map(\.label), ["Alex", "Sam"])
        XCTAssertEqual(result.driverEntries.map(\.value), ["Jun 9", "May 28"])
        XCTAssertEqual(result.driverEntries.map(\.badge.label), ["Owner", "Driver"])
        XCTAssertEqual(result.driverEntries.map(\.badge.tone), [.success, .neutral])
        XCTAssertEqual(result.driverCount, 2)
    }

    func testDriverLabelFallsBackNameThenEmailThenDash() {
        let rows = [
            drv(1, name: "Named", email: "e@x.com", role: "driver"),
            drv(2, email: "only@email.com", role: "driver"),
            drv(3, role: "owner")
        ]
        let result = project(drivers: rows)
        XCTAssertEqual(result.driverEntries.map(\.label), ["Named", "only@email.com", "—"])
        // Owner role still selects the success badge even when the label is the em-dash.
        XCTAssertEqual(result.driverEntries.last?.badge.tone, .success)
    }

    func testDriverDateFallsBackToDashWhenMissing() {
        let result = project(drivers: [drv(1, name: "No Date", role: "driver")])
        XCTAssertEqual(result.driverEntries.first?.value, "—")
    }

    func testInvitationEntriesMapStatusToBadge() {
        let result = project(invitations: sampleInvitations)
        XCTAssertEqual(result.invitationEntries.map(\.id), ["invitation-10", "invitation-11"])
        XCTAssertEqual(result.invitationEntries.map(\.label), ["alex@example.com", "owner@example.com"])
        XCTAssertEqual(result.invitationEntries.map(\.value), ["Jun 1", "Apr 15"])
        XCTAssertEqual(result.invitationEntries.map(\.badge.label), ["Pending", "Expired"])
        XCTAssertEqual(result.invitationEntries.map(\.badge.tone), [.warning, .danger])
    }

    func testInvitationAcceptedAndUnknownStatuses() {
        let rows = [inv(1, by: "a", status: "accepted"), inv(2, by: "b", status: "revoked")]
        let result = project(invitations: rows)
        // accepted → success; any other status (revoked) falls through to the Expired (danger) chip.
        XCTAssertEqual(result.invitationEntries.map(\.badge.label), ["Accepted", "Expired"])
        XCTAssertEqual(result.invitationEntries.map(\.badge.tone), [.success, .danger])
        XCTAssertEqual(result.invitationEntries.map(\.value), ["—", "—"])
    }

    func testMobileBadgeMapping() {
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: true).label, "Enabled")
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: true).tone, .success)
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: false).label, "Disabled")
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: false).tone, .danger)
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: nil).label, "Unknown")
        XCTAssertEqual(VehicleAccessProjector.mobileBadge(for: nil).tone, .neutral)
    }

    func testHasAnyDataPredicateMatchesWeb() {
        // Web: safeDrivers.length > 0 || safeInvitations.length > 0 || mobileEnabled !== null.
        XCTAssertFalse(project().hasAnyData)
        XCTAssertTrue(project(mobile: false).hasAnyData)
        XCTAssertTrue(project(drivers: sampleDrivers).hasAnyData)
        XCTAssertTrue(project(invitations: sampleInvitations).hasAnyData)
    }

    func testEmptyProjectionConstant() {
        XCTAssertFalse(VehicleAccessProjection.empty.hasAnyData)
        XCTAssertTrue(VehicleAccessProjection.empty.driverEntries.isEmpty)
        XCTAssertTrue(VehicleAccessProjection.empty.invitationEntries.isEmpty)
        XCTAssertEqual(VehicleAccessProjection.empty.driverCount, 0)
        XCTAssertNil(VehicleAccessProjection.empty.mobileEnabled)
        XCTAssertEqual(VehicleAccessProjection.empty.mobileBadge.tone, .neutral)
    }
}

// MARK: - Formatter (ported from the web dateFormat helper)

@MainActor final class VehicleAccessFormatTests: XCTestCase {
    func testDateShortRendersShortMonthDay() {
        XCTAssertEqual(VehicleAccessFormat.dateShort("2024-06-09T12:00:00Z", timeZone: utc), "Jun 9")
        XCTAssertEqual(VehicleAccessFormat.dateShort("2024-05-28T09:30:00Z", timeZone: utc), "May 28")
    }

    func testDateShortParsesFractionalSeconds() {
        XCTAssertEqual(VehicleAccessFormat.dateShort("2024-06-01T08:00:00.500Z", timeZone: utc), "Jun 1")
    }

    func testDateShortParsesDateOnly() {
        XCTAssertEqual(VehicleAccessFormat.dateShort("2024-04-15", timeZone: utc), "Apr 15")
    }

    func testDateShortFallsBackToEmDash() {
        XCTAssertEqual(VehicleAccessFormat.dateShort(nil), "—")
        XCTAssertEqual(VehicleAccessFormat.dateShort(""), "—")
        XCTAssertEqual(VehicleAccessFormat.dateShort("   "), "—")
        XCTAssertEqual(VehicleAccessFormat.dateShort("not-a-date"), "—")
        XCTAssertEqual(VehicleAccessFormat.emptyDash, "—")
    }
}

// MARK: - State holder: phases + telemetry + source wiring

@MainActor final class VehicleAccessModelTests: XCTestCase {
    private func makeModel(
        _ update: VehicleAccessUpdate,
        telemetry: VehicleAccessTelemetry = OSLogVehicleAccessTelemetry()
    ) -> (VehicleAccessModel, InMemoryVehicleAccessSource) {
        let source = InMemoryVehicleAccessSource(initial: update)
        return (VehicleAccessModel(source: source, telemetry: telemetry), source)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .loading, hasData: false), .loading)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .loading, hasData: true), .content)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .empty, hasData: false), .empty)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .empty, hasData: true), .empty)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .loaded, hasData: false), .empty)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .loaded, hasData: true), .content)
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .failed("x"), hasData: false), .error("x"))
        XCTAssertEqual(VehicleAccessModel.resolvePhase(status: .failed("x"), hasData: true), .content)
    }

    func testInitialProjectionIsEmptyConstant() {
        let (model, _) = makeModel(VehicleAccessUpdate(status: .loading))
        XCTAssertFalse(model.projection.hasAnyData)
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(VehicleAccessUpdate(status: .loaded))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testMobileOnlyShowsContent() {
        let (model, _) = makeModel(VehicleAccessUpdate(status: .loaded, mobileEnabled: false))
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.mobileEnabled, false)
    }

    func testFailedWithoutDataShowsError() {
        let (model, _) = makeModel(VehicleAccessUpdate(status: .failed("boom"), isError: true))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
        XCTAssertTrue(model.isError)
    }

    func testDataPresentShowsContentEvenWhileFailed() {
        let update = VehicleAccessUpdate(
            status: .failed("net"),
            isError: true,
            drivers: sampleDrivers,
            mobileEnabled: true
        )
        let (model, _) = makeModel(update)
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.projection.driverEntries.first?.badge.label, "Owner")
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyVehicleAccessTelemetry()
        let (model, source) = makeModel(VehicleAccessUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, ["VehicleAccessWidget"])
        XCTAssertEqual(VehicleAccessWidget.surfaceSlug, "VehicleAccessWidget")
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(VehicleAccessUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testAutoRefreshOnlyWhenStaleAndNotFetching() {
        let (model, source) = makeModel(VehicleAccessUpdate(
            status: .loaded,
            drivers: sampleDrivers,
            mobileEnabled: true
        ))
        model.start()
        model.autoRefreshIfStale() // live → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VehicleAccessUpdate(status: .loaded, connection: .stale, isFetching: true, mobileEnabled: true))
        model.autoRefreshIfStale() // stale but fetching → no refresh
        XCTAssertEqual(source.refreshCount, 0)

        source.push(VehicleAccessUpdate(status: .loaded, connection: .stale, isFetching: false, mobileEnabled: true))
        model.autoRefreshIfStale() // stale + idle → refresh
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testFreshnessFlagsTrackUpdates() {
        let (model, source) = makeModel(VehicleAccessUpdate(status: .loading))
        model.start()
        let stamp = Date()
        source.push(VehicleAccessUpdate(
            status: .loaded,
            connection: .offline,
            isFetching: true,
            drivers: sampleDrivers,
            mobileEnabled: true,
            updatedAt: stamp
        ))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertTrue(model.isFetching)
        XCTAssertFalse(model.isError)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.updatedAt, stamp)
    }

    func testStopResetsStartedSoTelemetryCanReemit() {
        let spy = SpyVehicleAccessTelemetry()
        let (model, _) = makeModel(VehicleAccessUpdate(status: .loading), telemetry: spy)
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(spy.surfaces, ["VehicleAccessWidget", "VehicleAccessWidget"])
    }
}

// MARK: - Registry / Layout parity

@MainActor final class VehicleAccessRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = VehicleAccessWidget.registration
        XCTAssertEqual(registration.id, "vehicle-access")
        XCTAssertEqual(registration.category, "security")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = VehicleAccessWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 0)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 2, rows: 4)), DashboardWidgetSize(cols: 2, rows: 4))
    }

    func testIsCompactWhenAtMostOneColumn() {
        XCTAssertTrue(VehicleAccessLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertTrue(VehicleAccessLayout.isCompact(DashboardWidgetSize(cols: 1, rows: 4)))
        XCTAssertFalse(VehicleAccessLayout.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
        XCTAssertFalse(VehicleAccessLayout.isCompact(DashboardWidgetSize(cols: 4, rows: 4)))
    }
}

// MARK: - Accessibility summary content

@MainActor final class VehicleAccessAccessibilityTests: XCTestCase {
    func testStandardSummaryIncludesEveryRow() {
        let result = project(drivers: sampleDrivers, invitations: [sampleInvitations[0]], mobile: true)
        XCTAssertEqual(
            VehicleAccessAccessibility.standardSummary(for: result),
            "Vehicle Access. Mobile Access Enabled. Authorized Drivers. "
                + "Alex Jun 9 Owner. Sam May 28 Driver. "
                + "Pending Invitations. alex@example.com Jun 1 Pending"
        )
    }

    func testStandardSummaryShowsNoDriversAndSkipsInvitations() {
        let result = project(mobile: false)
        XCTAssertEqual(
            VehicleAccessAccessibility.standardSummary(for: result),
            "Vehicle Access. Mobile Access Disabled. Authorized Drivers. No authorized drivers"
        )
    }

    func testCompactSummary() {
        let result = project(drivers: sampleDrivers, mobile: true)
        XCTAssertEqual(VehicleAccessAccessibility.compactSummary(for: result), "2 Drivers. Mobile access enabled")
    }

    func testMobileDotLabels() {
        XCTAssertEqual(VehicleAccessAccessibility.mobileDotLabel(for: true), "Mobile access enabled")
        XCTAssertEqual(VehicleAccessAccessibility.mobileDotLabel(for: false), "Mobile access disabled")
        XCTAssertEqual(VehicleAccessAccessibility.mobileDotLabel(for: nil), "Mobile access unknown")
    }

    func testEmptySummary() {
        XCTAssertEqual(VehicleAccessAccessibility.emptySummary(), "Vehicle Access. No access data available")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVehicleAccessTelemetry: VehicleAccessTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
