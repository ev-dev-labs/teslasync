//
//  RecentActivity.Vehicles.ModelTests.swift
//  TeslaSync — P4 feature view · 0277 · RecentActivity (Apple)
//
//  State-holder + accessibility coverage for the vehicles "Recent Activity" surface:
//    • `VehicleRecentActivityModel` phase across loading / loaded / empty / failed, the P1/S11
//      `view.opened` telemetry (once), the stale auto-refresh (once, re-armed on live), offline
//      keeping cached panels, the slice(0, 5) row cap, and the resolved display locale.
//    • `VehicleRecentActivityAccessibility` container summary + per-row VoiceOver value.
//
//  The adapter (formatting + projection) coverage lives in RecentActivity.Vehicles.Tests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets: the model is driven through an in-memory
//  source.
//

import XCTest
@testable import TeslaSync

// MARK: - State holder: VehicleRecentActivityModel

@MainActor final class VehicleRecentActivityModelTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_733_580_000)

    private func units(_ localeID: String = "en-US") -> VehicleRecentActivityUnits {
        VehicleRecentActivityUnits(
            distanceUnit: "mi", distanceDivisor: 1609.344, timeStyle: .relative, localeIdentifier: localeID
        )
    }

    private func sampleDrives(_ count: Int) -> [VehicleRecentActivityDrive] {
        (0 ..< count).map { index in
            VehicleRecentActivityDrive(
                id: "d\(index)", distanceM: 16093.44, durationS: 5400, startSocPct: 80, endSocPct: 60,
                startedAt: now.addingTimeInterval(-Double(index + 1) * 600)
            )
        }
    }

    private func sampleCharge() -> VehicleRecentActivityCharge {
        VehicleRecentActivityCharge(
            id: "c0", energyAddedWh: 31400, durationS: 2640, startSocPct: 44, endSocPct: 80,
            startedAt: now.addingTimeInterval(-300)
        )
    }

    private func makeModel(
        initial: VehicleRecentActivityUpdate?,
        telemetry: VehicleRecentActivityTelemetry = SpyVehicleRecentActivityTelemetry()
    ) -> (VehicleRecentActivityModel, InMemoryVehicleRecentActivitySource) {
        let source = InMemoryVehicleRecentActivitySource(initial: initial)
        let model = VehicleRecentActivityModel(source: source, telemetry: telemetry, now: { [now = self.now] in now })
        return (model, source)
    }

    private func loaded(_ connection: VehicleRecentActivityConnection = .live) -> VehicleRecentActivityUpdate {
        VehicleRecentActivityUpdate(
            status: .loaded, drives: sampleDrives(2), charges: [sampleCharge()], units: units(),
            connection: connection, updatedAt: now
        )
    }

    func testLoadedContentProjectsPanels() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.driveRows.count, 2)
        XCTAssertEqual(model.chargeRows.count, 1)
        XCTAssertEqual(model.driveCount, 2)
        XCTAssertEqual(model.chargeCount, 1)
        XCTAssertEqual(model.driveRows.first?.value, "10.0 mi")
        XCTAssertEqual(model.chargeRows.first?.value, "31.4 kWh")
        XCTAssertEqual(source.startCount, 1)
    }

    func testRowCapAppliesInModel() {
        let update = VehicleRecentActivityUpdate(status: .loaded, drives: sampleDrives(9), units: units())
        let (model, _) = makeModel(initial: update)
        model.start()
        XCTAssertEqual(model.driveCount, 9)
        XCTAssertEqual(model.driveRows.count, 5)
    }

    func testEmptyAndLoadingAndErrorPhases() {
        let (empty, _) = makeModel(initial: VehicleRecentActivityUpdate(status: .loaded, units: units()))
        empty.start()
        XCTAssertEqual(empty.phase, .empty)

        let (loading, _) = makeModel(initial: VehicleRecentActivityUpdate(status: .loading, units: units()))
        loading.start()
        XCTAssertEqual(loading.phase, .loading)

        let (failed, _) = makeModel(initial: VehicleRecentActivityUpdate(status: .failed("timeout"), units: units()))
        failed.start()
        XCTAssertEqual(failed.phase, .error("timeout"))
    }

    func testCachedPanelsStayContentWhileFailing() {
        let (model, source) = makeModel(initial: loaded())
        model.start()
        source.push(
            VehicleRecentActivityUpdate(
                status: .failed("net"),
                drives: sampleDrives(2),
                units: units(),
                connection: .stale
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.connection, .stale)
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = SpyVehicleRecentActivityTelemetry()
        let (model, source) = makeModel(initial: nil, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VehicleRecentActivitySurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testStaleAutoRefreshFiresOncePerEpisode() {
        let (model, source) = makeModel(initial: loaded(.live))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(loaded(.stale))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 1, "stale should trigger exactly one guarded auto-refresh")
        source.push(loaded(.live))
        source.push(loaded(.stale))
        XCTAssertEqual(source.refreshCount, 2, "returning to live re-arms the stale auto-refresh")
        _ = model
    }

    func testOfflineKeepsCachedPanelsWithoutRefresh() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(loaded(.offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.driveCount, 2)
        XCTAssertEqual(source.refreshCount, 0, "offline must not refetch")
    }

    func testDisplayLocaleTracksPreferences() {
        let (model, source) = makeModel(initial: nil)
        model.start()
        source.push(VehicleRecentActivityUpdate(status: .loaded, drives: sampleDrives(1), units: units("de-DE")))
        XCTAssertEqual(model.displayLocale, Locale(identifier: "de-DE"))
    }

    func testRetryRefreshesSourceAndStopStopsIt() {
        let (model, source) = makeModel(initial: VehicleRecentActivityUpdate(status: .failed("x"), units: units()))
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class VehicleRecentActivityAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }

    func testRowLabelJoinsValueTimeDurationSoc() {
        let row = VehicleRecentActivityRow(
            id: "drive-1", kind: .drive, value: "10.0 mi", timeText: "10m ago", alternateTimeText: "Dec 7, 2:30 PM",
            durationText: "1h 30m", socRange: "80% → 60%", routeID: "1"
        )
        XCTAssertEqual(VehicleRecentActivityAccessibility.rowLabel(row), "10.0 mi, 10m ago, 1h 30m, 80% → 60%")
    }

    func testRowLabelOmitsMissingSoc() {
        let row = VehicleRecentActivityRow(
            id: "charge-1", kind: .charge, value: "31.4 kWh", timeText: "1h ago", alternateTimeText: "Dec 7, 1:30 PM",
            durationText: "0h 44m", socRange: nil, routeID: "1"
        )
        XCTAssertEqual(VehicleRecentActivityAccessibility.rowLabel(row), "31.4 kWh, 1h ago, 0h 44m")
    }

    func testSummaryIncludesTitleAndCounts() {
        let summary = VehicleRecentActivityAccessibility.summary(driveCount: 2, chargeCount: 1, localize: echo)
        XCTAssertTrue(summary.contains("Recent Activity"))
        XCTAssertTrue(summary.contains("2 recent drives"))
        XCTAssertTrue(summary.contains("1 recent charges"))
    }

    func testSummaryEmptyUsesFriendlyMessage() {
        let summary = VehicleRecentActivityAccessibility.summary(driveCount: 0, chargeCount: 0, localize: echo)
        XCTAssertTrue(summary.contains("Recent Activity"))
        XCTAssertTrue(summary.contains("No recent activity"))
    }
}

// MARK: - Telemetry spy

/// Records the surfaces a model reports as opened. Single-threaded test use only.
final class SpyVehicleRecentActivityTelemetry: VehicleRecentActivityTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
