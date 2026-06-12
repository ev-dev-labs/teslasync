//
//  UptimeHeatmap.Tests.swift
//  TeslaSync — P4 shared surface · 0202 · UptimeHeatmap (Apple)
//
//  The state-holder + view-composition + facade half of the coverage (the pure projection + value types
//  + the percent formatter live in UptimeHeatmap.AdapterTests.swift; split to keep each file within the
//  SwiftLint file-length budget):
//    • UptimeHeatmapModel — the once-only `view.opened`, the props update + identical-update guard, the
//      derived projection, the composed heading / caption / empty copy, and the resolved squares.
//    • Status / tier → tone — each maps to the expected ``TSTone`` token.
//    • Views — the content view, the square + its detail popover, the empty view, and the public surface
//      compose in every branch.
//    • Strings — the heading / caption / status labels / a11y / empty copy resolve through the P1/S10
//      facade with the expected fallbacks.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network; the derivation is pure.
//

import SwiftUI
import XCTest
@testable import TeslaSync

// MARK: - UptimeHeatmapModel (surface lifecycle + derivation)

@MainActor
final class UptimeHeatmapModelTests: XCTestCase {
    private func days(_ count: Int, status: UptimeStatus = .healthy) -> [UptimeDay] {
        (0 ..< count).map { UptimeDay(date: String(format: "2026-06-%02d", $0 + 1), status: status) }
    }

    private func model(
        days: [UptimeDay],
        title: String? = nil,
        footnote: String? = nil,
        telemetry: any UptimeHeatmapTelemetry = OSLogUptimeHeatmapTelemetry()
    ) -> UptimeHeatmapModel {
        UptimeHeatmapModel(
            inputs: UptimeHeatmapInputs(days: days, title: title, footnote: footnote),
            telemetry: telemetry
        )
    }

    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let spy = SpyUptimeHeatmapTelemetry()
        let sut = model(days: days(3), telemetry: spy)
        sut.start()
        sut.start()
        XCTAssertEqual(spy.surfaces, [UptimeHeatmapSurface.slug])
    }

    func testViewOpenedNotReEmittedAfterStopStart() {
        let spy = SpyUptimeHeatmapTelemetry()
        let sut = model(days: days(3), telemetry: spy)
        sut.start()
        sut.stop()
        sut.start()
        XCTAssertEqual(spy.surfaces, [UptimeHeatmapSurface.slug], "view.opened fires once per instance")
    }

    func testUpdateChangesProjectionAndIdenticalUpdateIsNoOp() {
        let sut = model(days: days(3))
        XCTAssertEqual(sut.projection.dayCount, 3)
        sut.update(UptimeHeatmapInputs(days: days(5)))
        XCTAssertEqual(sut.projection.dayCount, 5)
        sut.update(UptimeHeatmapInputs(days: days(5)))
        XCTAssertEqual(sut.projection.dayCount, 5)
    }

    func testHeadingDefaultUsesDayCount() {
        XCTAssertEqual(model(days: days(5)).heading, "Uptime — last 5 days")
    }

    func testHeadingOverrideWins() {
        XCTAssertEqual(model(days: days(5), title: "Fleet API").heading, "Fleet API")
    }

    func testUptimeCaptionPresentWhenPopulated() {
        XCTAssertEqual(model(days: days(4)).uptimeCaption, "100.00% uptime")
        XCTAssertEqual(model(days: days(4)).tier, .high)
    }

    func testUptimeCaptionNilWhenEmpty() {
        let sut = model(days: [])
        XCTAssertNil(sut.uptimeCaption)
        XCTAssertNil(sut.tier)
        XCTAssertTrue(sut.isEmpty)
    }

    func testEmptyCopyAndGridLabelResolve() {
        let sut = model(days: [])
        XCTAssertEqual(sut.emptyTitle, "No status history")
        XCTAssertEqual(sut.gridAccessibilityLabel, "Daily status history")
        XCTAssertFalse(sut.emptyMessage.isEmpty)
    }

    func testFootnotePassesThrough() {
        XCTAssertEqual(model(days: days(2), footnote: "UTC").footnote, "UTC")
        XCTAssertNil(model(days: days(2)).footnote)
    }

    func testResolvedSquaresCarryLocalizedLabels() {
        let sut = model(days: [
            UptimeDay(date: "2026-06-01", status: .healthy, summary: "ok"),
            UptimeDay(date: "2026-06-02", status: .unhealthy)
        ])
        let squares = sut.resolvedSquares
        XCTAssertEqual(squares.count, 2)
        XCTAssertEqual(squares[0].statusLabel, "Operational")
        XCTAssertEqual(squares[0].accessibilityLabel, "2026-06-01: Operational")
        XCTAssertEqual(squares[0].summary, "ok")
        XCTAssertEqual(squares[1].statusLabel, "Outage")
        XCTAssertNil(squares[1].summary)
    }
}

// MARK: - Status / tier → tone tokens

@MainActor
final class UptimeHeatmapToneTests: XCTestCase {
    func testStatusMapsToTone() {
        XCTAssertEqual(UptimeStatus.healthy.tone, .success)
        XCTAssertEqual(UptimeStatus.degraded.tone, .warning)
        XCTAssertEqual(UptimeStatus.unhealthy.tone, .danger)
        XCTAssertEqual(UptimeStatus.unknown.tone, .neutral)
        XCTAssertEqual(UptimeStatus.maintenance.tone, .info)
    }

    func testStatusTonesAreDistinct() {
        let tones = UptimeStatus.allCases.map { "\($0.tone)" }
        XCTAssertEqual(Set(tones).count, UptimeStatus.allCases.count)
    }

    func testTierMapsToTone() {
        XCTAssertEqual(UptimeTier.high.tone, .success)
        XCTAssertEqual(UptimeTier.medium.tone, .warning)
        XCTAssertEqual(UptimeTier.low.tone, .danger)
    }
}

// MARK: - Views (every branch composes)

@MainActor
final class UptimeHeatmapViewCompositionTests: XCTestCase {
    func testSurfaceComposesForPopulatedAndEmpty() {
        _ = UptimeHeatmap(
            days: [UptimeDay(date: "2026-06-01", status: .healthy, summary: "ok")],
            title: "Status",
            footnote: "UTC"
        )
        _ = UptimeHeatmap(days: [])
        XCTAssertEqual(UptimeHeatmap.surfaceSlug, "UptimeHeatmap")
    }

    func testContentViewComposesForPopulatedAndEmpty() {
        let populated = UptimeHeatmapModel(inputs: UptimeHeatmapInputs(
            days: [UptimeDay(date: "2026-06-01", status: .maintenance, summary: "window")],
            footnote: "UTC"
        ))
        _ = UptimeHeatmapContentView(model: populated)
        _ = UptimeHeatmapContentView(model: UptimeHeatmapModel(inputs: UptimeHeatmapInputs(days: [])))
    }

    func testSquareAndDetailComposeForEveryStatusAndSummary() {
        for status in UptimeStatus.allCases {
            let withSummary = ResolvedUptimeSquare(
                id: 0, status: status, dateText: "2026-06-01",
                statusLabel: "Label", summary: "summary", accessibilityLabel: "2026-06-01: Label"
            )
            let withoutSummary = ResolvedUptimeSquare(
                id: 1, status: status, dateText: "2026-06-02",
                statusLabel: "Label", summary: nil, accessibilityLabel: "2026-06-02: Label"
            )
            _ = UptimeDaySquareView(square: withSummary)
            _ = UptimeDayDetailView(square: withSummary)
            _ = UptimeDayDetailView(square: withoutSummary)
        }
    }

    func testEmptyViewComposes() {
        _ = UptimeHeatmapEmptyView(title: "No status history", message: "history appears here")
    }
}

// MARK: - Strings facade (P1/S10)

final class UptimeHeatmapStringsTests: XCTestCase {
    func testHeadingDefaultAndOverride() {
        XCTAssertEqual(
            UptimeHeatmapStrings.heading(titleOverride: nil, dayCount: 7),
            "Uptime — last 7 days"
        )
        XCTAssertEqual(
            UptimeHeatmapStrings.heading(titleOverride: "Fleet API", dayCount: 7),
            "Fleet API"
        )
    }

    func testUptimeCaptionFormat() {
        XCTAssertEqual(UptimeHeatmapStrings.uptimeCaption(percentText: "99.50%"), "99.50% uptime")
    }

    func testStatusLabelsMatchWebMap() {
        XCTAssertEqual(UptimeHeatmapStrings.statusLabel(.healthy), "Operational")
        XCTAssertEqual(UptimeHeatmapStrings.statusLabel(.degraded), "Degraded")
        XCTAssertEqual(UptimeHeatmapStrings.statusLabel(.unhealthy), "Outage")
        XCTAssertEqual(UptimeHeatmapStrings.statusLabel(.unknown), "Unknown")
        XCTAssertEqual(UptimeHeatmapStrings.statusLabel(.maintenance), "Maintenance")
    }

    func testSquareAccessibilityLabelFormat() {
        XCTAssertEqual(
            UptimeHeatmapStrings.squareAccessibilityLabel(date: "2026-06-01", statusLabel: "Operational"),
            "2026-06-01: Operational"
        )
    }

    func testGridLabelEmptyCopyAndTableName() {
        XCTAssertEqual(UptimeHeatmapStrings.gridAccessibilityLabel, "Daily status history")
        XCTAssertEqual(UptimeHeatmapStrings.emptyTitle, "No status history")
        XCTAssertEqual(
            UptimeHeatmapStrings.emptyMessage,
            "Daily status appears here once health history is recorded."
        )
        XCTAssertEqual(UptimeHeatmapStrings.table, "UptimeHeatmap")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted. Lock-guarded so it satisfies
/// the `Sendable` telemetry seam under Swift 6 strict concurrency.
private final class SpyUptimeHeatmapTelemetry: UptimeHeatmapTelemetry, @unchecked Sendable {
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
