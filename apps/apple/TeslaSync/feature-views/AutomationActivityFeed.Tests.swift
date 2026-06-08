//
//  AutomationActivityFeed.Tests.swift
//  TeslaSync — P4 feature view · 0081 · AutomationActivityFeed (Apple)
//
//  Unit coverage for the AutomationActivityFeed surface:
//    • Adapter — the web ports: statusConfig / typeMap resolution (+ their nullish
//      fallbacks), formatDurationMs / fmtPercent / timeAgo formatting, the display-name
//      `?? '#id'` rule, the live-event slice(0,5) cap, the stats gate, and row projection.
//    • State holder — `AutomationFeedProjection` phase resolution across loading / error /
//      data / empty (+ the independently-projected live rows / stats / connection), plus
//      the `AutomationFeedModel` wiring, the P1/S11 `view.opened`, and the stale
//      auto-refresh.
//    • Accessibility — the VoiceOver history-row + live-event summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no real
//  store: the model is driven by `InMemoryAutomationFeedSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: status / event resolution

@MainActor final class AutomationFeedStatusTests: XCTestCase {
    func testStatusParseAndFallback() {
        XCTAssertEqual(AutomationRunStatus.parse("success"), .success)
        XCTAssertEqual(AutomationRunStatus.parse("partial"), .partial)
        XCTAssertEqual(AutomationRunStatus.parse("failed"), .failed)
        XCTAssertEqual(AutomationRunStatus.parse("skipped"), .skipped)
        XCTAssertEqual(AutomationRunStatus.parse("test"), .test)
        XCTAssertEqual(AutomationRunStatus.parse("undo"), .undo)
        XCTAssertEqual(AutomationRunStatus.parse("running"), .running)
        XCTAssertEqual(AutomationRunStatus.parse("cancelled"), .cancelled)
        // Case-insensitive + unknown → running (web `statusConfig[...] ?? statusConfig.running`).
        XCTAssertEqual(AutomationRunStatus.parse("SUCCESS"), .success)
        XCTAssertEqual(AutomationRunStatus.parse("nonsense"), .running)
    }

    func testStatusLabels() {
        XCTAssertEqual(AutomationRunStatus.success.labelFallback, "Succeeded")
        XCTAssertEqual(AutomationRunStatus.partial.labelFallback, "Partial")
        XCTAssertEqual(AutomationRunStatus.failed.labelFallback, "Failed")
        XCTAssertEqual(AutomationRunStatus.skipped.labelFallback, "Skipped")
        XCTAssertEqual(AutomationRunStatus.test.labelFallback, "Test")
        XCTAssertEqual(AutomationRunStatus.undo.labelFallback, "Undo")
        XCTAssertEqual(AutomationRunStatus.running.labelFallback, "Running")
        XCTAssertEqual(AutomationRunStatus.cancelled.labelFallback, "Cancelled")
        XCTAssertEqual(AutomationRunStatus.success.labelKey, "automations.status.success")
    }

    func testEventKindParseAndFallback() {
        XCTAssertEqual(AutomationEventKind.parse("automation.triggered"), .triggered)
        XCTAssertEqual(AutomationEventKind.parse("automation.succeeded"), .succeeded)
        XCTAssertEqual(AutomationEventKind.parse("automation.failed"), .failed)
        XCTAssertEqual(AutomationEventKind.parse("automation.skipped"), .skipped)
        XCTAssertEqual(AutomationEventKind.parse("automation.state_changed"), .stateChanged)
        // Unknown → triggered (web `typeMap[...] ?? typeMap['automation.triggered']`).
        XCTAssertEqual(AutomationEventKind.parse("automation.unknown"), .triggered)
    }

    func testEventBadgeSuffix() {
        XCTAssertEqual(AutomationEventKind.triggered.badgeSuffix, "triggered")
        XCTAssertEqual(AutomationEventKind.stateChanged.badgeSuffix, "state_changed")
        XCTAssertEqual(AutomationEventKind.stateChanged.badgeKey, "automations.event.state_changed")
    }
}

// MARK: - Adapter: formatting

@MainActor final class AutomationFeedFormatTests: XCTestCase {
    func testDurationFormatting() {
        XCTAssertEqual(AutomationFeedFormat.duration(nil), "—")
        XCTAssertEqual(AutomationFeedFormat.duration(0), "0ms")
        XCTAssertEqual(AutomationFeedFormat.duration(999), "999ms")
        XCTAssertEqual(AutomationFeedFormat.duration(1000), "1.0s")
        XCTAssertEqual(AutomationFeedFormat.duration(1840), "1.8s")
        XCTAssertEqual(AutomationFeedFormat.duration(60000), "60.0s")
    }

    func testPercentFormatting() {
        let posix = Locale(identifier: "en_US_POSIX")
        XCTAssertEqual(AutomationFeedFormat.percent(93, locale: posix), "93%")
        XCTAssertEqual(AutomationFeedFormat.percent(0, locale: posix), "0%")
        // nil folds to 0 (web safeNumber), and the value rounds to the integer percent.
        XCTAssertEqual(AutomationFeedFormat.percent(nil, locale: posix), "0%")
        XCTAssertEqual(AutomationFeedFormat.percent(95.6, locale: posix), "96%")
    }

    func testParseDate() {
        XCTAssertNotNil(AutomationFeedFormat.parseDate("2026-01-05T15:04:05Z"))
        XCTAssertNotNil(AutomationFeedFormat.parseDate("1736089445"))
        XCTAssertNil(AutomationFeedFormat.parseDate(""))
        XCTAssertNil(AutomationFeedFormat.parseDate("not-a-date"))
    }

    func testRelativeIsNonEmpty() {
        let date = Date(timeIntervalSince1970: 1_736_089_445)
        let now = date.addingTimeInterval(3600)
        XCTAssertFalse(AutomationFeedFormat.relative(for: date, relativeTo: now).isEmpty)
    }
}

// MARK: - Adapter: projection

@MainActor final class AutomationFeedAdapterTests: XCTestCase {
    func testDisplayName() {
        XCTAssertEqual(AutomationFeedAdapter.displayName(name: "Morning", automationId: 7), "Morning")
        XCTAssertEqual(AutomationFeedAdapter.displayName(name: nil, automationId: 7), "#7")
        XCTAssertEqual(AutomationFeedAdapter.displayName(name: "", automationId: 9), "#9")
    }

    func testHistoryRowProjection() {
        let row = AutomationFeedAdapter.historyRow(from: AutomationHistoryInput(
            id: "1",
            automationName: "Lock when away",
            status: "failed",
            error: "Vehicle unreachable",
            triggeredAt: "2026-01-05T15:04:05Z",
            durationMs: 450,
            actionsTotal: 2,
            actionsSucceeded: 1
        ))
        XCTAssertEqual(row.id, "1")
        XCTAssertEqual(row.name, "Lock when away")
        XCTAssertEqual(row.status, .failed)
        XCTAssertEqual(row.error, "Vehicle unreachable")
        XCTAssertEqual(row.durationText, "450ms")
        XCTAssertEqual(row.actionsText, "1/2")
        XCTAssertNotNil(row.triggeredAt)
    }

    func testHistoryRowEmptyErrorAndNoActions() {
        let row = AutomationFeedAdapter.historyRow(from: AutomationHistoryInput(
            id: "2",
            automationName: "Sentry",
            status: "skipped",
            error: "",
            triggeredAt: "",
            durationMs: nil,
            actionsTotal: 0,
            actionsSucceeded: 0
        ))
        // Empty error folds to nil; zero actions hides the count; nil duration → em-dash.
        XCTAssertNil(row.error)
        XCTAssertNil(row.actionsText)
        XCTAssertEqual(row.durationText, "—")
        XCTAssertNil(row.triggeredAt)
        XCTAssertEqual(row.status, .skipped)
    }

    func testLiveRowsCapAndProjection() {
        let inputs = (0 ..< 8).map { index in
            AutomationLiveEventInput(
                id: "ae-\(index)",
                type: "automation.triggered",
                automationId: index,
                name: index == 0 ? nil : "Auto \(index)"
            )
        }
        let rows = AutomationFeedAdapter.liveRows(from: inputs)
        // Web `liveEvents.slice(0, 5)` — never more than five rows.
        XCTAssertEqual(rows.count, 5)
        XCTAssertEqual(rows.first?.name, "#0")
        XCTAssertEqual(rows.first?.kind, .triggered)

        let failed = AutomationFeedAdapter.liveRow(from: AutomationLiveEventInput(
            id: "x",
            type: "automation.failed",
            automationId: 3,
            name: "Lock",
            error: "boom"
        ))
        XCTAssertEqual(failed.kind, .failed)
        XCTAssertEqual(failed.error, "boom")
        XCTAssertNil(failed.reason)
    }

    func testStatsGate() {
        XCTAssertNil(AutomationFeedAdapter.stats(from: nil))
        XCTAssertNil(AutomationFeedAdapter.stats(from: AutomationHistoryStatsInput(
            totalExecutions: 0, successRate: 100, avgDurationMs: 0
        )))
        let posix = Locale(identifier: "en_US_POSIX")
        let stats = AutomationFeedAdapter.stats(
            from: AutomationHistoryStatsInput(totalExecutions: 142, successRate: 93, avgDurationMs: 1320),
            locale: posix
        )
        XCTAssertEqual(stats?.totalExecutions, 142)
        XCTAssertEqual(stats?.successRateText, "93%")
        XCTAssertEqual(stats?.avgDurationText, "1.3s")
    }
}

// MARK: - Projection: phase resolution across every branch

@MainActor final class AutomationFeedProjectionTests: XCTestCase {
    private var sampleHistory: [AutomationHistoryInput] {
        [AutomationHistoryInput(id: "1", automationName: "A", status: "success", triggeredAt: "2026-01-05T15:04:05Z")]
    }

    func testLoadingTakesPrecedence() {
        let resolved = AutomationFeedProjection.resolve(
            AutomationFeedInput(history: sampleHistory, isLoading: true)
        )
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testErrorWhenNotLoading() {
        let resolved = AutomationFeedProjection.resolve(
            AutomationFeedInput(history: sampleHistory, errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
    }

    func testDataWhenRowsPresent() {
        let resolved = AutomationFeedProjection.resolve(AutomationFeedInput(history: sampleHistory))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.historyRows.count, 1)
    }

    func testEmptyWhenNoRows() {
        let resolved = AutomationFeedProjection.resolve(AutomationFeedInput(history: []))
        XCTAssertEqual(resolved.phase, .empty)
    }

    func testLiveStatsConnectionProjectedIndependentlyOfPhase() {
        let posix = Locale(identifier: "en_US_POSIX")
        let resolved = AutomationFeedProjection.resolve(
            AutomationFeedInput(
                history: [],
                stats: AutomationHistoryStatsInput(totalExecutions: 5, successRate: 80, avgDurationMs: 1000),
                isLoading: true,
                liveEvents: [AutomationLiveEventInput(
                    id: "1",
                    type: "automation.triggered",
                    automationId: 1,
                    name: "A"
                )],
                connection: .reconnecting
            ),
            locale: posix
        )
        // Loading history but live rows + stats + connection still resolve (web renders them
        // outside the isLoading branch).
        XCTAssertEqual(resolved.phase, .loading)
        XCTAssertEqual(resolved.liveRows.count, 1)
        XCTAssertEqual(resolved.stats?.successRateText, "80%")
        XCTAssertEqual(resolved.connection, .reconnecting)
    }
}

// MARK: - State holder: wiring + telemetry + stale auto-refresh

@MainActor final class AutomationFeedModelTests: XCTestCase {
    private func makeModel(
        _ input: AutomationFeedInput,
        telemetry: AutomationFeedTelemetry = OSLogAutomationFeedTelemetry()
    ) -> (AutomationFeedModel, InMemoryAutomationFeedSource) {
        let source = InMemoryAutomationFeedSource(initial: input)
        let model = AutomationFeedModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyAutomationFeedTelemetry()
        let history = [AutomationHistoryInput(
            id: "1",
            automationName: "A",
            status: "success",
            triggeredAt: "2026-01-05T15:04:05Z"
        )]
        let (model, source) = makeModel(AutomationFeedInput(history: history), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.historyRows.count, 1)
        XCTAssertEqual(spy.surfaces, [AutomationFeedDiagnostics.surface])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(AutomationFeedInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(AutomationFeedInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(AutomationFeedInput(
            history: [AutomationHistoryInput(
                id: "7",
                automationName: "Z",
                status: "running",
                triggeredAt: "2026-01-05T15:04:05Z"
            )]
        ))
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.historyRows.first?.id, "7")
    }

    func testStaleTriggersExactlyOneAutoRefreshUntilLive() {
        let (model, source) = makeModel(AutomationFeedInput(connection: .connected))
        model.start()
        XCTAssertEqual(source.refreshCount, 0)
        source.push(AutomationFeedInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // A second stale snapshot does not re-trigger (guarded).
        source.push(AutomationFeedInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        // Returning to live resets the guard; a later stale episode refreshes once more.
        source.push(AutomationFeedInput(connection: .connected))
        source.push(AutomationFeedInput(connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionAndLiveSurfaceThroughModel() {
        let (model, source) = makeModel(AutomationFeedInput(connection: .offline))
        model.start()
        XCTAssertEqual(model.connection, .offline)
        source.push(AutomationFeedInput(
            liveEvents: [AutomationLiveEventInput(id: "1", type: "automation.succeeded", automationId: 2, name: "A")],
            connection: .reconnecting
        ))
        XCTAssertEqual(model.connection, .reconnecting)
        XCTAssertEqual(model.liveRows.first?.kind, .succeeded)
    }
}

// MARK: - Accessibility: VoiceOver summaries

@MainActor final class AutomationFeedAccessibilityTests: XCTestCase {
    /// Bundle-free localizer that returns the English fallback (the web `t` default).
    private let localize: AutomationFeedAccessibility.Localize = { _, fallback in fallback }

    func testHistoryRowSummaryCombinesEveryField() {
        let row = AutomationFeedAdapter.historyRow(from: AutomationHistoryInput(
            id: "1",
            automationName: "Lock when away",
            status: "failed",
            error: "Vehicle unreachable",
            triggeredAt: "2026-01-05T15:04:05Z",
            durationMs: 450,
            actionsTotal: 2,
            actionsSucceeded: 1
        ))
        let now = Date(timeIntervalSince1970: 1_736_090_000)
        let summary = AutomationFeedAccessibility.historyRowSummary(for: row, now: now, localize)
        XCTAssertTrue(summary.contains("Lock when away"))
        XCTAssertTrue(summary.contains("Failed"))
        XCTAssertTrue(summary.contains("450ms"))
        XCTAssertTrue(summary.contains("1/2"))
        XCTAssertTrue(summary.contains("Vehicle unreachable"))
    }

    func testLiveEventSummaryCombinesEveryField() {
        let row = AutomationFeedAdapter.liveRow(from: AutomationLiveEventInput(
            id: "1",
            type: "automation.skipped",
            automationId: 4,
            name: "Sentry",
            reason: "Condition not met"
        ))
        let summary = AutomationFeedAccessibility.liveEventSummary(for: row, localize)
        XCTAssertTrue(summary.contains("Sentry"))
        XCTAssertTrue(summary.contains("skipped"))
        XCTAssertTrue(summary.contains("Condition not met"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyAutomationFeedTelemetry: AutomationFeedTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
