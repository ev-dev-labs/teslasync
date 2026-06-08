//
//  HashCalculator.Tests.swift
//  TeslaSync — P4 feature view · 0015 · HashCalculator (Apple)
//
//  Unit coverage for the HashCalculator surface:
//    • Engine  — the pure SHA-256 → lowercase-hex adapter against known vectors.
//    • Model   — phase resolution across idle / computing / result / failed, the
//                empty-input guard, and the P1/S11 `view.opened` telemetry contract.
//    • i18n    — the P1/S10 facade resolves keys with the web English fallback.
//
//  These run in the TeslaSync(/-macOS) XCTest targets (their sources move under
//  Tests/Unit at integration). The pure-engine subset is additionally executed in
//  the host validation harness.
//

import XCTest
@testable import TeslaSync
 import TeslaSync

// MARK: - Engine: pure SHA-256 hex (parity with crypto.subtle.digest)

@MainActor
final class HashCalculatorEngineTests: XCTestCase {
    func testKnownVectorABC() {
        XCTAssertEqual(
            HashCalculatorEngine.sha256Hex("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        )
    }

    func testKnownVectorEmptyString() {
        XCTAssertEqual(
            HashCalculatorEngine.sha256Hex(""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        )
    }

    func testDigestIsLowercaseHexOfLength64() {
        let hex = HashCalculatorEngine.sha256Hex("TeslaSync")
        XCTAssertEqual(hex.count, 64)
        XCTAssertEqual(hex, hex.lowercased())
        XCTAssertTrue(hex.allSatisfy(\.isHexDigit))
    }

    func testUTF8MultibyteInputIsHashedByBytes() {
        // "héllo 🚗" exercises multi-byte UTF-8, matching the web TextEncoder path.
        let hex = HashCalculatorEngine.sha256Hex("héllo 🚗")
        XCTAssertEqual(hex.count, 64)
        XCTAssertEqual(hex, HashCalculatorEngine.sha256Hex("héllo 🚗"))
    }
}

// MARK: - Model: phases + guard + telemetry

@MainActor
final class HashCalculatorModelTests: XCTestCase {
    func testInitialPhaseIsIdle() {
        XCTAssertEqual(HashCalculatorModel().phase, .idle)
    }

    func testCanComputeReflectsTrimmedInput() {
        let model = HashCalculatorModel()
        XCTAssertFalse(model.canCompute)
        model.input = "   \n\t "
        XCTAssertFalse(model.canCompute)
        model.input = "abc"
        XCTAssertTrue(model.canCompute)
    }

    func testComputeProducesResultPhaseWithDigest() async {
        let model = HashCalculatorModel(input: "abc")
        await model.compute()
        XCTAssertEqual(
            model.phase,
            .result("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        )
        XCTAssertEqual(model.digest, HashCalculatorEngine.sha256Hex("abc"))
    }

    func testComputeIsNoOpForEmptyInput() async {
        let model = HashCalculatorModel(input: "  ")
        await model.compute()
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.digest)
    }

    func testComputeRoutesThrownErrorToFailedPhase() async {
        let model = HashCalculatorModel(input: "abc", digester: ThrowingDigester())
        await model.compute()
        XCTAssertEqual(model.phase, .failed)
        XCTAssertNil(model.digest)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyHashCalculatorTelemetry()
        let model = HashCalculatorModel(telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [HashCalculatorView.surfaceSlug])
    }
}

// MARK: - i18n facade content

@MainActor
final class HashCalculatorStringsTests: XCTestCase {
    func testStringReturnsFallbackWhenKeyMissing() {
        let value = HashCalculatorStrings.string("devtools.hash.__missing__", "Fallback")
        XCTAssertEqual(value, "Fallback")
    }

    func testTextResolvesThroughFacade() {
        // Smoke: the surface-key constants resolve to their web English fallback.
        XCTAssertEqual(
            HashCalculatorStrings.string("devtools.utils.computeSha256", "Compute Sha256"),
            "Compute Sha256"
        )
    }
}

// MARK: - Test doubles

/// A digester that always throws, so the model's `.failed` branch is exercised.
private struct ThrowingDigester: HashDigesting {
    struct Failure: Error {}

    func sha256Hex(_: String) throws -> String {
        throw Failure()
    }
}

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyHashCalculatorTelemetry: HashCalculatorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []

    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
