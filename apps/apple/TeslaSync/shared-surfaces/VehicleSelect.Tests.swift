//
//  VehicleSelect.Tests.swift
//  TeslaSync — P4 shared surface · 0164 · VehicleSelect (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in VehicleSelect.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • VehicleSelectModel — the once-only `view.opened`, snapshot ingestion → phase (loading / content /
//      empty / error), the projection + selected-name derivation, the `onSelect` routing (web `onChange` →
//      `setVehicleId`, incl. clear-to-nil), and the freshness axis (stale auto-refreshes ONCE, resets after
//      live; offline + live do NOT refetch).
//    • Views — the public surface composes in every phase (content / loading / empty / error), with the
//      icon-prefixed variant, the injected-model + source initializers, and every subview + freshness chip.
//    • Strings — the web `vehicleSelect.aria` key, the interpolated `Vehicle {id}` fallback, and the native
//      a11y labels all resolve through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - VehicleSelectModel (state + routing)

@MainActor
final class VehicleSelectModelTests: XCTestCase {
    private func fleet(_ count: Int) -> [VehicleSelectVehicle] {
        (1 ... count).map { VehicleSelectVehicle(id: $0, displayName: "Car \($0)") }
    }

    private func model(
        source: VehicleSelectSource,
        onSelect: @escaping @MainActor (Int?) -> Void = { _ in },
        telemetry: VehicleSelectTelemetry = OSLogVehicleSelectTelemetry()
    ) -> VehicleSelectModel {
        VehicleSelectModel(source: source, onSelect: onSelect, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehicleSelectSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleSelectSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehicleSelectSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleSelectSurface.slug], "view.opened fires once per instance")
    }

    func testIngestLoadingSnapshotYieldsLoadingPhase() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: [], isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
    }

    func testIngestLoadedFleetYieldsContentPhase() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: fleet(2), selectedId: 1))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertEqual(holder.projection.options.count, 2)
        XCTAssertEqual(holder.projection.selectedValue, "1")
        XCTAssertEqual(holder.selectedVehicleName, "Car 1")
    }

    func testIngestEmptyFleetYieldsEmptyPhase() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: [], selectedId: nil))
        XCTAssertEqual(holder.phase, .empty, "web returns null for an empty fleet → native empty state")
        XCTAssertNil(holder.selectedVehicleName)
    }

    func testIngestErrorSnapshotYieldsErrorPhase() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: [], errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testSelectByValueRoutesParsedIdToOnSelect() {
        let recorder = SelectRecorder()
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source, onSelect: { recorder.record($0) })
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: fleet(3), selectedId: 1))
        holder.select(value: "2")
        XCTAssertEqual(recorder.ids, [2])
    }

    func testSelectByBlankValueClearsSelection() {
        let recorder = SelectRecorder()
        let holder = model(source: RecordingVehicleSelectSource(), onSelect: { recorder.record($0) })
        holder.select(value: "")
        holder.select(value: "0")
        XCTAssertEqual(recorder.ids, [nil, nil], "blank / non-positive clears (web setVehicleId(null))")
    }

    func testSelectByIdPassesThrough() {
        let recorder = SelectRecorder()
        let holder = model(source: RecordingVehicleSelectSource(), onSelect: { recorder.record($0) })
        holder.select(id: 9)
        holder.select(id: nil)
        XCTAssertEqual(recorder.ids, [9, nil])
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "first stale read auto-refreshes once")
        source.emit(VehicleSelectSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "a still-stale read does not re-refresh")
        source.emit(VehicleSelectSnapshot(vehicles: fleet(1), selectedId: 1, connection: .live))
        source.emit(VehicleSelectSnapshot(vehicles: fleet(1), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a fresh stale episode after live re-triggers exactly once")
    }

    func testOfflineDoesNotRefetch() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleSelectSnapshot(vehicles: fleet(1), selectedId: 1, connection: .offline))
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline keeps the cached fleet and does not refetch")
    }

    func testRefreshDelegatesToSource() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesToSource() {
        let source = RecordingVehicleSelectSource()
        let holder = model(source: source)
        holder.start()
        holder.stop()
        XCTAssertEqual(source.stopCount, 1)
    }

    func testAriaLabelDefaultResolves() {
        let holder = model(source: RecordingVehicleSelectSource())
        XCTAssertEqual(holder.ariaLabel, "Select vehicle")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class VehicleSelectViewTests: XCTestCase {
    private func model(_ snapshot: VehicleSelectSnapshot) -> VehicleSelectModel {
        let holder = VehicleSelectModel(
            source: InMemoryVehicleSelectSource(snapshot: snapshot),
            telemetry: SpyTelemetry()
        )
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        let fleet = [
            VehicleSelectVehicle(id: 1, displayName: "A"),
            VehicleSelectVehicle(id: 2, displayName: nil, vin: "VIN2")
        ]
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: fleet, selectedId: 1)))
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: fleet, selectedId: 2)), withIcon: true)
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: [], isLoading: true)))
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: [], selectedId: nil)))
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: [], errorMessage: "x")))
        _ = VehicleSelect(model: model(VehicleSelectSnapshot(vehicles: fleet, selectedId: 1, connection: .stale)))
        _ = VehicleSelect(
            model: model(VehicleSelectSnapshot(vehicles: fleet, selectedId: 1, connection: .offline)),
            ariaLabel: "Pick a car"
        )
        XCTAssertEqual(VehicleSelect.surfaceSlug, "VehicleSelect")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryVehicleSelectSource(
            snapshot: VehicleSelectSnapshot(vehicles: [VehicleSelectVehicle(id: 1, displayName: "A")], selectedId: 1)
        )
        _ = VehicleSelect(source: source, onSelect: { _ in }, withIcon: true, telemetry: SpyTelemetry())
    }

    func testSubviewsBuild() {
        let projection = VehicleSelectProjector.projection(
            vehicles: [VehicleSelectVehicle(id: 1, displayName: "A")],
            selectedId: 1,
            fallbackName: { "Vehicle \($0)" }
        )
        _ = VehicleSelectControl(
            projection: projection,
            ariaLabel: "Select vehicle",
            selectedName: "A",
            withIcon: true,
            onSelect: { _ in }
        )
        _ = VehicleSelectLoadingView(label: VehicleSelectStrings.loadingA11y)
        _ = VehicleSelectEmptyView(title: VehicleSelectStrings.emptyTitle, message: VehicleSelectStrings.emptyMessage)
        _ = VehicleSelectErrorView(
            title: VehicleSelectStrings.errorTitle,
            message: "boom",
            retryLabel: VehicleSelectStrings.retry,
            onRetry: {}
        )
        for connection in VehicleSelectConnection.allCases {
            _ = VehicleSelectFreshnessChip(connection: connection, onRefresh: {})
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class VehicleSelectStringsTests: XCTestCase {
    func testWebKeyAndFallbacksResolve() {
        XCTAssertEqual(VehicleSelectStrings.table, "VehicleSelect")
        XCTAssertEqual(VehicleSelectStrings.aria, "Select vehicle")
        XCTAssertEqual(VehicleSelectStrings.fallbackName(42), "Vehicle 42", "interpolates the id into {{id}}")
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(VehicleSelectStrings.loadingA11y, "Loading vehicles")
        XCTAssertEqual(VehicleSelectStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(VehicleSelectStrings.offlineA11y, "Offline — showing the last fleet")
        XCTAssertFalse(VehicleSelectStrings.errorTitle.isEmpty)
        XCTAssertFalse(VehicleSelectStrings.emptyTitle.isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: VehicleSelectTelemetry, @unchecked Sendable {
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
    private(set) var ids: [Int?] = []

    func record(_ id: Int?) {
        ids.append(id)
    }
}

/// A controllable source: counts start / stop / refresh and emits snapshots only when the test asks, so the
/// stale-auto-refresh-once contract is asserted deterministically (it never re-emits on `refresh()`).
@MainActor
private final class RecordingVehicleSelectSource: VehicleSelectSource {
    var onUpdate: (@MainActor (VehicleSelectSnapshot) -> Void)?
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

    func emit(_ snapshot: VehicleSelectSnapshot) {
        onUpdate?(snapshot)
    }
}
