//
//  UuidGenerator.Tests.swift
//  TeslaSync — P4 feature view · 0024 · UuidGenerator (Apple)
//
//  Unit coverage for the UuidGenerator surface:
//    • Adapter — UuidGeneration.prepending (newest-first + cap) + isCanonicalV4 +
//      the Foundation generator's v4 output (parity with lib/safeUUID.ts).
//    • State holder — UuidGeneratorModel phase (empty → content), generate cap,
//      and the P1/S11 view.opened telemetry (emitted exactly once).
//    • Accessibility — the combined row label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. No network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: generation rules (parity with lib/safeUUID.ts + slice(0, 10))

@MainActor final class UuidGenerationTests: XCTestCase {
    func testPrependPutsNewestFirst() {
        var entries: [UuidEntry] = []
        entries = UuidGeneration.prepending("a", to: entries)
        entries = UuidGeneration.prepending("b", to: entries)
        XCTAssertEqual(entries.map(\.value), ["b", "a"])
    }

    func testPrependCapsAtLimit() {
        var entries: [UuidEntry] = []
        for index in 0 ..< 15 {
            entries = UuidGeneration.prepending("u\(index)", to: entries)
        }
        XCTAssertEqual(entries.count, UuidGeneration.limit)
        XCTAssertEqual(entries.first?.value, "u14")
        XCTAssertEqual(entries.last?.value, "u5")
    }

    func testSystemGeneratorProducesLowercaseCanonicalV4() {
        let generator = SystemUuidGenerator()
        for _ in 0 ..< 64 {
            let value = generator.next()
            XCTAssertTrue(UuidGeneration.isCanonicalV4(value), "not canonical v4: \(value)")
            XCTAssertEqual(value, value.lowercased())
        }
    }

    func testCanonicalV4RejectsNonV4() {
        XCTAssertFalse(UuidGeneration.isCanonicalV4("not-a-uuid"))
        // version nibble 1 (time-based), not 4:
        XCTAssertFalse(UuidGeneration.isCanonicalV4("6f9619ff-8b86-1011-b42d-00cf4fc964ff"))
        // variant nibble c (out of 8…b range):
        XCTAssertFalse(UuidGeneration.isCanonicalV4("f47ac10b-58cc-4372-c567-0e02b2c3d479"))
    }
}

// MARK: - State holder: phase + generate + telemetry

@MainActor final class UuidGeneratorModelTests: XCTestCase {
    func testStartsEmpty() {
        let model = UuidGeneratorModel(generator: CountingGenerator(), telemetry: UuidGeneratorSpyTelemetry())
        XCTAssertEqual(model.phase, .empty)
        XCTAssertTrue(model.entries.isEmpty)
    }

    func testGenerateMovesToContent() {
        let model = UuidGeneratorModel(generator: CountingGenerator())
        model.generate()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.entries.first?.value, "uuid-1")
    }

    func testGenerateCapsAtLimit() {
        let model = UuidGeneratorModel(generator: CountingGenerator())
        for _ in 0 ..< 21 {
            model.generate()
        }
        XCTAssertEqual(model.entries.count, UuidGeneration.limit)
        XCTAssertEqual(model.entries.first?.value, "uuid-21")
        XCTAssertEqual(model.entries.last?.value, "uuid-12")
    }

    func testStartEmitsViewOpenedExactlyOnce() {
        let spy = UuidGeneratorSpyTelemetry()
        let model = UuidGeneratorModel(generator: CountingGenerator(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [UuidGeneratorView.surfaceSlug])
    }
}

// MARK: - Accessibility

@MainActor final class UuidGeneratorAccessibilityTests: XCTestCase {
    func testRowLabelIncludesPositionAndValue() {
        let label = UuidGeneratorAccessibility.rowLabel(index: 2, total: 5, value: "abc-123")
        XCTAssertTrue(label.contains("2"))
        XCTAssertTrue(label.contains("5"))
        XCTAssertTrue(label.contains("abc-123"))
    }
}

// MARK: - Test doubles

private final class UuidGeneratorSpyTelemetry: UuidGeneratorTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

private final class CountingGenerator: UuidGenerating, @unchecked Sendable {
    private var count = 0
    func next() -> String {
        count += 1
        return "uuid-\(count)"
    }
}
