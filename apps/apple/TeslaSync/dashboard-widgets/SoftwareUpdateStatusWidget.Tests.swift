//
//  SoftwareUpdateStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0092 · SoftwareUpdateStatusWidget (Apple)
//
//  Adapter + accessibility coverage for the SoftwareUpdateStatusWidget surface:
//    • Adapter (cached input → projection) — `SoftwareStatusProjectionBuilder`
//      parity with the web SoftwareUpdateStatusWidget.tsx data pipeline (version
//      narrowing, the `updateStatus` memo + ordering, the stage→chip map, the
//      `${pct}%` / `~${duration}` rendering, the `MetricBar` fill maths).
//    • Accessibility — the VoiceOver summary content for each state.
//
//  State-holder, registry, and layout coverage live in
//  SoftwareUpdateStatusWidget.ModelTests.swift (split to keep each file focused).
//  These run in the TeslaSync(/-macOS) XCTest targets — no network, no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached input → projection (parity with the web data pipeline)

final class SoftwareStatusAdapterTests: XCTestCase {
    // MARK: Version narrowing (web truthiness)

    func testNonEmptyAndDisplayVersion() {
        XCTAssertNil(SoftwareStatusProjectionBuilder.nonEmpty(nil))
        XCTAssertNil(SoftwareStatusProjectionBuilder.nonEmpty(""))
        XCTAssertEqual(SoftwareStatusProjectionBuilder.nonEmpty("2024.8"), "2024.8")
        // Whitespace stays truthy (JS `!' '` is false).
        XCTAssertEqual(SoftwareStatusProjectionBuilder.nonEmpty(" "), " ")

        XCTAssertEqual(SoftwareStatusProjectionBuilder.displayVersion(nil), "—")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.displayVersion(""), "—")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.displayVersion("2024.20.1"), "2024.20.1")
    }

    // MARK: Stage (web `updateStatus` memo + ordering)

    func testUpdateStageUpToDateWhenNoUpdate() {
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: nil, downloadPct: 50, installPct: 50),
            .upToDate
        )
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "", downloadPct: 100, installPct: 100),
            .upToDate
        )
    }

    func testUpdateStageInstallingWinsOverDownloading() {
        // Web order: in-flight install is checked before in-flight download.
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 50, installPct: 50),
            .installing
        )
    }

    func testUpdateStageDownloading() {
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 50, installPct: nil),
            .downloading
        )
    }

    func testUpdateStageInstalledAndReadyTerminals() {
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 100, installPct: 100),
            .installed
        )
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 100, installPct: nil),
            .ready
        )
        // installPct 0 is not in-flight and not terminal ⇒ falls through to download.
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 100, installPct: 0),
            .ready
        )
    }

    func testUpdateStageAvailableFallthrough() {
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: nil, installPct: nil),
            .available
        )
        // downloadPct 0 is present but not in-flight / terminal ⇒ available.
        XCTAssertEqual(
            SoftwareStatusProjectionBuilder.updateStage(updateVersion: "v", downloadPct: 0, installPct: nil),
            .available
        )
    }

    // MARK: Stage → chip (web `StatusBadgeSmall` config)

    func testBadgeMappingPerStage() {
        let expected: [SoftwareStatusStage: (String, SoftwareStatusBadgeVariant)] = [
            .upToDate: ("widget.statusUpToDate", .success),
            .available: ("widget.statusAvailable", .info),
            .downloading: ("widget.statusDownloading", .warning),
            .ready: ("widget.statusReady", .info),
            .installing: ("widget.statusInstalling", .warning),
            .installed: ("widget.statusInstalled", .success)
        ]
        for stage in SoftwareStatusStage.allCases {
            let badge = SoftwareStatusProjectionBuilder.badge(for: stage)
            XCTAssertEqual(badge.label.key, expected[stage]?.0, "label key for \(stage)")
            XCTAssertEqual(badge.variant, expected[stage]?.1, "variant for \(stage)")
        }
    }

    // MARK: Number rendering (web template literals)

    func testJsNumberStringIntegralVsFractional() {
        XCTAssertEqual(SoftwareStatusProjectionBuilder.jsNumberString(47), "47")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.jsNumberString(0), "0")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.jsNumberString(100), "100")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.jsNumberString(47.5), "47.5")
    }

    func testPercentAndDurationText() {
        XCTAssertEqual(SoftwareStatusProjectionBuilder.percentText(47), "47%")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.percentText(100), "100%")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.percentText(62.5), "62.5%")
        XCTAssertEqual(SoftwareStatusProjectionBuilder.durationText(15), "~15")
    }

    // MARK: MetricBar fill

    func testFractionClampAndRange() {
        XCTAssertEqual(SoftwareStatusProjectionBuilder.fraction(47), 0.47, accuracy: 0.0001)
        XCTAssertEqual(SoftwareStatusProjectionBuilder.fraction(150), 1, accuracy: 0.0001)
        XCTAssertEqual(SoftwareStatusProjectionBuilder.fraction(-5), 0, accuracy: 0.0001)
        XCTAssertEqual(SoftwareStatusProjectionBuilder.fraction(100), 1, accuracy: 0.0001)
        XCTAssertEqual(SoftwareStatusProjectionBuilder.fraction(.nan), 0, accuracy: 0.0001)
    }

    func testPositiveDuration() {
        XCTAssertEqual(SoftwareStatusProjectionBuilder.positiveDuration(15), 15)
        XCTAssertNil(SoftwareStatusProjectionBuilder.positiveDuration(0))
        XCTAssertNil(SoftwareStatusProjectionBuilder.positiveDuration(-5))
        XCTAssertNil(SoftwareStatusProjectionBuilder.positiveDuration(nil))
        XCTAssertNil(SoftwareStatusProjectionBuilder.positiveDuration(.infinity))
    }

    // MARK: Projection assembly

    func testBuildEmptyWhenNoInput() {
        let projection = SoftwareStatusProjectionBuilder.build(input: nil)
        XCTAssertFalse(projection.hasData)
        XCTAssertEqual(projection.currentVersion, "—")
        XCTAssertNil(projection.updateVersion)
        XCTAssertNil(projection.progress)
        XCTAssertFalse(projection.showsUpdateSection)
    }

    func testBuildUpToDateProjection() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(softwareVersion: "2024.8.10")
        )
        XCTAssertTrue(projection.hasData)
        XCTAssertEqual(projection.currentVersion, "2024.8.10")
        XCTAssertEqual(projection.stage, .upToDate)
        XCTAssertEqual(projection.statusBadge.label.key, "widget.statusUpToDate")
        XCTAssertNil(projection.updateVersion)
        XCTAssertNil(projection.progress)
        XCTAssertFalse(projection.showsUpdateSection)
    }

    func testBuildDownloadingProjection() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                downloadPct: 47
            )
        )
        XCTAssertEqual(projection.stage, .downloading)
        XCTAssertTrue(projection.showsUpdateSection)
        XCTAssertEqual(projection.updateVersion, "2024.20.1")
        let progress = try? XCTUnwrap(projection.progress)
        XCTAssertEqual(progress?.kind, .downloading)
        XCTAssertEqual(progress?.percentText, "47%")
        XCTAssertEqual(progress?.fraction ?? 0, 0.47, accuracy: 0.0001)
        XCTAssertEqual(progress?.label.key, "widget.downloading")
    }

    func testBuildInstallingProjectionWithEstimateAndSchedule() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                installPct: 62,
                expectedDurationMinutes: 15,
                scheduledStart: "Tonight, 2:00 AM"
            )
        )
        XCTAssertEqual(projection.stage, .installing)
        XCTAssertEqual(projection.progress?.kind, .installing)
        XCTAssertEqual(projection.progress?.percentText, "62%")
        XCTAssertEqual(projection.expectedDurationMinutes, 15)
        XCTAssertEqual(projection.expectedDurationText, "~15")
        XCTAssertEqual(projection.scheduledStart, "Tonight, 2:00 AM")
    }

    func testBuildReadyProjectionHasNoBar() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                downloadPct: 100
            )
        )
        XCTAssertEqual(projection.stage, .ready)
        XCTAssertTrue(projection.showsUpdateSection)
        XCTAssertNil(projection.progress) // ready shows a message, not a bar
    }

    func testBuildSuppressesEmptyScheduleAndNonPositiveEstimate() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                installPct: 30,
                expectedDurationMinutes: 0,
                scheduledStart: ""
            )
        )
        XCTAssertNil(projection.expectedDurationMinutes)
        XCTAssertNil(projection.expectedDurationText)
        XCTAssertNil(projection.scheduledStart)
    }
}

// MARK: - Accessibility summary content

final class SoftwareStatusAccessibilityTests: XCTestCase {
    func testDownloadingSummary() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                downloadPct: 47
            )
        )
        let summary = SoftwareStatusAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Downloading"))
        XCTAssertTrue(summary.contains("Current Version: 2024.8.10"))
        XCTAssertTrue(summary.contains("Update: 2024.20.1"))
        XCTAssertTrue(summary.contains("47%"))
    }

    func testReadySummary() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(
                softwareVersion: "2024.8.10",
                updateVersion: "2024.20.1",
                downloadPct: 100
            )
        )
        XCTAssertTrue(SoftwareStatusAccessibility.summary(for: projection).contains("Ready to install"))
    }

    func testUpToDateSummary() {
        let projection = SoftwareStatusProjectionBuilder.build(
            input: SoftwareStatusInput(softwareVersion: "2024.8.10")
        )
        let summary = SoftwareStatusAccessibility.summary(for: projection)
        XCTAssertTrue(summary.contains("Up to date"))
        XCTAssertTrue(summary.contains("2024.8.10"))
    }

    func testEmptySummary() {
        XCTAssertEqual(SoftwareStatusAccessibility.summary(for: .empty), "No software data")
    }
}
