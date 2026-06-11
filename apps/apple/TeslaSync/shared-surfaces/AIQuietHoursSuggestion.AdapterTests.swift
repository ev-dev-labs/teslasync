//
//  AIQuietHoursSuggestion.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0041 · AIQuietHoursSuggestion (Apple)
//
//  Adapter-tier coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): the typed `tool_result` → `QuietHoursDraftProposal` decode (the web `handleEvent`
//  guard), the cached-inputs → `QuietHoursSuggestionProjection` map (P4 acceptance: *adapter unit test
//  (cached → projection)*), the proposal formatting helpers, and the VoiceOver summary seam. Pure +
//  view-free where possible; the format helpers exercise the P1/S10 facade. They run in the
//  TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification harness with no network.
//

import XCTest
@testable import TeslaSync

// MARK: - Proposal decode (web `handleEvent` guard)

@MainActor final class QuietHoursProposalDecodeTests: XCTestCase {
    private func frame(
        _ data: [String: QuietHoursSuggestionJSON]?,
        name: String = QuietHoursDraftProposal.toolName,
        ok: Bool = true
    ) -> QuietHoursSuggestionToolResult {
        QuietHoursSuggestionToolResult(id: "tr-1", name: name, ok: ok, data: data)
    }

    private var validData: [String: QuietHoursSuggestionJSON] {
        [
            "start_local": .string("22:00"),
            "end_local": .string("07:00"),
            "timezone": .string("America/Los_Angeles"),
            "weekdays": .number(127),
            "bypass_severities": .array([.string("critical"), .string("warning")]),
            "status": .string("ok"),
            "existing_windows_count": .number(1)
        ]
    }

    func testCapturesValidProposal() {
        let proposal = QuietHoursDraftProposal.from(frame(validData))
        XCTAssertEqual(proposal?.startLocal, "22:00")
        XCTAssertEqual(proposal?.endLocal, "07:00")
        XCTAssertEqual(proposal?.timezone, "America/Los_Angeles")
        XCTAssertEqual(proposal?.weekdays, 127)
        XCTAssertEqual(proposal?.bypassSeverities, ["critical", "warning"])
        XCTAssertEqual(proposal?.status, "ok")
        XCTAssertEqual(proposal?.existingWindowsCount, 1)
    }

    func testRejectsWrongToolName() {
        XCTAssertNil(QuietHoursDraftProposal.from(frame(validData, name: "other_tool")))
    }

    func testRejectsWhenOkIsFalse() {
        // Web guard is `ev.type === 'tool_result' && ev.name === '…' && ev.ok`.
        XCTAssertNil(QuietHoursDraftProposal.from(frame(validData, ok: false)))
    }

    func testRejectsNilData() {
        XCTAssertNil(QuietHoursDraftProposal.from(frame(nil)))
    }

    func testRejectsMissingStringFields() {
        var data = validData
        data["start_local"] = .number(5)
        XCTAssertNil(QuietHoursDraftProposal.from(frame(data)))

        data = validData
        data["timezone"] = nil
        XCTAssertNil(QuietHoursDraftProposal.from(frame(data)))
    }

    func testRejectsNonNumberWeekdays() {
        var data = validData
        data["weekdays"] = .string("127")
        XCTAssertNil(QuietHoursDraftProposal.from(frame(data)))
    }

    func testRejectsNonArrayBypassSeverities() {
        var data = validData
        data["bypass_severities"] = .string("critical")
        XCTAssertNil(QuietHoursDraftProposal.from(frame(data)))
    }

    func testFiltersNonStringSeveritiesRatherThanRejecting() {
        // Web `.filter((s) => typeof s === 'string')` — non-string elements are DROPPED, not rejected.
        var data = validData
        data["bypass_severities"] = .array([.string("critical"), .number(3), .bool(true), .string("info")])
        let proposal = QuietHoursDraftProposal.from(frame(data))
        XCTAssertEqual(proposal?.bypassSeverities, ["critical", "info"])
    }

    func testStatusDefaultsToOkAndCountToZero() {
        var data = validData
        data["status"] = nil
        data["existing_windows_count"] = nil
        let proposal = QuietHoursDraftProposal.from(frame(data))
        XCTAssertEqual(proposal?.status, "ok")
        XCTAssertEqual(proposal?.existingWindowsCount, 0)
        XCTAssertFalse(proposal?.hasInsufficientHistory ?? true)
        XCTAssertFalse(proposal?.hasExistingWindows ?? true)
    }

    func testInsufficientHistoryAndExistingFlags() {
        var data = validData
        data["status"] = .string("insufficient_history")
        data["existing_windows_count"] = .number(3)
        let proposal = QuietHoursDraftProposal.from(frame(data))
        XCTAssertTrue(proposal?.hasInsufficientHistory ?? false)
        XCTAssertTrue(proposal?.hasExistingWindows ?? false)
    }

    func testToPatchSeedsEnabledTrueWithScalars() {
        let proposal = QuietHoursDraftProposal.from(frame(validData))
        let patch = proposal?.toPatch()
        XCTAssertEqual(patch?.enabled, true)
        XCTAssertEqual(patch?.startLocal, "22:00")
        XCTAssertEqual(patch?.endLocal, "07:00")
        XCTAssertEqual(patch?.timezone, "America/Los_Angeles")
        XCTAssertEqual(patch?.weekdays, 127)
        XCTAssertEqual(patch?.bypassSeverities, ["critical", "warning"])
    }
}

// MARK: - Projection (adapter: cached inputs → render decisions)

@MainActor final class QuietHoursSuggestionProjectionTests: XCTestCase {
    func testReadyIdleInviteProjection() {
        let projection = QuietHoursSuggestionProjection.make(
            snapshot: QuietHoursSuggestionInputSnapshot(gate: .on),
            phase: .idle,
            hasProposal: false,
            streamText: ""
        )
        XCTAssertEqual(projection.renderState, .ready)
        XCTAssertTrue(projection.canStart)
        XCTAssertFalse(projection.buttonDisabled)
        XCTAssertFalse(projection.isStreaming)
        XCTAssertFalse(projection.canApply)
        XCTAssertFalse(projection.outputVisible)
        XCTAssertTrue(projection.showIdleHint)
        XCTAssertEqual(projection.connection, .live)
    }

    func testProposalCapturedEnablesApplyAndHidesIdleHint() {
        let projection = QuietHoursSuggestionProjection.make(
            snapshot: QuietHoursSuggestionInputSnapshot(gate: .on),
            phase: .done,
            hasProposal: true,
            streamText: ""
        )
        XCTAssertTrue(projection.canApply)
        XCTAssertFalse(projection.showIdleHint)
        XCTAssertFalse(projection.buttonDisabled)
    }

    func testStreamingProjectionDisablesActionsAndShowsThinking() {
        let projection = QuietHoursSuggestionProjection.make(
            snapshot: QuietHoursSuggestionInputSnapshot(gate: .on),
            phase: .streaming,
            hasProposal: true,
            streamText: ""
        )
        XCTAssertTrue(projection.isStreaming)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertFalse(projection.canApply)
        XCTAssertTrue(projection.outputVisible)
        XCTAssertTrue(projection.thinkingVisible)
        XCTAssertFalse(projection.showIdleHint)
    }

    func testOfflineProjectionDisablesButton() {
        let projection = QuietHoursSuggestionProjection.make(
            snapshot: QuietHoursSuggestionInputSnapshot(gate: .on, connection: .offline),
            phase: .idle,
            hasProposal: false,
            streamText: ""
        )
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertEqual(projection.connection, .offline)
    }

    func testGateAxisProjection() {
        XCTAssertEqual(
            QuietHoursSuggestionProjection.make(
                snapshot: QuietHoursSuggestionInputSnapshot(gate: .off),
                phase: .idle, hasProposal: false, streamText: ""
            ).renderState,
            .gatedOff
        )
        XCTAssertEqual(
            QuietHoursSuggestionProjection.make(
                snapshot: QuietHoursSuggestionInputSnapshot(gate: .loading, errorMessage: "boom"),
                phase: .idle, hasProposal: false, streamText: ""
            ).renderState,
            .gateError("boom")
        )
    }
}

// MARK: - Proposal formatting (web `t(key, vars)` interpolation)

@MainActor final class QuietHoursSuggestionFormatTests: XCTestCase {
    private let proposal = QuietHoursDraftProposal(
        startLocal: "22:00",
        endLocal: "07:00",
        timezone: "America/Los_Angeles",
        weekdays: 127,
        bypassSeverities: ["critical", "warning"],
        status: "insufficient_history",
        existingWindowsCount: 2
    )

    func testWindowLine() {
        XCTAssertEqual(
            QuietHoursSuggestionFormat.windowLine(proposal),
            "Window: 22:00 → 07:00 (America/Los_Angeles)"
        )
    }

    func testWeekdaysLine() {
        XCTAssertEqual(QuietHoursSuggestionFormat.weekdaysLine(proposal), "Weekday bitmask: 127")
    }

    func testSeveritiesLineJoinsWithComma() {
        XCTAssertEqual(
            QuietHoursSuggestionFormat.severitiesLine(proposal), "Bypass severities: critical, warning"
        )
    }

    func testExistingCountNote() {
        XCTAssertEqual(
            QuietHoursSuggestionFormat.existingCountNote(proposal),
            "You already have 2 quiet-hours window(s) configured."
        )
    }

    func testProposalSummaryJoinsAllLines() {
        XCTAssertEqual(
            QuietHoursSuggestionFormat.proposalSummary(proposal),
            "Window: 22:00 → 07:00 (America/Los_Angeles), Weekday bitmask: 127, "
                + "Bypass severities: critical, warning"
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class QuietHoursSuggestionAccessibilityTests: XCTestCase {
    private let labels = QuietHoursSuggestionAccessibility.Labels(
        title: "Suggest a quiet-hours window from your notification history",
        proposed: "Proposed quiet-hours window",
        thinking: "Helix is thinking…",
        errorLabel: "Helix error:",
        errorUnknown: "unknown"
    )

    func testTitleOnlyWhenIdleNoProposal() {
        let summary = QuietHoursSuggestionAccessibility.summary(
            labels: labels, proposalSummary: nil, phase: .idle, streamText: ""
        )
        XCTAssertEqual(summary, "Suggest a quiet-hours window from your notification history")
    }

    func testProposalSummaryIsRead() {
        let summary = QuietHoursSuggestionAccessibility.summary(
            labels: labels,
            proposalSummary: "Window: 22:00 → 07:00 (America/Los_Angeles)",
            phase: .done,
            streamText: ""
        )
        XCTAssertEqual(
            summary,
            "Suggest a quiet-hours window from your notification history. "
                + "Proposed quiet-hours window: Window: 22:00 → 07:00 (America/Los_Angeles)"
        )
    }

    func testStreamingWithoutTextReadsThinking() {
        let summary = QuietHoursSuggestionAccessibility.summary(
            labels: labels, proposalSummary: nil, phase: .streaming, streamText: ""
        )
        XCTAssertEqual(
            summary, "Suggest a quiet-hours window from your notification history. Helix is thinking…"
        )
    }

    func testErrorReadsErrorLabelAndMessage() {
        let summary = QuietHoursSuggestionAccessibility.summary(
            labels: labels, proposalSummary: nil, phase: .error("rate limited"), streamText: ""
        )
        XCTAssertEqual(
            summary,
            "Suggest a quiet-hours window from your notification history. Helix error: rate limited"
        )
    }

    func testEmptyErrorFallsBackToUnknown() {
        let summary = QuietHoursSuggestionAccessibility.summary(
            labels: labels, proposalSummary: nil, phase: .error(""), streamText: ""
        )
        XCTAssertEqual(
            summary, "Suggest a quiet-hours window from your notification history. Helix error: unknown"
        )
    }
}
