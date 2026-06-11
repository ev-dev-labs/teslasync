//
//  SourceLayerBadge.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0105 · SourceLayerBadge (Apple)
//
//  Pure-core coverage for the SourceLayerBadge adapter — the verbatim ports of the web helpers,
//  asserted in isolation (Foundation only, no store, no view):
//    • SourceLayerBadgeKind — the `STYLE` lookup (l1/l2/log/stale, the unknown fallback, the
//      case-insensitive `.toLowerCase()` match, the null/empty/unrecognized → unknown rule) plus the
//      label/description key + fallback wiring.
//    • SourceLayerBadgeAgeFormatter — `formatAge` every branch + boundaries (nil / non-finite → nil),
//      routed through an identity resolver so the web fallback literals are asserted.
//    • SourceLayerBadgeTooltipBuilder — the `desc (age: …)` composer with and without an age.
//    • SourceLayerBadgeAccessibility — the tooltip-plus-offline VoiceOver label.
//    • SourceLayerBadgeMeta — the static diagnostics slug.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Shared fixtures

private let passthroughStrings: SourceLayerBadgeResolve = { _, fallback in fallback }

// MARK: - Source layer (web `STYLE` lookup)

final class SourceLayerBadgeKindTests: XCTestCase {
    func testKnownLayersResolve() {
        XCTAssertEqual(SourceLayerBadgeKind(source: "l1"), .l1)
        XCTAssertEqual(SourceLayerBadgeKind(source: "l2"), .l2)
        XCTAssertEqual(SourceLayerBadgeKind(source: "log"), .log)
        XCTAssertEqual(SourceLayerBadgeKind(source: "stale"), .stale)
        XCTAssertEqual(SourceLayerBadgeKind(source: "unknown"), .unknown)
    }

    func testMatchIsCaseInsensitive() {
        XCTAssertEqual(SourceLayerBadgeKind(source: "L1"), .l1)
        XCTAssertEqual(SourceLayerBadgeKind(source: "Log"), .log)
        XCTAssertEqual(SourceLayerBadgeKind(source: "STALE"), .stale)
    }

    func testNilEmptyAndUnrecognizedFoldToUnknown() {
        XCTAssertEqual(SourceLayerBadgeKind(source: nil), .unknown)
        XCTAssertEqual(SourceLayerBadgeKind(source: ""), .unknown)
        XCTAssertEqual(SourceLayerBadgeKind(source: "redis"), .unknown)
    }

    func testLabelFallbacksMatchWebGlyphs() {
        XCTAssertEqual(SourceLayerBadgeKind.l1.label(passthroughStrings), "L1")
        XCTAssertEqual(SourceLayerBadgeKind.l2.label(passthroughStrings), "L2")
        XCTAssertEqual(SourceLayerBadgeKind.log.label(passthroughStrings), "LOG")
        XCTAssertEqual(SourceLayerBadgeKind.stale.label(passthroughStrings), "STALE")
        XCTAssertEqual(SourceLayerBadgeKind.unknown.label(passthroughStrings), "—")
    }

    func testDescriptionFallbacksMatchWebText() {
        XCTAssertEqual(
            SourceLayerBadgeKind.l1.description(passthroughStrings),
            "Read from the in-process SignalStore (hot path, freshest)."
        )
        XCTAssertEqual(
            SourceLayerBadgeKind.l2.description(passthroughStrings),
            "Read from Redis cross-pod cache (legacy entry; freshness unknown)."
        )
        XCTAssertEqual(
            SourceLayerBadgeKind.log.description(passthroughStrings),
            "Replayed from signal_log (durable history)."
        )
        XCTAssertEqual(
            SourceLayerBadgeKind.stale.description(passthroughStrings),
            "Redis-backed value older than the 2-minute freshness window."
        )
        XCTAssertEqual(SourceLayerBadgeKind.unknown.description(passthroughStrings), "Source layer unknown.")
    }

    func testKeysAreNamespacedByRawValue() {
        XCTAssertEqual(SourceLayerBadgeKind.l1.descriptionKey, "sourceLayer.l1.desc")
        XCTAssertEqual(SourceLayerBadgeKind.stale.labelKey, "sourceLayer.stale.label")
    }
}

// MARK: - Age label (web `formatAge`)

final class SourceLayerBadgeAgeFormatterTests: XCTestCase {
    private func label(_ ms: Double?) -> String? {
        SourceLayerBadgeAgeFormatter.label(ms: ms, strings: passthroughStrings)
    }

    func testNilAndNonFiniteAreNil() {
        XCTAssertNil(label(nil))
        XCTAssertNil(label(.infinity))
        XCTAssertNil(label(.nan))
    }

    func testMillisecondsBranchRounds() {
        XCTAssertEqual(label(0), "0 ms")
        XCTAssertEqual(label(349.4), "349 ms")
        XCTAssertEqual(label(999), "999 ms")
    }

    func testSecondsBranchOneDecimal() {
        XCTAssertEqual(label(1000), "1.0 s")
        XCTAssertEqual(label(1500), "1.5 s")
        XCTAssertEqual(label(59999), "60.0 s")
    }

    func testMinutesBranchRounds() {
        XCTAssertEqual(label(60000), "1 min")
        XCTAssertEqual(label(185_000), "3 min")
        XCTAssertEqual(label(3_599_999), "60 min")
    }

    func testHoursBranchOneDecimal() {
        XCTAssertEqual(label(3_600_000), "1.0 h")
        XCTAssertEqual(label(7_200_000), "2.0 h")
        XCTAssertEqual(label(86_399_999), "24.0 h")
    }

    func testDaysBranchOneDecimal() {
        XCTAssertEqual(label(86_400_000), "1.0 d")
        XCTAssertEqual(label(129_600_000), "1.5 d")
    }
}

// MARK: - Tooltip (web `desc (age: …)` composer)

final class SourceLayerBadgeTooltipBuilderTests: XCTestCase {
    func testWithoutAgeIsDescriptionAlone() {
        let tooltip = SourceLayerBadgeTooltipBuilder.tooltip(
            description: "Replayed from signal_log (durable history).",
            ageText: nil,
            ageLabel: "age"
        )
        XCTAssertEqual(tooltip, "Replayed from signal_log (durable history).")
    }

    func testWithAgeAppendsParenthetical() {
        let tooltip = SourceLayerBadgeTooltipBuilder.tooltip(
            description: "Read from the in-process SignalStore (hot path, freshest).",
            ageText: "350 ms",
            ageLabel: "age"
        )
        XCTAssertEqual(
            tooltip,
            "Read from the in-process SignalStore (hot path, freshest). (age: 350 ms)"
        )
    }
}

// MARK: - Accessibility (tooltip + offline note)

final class SourceLayerBadgeAccessibilityTests: XCTestCase {
    func testOnlineLabelIsTooltipAlone() {
        XCTAssertEqual(
            SourceLayerBadgeAccessibility.label(tooltip: "Source layer unknown.", offlineNote: nil),
            "Source layer unknown."
        )
    }

    func testOfflineLabelAppendsNote() {
        XCTAssertEqual(
            SourceLayerBadgeAccessibility.label(
                tooltip: "Read from the in-process SignalStore (hot path, freshest). (age: 950 ms)",
                offlineNote: "Offline — showing the last known value"
            ),
            "Read from the in-process SignalStore (hot path, freshest). (age: 950 ms), "
                + "Offline — showing the last known value"
        )
    }
}

// MARK: - Metadata (static identity)

final class SourceLayerBadgeMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(SourceLayerBadgeMeta.surfaceSlug, "SourceLayerBadge")
        XCTAssertEqual(SourceLayerBadge.surfaceSlug, "SourceLayerBadge")
    }
}
