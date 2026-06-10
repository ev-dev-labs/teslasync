//
//  TelemetryPipelineCard.Tests.swift
//  TeslaSync — P4 feature view · 0256 · TelemetryPipelineCard (Apple)
//
//  Pure-adapter + accessibility coverage for the TelemetryPipelineCard surface:
//    • Adapter (cached → projection) — the union liveness ladder + source selection, the
//      VIN tail, the canonical state mapping, the battery tone, the fleet summary, the
//      phase resolution, the grouped count / em-dash + display-name fallback, all parity
//      with the web `liveness` / `vinTail` / `vehicleStateBadge` / `batteryColor` rules
//      (incl. the exact web-test scenarios: 1/10/60-min ladder, streaming-only, tie-wins).
//    • Accessibility — the VoiceOver row summary (present + absent battery).
//
//  The `TelemetryPipelineModel` state-holder coverage lives in `…ModelTests.swift` (split
//  for the lint length budget). These run in the TeslaSync(/-macOS) XCTest targets with no
//  network and no real store.
//

import XCTest
@testable import TeslaSync

// MARK: - Test helpers

private func toneName(_ tone: TSTone) -> String {
    switch tone {
    case .neutral: "neutral"
    case .accent: "accent"
    case .success: "success"
    case .warning: "warning"
    case .danger: "danger"
    case .info: "info"
    }
}

// MARK: - Adapter: liveness ladder + source selection (web `liveness`)

final class TelemetryPipelineLivenessTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testLadderBoundaries() {
        // < 5 min → sending; [5, 30) → slow; ≥ 30 → stale (web ageMin thresholds).
        XCTAssertEqual(level(pollAgoMinutes: 1), .sending)
        XCTAssertEqual(level(pollAgoMinutes: 4.9), .sending)
        XCTAssertEqual(level(pollAgoMinutes: 5), .slow)
        XCTAssertEqual(level(pollAgoMinutes: 10), .slow)
        XCTAssertEqual(level(pollAgoMinutes: 29.9), .slow)
        XCTAssertEqual(level(pollAgoMinutes: 30), .stale)
        XCTAssertEqual(level(pollAgoMinutes: 60), .stale)
    }

    func testNoSignalIsOffline() {
        let result = TelemetryPipelineProjection.liveness(lastPoll: nil, lastStream: nil, now: now)
        XCTAssertEqual(result.level, .offline)
        XCTAssertEqual(result.source, TelemetryLivenessSource.none)
        XCTAssertNil(result.lastSeen)
    }

    func testFutureTimestampReadsAsSending() {
        let result = TelemetryPipelineProjection.liveness(
            lastPoll: now.addingTimeInterval(60), lastStream: nil, now: now
        )
        XCTAssertEqual(result.level, .sending)
        XCTAssertEqual(result.source, .poll)
    }

    func testStreamWinsTie() {
        let instant = now.addingTimeInterval(-60)
        let result = TelemetryPipelineProjection.liveness(lastPoll: instant, lastStream: instant, now: now)
        XCTAssertEqual(result.source, .stream)
        XCTAssertEqual(result.lastSeen, instant)
    }

    func testStreamingOnlyCaseWebParity() {
        // Web: polling never ran, stream is 12 s old → sending · stream.
        let result = TelemetryPipelineProjection.liveness(
            lastPoll: nil, lastStream: now.addingTimeInterval(-12), now: now
        )
        XCTAssertEqual(result.level, .sending)
        XCTAssertEqual(result.source, .stream)
    }

    func testMostRecentWinsWhenBothPresent() {
        // Web: poll 3 min ago, stream 30 s ago → stream wins (the displayed last-seen).
        let stream = now.addingTimeInterval(-30)
        let result = TelemetryPipelineProjection.liveness(
            lastPoll: now.addingTimeInterval(-180), lastStream: stream, now: now
        )
        XCTAssertEqual(result.level, .sending)
        XCTAssertEqual(result.source, .stream)
        XCTAssertEqual(result.lastSeen, stream)
    }

    func testPollWinsWhenFresher() {
        let poll = now.addingTimeInterval(-30)
        let result = TelemetryPipelineProjection.liveness(
            lastPoll: poll, lastStream: now.addingTimeInterval(-300), now: now
        )
        XCTAssertEqual(result.source, .poll)
        XCTAssertEqual(result.lastSeen, poll)
    }

    private func level(pollAgoMinutes minutes: Double) -> TelemetryLiveness {
        TelemetryPipelineProjection.liveness(
            lastPoll: now.addingTimeInterval(-minutes * 60), lastStream: nil, now: now
        ).level
    }
}

// MARK: - Adapter: formatting + mapping (web parity)

final class TelemetryPipelineProjectionTests: XCTestCase {
    func testVinTail() {
        XCTAssertEqual(TelemetryPipelineProjection.vinTail("5YJSA1E60JF000ABC"), "0ABC")
        XCTAssertEqual(TelemetryPipelineProjection.vinTail("ABC"), "ABC")
        XCTAssertEqual(TelemetryPipelineProjection.vinTail("ABCD"), "ABCD")
        XCTAssertEqual(TelemetryPipelineProjection.vinTail(nil), TelemetryPipelineProjection.vinFallback)
        XCTAssertEqual(TelemetryPipelineProjection.vinTail("   "), TelemetryPipelineProjection.vinFallback)
    }

    func testStateLabelMapping() {
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "online").fallback, "online")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "DRIVING").fallback, "driving")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "charging").fallback, "charging")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "sleeping").fallback, "asleep")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "asleep").fallback, "asleep")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "offline").fallback, "offline")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: nil).fallback, "unknown")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "").fallback, "unknown")
    }

    func testStateLabelPassesThroughUnknownVerbatim() {
        let label = TelemetryPipelineProjection.stateLabel(for: "Updating")
        XCTAssertNil(label.key)
        XCTAssertEqual(label.fallback, "updating")
    }

    func testKnownStateLabelsCarryKeys() {
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: "online").key, "telemetry.pipeline.state.online")
        XCTAssertEqual(TelemetryPipelineProjection.stateLabel(for: nil).key, "telemetry.pipeline.state.unknown")
    }

    func testBatteryTone() {
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(73)), "success")
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(50)), "success")
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(49)), "warning")
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(20)), "warning")
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(19)), "danger")
        XCTAssertEqual(toneName(TelemetryPipelineProjection.batteryTone(0)), "danger")
    }

    func testClampBattery() {
        XCTAssertEqual(TelemetryPipelineProjection.clampBattery(-5), 0)
        XCTAssertEqual(TelemetryPipelineProjection.clampBattery(50), 50)
        XCTAssertEqual(TelemetryPipelineProjection.clampBattery(150), 100)
    }

    func testFormattedCount() {
        XCTAssertEqual(TelemetryPipelineProjection.formattedCount(nil), TelemetryPipelineProjection.emDash)
        XCTAssertEqual(TelemetryPipelineProjection.formattedCount(0), "0")
        XCTAssertEqual(TelemetryPipelineProjection.formattedCount(42), "42")
        XCTAssertFalse(TelemetryPipelineProjection.formattedCount(12366).isEmpty)
    }

    func testDisplayNameFallback() {
        let echo: (String, String) -> String = { _, fallback in fallback }
        XCTAssertEqual(
            TelemetryPipelineProjection.displayName(raw: "  Daily Driver  ", id: 1, localize: echo),
            "Daily Driver"
        )
        XCTAssertEqual(
            TelemetryPipelineProjection.displayName(raw: "", id: 42, localize: echo),
            "Vehicle 42"
        )
    }

    func testLabelKeys() {
        XCTAssertEqual(TelemetryPipelineProjection.label(for: .sending).key, "telemetry.pipeline.sending")
        XCTAssertEqual(TelemetryPipelineProjection.label(for: .slow).fallback, "slow")
        XCTAssertEqual(TelemetryPipelineProjection.label(for: .stale).fallback, "stale")
        XCTAssertEqual(TelemetryPipelineProjection.label(for: .offline).fallback, "offline")
    }
}

// MARK: - Adapter: summary + phase

final class TelemetryPipelineSummaryTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testSummaryTalliesAndOrder() {
        let rows = [
            row(level: .sending), row(level: .sending),
            row(level: .slow),
            row(level: .stale),
            row(level: .offline)
        ]
        let summary = TelemetryPipelineProjection.summary(for: rows)
        XCTAssertEqual(summary.sending, 2)
        XCTAssertEqual(summary.slow, 1)
        XCTAssertEqual(summary.stale, 1)
        XCTAssertEqual(summary.offline, 1)
        XCTAssertEqual(summary.tally(for: .sending), 2)
        // Fixed web order, zero buckets filtered out.
        XCTAssertEqual(summary.orderedNonZero.map(\.level), [.sending, .slow, .stale, .offline])
    }

    func testSummaryFiltersZeroBuckets() {
        let summary = TelemetryPipelineProjection.summary(for: [row(level: .sending)])
        XCTAssertEqual(summary.orderedNonZero.map(\.level), [.sending])
        XCTAssertEqual(summary.orderedNonZero.first?.count, 1)
    }

    func testResolvePhaseMatrix() {
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.loading, hasVehicles: false), .loading)
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.loading, hasVehicles: true), .content)
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.empty, hasVehicles: false), .empty)
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.loaded, hasVehicles: false), .empty)
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.loaded, hasVehicles: true), .content)
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.failed("e"), hasVehicles: false), .error("e"))
        XCTAssertEqual(TelemetryPipelineProjection.resolvePhase(.failed("e"), hasVehicles: true), .content)
    }

    private func row(level: TelemetryLiveness) -> TelemetryPipelineVehicleRow {
        TelemetryPipelineVehicleRow(
            id: 1, displayName: "V", vinTail: "ABCD",
            state: TelemetryStateLabel(key: nil, fallback: "online"),
            level: level, source: .poll, lastSeen: now, nextPoll: nil, batteryPercent: 50
        )
    }
}

// MARK: - Accessibility row summary

final class TelemetryPipelineAccessibilityTests: XCTestCase {
    private let echo: (String, String) -> String = { _, fallback in fallback }
    private let now = Date(timeIntervalSince1970: 1_700_000_000)

    func testRowSummaryIncludesPresentSegments() {
        let row = TelemetryPipelineVehicleRow(
            id: 1, displayName: "Daily Driver", vinTail: "0ABC",
            state: TelemetryStateLabel(key: "telemetry.pipeline.state.online", fallback: "online"),
            level: .sending, source: .stream, lastSeen: now.addingTimeInterval(-30),
            nextPoll: nil, batteryPercent: 73
        )
        let summary = TelemetryPipelineAccessibility.rowSummary(row, now: now, localize: echo)
        XCTAssertTrue(summary.contains("Daily Driver"))
        XCTAssertTrue(summary.contains("sending"))
        XCTAssertTrue(summary.contains("VIN 0ABC"))
        XCTAssertTrue(summary.contains("online"))
        XCTAssertTrue(summary.contains("battery 73%"))
        XCTAssertTrue(summary.contains("last seen"))
    }

    func testRowSummaryOmitsAbsentBattery() {
        let row = TelemetryPipelineVehicleRow(
            id: 2, displayName: "Loaner", vinTail: "0444",
            state: TelemetryStateLabel(key: nil, fallback: "offline"),
            level: .offline, source: .none, lastSeen: nil, nextPoll: nil, batteryPercent: nil
        )
        let summary = TelemetryPipelineAccessibility.rowSummary(row, now: now, localize: echo)
        XCTAssertTrue(summary.contains("Loaner"))
        XCTAssertTrue(summary.contains("offline"))
        XCTAssertFalse(summary.contains("battery"))
        XCTAssertTrue(summary.contains(TelemetryPipelineProjection.emDash))
    }
}
