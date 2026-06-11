//
//  MetricCard.Tests.swift
//  TeslaSync — P4 shared surface · 0095 · MetricCard (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value
//  types live in MetricCard.AdapterTests.swift; split to keep each file within the SwiftLint
//  file-length budget):
//    • MetricCardModel — the once-only `view.opened`, the props update + identical-update guard, the
//      derived projection, the combined value VoiceOver label, and the help / delta labels.
//    • Views — the content view + the public surface compose in every branch; the color / tone / arrow
//      token projections resolve.
//    • Strings — the four composed-source i18n keys resolve through the P1/S10 facade with the web
//      English fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - MetricCardModel (surface lifecycle + derivation)

@MainActor
final class MetricCardModelTests: XCTestCase {
    private func model(
        _ inputs: MetricCardInputs,
        telemetry: MetricCardTelemetry = OSLogMetricCardTelemetry()
    ) -> MetricCardModel {
        MetricCardModel(inputs: inputs, telemetry: telemetry)
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyMetricCardTelemetry()
        let card = model(.init(label: "Range", value: .number(312)), telemetry: spy)
        card.start()
        card.start()
        XCTAssertEqual(spy.surfaces, [MetricCardSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyMetricCardTelemetry()
        let card = model(.init(label: "Range", value: .number(312)), telemetry: spy)
        card.start()
        card.stop()
        card.start()
        XCTAssertEqual(spy.surfaces, [MetricCardSurface.slug], "view.opened fires once per instance")
    }

    func testProjectionReflectsInputs() {
        let card = model(.init(
            label: "Range",
            value: .text("312 mi"),
            change: .init(value: "4%", positive: true)
        ))
        XCTAssertEqual(card.projection.valueText, "312 mi")
        guard case .change = card.projection.trend else { return XCTFail("expected change pill") }
    }

    func testUpdateChangesProjectionAndGuardsIdentical() {
        let initial = MetricCardInputs(label: "Range", value: .number(298))
        let card = model(initial)
        card.update(initial)
        XCTAssertEqual(card.projection.valueText, "298")
        card.update(.init(label: "Range", value: .number(312)))
        XCTAssertEqual(card.projection.valueText, "312")
    }

    func testValueAccessibilityLabelCombinesLabelValueSubtitle() {
        XCTAssertEqual(
            model(.init(label: "Range", value: .number(312))).valueAccessibilityLabel,
            "Range, 312"
        )
        XCTAssertEqual(
            model(.init(label: "Range", value: .number(312), subtitle: "since last charge"))
                .valueAccessibilityLabel,
            "Range, 312, since last charge"
        )
    }

    func testHelpAccessibilityLabelDefaultAndOverride() {
        let withHelp = model(.init(
            label: "Range", value: .number(312),
            help: .init(text: "Estimated remaining range.")
        ))
        XCTAssertEqual(withHelp.helpAccessibilityLabel, "More info about Range")

        let overridden = model(.init(
            label: "Range", value: .number(312),
            help: .init(text: "Estimated remaining range.", ariaLabel: "Range help")
        ))
        XCTAssertEqual(overridden.helpAccessibilityLabel, "Range help")
    }

    func testLearnMoreLabelDefaultAndOverride() throws {
        let docURL = try XCTUnwrap(URL(string: "https://teslasync.io/docs"))
        let defaulted = model(.init(
            label: "Range", value: .number(312),
            help: .init(text: "x", learnMore: .init(url: docURL))
        ))
        XCTAssertEqual(defaulted.learnMoreLabel, "Learn more")

        let overridden = model(.init(
            label: "Range", value: .number(312),
            help: .init(text: "x", learnMore: .init(url: docURL, label: "Read the docs"))
        ))
        XCTAssertEqual(overridden.learnMoreLabel, "Read the docs")
    }

    func testDeltaAccessibilityLabel() {
        let card = model(.init(label: "Range", value: .number(312)))
        let populated = MetricCardDeltaProjector.resolve(
            .init(direction: .higherBetter, current: 312, previous: 298),
            fallbackCurrent: nil
        )
        XCTAssertEqual(card.deltaAccessibilityLabel(for: populated), "312.00 vs 298.00")
        XCTAssertEqual(
            card.deltaAccessibilityLabel(for: .empty(comparedTo: nil, size: .sm)),
            "No comparison data"
        )
    }
}

// MARK: - Views (every branch composes + token projections)

@MainActor
final class MetricCardViewCompositionTests: XCTestCase {
    func testSurfaceComposesForEveryInitAndBranch() {
        _ = MetricCard(label: "Range", value: .number(312), iconSystemName: "bolt.fill")
        _ = MetricCard(label: "Odometer", value: 132_004, color: .blue)
        _ = MetricCard(label: "Distance", value: "48,210 km", color: .green)
        _ = MetricCard(
            label: "Range", value: "312 mi",
            change: MetricCardChange(value: "4%", positive: true)
        )
        _ = MetricCard(
            label: "Efficiency", value: 268, color: .green,
            delta: MetricCardDelta(direction: .lowerBetter, previous: 281, unitSuffix: "Wh/mi")
        )
        _ = MetricCard(
            label: "Battery health", value: "94%", subtitle: "since last charge",
            help: MetricCardHelp(text: "Usable capacity vs original.")
        )
    }

    func testSurfaceComposesFromInjectedModel() {
        let injected = MetricCardModel(
            inputs: .init(label: "Range", value: .number(312)),
            telemetry: SpyMetricCardTelemetry()
        )
        _ = MetricCard(model: injected)
        XCTAssertEqual(MetricCard.surfaceSlug, "MetricCard")
    }

    func testContentViewComposesForEveryTrendArm() {
        let arms: [MetricCardInputs] = [
            .init(label: "A", value: .number(1)),
            .init(label: "B", value: .number(1), change: .init(value: "2%", positive: false)),
            .init(
                label: "C",
                value: .number(312),
                delta: .init(direction: .higherBetter, previous: 298)
            ),
            .init(label: "D", value: .number(1), delta: .init(direction: .neutral, previous: nil)),
            .init(label: "E", value: .number(0), delta: .init(
                direction: .higherBetter,
                previous: 1,
                loading: true
            ))
        ]
        for inputs in arms {
            _ = MetricCardContentView(
                inputs: inputs,
                projection: MetricCardProjector.resolve(inputs),
                valueAccessibilityLabel: "label",
                helpAccessibilityLabel: "More info",
                learnMoreLabel: "Learn more"
            )
        }
    }

    func testTokenProjectionsAreResolvable() {
        XCTAssertEqual(Set(MetricCardColor.allCases.map { "\($0.tint)" }).count, 6)
        XCTAssertEqual(MetricCardTone.success.color, Color.TS.statusSuccess)
        XCTAssertEqual(MetricCardTone.danger.color, Color.TS.statusDanger)
        XCTAssertEqual(MetricCardTone.muted.color, Color.TS.textMuted)
        XCTAssertEqual(MetricCardTone.secondary.color, Color.TS.textSecondary)
        XCTAssertEqual(MetricCardDeltaArrow.up.systemName, "arrow.up")
        XCTAssertNil(MetricCardDeltaArrow.hidden.systemName)
    }
}

// MARK: - Strings facade (P1/S10)

final class MetricCardStringsTests: XCTestCase {
    func testHelpAriaLabelInterpolatesMetricLabel() {
        XCTAssertEqual(MetricCardStrings.helpAccessibilityLabel(label: "Range"), "More info about Range")
    }

    func testLearnMoreFallback() {
        XCTAssertEqual(MetricCardStrings.learnMoreLabel, "Learn more")
    }

    func testDeltaTitleInterpolatesEndpoints() {
        XCTAssertEqual(MetricCardStrings.deltaTitle(current: "312", previous: "298"), "312 vs 298")
    }

    func testDeltaNoComparisonFallback() {
        XCTAssertEqual(MetricCardStrings.deltaNoComparison, "No comparison data")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it
/// satisfies the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyMetricCardTelemetry: MetricCardTelemetry, @unchecked Sendable {
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
