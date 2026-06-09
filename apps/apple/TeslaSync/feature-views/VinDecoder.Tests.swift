//
//  VinDecoder.Tests.swift
//  TeslaSync — P4 feature view · 0025 · VinDecoder (Apple)
//
//  Unit coverage for the VinDecoder surface:
//    • Adapter — the positional decode pipeline (no-result / decoded / unknown
//      positions / serial extraction), pinned to the exact values the web source
//      produces (parity with
//      features/admin/components/devtools/tools/VinDecoder.tsx).
//    • Reference tables — the ported `VIN_*` constants match the web.
//    • State holder — `VinDecoderModel` input → result, plus the P1/S11
//      `view.opened` telemetry emitted once.
//    • i18n facade — `VinDecoderStrings` resolves the web fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the decode is a pure local computation.
//

import XCTest
@testable import TeslaSync

// MARK: - Sample VIN (Model 3, Fremont, 2022)

private enum VinDecoderSample {
    static let vin = "5YJ3E1EA1NF000001"
}

// MARK: - Adapter: decode pipeline

@MainActor final class VinDecoderAdapterTests: XCTestCase {
    func testShortInputDoesNotDecode() {
        // web: `if (vin.length < 11) return null`.
        XCTAssertNil(VinDecoderAdapter.decode(""))
        XCTAssertNil(VinDecoderAdapter.decode("5YJ3E1EA1")) // 9 chars
        XCTAssertNil(VinDecoderAdapter.decode("5YJ3E1EA1N")) // 10 chars
    }

    func testDecodesEverySampleField() {
        guard let decoded = VinDecoderAdapter.decode(VinDecoderSample.vin) else {
            return XCTFail("expected the sample VIN to decode")
        }
        XCTAssertEqual(decoded.manufacturer, "Tesla (USA)")
        XCTAssertEqual(decoded.model, "Model 3")
        XCTAssertEqual(decoded.drive, "Dual Motor AWD")
        XCTAssertEqual(decoded.year, "2022")
        XCTAssertEqual(decoded.plant, "Fremont, CA")
        XCTAssertEqual(decoded.serial, "000001")
    }

    func testUppercasesBeforeDecoding() {
        // web: `vin.toUpperCase()` — a lower-cased VIN decodes identically.
        guard let decoded = VinDecoderAdapter.decode(VinDecoderSample.vin.lowercased()) else {
            return XCTFail("expected the lower-cased VIN to decode")
        }
        XCTAssertEqual(decoded.manufacturer, "Tesla (USA)")
        XCTAssertEqual(decoded.model, "Model 3")
        XCTAssertEqual(decoded.serial, "000001")
    }

    func testUnmatchedPositionsAreNil() {
        // Valid length but every lookup position misses its table → nil (the view
        // renders the localized "Unknown"). The serial is still extracted.
        guard let decoded = VinDecoderAdapter.decode("ZZZ9Z9Z9Z9Z999999") else {
            return XCTFail("expected a long-enough VIN to decode")
        }
        XCTAssertNil(decoded.manufacturer)
        XCTAssertNil(decoded.model)
        XCTAssertNil(decoded.drive)
        XCTAssertNil(decoded.year)
        XCTAssertNil(decoded.plant)
        XCTAssertEqual(decoded.serial, "999999")
    }

    func testElevenCharVinHasEmptySerial() {
        // Exactly 11 chars → positions resolve; serial `slice(11)` is empty (web parity).
        guard let decoded = VinDecoderAdapter.decode("5YJ3E1EA1NF") else {
            return XCTFail("expected an 11-char VIN to decode")
        }
        XCTAssertEqual(decoded.plant, "Fremont, CA")
        XCTAssertEqual(decoded.serial, "")
    }

    func testFieldsProjectionOrderAndLabelKeys() {
        guard let decoded = VinDecoderAdapter.decode(VinDecoderSample.vin) else {
            return XCTFail("expected the sample VIN to decode")
        }
        let fields = decoded.fields
        // web iterates `Object.entries(decoded)` in insertion order.
        XCTAssertEqual(fields.map(\.key), ["mfr", "model", "drive", "year", "plant", "serial"])
        XCTAssertEqual(
            fields.map(\.labelKey),
            [
                "devtools.utils.vin_mfr",
                "devtools.utils.vin_model",
                "devtools.utils.vin_drive",
                "devtools.utils.vin_year",
                "devtools.utils.vin_plant",
                "devtools.utils.vin_serial"
            ]
        )
        XCTAssertEqual(fields.first?.value, "Tesla (USA)")
        XCTAssertEqual(fields.last?.value, "000001")
    }
}

// MARK: - Reference tables (web VIN_* parity)

@MainActor final class VinReferenceTests: XCTestCase {
    func testManufacturerTableMatchesWeb() {
        XCTAssertEqual(VinReference.manufacturers["5YJ"], "Tesla (USA)")
        XCTAssertEqual(VinReference.manufacturers["LRW"], "Tesla (China)")
        XCTAssertEqual(VinReference.manufacturers["7SA"], "Tesla (EU/Berlin)")
        XCTAssertEqual(VinReference.manufacturers["XP7"], "Tesla (USA)")
    }

    func testModelYearAndPlantTablesMatchWeb() {
        XCTAssertEqual(VinReference.models["Y"], "Model Y")
        XCTAssertEqual(VinReference.drive["4"], "Single Motor RWD (LFP)")
        XCTAssertEqual(VinReference.year["T"], "2026")
        XCTAssertEqual(VinReference.plant["B"], "Berlin, Germany")
        XCTAssertNil(VinReference.models["Q"])
    }
}

// MARK: - State holder: input → result + telemetry

@MainActor final class VinDecoderModelTests: XCTestCase {
    func testEmptyInputHasNoResult() {
        let model = VinDecoderModel()
        XCTAssertNil(model.result)
    }

    func testInputDrivesDecodedResult() {
        let model = VinDecoderModel(input: VinDecoderSample.vin)
        XCTAssertEqual(model.result?.manufacturer, "Tesla (USA)")
        XCTAssertEqual(model.result?.serial, "000001")
    }

    func testMutatingInputRecomputesResult() {
        let model = VinDecoderModel()
        XCTAssertNil(model.result)
        model.input = "short"
        XCTAssertNil(model.result)
        model.input = VinDecoderSample.vin
        XCTAssertEqual(model.result?.model, "Model 3")
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyVinDecoderTelemetry()
        let model = VinDecoderModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [VinDecoderView.surfaceSlug])
        XCTAssertEqual(VinDecoderView.surfaceSlug, "VinDecoder")
        XCTAssertEqual(VinDecoderSurface.slug, "VinDecoder")
    }
}

// MARK: - i18n facade

@MainActor final class VinDecoderStringsTests: XCTestCase {
    func testFacadeResolvesWebFallbacks() {
        // The per-surface table folds in at integration; the facade returns the
        // English fallback for each source key here.
        XCTAssertEqual(VinDecoderStrings.string("Vin Decoder", "VIN Decoder"), "VIN Decoder")
        XCTAssertEqual(VinDecoderStrings.string("Vin", "VIN"), "VIN")
        XCTAssertEqual(VinDecoderStrings.string("Unknown", "Unknown"), "Unknown")
        XCTAssertEqual(VinDecoderStrings.string("devtools.utils.vin_mfr", "Manufacturer"), "Manufacturer")
        XCTAssertEqual(VinDecoderStrings.string("devtools.utils.vin_serial", "Serial"), "Serial")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyVinDecoderTelemetry: VinDecoderTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
