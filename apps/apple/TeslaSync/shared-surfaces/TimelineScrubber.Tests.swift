//
//  TimelineScrubber.Tests.swift
//  TeslaSync — P4 shared surface · 0107 · TimelineScrubber (Apple)
//
//  The Foundation-only coverage for the TimelineScrubber surface:
//    • Adapter (the data adapter: clamp / percent / time-text / throttle decision).
//    • Accessibility — the spoken scrubber value + marker label (with / without a label) + count.
//    • Projection (cached snapshot → resolved) — leaf-contract precedence (error > loading > empty >
//      content), clamped progress / buffered, the percent, and the spoken value text.
//    • Meta — the diagnostics slug.
//
//  The state-holder / source-seam coverage lives in the sibling TimelineScrubber.ModelTests.swift.
//  These run in the TeslaSync(/-macOS) XCTest targets with no network and an identity string resolver
//  so the copy reads as the shipped English fallback.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - Fixtures

private let resolve: TimelineScrubberResolve = { _, fallback in fallback }

private func contentInput(
    connection: TimelineScrubberConnection = .live,
    progress: Double = 0.5,
    buffered: Double? = 0.6,
    durationSeconds: Double = 372
) -> TimelineScrubberInput {
    TimelineScrubberInput(
        progress: progress,
        buffered: buffered,
        durationSeconds: durationSeconds,
        markers: [TimelineScrubberMarker(at: 0.41, kind: .regenPeak, label: "Regen", count: 3)],
        connection: connection
    )
}

// MARK: - Adapter

final class TimelineScrubberAdapterTests: XCTestCase {
    func testClamp01ClampsAndPassesThrough() {
        XCTAssertEqual(TimelineScrubberAdapter.clamp01(-0.5), 0)
        XCTAssertEqual(TimelineScrubberAdapter.clamp01(1.5), 1)
        XCTAssertEqual(TimelineScrubberAdapter.clamp01(0.42), 0.42, accuracy: 1e-9)
    }

    func testClamp01NonFiniteIsZero() {
        XCTAssertEqual(TimelineScrubberAdapter.clamp01(.nan), 0)
        XCTAssertEqual(TimelineScrubberAdapter.clamp01(.infinity), 0)
    }

    func testPercentRoundsAndClamps() {
        XCTAssertEqual(TimelineScrubberAdapter.percent(0.41), 41)
        XCTAssertEqual(TimelineScrubberAdapter.percent(0.005), 1)
        XCTAssertEqual(TimelineScrubberAdapter.percent(1.4), 100)
        XCTAssertEqual(TimelineScrubberAdapter.percent(-2), 0)
    }

    func testTimeTextFromDurationAndProgress() {
        // 372s, 50% → 186s → 3:06; 100% → 6:12.
        XCTAssertEqual(TimelineScrubberAdapter.timeText(durationSeconds: 372, progress: 0.5), "3:06")
        XCTAssertEqual(TimelineScrubberAdapter.timeText(durationSeconds: 372, progress: 1), "6:12")
    }

    func testTimeTextPadsSeconds() {
        XCTAssertEqual(TimelineScrubberAdapter.timeText(durationSeconds: 65, progress: 1), "1:05")
        XCTAssertEqual(TimelineScrubberAdapter.timeText(durationSeconds: 9, progress: 1), "0:09")
    }

    func testTimeTextNilWhenDurationUnknown() {
        XCTAssertNil(TimelineScrubberAdapter.timeText(durationSeconds: 0, progress: 0.5))
        XCTAssertNil(TimelineScrubberAdapter.timeText(durationSeconds: -5, progress: 0.5))
        XCTAssertNil(TimelineScrubberAdapter.timeText(durationSeconds: .nan, progress: 0.5))
    }

    func testShouldEmitThrottleDecision() {
        let base = Date(timeIntervalSince1970: 1000)
        XCTAssertTrue(TimelineScrubberAdapter.shouldEmit(now: base, last: .distantPast))
        XCTAssertTrue(TimelineScrubberAdapter.shouldEmit(now: base.addingTimeInterval(0.06), last: base))
        XCTAssertFalse(TimelineScrubberAdapter.shouldEmit(now: base.addingTimeInterval(0.02), last: base))
    }
}

// MARK: - Accessibility

final class TimelineScrubberAccessibilityTests: XCTestCase {
    func testScrubberValueUsesTimeWhenDurationKnown() {
        XCTAssertEqual(
            TimelineScrubberAccessibility.scrubberValue(durationSeconds: 372, progress: 0.5),
            "3:06"
        )
    }

    func testScrubberValueFallsBackToPercent() {
        XCTAssertEqual(
            TimelineScrubberAccessibility.scrubberValue(durationSeconds: 0, progress: 0.42),
            "42%"
        )
    }

    func testMarkerLabelWithLabel() {
        let marker = TimelineScrubberMarker(at: 0.42, kind: .regenPeak, label: "Regen peak")
        XCTAssertEqual(
            TimelineScrubberAccessibility.markerLabel(marker, strings: resolve),
            "Regen peak, at 42%"
        )
    }

    func testMarkerLabelWithoutLabelUsesKind() {
        let marker = TimelineScrubberMarker(at: 0.4, kind: .lowSoc)
        XCTAssertEqual(
            TimelineScrubberAccessibility.markerLabel(marker, strings: resolve),
            "lowSoc 40%"
        )
    }

    func testMarkerCountLabel() {
        XCTAssertEqual(TimelineScrubberAccessibility.markerCountLabel(3, strings: resolve), "3 events")
    }
}

// MARK: - Projection

final class TimelineScrubberProjectionTests: XCTestCase {
    func testErrorTakesPrecedenceOverLoadingAndContent() {
        let input = TimelineScrubberInput(durationSeconds: 100, isLoading: true, errorMessage: "boom")
        XCTAssertEqual(TimelineScrubberProjection.resolve(input).phase, .error("boom"))
    }

    func testBlankErrorDoesNotTriggerErrorPhase() {
        let input = TimelineScrubberInput(durationSeconds: 100, errorMessage: "")
        XCTAssertEqual(TimelineScrubberProjection.resolve(input).phase, .content)
    }

    func testLoadingWhenFlaggedAndNoError() {
        let input = TimelineScrubberInput(durationSeconds: 100, isLoading: true)
        XCTAssertEqual(TimelineScrubberProjection.resolve(input).phase, .loading)
    }

    func testEmptyWhenNoTimeline() {
        XCTAssertEqual(TimelineScrubberProjection.resolve(TimelineScrubberInput(durationSeconds: 0)).phase, .empty)
        XCTAssertEqual(TimelineScrubberProjection.resolve(TimelineScrubberInput(durationSeconds: -1)).phase, .empty)
    }

    func testContentWhenDurationPositive() {
        let resolved = TimelineScrubberProjection.resolve(contentInput())
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertTrue(resolved.isContent)
        XCTAssertEqual(resolved.markers.count, 1)
    }

    func testClampsProgressAndBuffered() {
        let resolved = TimelineScrubberProjection.resolve(contentInput(progress: 1.4, buffered: -0.3))
        XCTAssertEqual(resolved.progress, 1)
        XCTAssertEqual(resolved.buffered, 0)
    }

    func testNilBufferedStaysNil() {
        let resolved = TimelineScrubberProjection.resolve(contentInput(buffered: nil))
        XCTAssertNil(resolved.buffered)
    }

    func testProgressPercentAndValueText() {
        let resolved = TimelineScrubberProjection.resolve(contentInput(progress: 0.5))
        XCTAssertEqual(resolved.progressPercent, 50)
        XCTAssertEqual(resolved.scrubberValueText, "3:06")
    }

    func testValueTextFallsBackToPercentWhenNoDuration() {
        let resolved = TimelineScrubberProjection.resolve(
            TimelineScrubberInput(progress: 0.25, durationSeconds: 0, isLoading: true)
        )
        XCTAssertEqual(resolved.scrubberValueText, "25%")
    }

    func testConnectionPassesThrough() {
        XCTAssertEqual(TimelineScrubberProjection.resolve(contentInput(connection: .offline)).connection, .offline)
    }
}

// MARK: - Meta

@MainActor
final class TimelineScrubberMetaTests: XCTestCase {
    func testSurfaceSlug() {
        XCTAssertEqual(TimelineScrubberMeta.surfaceSlug, "TimelineScrubber")
        XCTAssertEqual(TimelineScrubber.surfaceSlug, "TimelineScrubber")
    }

    func testScrubIntervalMatchesWeb() {
        XCTAssertEqual(TimelineScrubberMeta.scrubInterval, 0.05, accuracy: 1e-9)
    }
}
