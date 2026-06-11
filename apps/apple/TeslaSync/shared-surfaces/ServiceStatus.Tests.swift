//
//  ServiceStatus.Tests.swift
//  TeslaSync — P4 shared surface · 0104 · ServiceStatus (Apple)
//
//  Adapter + projection coverage for the ServiceStatus surface:
//    • Health taxonomy — the web `SystemHealthDot` `overall` → colour ternary (healthy → green,
//      degraded → amber, else → red), the per-level SF Symbol, and the level labels.
//    • Connectivity copy — the verbatim port of the web `ServiceStatusBanner` strings.
//    • Snapshot — the `hasValue` guard (web `!data`) and the `fromSystemStatus` subsystem builder.
//    • Projection — the render branches plus the P4 leaf contract across data / empty / loading /
//      error, including the cached-value-wins precedence.
//    • Accessibility — the dot label substitution and the offline banner label join.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real store, so
//  each assertion reads the pure adapter / projection directly.
//

import XCTest
@testable import TeslaSync

// MARK: - Health level (web `overall` colour ternary)

final class SystemHealthLevelTests: XCTestCase {
    func testOverallMapsToLevel() {
        XCTAssertEqual(SystemHealthLevel.forOverall("healthy"), .healthy)
        XCTAssertEqual(SystemHealthLevel.forOverall("degraded"), .degraded)
        XCTAssertEqual(SystemHealthLevel.forOverall("down"), .down)
    }

    func testUnknownAndUnhealthyResolveAsDown() {
        XCTAssertEqual(SystemHealthLevel.forOverall("unhealthy"), .down)
        XCTAssertEqual(SystemHealthLevel.forOverall("anything-new"), .down)
        XCTAssertEqual(SystemHealthLevel.forOverall(""), .down)
        XCTAssertEqual(SystemHealthLevel.forOverall("HEALTHY"), .down) // case-sensitive, web parity
    }

    func testEachLevelHasADistinctSymbol() {
        let symbols = Set(SystemHealthLevel.allCases.map(\.systemImageName))
        XCTAssertEqual(symbols.count, SystemHealthLevel.allCases.count)
        XCTAssertFalse(symbols.contains(""))
    }

    func testEachLevelHasANonEmptyLabelKeyAndFallback() {
        for level in SystemHealthLevel.allCases {
            XCTAssertTrue(level.label.key.hasPrefix("service.status.level."))
            XCTAssertFalse(level.label.fallback.isEmpty)
        }
    }
}

// MARK: - Connectivity copy (web `ServiceStatusBanner`)

final class ServiceStatusCopyTests: XCTestCase {
    func testOfflineCopyMatchesWebContent() {
        XCTAssertEqual(ServiceStatusCopy.offlineTitleFallback, "You are offline")
        XCTAssertEqual(
            ServiceStatusCopy.offlineMessageFallback,
            "Data may be stale. Reconnecting automatically…"
        )
        XCTAssertTrue(ServiceStatusCopy.offlineTitleKey.hasPrefix("service.status.offline"))
        XCTAssertTrue(ServiceStatusCopy.offlineMessageKey.hasPrefix("service.status.offline"))
    }
}

// MARK: - Snapshot (web `SystemStatus`)

final class SystemStatusSnapshotTests: XCTestCase {
    func testHasValueGuardsBlankOverall() {
        XCTAssertTrue(SystemStatusSnapshot(overall: "healthy").hasValue)
        XCTAssertFalse(SystemStatusSnapshot(overall: "").hasValue)
        XCTAssertFalse(SystemStatusSnapshot(overall: "   ").hasValue)
    }

    func testFromSystemStatusMapsPresentSubsystemsOnly() {
        let snapshot = SystemStatusSnapshot.fromSystemStatus(
            overall: "degraded",
            database: "healthy",
            teslaApi: "degraded",
            mqtt: nil,
            worker: "down"
        )
        XCTAssertEqual(snapshot.overall, "degraded")
        XCTAssertEqual(snapshot.components.map(\.id), ["database", "tesla_api", "worker"])
        XCTAssertEqual(snapshot.components.first?.nameKey, "service.status.component.database")
    }

    func testComponentDerivesItsLevel() {
        let component = ServiceComponentStatus(
            id: "mqtt", nameKey: "service.status.component.mqtt", nameFallback: "MQTT", status: "unhealthy"
        )
        XCTAssertEqual(component.level, .down)
    }
}

// MARK: - Projection (render branches + P4 leaf contract)

final class ServiceStatusProjectionTests: XCTestCase {
    func testDataPaintsLevelFromOverall() throws {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(status: SystemStatusSnapshot(overall: "degraded"))
        )
        XCTAssertEqual(resolved.phase, .data)
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.level, .degraded)
        XCTAssertEqual(data.overall, "degraded")
    }

    func testCachedValueWinsOverError() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(
                status: SystemStatusSnapshot(overall: "healthy"),
                errorMessage: "boom"
            )
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.level, .healthy)
    }

    func testCachedValueWinsOverLoading() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(status: SystemStatusSnapshot(overall: "down"), isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.data?.level, .down)
    }

    func testErrorWhenNoUsableValue() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(errorMessage: "timeout")
        )
        XCTAssertEqual(resolved.phase, .error("timeout"))
        XCTAssertNil(resolved.data)
    }

    func testBlankOverallWithErrorSurfacesError() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(status: SystemStatusSnapshot(overall: ""), errorMessage: "bad")
        )
        XCTAssertEqual(resolved.phase, .error("bad"))
    }

    func testEmptyErrorMessageDoesNotForceError() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(errorMessage: "")
        )
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLoadingWhenFlaggedAndNoValueNorError() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenNoValue() {
        let resolved = ServiceStatusProjection.resolve(input: ServiceStatusInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertNil(resolved.data)
    }

    func testBlankOverallIsEmpty() {
        let resolved = ServiceStatusProjection.resolve(
            input: ServiceStatusInput(status: SystemStatusSnapshot(overall: "   "))
        )
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testDataCarriesComponents() throws {
        let snapshot = SystemStatusSnapshot.fromSystemStatus(
            overall: "healthy", database: "healthy", worker: "degraded"
        )
        let resolved = ServiceStatusProjection.resolve(input: ServiceStatusInput(status: snapshot))
        let data = try XCTUnwrap(resolved.data)
        XCTAssertEqual(data.components.count, 2)
    }
}

// MARK: - Accessibility

final class ServiceStatusAccessibilityTests: XCTestCase {
    func testDotLabelSubstitutesStatus() {
        XCTAssertEqual(
            ServiceStatusAccessibility.dotLabel(statusLabel: "Healthy", template: "System: {status}"),
            "System: Healthy"
        )
    }

    func testDotLabelToleratesMissingToken() {
        XCTAssertEqual(
            ServiceStatusAccessibility.dotLabel(statusLabel: "Down", template: "System health"),
            "System health"
        )
    }

    func testBannerLabelJoinsTitleAndMessage() {
        XCTAssertEqual(
            ServiceStatusAccessibility.bannerLabel(
                title: "You are offline",
                message: "Data may be stale."
            ),
            "You are offline. Data may be stale."
        )
    }

    func testBannerLabelDoesNotDoubleTerminalPunctuation() {
        XCTAssertEqual(
            ServiceStatusAccessibility.bannerLabel(title: "Offline.", message: "Reconnecting…"),
            "Offline. Reconnecting…"
        )
    }

    func testBannerLabelHandlesEmptyParts() {
        XCTAssertEqual(ServiceStatusAccessibility.bannerLabel(title: "", message: "Only body"), "Only body")
        XCTAssertEqual(ServiceStatusAccessibility.bannerLabel(title: "Only title", message: ""), "Only title")
    }
}
