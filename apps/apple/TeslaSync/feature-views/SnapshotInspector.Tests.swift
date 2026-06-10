//
//  SnapshotInspector.Tests.swift
//  TeslaSync — P4 feature view · 0234 · SnapshotInspector (Apple)
//
//  Pure value-model + source-layer + accessibility + identity coverage for the
//  SnapshotInspector surface — the faithful port checks for
//  features/system/components/state-machine/SnapshotInspector.tsx:
//    • `SnapshotValue.display` — the web `formatValue` (null / bool / number / string / JSON).
//    • `SnapshotValue.compactJSON` / `prettyJSON` — the `JSON.stringify` round-trips.
//    • `SignalSourceLayer` + `SnapshotAge` — the web `SourceLayerBadge` mapping + `formatAge`.
//    • `SnapshotTransition.durationInStateMs` — the `details?.duration_in_state_ms` read.
//    • `SnapshotInspectorAccessibility` — the VoiceOver detail + row labels.
//    • the `view.opened` telemetry slug + the surface identity.
//  The projection (rows / copy / phase / relative time) is covered in
//  SnapshotInspector.ProjectionTests.swift; the state holder in
//  SnapshotInspector.ModelTests.swift. Pure, bundle-free: copy resolves through an identity
//  localizer.
//
//  The whole file is gated on `canImport(XCTest)`: the feature-views group is a member of
//  the app targets as well as the test bundle, and the app targets do not link XCTest — the
//  guard means this file compiles to nothing there while still compiling + running in the
//  XCTest bundle.
//

#if canImport(XCTest)
    import Foundation
    import XCTest
    @testable import TeslaSync

    /// Identity localizer: returns each call's English fallback so assertions read the real
    /// copy / templates without a bundle.
    private let passthroughLocalize: @Sendable (String, String) -> String = { _, fallback in fallback }

    // MARK: - formatValue (web `formatValue`)

    @MainActor final class SnapshotValueDisplayTests: XCTestCase {
        func testNullIsDash() {
            XCTAssertEqual(SnapshotValue.null.display, "—")
        }

        func testBool() {
            XCTAssertEqual(SnapshotValue.bool(true).display, "true")
            XCTAssertEqual(SnapshotValue.bool(false).display, "false")
        }

        func testNumberIntegralDropsFractionalTail() {
            XCTAssertEqual(SnapshotValue.number(82).display, "82")
        }

        func testNumberDecimal() {
            XCTAssertEqual(SnapshotValue.number(34.5).display, "34.5")
        }

        func testNonFiniteNumberIsDash() {
            XCTAssertEqual(SnapshotValue.number(.nan).display, "—")
            XCTAssertEqual(SnapshotValue.number(.infinity).display, "—")
        }

        func testStringVerbatim() {
            XCTAssertEqual(SnapshotValue.string("Charging").display, "Charging")
        }

        func testObjectIsCompactJSON() {
            let value = SnapshotValue.object([
                SnapshotMember("lat", .number(37.5)),
                SnapshotMember("lng", .number(-122))
            ])
            XCTAssertEqual(value.display, "{\"lat\":37.5,\"lng\":-122}")
        }

        func testArrayIsCompactJSON() {
            XCTAssertEqual(SnapshotValue.array([.number(1), .string("x")]).display, "[1,\"x\"]")
        }
    }

    // MARK: - JSON.stringify (compact + pretty + escaping)

    @MainActor final class SnapshotValueJSONTests: XCTestCase {
        func testCanonicalOfNilIsNull() {
            XCTAssertEqual(SnapshotValue.canonical(nil), "null")
        }

        func testStringEscaping() {
            XCTAssertEqual(SnapshotValue.string("a\"b\\c\n").compactJSON, "\"a\\\"b\\\\c\\n\"")
        }

        func testPrettyTwoSpaceIndent() {
            let value = SnapshotValue.object([
                SnapshotMember("a", .number(1)),
                SnapshotMember("b", .string("x"))
            ])
            XCTAssertEqual(value.prettyJSON, "{\n  \"a\": 1,\n  \"b\": \"x\"\n}")
        }

        func testPrettyEmptyContainers() {
            XCTAssertEqual(SnapshotValue.object([]).prettyJSON, "{}")
            XCTAssertEqual(SnapshotValue.array([]).prettyJSON, "[]")
        }

        func testCanonicalNumber() {
            XCTAssertEqual(SnapshotNumber.canonical(82), "82")
            XCTAssertEqual(SnapshotNumber.canonical(34.5), "34.5")
            XCTAssertEqual(SnapshotNumber.canonical(.nan), "null")
        }
    }

    // MARK: - Source layer (web `SourceLayerBadge` STYLE)

    @MainActor final class SnapshotSourceLayerTests: XCTestCase {
        func testRawMapping() {
            XCTAssertEqual(SignalSourceLayer(raw: "l1"), .l1)
            XCTAssertEqual(SignalSourceLayer(raw: "L2"), .l2)
            XCTAssertEqual(SignalSourceLayer(raw: "log"), .log)
            XCTAssertEqual(SignalSourceLayer(raw: "stale"), .stale)
            XCTAssertEqual(SignalSourceLayer(raw: "nonsense"), .unknown)
            XCTAssertEqual(SignalSourceLayer(raw: nil), .unknown)
        }

        func testBadgeLabels() {
            XCTAssertEqual(SignalSourceLayer.l1.badgeLabel, "L1")
            XCTAssertEqual(SignalSourceLayer.log.badgeLabel, "LOG")
            XCTAssertEqual(SignalSourceLayer.stale.badgeLabel, "STALE")
            XCTAssertEqual(SignalSourceLayer.unknown.badgeLabel, "—")
        }

        func testAgeFormat() {
            XCTAssertEqual(SnapshotAge.format(240), "240 ms")
            XCTAssertEqual(SnapshotAge.format(5400), "5.4 s")
            XCTAssertEqual(SnapshotAge.format(180_000), "3 min")
            XCTAssertNil(SnapshotAge.format(nil))
            XCTAssertNil(SnapshotAge.format(.nan))
        }
    }

    // MARK: - Transition duration extraction

    @MainActor final class SnapshotTransitionTests: XCTestCase {
        private func transition(details: SnapshotValue?) -> SnapshotTransition {
            SnapshotTransition(
                id: 1, vehicleID: 1, ts: "t", fsmName: "vehicle",
                fromState: "a", toState: "b", trigger: "x", details: details
            )
        }

        func testDurationExtractedWhenNumeric() {
            let details = SnapshotValue.object([SnapshotMember("duration_in_state_ms", .number(8421))])
            XCTAssertEqual(transition(details: details).durationInStateMs, 8421)
        }

        func testDurationNilWhenAbsent() {
            XCTAssertNil(transition(details: nil).durationInStateMs)
        }

        func testDurationNilWhenNonNumeric() {
            let details = SnapshotValue.object([SnapshotMember("duration_in_state_ms", .string("nope"))])
            XCTAssertNil(transition(details: details).durationInStateMs)
        }
    }

    // MARK: - Accessibility + identity

    @MainActor final class SnapshotInspectorAccessibilityTests: XCTestCase {
        func testDetailLabel() {
            XCTAssertEqual(
                SnapshotInspectorAccessibility.detailLabel(
                    from: "online",
                    to: "driving",
                    localize: passthroughLocalize
                ),
                "Transition snapshot, online to driving"
            )
        }

        func testRowLabelIncludesSourceDescription() {
            let row = SnapshotInspectorSignalRow(
                name: "soc", valueDisplay: "82", source: .l1, ageMs: nil, changed: false, previousDisplay: nil
            )
            XCTAssertEqual(
                SnapshotInspectorAccessibility.rowLabel(row, localize: passthroughLocalize),
                "soc, 82, Read from the in-process SignalStore (hot path, freshest)."
            )
        }

        func testRowLabelWithoutSource() {
            let row = SnapshotInspectorSignalRow(
                name: "soc", valueDisplay: "82", source: nil, ageMs: nil, changed: false, previousDisplay: nil
            )
            XCTAssertEqual(
                SnapshotInspectorAccessibility.rowLabel(row, localize: passthroughLocalize),
                "soc, 82"
            )
        }

        func testSurfaceSlugIsStable() {
            XCTAssertEqual(SnapshotInspectorSurface.slug, "SnapshotInspector")
            XCTAssertEqual(SnapshotInspector.surfaceSlug, "SnapshotInspector")
        }

        func testReportOpenEmitsViewOpenedWithSlug() {
            let sink = BufferedSnapshotInspectorTelemetry()
            SnapshotInspectorSurface.reportOpen(to: sink)
            XCTAssertEqual(sink.opened, ["SnapshotInspector"])
        }
    }

    // MARK: - Test doubles

    /// A thread-safe buffered diagnostics sink for asserting the `view.opened` slug.
    private final class BufferedSnapshotInspectorTelemetry: SnapshotInspectorTelemetry, @unchecked Sendable {
        private let lock = NSLock()
        private var buffer: [String] = []

        var opened: [String] {
            lock.lock()
            defer { lock.unlock() }
            return buffer
        }

        func viewOpened(surface: String) {
            lock.lock()
            defer { lock.unlock() }
            buffer.append(surface)
        }
    }
#endif
