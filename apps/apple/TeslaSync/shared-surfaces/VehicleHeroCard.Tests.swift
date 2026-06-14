//
//  VehicleHeroCard.Tests.swift
//  TeslaSync — P4 shared surface · 0233 · VehicleHeroCard (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in VehicleHeroCard.AdapterTests.swift; split for the SwiftLint file-length budget):
//    • VehicleHeroCardModel — the once-only `view.opened`, snapshot ingestion → phase (loading / content /
//      empty / error), the projection gate (nil until a vehicle resolves), the `navigate(_:)` routing (web
//      `<Link>`), and the freshness axis (stale auto-refreshes ONCE, resets after live; offline + live do NOT
//      refetch).
//    • Views — the public surface composes in every phase + the subviews build.
//    • Strings — the web `vehicleHero.*` / `common.*` keys, the interpolated photo alt, and the native a11y
//      labels all resolve through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

@MainActor
private enum VHCTestData {
    static let vehicle = VehicleHeroCardVehicle(
        id: 7, displayName: "Lightning", model: "Model 3", vin: "VIN7", state: "online"
    )

    static func state() -> VehicleHeroCardLiveState {
        VehicleHeroCardLiveState(
            batteryLevel: 72,
            ratedRangeMeters: 480_000,
            insideTempC: 22.5,
            outsideTempC: 14,
            odometerMeters: 160_934_400,
            isCharging: false,
            isLocked: true,
            sentryMode: true,
            softwareVersion: "2026.6.2",
            power: 0,
            state: "online"
        )
    }
}

// MARK: - VehicleHeroCardModel (state + routing)

@MainActor
final class VehicleHeroCardModelTests: XCTestCase {
    private func model(
        source: VehicleHeroCardSource,
        onNavigate: @escaping @MainActor (VehicleHeroCardRoute) -> Void = { _ in },
        telemetry: VehicleHeroCardTelemetry = OSLogVehicleHeroCardTelemetry()
    ) -> VehicleHeroCardModel {
        VehicleHeroCardModel(source: source, onNavigate: onNavigate, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyVHCTelemetry()
        let holder = model(source: RecordingVHCSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleHeroCardSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyVHCTelemetry()
        let holder = model(source: RecordingVHCSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleHeroCardSurface.slug], "view.opened fires once per instance")
    }

    func testLoadingSnapshotYieldsLoadingPhaseAndNilProjection() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: nil, isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
        XCTAssertNil(holder.projection)
    }

    func testVehicleSnapshotYieldsContentAndProjection() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, liveState: VHCTestData.state()))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertEqual(holder.projection?.gauges.count, 4)
        XCTAssertEqual(holder.projection?.stats.count, 8)
        XCTAssertTrue(holder.projection?.hasLiveState ?? false)
    }

    func testVehicleWithoutLiveStateStillContentWithFallback() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, liveState: nil))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertFalse(holder.projection?.hasLiveState ?? true, "no live state → fallback, not hidden")
    }

    func testEmptySnapshotYieldsEmptyPhase() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: nil))
        XCTAssertEqual(holder.phase, .empty)
    }

    func testErrorSnapshotYieldsErrorPhase() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: nil, errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testNavigateRoutesToOnNavigate() {
        let recorder = NavRecorder()
        let source = RecordingVHCSource()
        let holder = model(source: source, onNavigate: { recorder.record($0) })
        holder.start()
        holder.navigate(.commands(vehicleID: 7))
        XCTAssertEqual(recorder.routes, [.commands(vehicleID: 7)])
    }

    func testUnitPrefsAndConnectionTracked() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(
            vehicle: VHCTestData.vehicle,
            liveState: VHCTestData.state(),
            unitPrefs: .metric,
            connection: .offline
        ))
        XCTAssertEqual(holder.unitPrefs, .metric)
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(holder.projection?.gauges[1].unit, "km")
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "first stale read auto-refreshes once")
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "a still-stale read does not re-refresh")
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, connection: .live))
        source.emit(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a fresh stale episode after live re-triggers once")
    }

    func testOfflineDoesNotRefetchAndKeepsCachedValues() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleHeroCardSnapshot(
            vehicle: VHCTestData.vehicle, liveState: VHCTestData.state(), connection: .offline
        ))
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline keeps cached values and does not refetch")
        XCTAssertTrue(holder.projection?.hasLiveState ?? false)
    }

    func testRefreshAndStopDelegateToSource() {
        let source = RecordingVHCSource()
        let holder = model(source: source)
        holder.start()
        holder.refresh()
        holder.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class VehicleHeroCardViewTests: XCTestCase {
    private func model(_ snapshot: VehicleHeroCardSnapshot) -> VehicleHeroCardModel {
        let holder = VehicleHeroCardModel(
            source: InMemoryVehicleHeroCardSource(snapshot: snapshot),
            telemetry: SpyVHCTelemetry()
        )
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(
            vehicle: VHCTestData.vehicle,
            liveState: VHCTestData.state(),
            photoURL: URL(string: "https://teslasync.local/p.jpg")
        )))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, liveState: nil)))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(vehicle: nil, isLoading: true)))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(vehicle: nil)))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(vehicle: nil, errorMessage: "x")))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(
            vehicle: VHCTestData.vehicle, liveState: VHCTestData.state(), connection: .stale
        )))
        _ = VehicleHeroCard(model: model(VehicleHeroCardSnapshot(
            vehicle: VHCTestData.vehicle, liveState: VHCTestData.state(), connection: .offline
        )))
        XCTAssertEqual(VehicleHeroCard.surfaceSlug, "VehicleHeroCard")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryVehicleHeroCardSource(
            snapshot: VehicleHeroCardSnapshot(vehicle: VHCTestData.vehicle, liveState: VHCTestData.state())
        )
        _ = VehicleHeroCard(source: source, onNavigate: { _ in }, telemetry: SpyVHCTelemetry())
    }

    func testSubviewsBuild() throws {
        let projection = VehicleHeroCardProjector.projection(
            vehicle: VHCTestData.vehicle,
            liveState: VHCTestData.state(),
            prefs: .imperial,
            hasPhoto: true,
            copy: VehicleHeroCardStrings.makeCopy { _, fallback in fallback }
        )
        _ = VehicleHeroCardHeader(identity: projection.identity)
        _ = VehicleHeroCardStatusBadge(status: projection.identity.status)
        _ = VehicleHeroCardModelBadge(model: projection.identity.model)
        _ = VehicleHeroCardGaugeFlow(gauges: projection.gauges)
        _ = VehicleHeroCardGaugeView(gauge: projection.gauges[0])
        _ = VehicleHeroCardStatGrid(stats: projection.stats)
        _ = VehicleHeroCardStatCell(stat: projection.stats[0])
        _ = VehicleHeroCardActionBar(vehicleID: 7, onNavigate: { _ in })
        _ = VehicleHeroCardNoLiveData()
        _ = VehicleHeroCardLoading()
        _ = VehicleHeroCardEmpty()
        _ = VehicleHeroCardErrorTile(message: "boom", onRetry: {})
        _ = try VehicleHeroCardPhoto(
            url: XCTUnwrap(URL(string: "https://teslasync.local/p.jpg")),
            alt: "Lightning photo"
        )
        for connection in VehicleHeroCardConnection.allCases {
            _ = VehicleHeroCardFreshnessChip(connection: connection, onRefresh: {})
            _ = VehicleHeroCardConnectivityBanner(connection: connection, onRefresh: {})
        }
        _ = VehicleHeroCardRefreshButton(onRefresh: {})
    }
}

// MARK: - Strings facade (P1/S10)

final class VehicleHeroCardStringsTests: XCTestCase {
    func testWebSourceKeysResolve() {
        XCTAssertEqual(VehicleHeroCardStrings.table, "VehicleHeroCard")
        XCTAssertEqual(VehicleHeroCardStrings.gaugeBattery, "Battery")
        XCTAssertEqual(VehicleHeroCardStrings.gaugeRange, "Range")
        XCTAssertEqual(VehicleHeroCardStrings.statInsideTemp, "Inside Temp")
        XCTAssertEqual(VehicleHeroCardStrings.statOdometer, "Odometer")
        XCTAssertEqual(VehicleHeroCardStrings.statFirmware, "Firmware")
        XCTAssertEqual(VehicleHeroCardStrings.statPower, "Power")
        XCTAssertEqual(VehicleHeroCardStrings.locked, "Locked")
        XCTAssertEqual(VehicleHeroCardStrings.unlocked, "Unlocked")
        XCTAssertEqual(VehicleHeroCardStrings.on, "On")
        XCTAssertEqual(VehicleHeroCardStrings.off, "Off")
    }

    func testActionKeysResolve() {
        XCTAssertEqual(VehicleHeroCardStrings.actionDetails, "Details")
        XCTAssertEqual(VehicleHeroCardStrings.actionCommands, "Commands")
        XCTAssertEqual(VehicleHeroCardStrings.actionLiveMap, "Live Map")
    }

    func testPhotoAltInterpolatesName() {
        XCTAssertEqual(VehicleHeroCardStrings.photoAlt("Lightning"), "Lightning photo")
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(VehicleHeroCardStrings.loadingA11y, "Loading vehicle")
        XCTAssertEqual(VehicleHeroCardStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(VehicleHeroCardStrings.offlineA11y, "Offline — showing the last value")
        XCTAssertFalse(VehicleHeroCardStrings.errorTitle.isEmpty)
        XCTAssertFalse(VehicleHeroCardStrings.retry.isEmpty)
        XCTAssertFalse(VehicleHeroCardStrings.noLiveDataTitle.isEmpty)
    }

    func testMakeCopyBuildsLabelsFromResolver() {
        let copy = VehicleHeroCardStrings.makeCopy { _, fallback in fallback }
        XCTAssertEqual(copy.gaugeBattery, "Battery")
        XCTAssertEqual(copy.statStatus, "Status")
        XCTAssertEqual(copy.photoAlt("Garage"), "Garage photo")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyVHCTelemetry: VehicleHeroCardTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var storage: [String] = []

    var surfaces: [String] {
        lock.lock()
        defer { lock.unlock() }
        return storage
    }

    func viewOpened(surface: String) {
        lock.lock()
        storage.append(surface)
        lock.unlock()
    }
}

/// Records the routes the model forwards through the host `onNavigate` (the `@MainActor` navigation seam).
@MainActor
private final class NavRecorder {
    private(set) var routes: [VehicleHeroCardRoute] = []

    func record(_ route: VehicleHeroCardRoute) {
        routes.append(route)
    }
}

/// A controllable source: counts start / stop / refresh and emits snapshots only when the test asks, so the
/// stale-auto-refresh-once contract is asserted deterministically (it never re-emits on `refresh()`).
@MainActor
private final class RecordingVHCSource: VehicleHeroCardSource {
    var onUpdate: (@MainActor (VehicleHeroCardSnapshot) -> Void)?
    private(set) var startCount = 0
    private(set) var stopCount = 0
    private(set) var refreshCount = 0

    func start() {
        startCount += 1
    }

    func stop() {
        stopCount += 1
    }

    func refresh() {
        refreshCount += 1
    }

    func emit(_ snapshot: VehicleHeroCardSnapshot) {
        onUpdate?(snapshot)
    }
}
