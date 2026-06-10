//
//  AISignalExplorerNlFilter.AdapterTests.swift
//  TeslaSync — P4 shared surface · 0046 · AISignalExplorerNlFilter (Apple)
//
//  Adapter-tier coverage split out of `…Tests.swift` (one file ≤ 400 lines per the SwiftLint
//  contract): the cached-inputs → `SignalExplorerFilterProjection` map (P4 acceptance: *adapter unit
//  test (cached → projection)*), the VoiceOver summary seam, and the P1/S10 i18n facade. Pure +
//  view-free, so they run in the TeslaSync(/-macOS) XCTest targets and in the SwiftPM verification
//  harness with no network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Projection (adapter: cached inputs → render decisions)

@MainActor final class SignalExplorerFilterProjectionTests: XCTestCase {
    func testReadyProjectionWithPromptAndDraft() {
        let projection = SignalExplorerFilterProjection.make(
            snapshot: SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 9),
            prompt: "battery for yesterday",
            phase: .done,
            hasDraft: true,
            streamText: ""
        )
        XCTAssertEqual(projection.renderState, .ready)
        XCTAssertTrue(projection.canStart)
        XCTAssertFalse(projection.buttonDisabled)
        XCTAssertTrue(projection.canApply)
        XCTAssertNil(projection.emptyHint)
        XCTAssertEqual(projection.connection, .live)
    }

    func testStreamingProjectionDisablesActionsAndShowsThinking() {
        let projection = SignalExplorerFilterProjection.make(
            snapshot: SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 9),
            prompt: "battery",
            phase: .streaming,
            hasDraft: true,
            streamText: ""
        )
        XCTAssertTrue(projection.isStreaming)
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertFalse(projection.canApply)
        XCTAssertTrue(projection.outputVisible)
        XCTAssertTrue(projection.thinkingVisible)
    }

    func testOfflineProjectionDisablesButtonAndEmptyHint() {
        let projection = SignalExplorerFilterProjection.make(
            snapshot: SignalExplorerFilterInputSnapshot(gate: .on, vehicleID: 0, connection: .offline),
            prompt: "",
            phase: .idle,
            hasDraft: false,
            streamText: ""
        )
        XCTAssertTrue(projection.buttonDisabled)
        XCTAssertEqual(projection.emptyHint, .selectVehicle)
        XCTAssertEqual(projection.connection, .offline)
    }

    func testGateAxisProjection() {
        XCTAssertEqual(
            SignalExplorerFilterProjection.make(
                snapshot: SignalExplorerFilterInputSnapshot(gate: .off, vehicleID: 1),
                prompt: "x", phase: .idle, hasDraft: false, streamText: ""
            ).renderState,
            .gatedOff
        )
        XCTAssertEqual(
            SignalExplorerFilterProjection.make(
                snapshot: SignalExplorerFilterInputSnapshot(gate: .loading, vehicleID: 1, errorMessage: "boom"),
                prompt: "x", phase: .idle, hasDraft: false, streamText: ""
            ).renderState,
            .gateError("boom")
        )
    }
}

// MARK: - Accessibility summary

@MainActor final class SignalExplorerFilterAccessibilityTests: XCTestCase {
    private let labels = SignalExplorerFilterAccessibility.Labels(
        title: "Helix natural-language filter",
        proposed: "Proposed filter",
        signals: "Signals",
        range: "Range",
        perPage: "Per page",
        thinking: "Helix is thinking…",
        errorLabel: "Helix error:",
        errorUnknown: "unknown"
    )

    private var sampleDraft: SignalExplorerFilterDraft {
        SignalExplorerFilterDraft(
            vehicleID: 1, signals: ["battery_level", "inside_temp"], rangePreset: "24h", perPage: 100
        )
    }

    func testTitleOnlyWhenIdleNoDraft() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: nil, phase: .idle, streamText: ""
        )
        XCTAssertEqual(summary, "Helix natural-language filter")
    }

    func testDraftReadsProposedSummary() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: sampleDraft, phase: .done, streamText: ""
        )
        XCTAssertEqual(
            summary,
            "Helix natural-language filter. Proposed filter: Signals 2, Range 24h, Per page 100"
        )
    }

    func testStreamingWithoutTextReadsThinking() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: nil, phase: .streaming, streamText: ""
        )
        XCTAssertEqual(summary, "Helix natural-language filter. Helix is thinking…")
    }

    func testErrorReadsErrorLabelAndMessage() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: nil, phase: .error("rate limited"), streamText: ""
        )
        XCTAssertEqual(summary, "Helix natural-language filter. Helix error: rate limited")
    }

    func testEmptyErrorFallsBackToUnknown() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: nil, phase: .error(""), streamText: ""
        )
        XCTAssertEqual(summary, "Helix natural-language filter. Helix error: unknown")
    }

    func testStreamedTextAppendsAfterDraft() {
        let summary = SignalExplorerFilterAccessibility.summary(
            labels: labels, draft: sampleDraft, phase: .done, streamText: "Drafted a filter."
        )
        XCTAssertEqual(
            summary,
            "Helix natural-language filter. Proposed filter: Signals 2, Range 24h, Per page 100. "
                + "Drafted a filter."
        )
    }
}

// MARK: - i18n facade

@MainActor final class SignalExplorerFilterStringsTests: XCTestCase {
    /// The "AISignalExplorerNlFilter" table folds in at integration time, so the test bundle resolves
    /// each key to its `value:` fallback — deterministic for assertions.
    func testResolvesKeysToFallback() {
        XCTAssertEqual(
            SignalExplorerFilterStrings.string(
                "signalExplorer.aiFilter.title", "Helix natural-language filter"
            ),
            "Helix natural-language filter"
        )
        XCTAssertEqual(SignalExplorerFilterStrings.string("helix.askHelix", "Ask Helix"), "Ask Helix")
    }
}
