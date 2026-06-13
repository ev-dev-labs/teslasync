//
//  VehicleMultiSelect.Tests.swift
//  TeslaSync — P4 shared surface · 0163 · VehicleMultiSelect (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types live
//  in VehicleMultiSelect.AdapterTests.swift; split to keep each file within the SwiftLint file-length budget):
//    • VehicleMultiSelectModel — the once-only `view.opened`, snapshot ingestion → phase (loading / content /
//      empty / error), the projection + summary derivation, the All-sentinel / per-vehicle toggle routing (web
//      `onChange`, incl. the D13 toggle-OFF restore), the validation-error resolution, the trigger-enabled +
//      popover-open rules, and the freshness axis (stale auto-refreshes ONCE, resets after live; offline does
//      NOT refetch).
//    • Views — the public surface composes in every phase (content / loading / empty / error), with the
//      injected-model + source initializers, and every subview + freshness chip.
//    • Strings — the nine web `vehicles*` keys, the interpolated summaries / unknown / fleet-fallback labels,
//      and the native a11y labels all resolve through the P1/S10 facade with the English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - VehicleMultiSelectModel (state + routing)

@MainActor
final class VehicleMultiSelectModelTests: XCTestCase {
    private func fleet(_ count: Int) -> [VehicleMultiSelectVehicle] {
        (1 ... count).map { VehicleMultiSelectVehicle(id: $0, displayName: "Car \($0)", model: "Model \($0)") }
    }

    private func model(
        source: VehicleMultiSelectSource,
        onChange: @escaping @MainActor (VehicleMultiSelectValue) -> Void = { _ in },
        telemetry: VehicleMultiSelectTelemetry = OSLogVehicleMultiSelectTelemetry()
    ) -> VehicleMultiSelectModel {
        VehicleMultiSelectModel(source: source, onChange: onChange, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehicleMultiSelectSource(), telemetry: spy)
        holder.start()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleMultiSelectSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyTelemetry()
        let holder = model(source: RecordingVehicleMultiSelectSource(), telemetry: spy)
        holder.start()
        holder.stop()
        holder.start()
        XCTAssertEqual(spy.surfaces, [VehicleMultiSelectSurface.slug], "view.opened fires once per instance")
    }

    func testIngestLoadingYieldsLoadingPhase() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: [], isLoading: true))
        XCTAssertEqual(holder.phase, .loading)
        XCTAssertFalse(holder.isTriggerEnabled)
    }

    func testIngestLoadedFleetYieldsContentPhaseAndProjection() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([2])))
        XCTAssertEqual(holder.phase, .content)
        XCTAssertEqual(holder.projection.rows.count, 3)
        XCTAssertEqual(holder.summaryText, "Car 2")
        XCTAssertTrue(holder.isTriggerEnabled)
    }

    func testIngestEmptyFleetYieldsEmptyPhaseAndClosesPopover() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(2)))
        holder.setOpen(true)
        XCTAssertTrue(holder.isOpen)
        source.emit(VehicleMultiSelectSnapshot(vehicles: []))
        XCTAssertEqual(holder.phase, .empty, "web disables the trigger for an empty fleet → native empty phase")
        XCTAssertFalse(holder.isOpen, "an empty fleet closes the popover")
        XCTAssertFalse(holder.isTriggerEnabled)
    }

    func testIngestErrorYieldsErrorPhase() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: [], errorMessage: "boom"))
        XCTAssertEqual(holder.phase, .error("boom"))
    }

    func testToggleVehicleFromSentinelRoutesFreshSubset() {
        let recorder = ChangeRecorder()
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source, onChange: { recorder.record($0) })
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .allSticky))
        holder.toggleVehicle(id: 2)
        XCTAssertEqual(recorder.values, [.specific([2])], "web: toggling a vehicle off all_sticky → specific[id]")
    }

    func testToggleVehicleAddsThenRemoves() {
        let recorder = ChangeRecorder()
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source, onChange: { recorder.record($0) })
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([1])))
        holder.toggleVehicle(id: 3)
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([1, 3])))
        holder.toggleVehicle(id: 1)
        XCTAssertEqual(recorder.values, [.specific([1, 3]), .specific([3])])
    }

    func testToggleAllRoutesAndRestoresPreviousSubsetD13() {
        let recorder = ChangeRecorder()
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source, onChange: { recorder.record($0) })
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([1, 3])))
        holder.toggleAll()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .allSticky))
        holder.toggleAll()
        XCTAssertEqual(
            recorder.values,
            [.allSticky, .specific([1, 3])],
            "toggle ON → all_sticky (remembers [1,3]); toggle OFF → restores [1,3] (D13)"
        )
    }

    func testErrorKeyResolvesInlineErrorText() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        XCTAssertFalse(holder.hasError)
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), errorKey: "alerts.vehiclesRequired"))
        XCTAssertTrue(holder.hasError)
        XCTAssertEqual(holder.errorText, "alerts.vehiclesRequired", "test bundle echoes the key as its fallback")
    }

    func testTriggerDisabledRespectsDisabledProp() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(2), disabled: true))
        XCTAssertFalse(holder.isTriggerEnabled)
        holder.toggleOpen()
        XCTAssertFalse(holder.isOpen, "a disabled trigger never opens the popover")
    }

    func testToggleOpenAndSetOpenWhenEnabled() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(2)))
        holder.toggleOpen()
        XCTAssertTrue(holder.isOpen)
        holder.toggleOpen()
        XCTAssertFalse(holder.isOpen)
        holder.setOpen(true)
        XCTAssertTrue(holder.isOpen)
    }

    func testStaleAutoRefreshesOnceThenResetsAfterLive() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), value: .specific([1]), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "first stale read auto-refreshes once")
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), value: .specific([1]), connection: .stale))
        XCTAssertEqual(source.refreshCount, 1, "a still-stale read does not re-refresh")
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), value: .specific([1]), connection: .live))
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), value: .specific([1]), connection: .stale))
        XCTAssertEqual(source.refreshCount, 2, "a fresh stale episode after live re-triggers exactly once")
    }

    func testOfflineDoesNotRefetch() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(1), connection: .offline))
        XCTAssertEqual(holder.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0, "offline keeps the cached fleet and does not refetch")
    }

    func testRefreshAndStopDelegateToSource() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        holder.refresh()
        holder.stop()
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(source.stopCount, 1)
    }

    func testSummaryTextVariantsResolve() {
        let source = RecordingVehicleMultiSelectSource()
        let holder = model(source: source)
        holder.start()
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .allSticky))
        XCTAssertEqual(holder.summaryText, "All vehicles")
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([])))
        XCTAssertEqual(holder.summaryText, "No vehicles selected")
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([1, 2])))
        XCTAssertEqual(holder.summaryText, "2 of 3 vehicles")
        source.emit(VehicleMultiSelectSnapshot(vehicles: fleet(3), value: .specific([1, 2, 3])))
        XCTAssertEqual(holder.summaryText, "3 vehicles")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class VehicleMultiSelectViewTests: XCTestCase {
    private func model(_ snapshot: VehicleMultiSelectSnapshot) -> VehicleMultiSelectModel {
        let holder = VehicleMultiSelectModel(
            source: InMemoryVehicleMultiSelectSource(snapshot: snapshot),
            telemetry: SpyTelemetry()
        )
        holder.start()
        return holder
    }

    func testSurfaceComposesForEveryPhase() {
        let fleet = [
            VehicleMultiSelectVehicle(id: 1, displayName: "A", model: "M"),
            VehicleMultiSelectVehicle(id: 2, displayName: nil, model: "Model 3", vin: "5YJ0000000000002")
        ]
        _ = VehicleMultiSelect(model: model(VehicleMultiSelectSnapshot(vehicles: fleet, value: .allSticky)))
        _ = VehicleMultiSelect(model: model(VehicleMultiSelectSnapshot(vehicles: fleet, value: .specific([2, 99]))))
        _ = VehicleMultiSelect(model: model(VehicleMultiSelectSnapshot(vehicles: [], value: .allSticky)))
        _ = VehicleMultiSelect(model: model(VehicleMultiSelectSnapshot(vehicles: [], isLoading: true)))
        _ = VehicleMultiSelect(model: model(VehicleMultiSelectSnapshot(vehicles: [], errorMessage: "x")))
        _ = VehicleMultiSelect(model: model(
            VehicleMultiSelectSnapshot(vehicles: fleet, value: .specific([1]), connection: .stale)
        ))
        _ = VehicleMultiSelect(model: model(
            VehicleMultiSelectSnapshot(vehicles: fleet, errorKey: "alerts.required", connection: .offline)
        ))
        XCTAssertEqual(VehicleMultiSelect.surfaceSlug, "VehicleMultiSelect")
    }

    func testSurfaceComposesFromSourceInitializer() {
        let source = InMemoryVehicleMultiSelectSource(
            snapshot: VehicleMultiSelectSnapshot(
                vehicles: [VehicleMultiSelectVehicle(id: 1, displayName: "A")],
                value: .specific([1])
            )
        )
        _ = VehicleMultiSelect(source: source, onChange: { _ in }, telemetry: SpyTelemetry())
    }

    func testSubviewsBuild() {
        let holder = model(VehicleMultiSelectSnapshot(
            vehicles: [VehicleMultiSelectVehicle(id: 1, displayName: "A", model: "M")],
            value: .specific([1])
        ))
        _ = VehicleMultiSelectCheckBox(checked: true)
        _ = VehicleMultiSelectCheckBox(checked: false)
        _ = VehicleMultiSelectCheckRow(
            title: "All vehicles (current + future)",
            checked: true,
            emphasized: true,
            selectedValue: "Selected",
            notSelectedValue: "Not selected",
            action: {}
        )
        _ = VehicleMultiSelectCheckRow(
            title: "Vehicle #99",
            checked: true,
            muted: true,
            badge: "Unknown",
            selectedValue: "Selected",
            notSelectedValue: "Not selected",
            action: {}
        )
        _ = VehicleMultiSelectTrigger(model: holder)
        _ = VehicleMultiSelectPopover(model: holder)
        _ = VehicleMultiSelectEmptyHelp(message: VehicleMultiSelectStrings.emptyFleetHelp())
        _ = VehicleMultiSelectErrorText(message: "Required")
        _ = VehicleMultiSelectLoadingView(label: VehicleMultiSelectStrings.loadingA11y())
        _ = VehicleMultiSelectErrorTile(
            title: VehicleMultiSelectStrings.errorTitle(),
            message: "boom",
            retryLabel: VehicleMultiSelectStrings.retry(),
            onRetry: {}
        )
        for connection in VehicleMultiSelectConnection.allCases {
            _ = VehicleMultiSelectFreshnessChip(
                connection: connection,
                localize: VehicleMultiSelectStrings.string,
                onRefresh: {}
            )
        }
    }
}

// MARK: - Strings facade (P1/S10)

final class VehicleMultiSelectStringsTests: XCTestCase {
    func testTableAndWebKeysResolve() {
        XCTAssertEqual(VehicleMultiSelectStrings.table, "VehicleMultiSelect")
        XCTAssertEqual(VehicleMultiSelectStrings.summaryAll(), "All vehicles")
        XCTAssertEqual(VehicleMultiSelectStrings.summaryNone(), "No vehicles selected")
        XCTAssertEqual(VehicleMultiSelectStrings.allOption(), "All vehicles (current + future)")
        XCTAssertEqual(VehicleMultiSelectStrings.unknownBadge(), "Unknown")
        XCTAssertEqual(
            VehicleMultiSelectStrings.emptyFleetHelp(),
            "Add a vehicle in Settings → Vehicles to use this rule."
        )
    }

    func testInterpolatedKeys() {
        XCTAssertEqual(VehicleMultiSelectStrings.summaryOne(name: "Plaid"), "Plaid")
        XCTAssertEqual(VehicleMultiSelectStrings.summaryPartial(count: 2, total: 3), "2 of 3 vehicles")
        XCTAssertEqual(VehicleMultiSelectStrings.summaryCount(4), "4 vehicles")
        XCTAssertEqual(VehicleMultiSelectStrings.unknownLabel(id: 99), "Vehicle #99")
        XCTAssertEqual(VehicleMultiSelectStrings.fleetFallbackName(id: 7), "Vehicle #7")
    }

    func testNativeAccessibilityLabelsPresent() {
        XCTAssertEqual(VehicleMultiSelectStrings.loadingA11y(), "Loading vehicles")
        XCTAssertEqual(VehicleMultiSelectStrings.staleA11y(), "Stale — tap to refresh")
        XCTAssertEqual(VehicleMultiSelectStrings.offlineA11y(), "Offline — showing the last fleet")
        XCTAssertEqual(VehicleMultiSelectStrings.optionSelected(), "Selected")
        XCTAssertEqual(VehicleMultiSelectStrings.optionNotSelected(), "Not selected")
        XCTAssertFalse(VehicleMultiSelectStrings.popoverA11y().isEmpty)
        XCTAssertFalse(VehicleMultiSelectStrings.triggerA11yHint().isEmpty)
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under Swift 6
/// strict concurrency.
private final class SpyTelemetry: VehicleMultiSelectTelemetry, @unchecked Sendable {
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

/// Records the values the model routes through the host `onChange` (the `@MainActor` selection seam).
@MainActor
private final class ChangeRecorder {
    private(set) var values: [VehicleMultiSelectValue] = []

    func record(_ value: VehicleMultiSelectValue) {
        values.append(value)
    }
}

/// A controllable source: counts start / stop / refresh and emits snapshots only when the test asks, so the
/// stale-auto-refresh-once contract is asserted deterministically (it never re-emits on `refresh()`).
@MainActor
private final class RecordingVehicleMultiSelectSource: VehicleMultiSelectSource {
    var onUpdate: (@MainActor (VehicleMultiSelectSnapshot) -> Void)?
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

    func emit(_ snapshot: VehicleMultiSelectSnapshot) {
        onUpdate?(snapshot)
    }
}
