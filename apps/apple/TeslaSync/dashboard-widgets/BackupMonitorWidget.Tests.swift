//
//  BackupMonitorWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0009 · BackupMonitorWidget (Apple)
//
//  Adapter (cached → projection) coverage for the BackupMonitorWidget surface:
//    • Status mapping — `BackupMonitorRunStatus` raw parsing, the web
//      `statusVariant`/`statusLabel` tone+label, and the `=== 'failed'` tile flag.
//    • Byte formatter — verbatim parity with the web `fmtBytes`.
//    • Relative-time formatter — parity with the web `fmtRelativeTime`.
//    • Projection — `ordered` sort (completedAt ?? createdAt desc), the `latest`
//      badge/grid fields, and the `recentRows` slice(0,5) + "size · duration".
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store; the projection is pure.
//

import XCTest
@testable import TeslaSync

// MARK: - Helpers

private let enUS = Locale(identifier: "en_US")
private let fixedNow = Date(timeIntervalSince1970: 1_700_000_000)

private func minutesBefore(_ minutes: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-minutes * 60))
}

private func daysBefore(_ days: Int) -> Date {
    fixedNow.addingTimeInterval(TimeInterval(-days * 86400))
}

// MARK: - Status mapping (parity with the web statusVariant/statusLabel)

@MainActor final class BackupRunStatusTests: XCTestCase {
    func testRawParsingRoundTrips() {
        XCTAssertEqual(BackupMonitorRunStatus(raw: "completed"), .completed)
        XCTAssertEqual(BackupMonitorRunStatus(raw: "failed"), .failed)
        XCTAssertEqual(BackupMonitorRunStatus(raw: "running"), .running)
        XCTAssertEqual(BackupMonitorRunStatus(raw: "queued"), .queued)
        XCTAssertEqual(BackupMonitorRunStatus(raw: "weird"), .other("weird"))
        XCTAssertEqual(BackupMonitorRunStatus(raw: "weird").rawValue, "weird")
    }

    func testToneMatchesWebStatusVariant() {
        XCTAssertEqual(BackupMonitorRunStatus.completed.tone, .success)
        XCTAssertEqual(BackupMonitorRunStatus.running.tone, .warning)
        XCTAssertEqual(BackupMonitorRunStatus.queued.tone, .warning)
        XCTAssertEqual(BackupMonitorRunStatus.failed.tone, .danger)
        XCTAssertEqual(BackupMonitorRunStatus.other("x").tone, .danger)
    }

    func testLabelMatchesWebStatusLabel() {
        XCTAssertEqual(BackupMonitorStrings.label(for: .completed), "Success")
        XCTAssertEqual(BackupMonitorStrings.label(for: .running), "Running")
        XCTAssertEqual(BackupMonitorStrings.label(for: .queued), "Queued")
        XCTAssertEqual(BackupMonitorStrings.label(for: .failed), "Failed")
        // The web `statusLabel` returns "Failed" for anything not in the union.
        XCTAssertEqual(BackupMonitorStrings.label(for: .other("x")), "Failed")
    }

    func testIsFailedOnlyForExactFailed() {
        XCTAssertTrue(BackupMonitorRunStatus.failed.isFailed)
        XCTAssertFalse(BackupMonitorRunStatus.completed.isFailed)
        XCTAssertFalse(BackupMonitorRunStatus.other("failed-ish").isFailed)
    }
}

// MARK: - Byte formatter (parity with the web fmtBytes)

@MainActor final class BackupByteFormatterTests: XCTestCase {
    func testZeroAndNegative() {
        XCTAssertEqual(BackupByteFormatter.string(0), "0 B")
        XCTAssertEqual(BackupByteFormatter.string(-100), "0 B")
    }

    func testUnderTenUsesOneDecimal() {
        XCTAssertEqual(BackupByteFormatter.string(1024), "1.0 KB")
        XCTAssertEqual(BackupByteFormatter.string(1_288_490_188), "1.2 GB")
        XCTAssertEqual(BackupByteFormatter.string(9_437_184), "9.0 MB")
    }

    func testTenAndAboveRoundsToInteger() {
        XCTAssertEqual(BackupByteFormatter.string(471_859_200), "450 MB")
        XCTAssertEqual(BackupByteFormatter.string(838_860_800), "800 MB")
        XCTAssertEqual(BackupByteFormatter.string(1023), "1023 B")
    }

    func testUnitProgression() {
        XCTAssertEqual(BackupByteFormatter.string(512), "512 B")
        XCTAssertEqual(BackupByteFormatter.string(5_368_709_120), "5.0 GB")
        XCTAssertEqual(BackupByteFormatter.string(1_099_511_627_776), "1.0 TB")
    }
}

// MARK: - Relative-time formatter (parity with the web fmtRelativeTime)

@MainActor final class BackupRelativeFormatterTests: XCTestCase {
    func testNilDateUsesDash() {
        XCTAssertEqual(BackupRelativeFormatter.string(for: nil, now: fixedNow), "—")
    }

    func testFutureAndSubMinuteAreJustNow() {
        XCTAssertEqual(
            BackupRelativeFormatter.string(for: fixedNow.addingTimeInterval(120), now: fixedNow),
            "just now"
        )
        XCTAssertEqual(
            BackupRelativeFormatter.string(for: fixedNow.addingTimeInterval(-30), now: fixedNow),
            "just now"
        )
    }

    func testMinutesHoursDaysBuckets() {
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(5), now: fixedNow), "5m ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(90), now: fixedNow), "1h ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(180), now: fixedNow), "3h ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: daysBefore(1), now: fixedNow), "1d ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: daysBefore(3), now: fixedNow), "3d ago")
    }

    func testBoundariesAtOneMinuteHourDay() {
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(1), now: fixedNow), "1m ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(60), now: fixedNow), "1h ago")
        XCTAssertEqual(BackupRelativeFormatter.string(for: minutesBefore(24 * 60), now: fixedNow), "1d ago")
    }
}

// MARK: - Projection (parity with sortedRuns / latestRun / slice(0,5))

@MainActor final class BackupMonitorProjectionTests: XCTestCase {
    private let runs: [BackupMonitorRun] = [
        BackupMonitorRun(
            id: "recent", status: .completed, backupType: "full", fileSize: 1_288_490_188,
            durationMs: 4200, createdAt: minutesBefore(45), completedAt: minutesBefore(42)
        ),
        BackupMonitorRun(
            id: "mid", status: .completed, backupType: "incremental", fileSize: 471_859_200,
            durationMs: 1100, createdAt: minutesBefore(199), completedAt: minutesBefore(199)
        ),
        BackupMonitorRun(
            id: "failed", status: .failed, backupType: "full", fileSize: 0,
            durationMs: 380, createdAt: daysBefore(1), completedAt: daysBefore(1)
        ),
        BackupMonitorRun(
            id: "running", status: .running, backupType: "full", fileSize: 838_860_800,
            durationMs: nil, createdAt: daysBefore(2), completedAt: nil
        )
    ]

    func testOrderedSortsByResolvedTimestampDescending() {
        let ordered = BackupMonitorProjection.ordered(runs)
        XCTAssertEqual(ordered.map(\.id), ["recent", "mid", "failed", "running"])
    }

    func testLatestUsesNewestRunAndFormatsFields() {
        let latest = BackupMonitorProjection.latest(from: runs, now: fixedNow)
        XCTAssertEqual(latest?.lastBackupRelative, "42m ago")
        XCTAssertEqual(latest?.sizeText, "1.2 GB")
        XCTAssertEqual(latest?.typeText, "full")
        XCTAssertEqual(latest?.statusLabel, "Success")
        XCTAssertEqual(latest?.statusTone, .success)
        XCTAssertEqual(latest?.showsFailedBackground, false)
    }

    func testLatestFlagsFailedBackgroundAndDangerTone() {
        let failedFirst = [
            BackupMonitorRun(id: "f", status: .failed, backupType: "full", fileSize: 0, completedAt: minutesBefore(1))
        ]
        let latest = BackupMonitorProjection.latest(from: failedFirst, now: fixedNow)
        XCTAssertEqual(latest?.statusLabel, "Failed")
        XCTAssertEqual(latest?.statusTone, .danger)
        XCTAssertEqual(latest?.showsFailedBackground, true)
    }

    func testLatestMissingTypeAndDateUseDashes() {
        let bare = [BackupMonitorRun(id: "bare", status: .queued, backupType: nil, fileSize: 0)]
        let latest = BackupMonitorProjection.latest(from: bare, now: fixedNow)
        XCTAssertEqual(latest?.typeText, "—")
        XCTAssertEqual(latest?.lastBackupRelative, "—")
        XCTAssertEqual(latest?.sizeText, "0 B")
        XCTAssertEqual(latest?.statusLabel, "Queued")
    }

    func testEmptyHistoryHasNoLatestOrRows() {
        XCTAssertNil(BackupMonitorProjection.latest(from: [], now: fixedNow))
        XCTAssertTrue(BackupMonitorProjection.recentRows(from: [], locale: enUS).isEmpty)
    }

    func testRecentRowsSliceToFiveNewestFirst() {
        let many = (1 ... 8).map {
            BackupMonitorRun(id: "\($0)", status: .completed, fileSize: 1024, createdAt: minutesBefore($0))
        }
        let rows = BackupMonitorProjection.recentRows(from: many, locale: enUS)
        XCTAssertEqual(rows.count, BackupMonitorProjection.maxRecentRows)
        XCTAssertEqual(rows.first?.id, "1")
        XCTAssertEqual(rows.last?.id, "5")
    }

    func testRecentRowDetailIncludesDurationWhenPresent() {
        let rows = BackupMonitorProjection.recentRows(from: runs, locale: enUS)
        let mid = rows.first { $0.id == "mid" }
        XCTAssertEqual(mid?.detailText, "450 MB · 1100ms")
        XCTAssertEqual(mid?.statusLabel, "Success")
        XCTAssertEqual(mid?.statusTone, .success)
    }

    func testRecentRowDetailOmitsDurationWhenNil() {
        let rows = BackupMonitorProjection.recentRows(from: runs, locale: enUS)
        let running = rows.first { $0.id == "running" }
        XCTAssertEqual(running?.detailText, "800 MB")
        XCTAssertEqual(running?.statusTone, .warning)
    }

    func testRecentRowTimeTextDashesWhenNoDate() {
        let dateless = [BackupMonitorRun(id: "x", status: .completed, fileSize: 1024)]
        let rows = BackupMonitorProjection.recentRows(from: dateless, locale: enUS)
        XCTAssertEqual(rows.first?.timeText, "—")
    }

    func testRecentRowTimeTextIsAbsoluteWhenDated() {
        let rows = BackupMonitorProjection.recentRows(from: runs, locale: enUS)
        let recent = rows.first { $0.id == "recent" }
        XCTAssertNotEqual(recent?.timeText, "—")
        XCTAssertFalse(recent?.timeText.contains("ago") ?? true)
    }
}
