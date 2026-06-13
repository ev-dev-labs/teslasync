//
//  ActiveVehicleSegment.Tests.swift
//  TeslaSync — P4 shared surface · 0176 · ActiveVehicleSegment (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in ActiveVehicleSegment.AdapterTests.swift; split to keep each file within the SwiftLint file-length
//  budget):
//    • ActiveVehicleSegmentModel — the once-only `view.opened`, snapshot ingestion → phase (loading /
//      content / empty / error), the projection (metrics + switchable derivation), the `select(id:)` routing
//      (web `pick` → `setVehicleId`), and the freshness axis (stale auto-refreshes ONCE, resets after live;
//      offline + live do NOT refetch).
//    • Views — the public surface composes in every phase + the icon-only variant, the injected-model +
//      source initializers, and every subview + freshness chip.
//    • Strings — the web `statusBar.vehicle.*` keys, the interpolated `Vehicle {id}` fallback, and the native
//      a11y labels all resolve through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - ActiveVehicleSegmentModel (state + routing)

@MainActor
final class ActiveVehicleSegmentModelTests: XCTestCase {
    private func fleet(_ count: Int) -> [ActiveVehicleSegmentVehicle] {
        (1 ... count).map { ActiveVehicleSegmentVehicle(id: $0, displayName: "Car \($0)") }
    }

    private func model(
        source: ActiveVehicleSegmentSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        telemetry: ActiveVehicleSegmentTelemetry = OSLogActiveVehicleSegmentTelemetry()
    ) -> ActiveVehicleSegmentModel {
        ActiveVehicleSegmentModel(source: source, onSelect: onSelect, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingActiveVehicleSegmentSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ActiveVehicleSegmentSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingActiveVehicleSegmentSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [ActiveVehicleSegmentSurface.slug], "view.opened fires once per instance")
    }

    func testIngestLoadingSnapshotYieldsLoadingPhase() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: [], isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
    }

    func testIngestSingleVehicleFleetYieldsNonSwitchableContent() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertFalse(holder.projection.isSwitchable)
        XCTAssertEqual(holder.projection.label, "Car 1")
    }

    func testIngestMultiVehicleFleetYieldsSwitchableContentWithMetrics() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(
            vehicles: fleet(2),
            selectedId: 2,
            metrics: ActiveVehicleSegmentMetrics(present: true, batteryLevel: 80, ratedRangeMeters: 480_000),
            distanceUnit: "km"
        ))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertTrue(holder.projection.isSwitchable)
        XCTAssertEqual(holder.projection.label, "Car 2")
        XCTAssertEqual(holder.projection.metricsLabel, "80% · 480 km")
        XCTAssertEqual(holder.projection.options.count, 2)
    }

    func testIngestEmptyFleetYieldsEmptyPhase() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: [], selectedId: nil))
        XCTAssertEqual(holder.phase, .empty, "web returns null for an empty fleet → native empty state")
    }

    func testIngestErrorSnapshotYieldsErrorPhase() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: [], errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testSelectByIdRoutesToOnSelect() {
        let recorder = SelectRecorder()
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source, onSelect: { recorder.record($0) })
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(3), selectedId: 1))
        holder.select(id: 3)
        XCTAssertEqual(recorder.ids, [3])
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "first stale read auto-refreshes once")
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "a still-stale read does not re-refresh")
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1, connection: .live))
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a fresh stale episode after live re-triggers exactly once")
    }

    func testOfflineDoesNotRefetch() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        source.emit(ActiveVehicleSegmentSnapshot(vehicles: fleet(1), selectedId: 1, connection: .offline))
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline keeps the cached value and does not refetch")
    }

    func testRefreshDelegatesToSource() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesToSource() {
        let source = RecordingActiveVehicleSegmentSource()
        let holder = model(source: source)
        holder.start()
        holder.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class ActiveVehicleSegmentViewTests: XCTestCase {
    private func model(_ snapshot: ActiveVehicleSegmentSnapshot) -> ActiveVehicleSegmentModel {
        let holder = ActiveVehicleSegmentModel(
            source: InMemoryActiveVehicleSegmentSource(snapshot: snapshot),
            telemetry: SpyTelemetry()
        )
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        let fleet = [
            ActiveVehicleSegmentVehicle(id: 1, displayName: "A", model: "Model 3"),
            ActiveVehicleSegmentVehicle(id: 2, displayName: nil, vin: "VIN2")
        ]
        let metrics = ActiveVehicleSegmentMetrics(present: true, batteryLevel: 60, ratedRangeMeters: 320_000)
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(
            vehicles: [fleet[0]], selectedId: 1, metrics: metrics
        )))
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(
            vehicles: fleet, selectedId: 2, metrics: metrics
        )))
        _ = ActiveVehicleSegment(
            model: model(ActiveVehicleSegmentSnapshot(vehicles: fleet, selectedId: 1)),
            iconOnly: true
        )
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(vehicles: [], isLoading: true)))
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(vehicles: [], selectedId: nil)))
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(vehicles: [], errorMessage: "x")))
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(
            vehicles: fleet, selectedId: 1, connection: .stale
        )))
        _ = ActiveVehicleSegment(model: model(ActiveVehicleSegmentSnapshot(
            vehicles: fleet, selectedId: 1, connection: .offline
        )))
        XCTAssertEqual(ActiveVehicleSegment.surfaceSlug, "ActiveVehicleSegment")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryActiveVehicleSegmentSource(
            snapshot: ActiveVehicleSegmentSnapshot(
                vehicles: [ActiveVehicleSegmentVehicle(id: 1, displayName: "A")],
                selectedId: 1
            )
        )
        _ = ActiveVehicleSegment(source: source, onSelect: { _ in }, iconOnly: true, telemetry: SpyTelemetry())
    }

    func testSubviewsBuild() {
        let projection = ActiveVehicleSegmentProjector.projection(
            vehicles: [
                ActiveVehicleSegmentVehicle(id: 1, displayName: "A", model: "Model 3"),
                ActiveVehicleSegmentVehicle(id: 2, displayName: "B")
            ],
            selectedId: 1,
            metrics: ActiveVehicleSegmentMetrics(present: true, batteryLevel: 72, ratedRangeMeters: 418_400),
            distanceUnit: "mi",
            copy: ActiveVehicleSegmentCopy(
                fallbackName: { "Vehicle \($0)" },
                noneLabel: { "No vehicle" },
                activeVehicleText: "Active vehicle"
            )
        )
        _ = ActiveVehicleSegmentChipContent(
            label: projection.label,
            metricsLabel: projection.metricsLabel,
            iconOnly: false,
            showsChevron: true
        )
        _ = ActiveVehicleSegmentStaticChip(projection: projection, iconOnly: false)
        _ = ActiveVehicleSegmentSwitcher(projection: projection, iconOnly: false, onSelect: { _ in })
        _ = ActiveVehicleSegmentLoadingChip(iconOnly: true)
        _ = ActiveVehicleSegmentEmptyChip(iconOnly: false)
        _ = ActiveVehicleSegmentErrorChip(message: "boom", iconOnly: false, onRetry: {})
        for connection in ActiveVehicleSegmentConnection.allCases {
            _ = ActiveVehicleSegmentFreshnessChip(connection: connection, onRefresh: {})
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class ActiveVehicleSegmentStringsTests: XCTestCase {
    func testWebSourceKeysResolve() {
        XCTAssertEqual(ActiveVehicleSegmentStrings.table, "ActiveVehicleSegment")
        XCTAssertEqual(ActiveVehicleSegmentStrings.fallbackName(42), "Vehicle 42", "interpolates the id")
        XCTAssertEqual(ActiveVehicleSegmentStrings.none, "No vehicle")
        XCTAssertEqual(ActiveVehicleSegmentStrings.tooltipPrefix, "Active vehicle")
        XCTAssertEqual(ActiveVehicleSegmentStrings.menuLabel, "Active vehicle")
    }

    func testWebAccessibleNamesCompose() {
        XCTAssertEqual(ActiveVehicleSegmentStrings.activeVehicleAria(label: "Lightning"), "Active vehicle: Lightning")
        XCTAssertEqual(
            ActiveVehicleSegmentStrings.switchVehicleAria(label: "Lightning"),
            "Switch vehicle (Lightning)"
        )
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(ActiveVehicleSegmentStrings.loadingA11y, "Loading vehicles")
        XCTAssertEqual(ActiveVehicleSegmentStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(ActiveVehicleSegmentStrings.offlineA11y, "Offline — showing the last value")
        XCTAssertEqual(ActiveVehicleSegmentStrings.selectedA11y, "Selected")
        XCTAssertFalse(ActiveVehicleSegmentStrings.errorTitle.isEmpty)
        XCTAssertFalse(ActiveVehicleSegmentStrings.retry.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: ActiveVehicleSegmentTelemetry, @unchecked Sendable {
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

/// Records the ids the model routes through the host `onSelect` (the `@MainActor` selection seam).
@MainActor
private final class SelectRecorder {
    private(set) var ids: [Int] = []

    func record(_ id: Int) {
        ids.append(id)
    }
}

/// A controllable source: counts start / stop / refresh and emits snapshots only when the test asks, so the
/// stale-auto-refresh-once contract is asserted deterministically (it never re-emits on `refresh()`).
@MainActor
private final class RecordingActiveVehicleSegmentSource: ActiveVehicleSegmentSource {
    var onUpdate: (@MainActor (ActiveVehicleSegmentSnapshot) -> Void)?
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

    func emit(_ snapshot: ActiveVehicleSegmentSnapshot) {
        onUpdate?(snapshot)
    }
}
