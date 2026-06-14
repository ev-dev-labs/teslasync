//
//  VehiclePicker.Tests.swift
//  TeslaSync — P4 shared surface · 0183 · VehiclePicker (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in VehiclePicker.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • VehiclePickerModel — the once-only `view.opened`, snapshot ingestion → phase (loading / content /
//      empty / error), the projection (pin-aware ordering + pickable derivation), the `select(id:)` routing
//      (web `onChange` → `setVehicleId`), and the freshness axis (stale auto-refreshes ONCE, resets after
//      live; offline + live do NOT refetch).
//    • Views — the public surface composes in every phase, the injected-model + source initializers, and
//      every subview + freshness chip.
//    • Strings — the web `vehiclePicker.aria` key, the interpolated `Vehicle {id}` fallback, and the native
//      a11y labels all resolve through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - VehiclePickerModel (state + routing)

@MainActor
final class VehiclePickerModelTests: XCTestCase {
    private func fleet(_ count: Int) -> [VehiclePickerVehicle] {
        (1 ... count).map { VehiclePickerVehicle(id: $0, displayName: "Car \($0)") }
    }

    private func model(
        source: VehiclePickerSource,
        onSelect: @escaping @MainActor (Int) -> Void = { _ in },
        telemetry: VehiclePickerTelemetry = OSLogVehiclePickerTelemetry()
    ) -> VehiclePickerModel {
        VehiclePickerModel(source: source, onSelect: onSelect, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehiclePickerSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehiclePickerSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehiclePickerSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehiclePickerSurface.slug], "view.opened fires once per instance")
    }

    func testIngestLoadingSnapshotYieldsLoadingPhase() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: [], isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
    }

    func testIngestSingleVehicleFleetYieldsNonPickableContent() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: fleet(1), selectedId: 1))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertFalse(holder.projection.isPickable)
        XCTAssertEqual(holder.projection.selectedLabel, "Car 1")
    }

    func testIngestMultiVehicleFleetYieldsPickableContentInPinOrder() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(
            vehicles: fleet(3),
            pins: [VehiclePickerPin(itemId: "3", position: 0)],
            selectedId: 2
        ))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertTrue(holder.projection.isPickable)
        XCTAssertEqual(holder.projection.options.map(\.id), [3, 1, 2], "pinned #3 floats to the top")
        XCTAssertEqual(holder.projection.selectedLabel, "Car 2")
    }

    func testIngestEmptyFleetYieldsEmptyPhase() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: [], selectedId: nil))
        XCTAssertEqual(holder.phase, .empty, "web returns null for an empty fleet → native empty state")
    }

    func testIngestErrorSnapshotYieldsErrorPhase() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: [], errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testSelectByIdRoutesToOnSelect() {
        let recorder = SelectRecorder()
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source, onSelect: { recorder.record($0) })
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: fleet(3), selectedId: 1))
        holder.select(id: 3)
        XCTAssertEqual(recorder.ids, [3])
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: fleet(2), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "first stale read auto-refreshes once")
        source.emit(VehiclePickerSnapshot(vehicles: fleet(2), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "a still-stale read does not re-refresh")
        source.emit(VehiclePickerSnapshot(vehicles: fleet(2), selectedId: 1, connection: .live))
        source.emit(VehiclePickerSnapshot(vehicles: fleet(2), selectedId: 1, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a fresh stale episode after live re-triggers exactly once")
    }

    func testOfflineDoesNotRefetch() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehiclePickerSnapshot(vehicles: fleet(2), selectedId: 1, connection: .offline))
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline keeps the cached value and does not refetch")
    }

    func testRefreshDelegatesToSource() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesToSource() {
        let source = RecordingVehiclePickerSource()
        let holder = model(source: source)
        holder.start()
        holder.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class VehiclePickerViewTests: XCTestCase {
    private func model(_ snapshot: VehiclePickerSnapshot) -> VehiclePickerModel {
        let holder = VehiclePickerModel(
            source: InMemoryVehiclePickerSource(snapshot: snapshot),
            telemetry: SpyTelemetry()
        )
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        let fleet = [
            VehiclePickerVehicle(id: 1, displayName: "A"),
            VehiclePickerVehicle(id: 2, displayName: nil, vin: "VIN2")
        ]
        let pins = [VehiclePickerPin(itemId: "2", position: 0)]
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: [fleet[0]], selectedId: 1)))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: fleet, pins: pins, selectedId: 2)))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: [], isLoading: true)))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: [], selectedId: nil)))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: [], errorMessage: "x")))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: fleet, selectedId: 1, connection: .stale)))
        _ = VehiclePicker(model: model(VehiclePickerSnapshot(vehicles: fleet, selectedId: 1, connection: .offline)))
        XCTAssertEqual(VehiclePicker.surfaceSlug, "VehiclePicker")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryVehiclePickerSource(
            snapshot: VehiclePickerSnapshot(
                vehicles: [VehiclePickerVehicle(id: 1, displayName: "A")],
                selectedId: 1
            )
        )
        _ = VehiclePicker(source: source, onSelect: { _ in }, telemetry: SpyTelemetry())
    }

    func testSubviewsBuild() {
        let projection = VehiclePickerProjector.projection(
            vehicles: [
                VehiclePickerVehicle(id: 1, displayName: "A"),
                VehiclePickerVehicle(id: 2, displayName: "B")
            ],
            pins: [VehiclePickerPin(itemId: "2", position: 0)],
            selectedId: 1,
            copy: VehiclePickerCopy(fallbackName: { "Vehicle \($0)" }, placeholder: "Select vehicle") // parity:allow ui
        )
        _ = VehiclePickerChipContent(label: projection.selectedLabel, isPinned: false, showsChevron: true)
        _ = VehiclePickerStaticChip(projection: projection)
        _ = VehiclePickerMenu(projection: projection, onSelect: { _ in })
        _ = VehiclePickerLoadingChip()
        _ = VehiclePickerEmptyChip()
        _ = VehiclePickerErrorChip(message: "boom", onRetry: {})
        for connection in VehiclePickerConnection.allCases {
            _ = VehiclePickerFreshnessChip(connection: connection, onRefresh: {})
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class VehiclePickerStringsTests: XCTestCase {
    func testWebSourceKeyResolves() {
        XCTAssertEqual(VehiclePickerStrings.table, "VehiclePicker")
        XCTAssertEqual(VehiclePickerStrings.aria, "Select vehicle", "web `t('vehiclePicker.aria', 'Select vehicle')`")
    }

    func testFallbackNameInterpolatesId() {
        XCTAssertEqual(VehiclePickerStrings.fallbackName(42), "Vehicle 42")
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(VehiclePickerStrings.loadingA11y, "Loading vehicles")
        XCTAssertEqual(VehiclePickerStrings.emptyTitle, "No vehicles")
        XCTAssertEqual(VehiclePickerStrings.pinnedA11y, "Pinned")
        XCTAssertEqual(VehiclePickerStrings.selectedA11y, "Selected")
        XCTAssertEqual(VehiclePickerStrings.staleA11y, "Stale — tap to refresh")
        XCTAssertEqual(VehiclePickerStrings.offlineA11y, "Offline — showing the last value")
        XCTAssertFalse(VehiclePickerStrings.errorTitle.isEmpty)
        XCTAssertFalse(VehiclePickerStrings.retry.isEmpty)
        XCTAssertFalse(VehiclePickerStrings.placeholder.isEmpty) // parity:allow ui
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: VehiclePickerTelemetry, @unchecked Sendable {
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
private final class RecordingVehiclePickerSource: VehiclePickerSource {
    var onUpdate: (@MainActor (VehiclePickerSnapshot) -> Void)?
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

    func emit(_ snapshot: VehiclePickerSnapshot) {
        onUpdate?(snapshot)
    }
}
