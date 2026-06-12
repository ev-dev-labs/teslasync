//
//  VehiclePaintPicker.Tests.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The state-holder + view-composition + facade + seams half of the coverage (the pure projection +
//  value types live in VehiclePaintPicker.AdapterTests.swift; split to keep each file within the
//  SwiftLint length budget):
//    • VehiclePaintPickerModel — seeding from the store, selecting a paint writing through the store
//      (web `setPaint`), selecting the inferred colour clearing the override (web normalization),
//      `reset()` clearing it, the once-only `view.opened`, and the live projection.
//    • Seams — the in-memory store reproduces the web `useVehiclePaint` resolution + the
//      `setPaint(inferred) -> clear` normalization + the recorded writes.
//    • Strings — the web keys + a11y additions resolve through the P1/S10 facade with the fallbacks.
//    • Views — the public surface + every subview compose in each branch.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - VehiclePaintPickerModel (selection state + routing)

@MainActor
final class VehiclePaintPickerModelTests: XCTestCase {
    private func makeModel(
        store: InMemoryVehiclePaintStore = InMemoryVehiclePaintStore(),
        input: VehiclePaintPickerInput = VehiclePaintPickerInput(vehicleID: 1),
        palettes: [VehiclePaintPalette] = VehiclePaintCatalog.list,
        telemetry: any VehiclePaintPickerTelemetry = OSLogVehiclePaintPickerTelemetry()
    ) -> VehiclePaintPickerModel {
        VehiclePaintPickerModel(
            store: store,
            input: input,
            palettes: palettes,
            telemetry: telemetry,
            resolve: { _, fallback in fallback }
        )
    }

    func testInitSeedsFromStore() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "DeepBlueMetallic")
        let model = makeModel(store: store)
        XCTAssertEqual(model.state.selectedID, .deepBlue, "inferred when no override")
        XCTAssertEqual(model.state.inferredID, .deepBlue)
        XCTAssertFalse(model.state.isOverridden)
    }

    func testSelectPaintWritesStoreAndUpdatesState() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "PearlWhite")
        let model = makeModel(store: store)
        model.selectPaint(.redMulticoat)
        XCTAssertEqual(model.state.selectedID, .redMulticoat)
        XCTAssertTrue(model.state.isOverridden)
        XCTAssertEqual(store.overrideID, .redMulticoat)
        XCTAssertEqual(store.writtenOverrides, [.redMulticoat])
    }

    func testSelectingInferredColorClearsOverride() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "DeepBlueMetallic", override: .redMulticoat)
        let model = makeModel(store: store)
        XCTAssertTrue(model.state.isOverridden)
        // Picking the inferred colour is normalized to "clear the override" (web parity).
        model.selectPaint(.deepBlue)
        XCTAssertEqual(model.state.selectedID, .deepBlue)
        XCTAssertFalse(model.state.isOverridden)
        XCTAssertNil(store.overrideID)
        XCTAssertEqual(store.writtenOverrides.last, VehiclePaintPaletteID?.none)
    }

    func testResetClearsOverride() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "PearlWhite", override: .solidBlack)
        let model = makeModel(store: store)
        XCTAssertTrue(model.state.isOverridden)
        model.reset()
        XCTAssertFalse(model.state.isOverridden)
        XCTAssertEqual(model.state.selectedID, .pearlWhite, "reverts to inferred")
        XCTAssertNil(store.overrideID)
    }

    func testMarkAppearedEmitsViewOpenedOnce() {
        let spy = SpyVehiclePaintTelemetry()
        let model = makeModel(telemetry: spy)
        model.markAppeared()
        model.markAppeared()
        XCTAssertEqual(spy.surfaces, ["VehiclePaintPicker"])
    }

    func testProjectionReflectsSelectionChange() {
        let model = makeModel(store: InMemoryVehiclePaintStore(exteriorColor: "PearlWhite"))
        XCTAssertEqual(model.projection.swatches.first { $0.paletteID == .pearlWhite }?.isSelected, true)
        model.selectPaint(.solidBlack)
        XCTAssertEqual(model.projection.swatches.first { $0.paletteID == .solidBlack }?.isSelected, true)
        XCTAssertTrue(model.projection.showsReset)
    }
}

// MARK: - Seams (in-memory store)

@MainActor
final class VehiclePaintSeamsTests: XCTestCase {
    func testInfersFromExteriorColor() {
        XCTAssertEqual(InMemoryVehiclePaintStore(exteriorColor: "DeepBlueMetallic").state.selectedID, .deepBlue)
        XCTAssertEqual(InMemoryVehiclePaintStore().state.selectedID, .pearlWhite, "nil -> fallback")
    }

    func testSetPaintNormalizesInferredToClear() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "DeepBlueMetallic")
        store.setPaint(.redMulticoat)
        XCTAssertEqual(store.overrideID, .redMulticoat)
        XCTAssertTrue(store.state.isOverridden)
        store.setPaint(.deepBlue) // == inferred -> clears
        XCTAssertNil(store.overrideID)
        XCTAssertFalse(store.state.isOverridden)
        XCTAssertEqual(store.writtenOverrides, [.redMulticoat, VehiclePaintPaletteID?.none])
    }

    func testResetClearsAndRecords() {
        let store = InMemoryVehiclePaintStore(exteriorColor: "PearlWhite", override: .solidBlack)
        store.reset()
        XCTAssertNil(store.overrideID)
        XCTAssertEqual(store.writtenOverrides, [VehiclePaintPaletteID?.none])
    }
}

// MARK: - Strings facade (P1/S10)

final class VehiclePaintStringsTests: XCTestCase {
    func testWebKeyFallbacks() {
        XCTAssertEqual(VehiclePaintPickerStrings.pickerLabel, "Vehicle paint color")
        XCTAssertEqual(VehiclePaintPickerStrings.sectionLabel, "Paint")
        XCTAssertEqual(VehiclePaintPickerStrings.detected, "Auto-detected")
        XCTAssertEqual(VehiclePaintPickerStrings.reset, "Reset to auto-detected")
    }

    func testA11yFallbacks() {
        XCTAssertEqual(VehiclePaintPickerStrings.selectedValue, "Selected")
        XCTAssertEqual(VehiclePaintPickerStrings.swatchHint, "Selects the paint color")
        XCTAssertEqual(VehiclePaintPickerStrings.emptyTitle, "No paint options available")
    }

    func testResolverReturnsFallbackForMissingKey() {
        XCTAssertEqual(VehiclePaintPickerStrings.string("paint.__missing__", "fallback"), "fallback")
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class VehiclePaintPickerViewTests: XCTestCase {
    func testSurfaceComposesForBranches() {
        _ = VehiclePaintPicker(
            store: InMemoryVehiclePaintStore(exteriorColor: "PearlWhite"),
            input: VehiclePaintPickerInput(vehicleID: 1, exteriorColor: "PearlWhite")
        )
        _ = VehiclePaintPicker(model: VehiclePaintPickerModel(
            store: InMemoryVehiclePaintStore(),
            input: VehiclePaintPickerInput(vehicleID: 1),
            palettes: []
        ))
        XCTAssertEqual(VehiclePaintPicker.surfaceSlug, "VehiclePaintPicker")
    }

    func testSubviewsCompose() {
        let layout = VehiclePaintPickerProjector.layout()
        let swatch = VehiclePaintSwatch(
            paletteID: .pearlWhite,
            displayName: "Pearl White Multi-Coat",
            swatchHex: "#e9ecf2",
            isSelected: true,
            isInferred: true
        )
        _ = VehiclePaintSectionLabel(text: "Paint")
        _ = VehiclePaintSwatchHeader(
            sectionLabel: "Paint",
            pickerLabel: "Vehicle paint color",
            swatches: [swatch],
            layout: layout,
            onSelect: { _ in }
        )
        _ = VehiclePaintSwatchButton(swatch: swatch, layout: layout, action: {})
        _ = VehiclePaintStatusRow(
            currentPaintName: "Pearl White Multi-Coat",
            showsReset: true,
            resetLabel: "Reset to auto-detected",
            onReset: {}
        )
        _ = VehiclePaintResetButton(label: "Reset to auto-detected", action: {})
        _ = VehiclePaintPickerEmptyState()
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces. Lock-guarded so it satisfies the `Sendable` telemetry seam under
/// Swift 6 strict concurrency.
private final class SpyVehiclePaintTelemetry: VehiclePaintPickerTelemetry, @unchecked Sendable {
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
