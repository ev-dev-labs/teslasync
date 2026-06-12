//
//  VehiclePaintPicker.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0234 · VehiclePaintPicker (Apple)
//
//  The pure-core coverage (the Foundation-only adapter): the surface identity, the palette-id type-guard
//  (web `isPaintPaletteId`), the Tesla-code inference (web `inferPaintFromTesla`, across every variant
//  branch + the fallback), the catalog shape (the `vehicleColors.ts` parity), the projection (the
//  "cached selection → view-ready projection" derivation the acceptance calls for — across the
//  inferred / overridden / selected / empty branches), the layout, and value-type equality. Split from
//  VehiclePaintPicker.Tests.swift (the SwiftUI / state-holder half) to keep each file inside the
//  SwiftLint length budget. These run in the TeslaSync(/-macOS) XCTest targets; the derivation is pure,
//  with no network and no clock.
//

import XCTest
@testable import TeslaSync

// MARK: - Surface identity

final class VehiclePaintPickerSurfaceTests: XCTestCase {
    func testSlugIsStable() {
        XCTAssertEqual(VehiclePaintPickerSurface.slug, "VehiclePaintPicker")
        XCTAssertEqual(VehiclePaintPicker.surfaceSlug, "VehiclePaintPicker")
    }
}

// MARK: - PaletteID type-guard (web `isPaintPaletteId`)

final class VehiclePaintPaletteIDTests: XCTestCase {
    func testParsesKnownIDs() {
        XCTAssertEqual(VehiclePaintPaletteID.parse("pearl-white"), .pearlWhite)
        XCTAssertEqual(VehiclePaintPaletteID.parse("midnight-silver"), .midnightSilver)
        XCTAssertEqual(VehiclePaintPaletteID.parse("deep-blue"), .deepBlue)
        XCTAssertEqual(VehiclePaintPaletteID.parse("solid-black"), .solidBlack)
        XCTAssertEqual(VehiclePaintPaletteID.parse("red-multicoat"), .redMulticoat)
    }

    func testRejectsUnknownAndNil() {
        XCTAssertNil(VehiclePaintPaletteID.parse("chartreuse"))
        XCTAssertNil(VehiclePaintPaletteID.parse(""))
        XCTAssertNil(VehiclePaintPaletteID.parse(nil))
        XCTAssertFalse(VehiclePaintPaletteID.isPaintPaletteID("stale-value"))
        XCTAssertTrue(VehiclePaintPaletteID.isPaintPaletteID("solid-black"))
    }

    func testCaseIterableCoversFive() {
        XCTAssertEqual(VehiclePaintPaletteID.allCases.count, 5)
    }
}

// MARK: - Tesla-code inference (web `inferPaintFromTesla`)

final class VehiclePaintInferenceTests: XCTestCase {
    func testInfersPearlWhiteVariants() {
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "PearlWhite"), .pearlWhite)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "PearlWhiteMultiCoat"), .pearlWhite)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "white"), .pearlWhite)
    }

    func testInfersSilverBlueBlackRed() {
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "MidnightSilverMetallic"), .midnightSilver)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "silver"), .midnightSilver)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "DeepBlueMetallic"), .deepBlue)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "darkblue"), .deepBlue)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "SolidBlack"), .solidBlack)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "ObsidianBlack"), .solidBlack)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "RedMulticoat"), .redMulticoat)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "Red_Multi-Coat"), .redMulticoat)
    }

    func testNormalizesCaseSpacesDashesUnderscores() {
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "  deep blue  "), .deepBlue)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "MIDNIGHT_SILVER"), .midnightSilver)
    }

    func testUnknownAndEmptyFallBackToPearlWhite() {
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: "Chartreuse"), .pearlWhite)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: ""), .pearlWhite)
        XCTAssertEqual(VehiclePaintCatalog.infer(fromTeslaCode: nil), .pearlWhite)
        XCTAssertEqual(VehiclePaintCatalog.fallbackID, .pearlWhite)
    }
}

// MARK: - Catalog (vehicleColors.ts parity)

final class VehiclePaintCatalogTests: XCTestCase {
    func testCatalogShape() {
        XCTAssertEqual(VehiclePaintCatalog.list.count, 5)
        XCTAssertEqual(Set(VehiclePaintCatalog.list.map(\.id)).count, 5, "ids unique")
        XCTAssertEqual(VehiclePaintCatalog.list.map(\.id), [
            .pearlWhite, .midnightSilver, .deepBlue, .solidBlack, .redMulticoat
        ], "display order matches PAINT_PALETTE_LIST")
    }

    func testSwatchHexesAreSixDigitHex() {
        for palette in VehiclePaintCatalog.list {
            XCTAssertTrue(palette.swatchHex.hasPrefix("#"), "\(palette.id) swatch has #")
            XCTAssertEqual(palette.swatchHex.count, 7, "\(palette.id) swatch is #RRGGBB")
        }
        XCTAssertEqual(VehiclePaintCatalog.list.first?.swatchHex, "#e9ecf2")
    }
}

// MARK: - Projector (state → projection)

final class VehiclePaintProjectorTests: XCTestCase {
    private let resolve: VehiclePaintResolve = { _, fallback in fallback }

    private func project(
        selected: VehiclePaintPaletteID,
        inferred: VehiclePaintPaletteID,
        overridden: Bool,
        palettes: [VehiclePaintPalette] = VehiclePaintCatalog.list
    ) -> VehiclePaintPickerProjection {
        VehiclePaintPickerProjector.resolve(
            palettes: palettes,
            state: VehiclePaintState(selectedID: selected, inferredID: inferred, isOverridden: overridden),
            resolve: resolve
        )
    }

    func testDefaultInferredProjection() {
        let projection = project(selected: .pearlWhite, inferred: .pearlWhite, overridden: false)
        XCTAssertEqual(projection.pickerLabel, "Vehicle paint color")
        XCTAssertEqual(projection.sectionLabel, "Paint")
        XCTAssertEqual(projection.swatches.count, 5)
        XCTAssertEqual(projection.currentPaintName, "Pearl White Multi-Coat")
        XCTAssertFalse(projection.isOverridden)
        XCTAssertFalse(projection.showsReset, "no Reset without an override")
        XCTAssertFalse(projection.isEmpty)
    }

    func testSelectedAndInferredFlags() {
        let projection = project(selected: .pearlWhite, inferred: .deepBlue, overridden: false)
        XCTAssertEqual(projection.swatches.first { $0.paletteID == .pearlWhite }?.isSelected, true)
        XCTAssertEqual(projection.swatches.first { $0.paletteID == .deepBlue }?.isSelected, false)
        XCTAssertEqual(projection.swatches.first { $0.paletteID == .deepBlue }?.isInferred, true)
        XCTAssertEqual(projection.swatches.first { $0.paletteID == .pearlWhite }?.isInferred, false)
    }

    func testOverriddenRevealsReset() {
        let projection = project(selected: .redMulticoat, inferred: .pearlWhite, overridden: true)
        XCTAssertTrue(projection.isOverridden)
        XCTAssertTrue(projection.showsReset)
        XCTAssertEqual(projection.resetLabel, "Reset to auto-detected")
        XCTAssertEqual(projection.currentPaintName, "Red Multi-Coat")
        XCTAssertEqual(projection.swatches.first { $0.paletteID == .redMulticoat }?.isSelected, true)
    }

    func testSwatchCarriesNameAndHex() {
        let projection = project(selected: .pearlWhite, inferred: .pearlWhite, overridden: false)
        let blue = projection.swatches.first { $0.paletteID == .deepBlue }
        XCTAssertEqual(blue?.displayName, "Deep Blue Metallic")
        XCTAssertEqual(blue?.swatchHex, "#1f3a72")
        XCTAssertEqual(blue?.id, "deep-blue")
    }

    func testEmptyCatalogProducesEmptyLeaf() {
        let projection = project(selected: .pearlWhite, inferred: .pearlWhite, overridden: true, palettes: [])
        XCTAssertTrue(projection.isEmpty)
        XCTAssertTrue(projection.swatches.isEmpty)
        XCTAssertFalse(projection.showsReset, "no Reset on the empty leaf even if overridden")
        XCTAssertEqual(projection.currentPaintName, "pearl-white", "falls back to the raw id")
    }
}

// MARK: - Layout + value-type equality

final class VehiclePaintLayoutTests: XCTestCase {
    func testLayoutMetrics() {
        let layout = VehiclePaintPickerProjector.layout()
        XCTAssertEqual(layout.swatchDiameter, 28, accuracy: 0.001)
        XCTAssertGreaterThan(layout.selectedScale, 1)
    }

    func testInputEquality() {
        XCTAssertEqual(
            VehiclePaintPickerInput(vehicleID: 1, exteriorColor: "white"),
            VehiclePaintPickerInput(vehicleID: 1, exteriorColor: "white")
        )
        XCTAssertNotEqual(
            VehiclePaintPickerInput(vehicleID: 1),
            VehiclePaintPickerInput(vehicleID: 2)
        )
    }

    func testProjectionEquality() {
        let resolve: VehiclePaintResolve = { _, fallback in fallback }
        let state = VehiclePaintState(selectedID: .pearlWhite, inferredID: .pearlWhite, isOverridden: false)
        let lhs = VehiclePaintPickerProjector.resolve(
            palettes: VehiclePaintCatalog.list,
            state: state,
            resolve: resolve
        )
        let rhs = VehiclePaintPickerProjector.resolve(
            palettes: VehiclePaintCatalog.list,
            state: state,
            resolve: resolve
        )
        XCTAssertEqual(lhs, rhs)
    }
}
