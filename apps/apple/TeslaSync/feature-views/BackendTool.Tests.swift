//
//  BackendTool.Tests.swift
//  TeslaSync — P4 feature view · 0002 · BackendTool (Apple)
//
//  Unit coverage for the BackendTool surface:
//    • Adapter (settled outcome → projection) — `BackendToolJSON` pretty-print
//      parity with the web `JSON.stringify(data, null, 2)`, the run-status badge
//      (web `Badge variant={data.error ? 'danger' : 'success'}`), the freshness
//      chip, and the method tone.
//    • State holder — `BackendToolModel` phase transitions across idle / running /
//      success / failure, the cached-behind-offline contract, freshness (stale),
//      run re-entrancy guard, and the P1/S11 `view.opened` telemetry + seam wiring.
//    • Accessibility — the VoiceOver run label + result summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryBackendToolRunner`.
//

import Foundation
import XCTest
@testable import TeslaSync

// MARK: - Adapter: settled outcome → projection

@MainActor final class BackendToolAdapterTests: XCTestCase {
    /// English-fallback localizer (bundle-free) used by the projection tests.
    private let echo: (String, String) -> String = { _, fallback in fallback }

    // JSON pretty-print (web `JSON.stringify(data, null, 2)`)

    func testPrettyPrintSortsKeysAndIndents() {
        let pretty = BackendToolJSON.prettyPrinted("{\"b\":1,\"a\":2}")
        XCTAssertTrue(pretty.contains("\"a\""))
        XCTAssertTrue(pretty.contains("\"b\""))
        XCTAssertTrue(pretty.contains("\n"))
        let aIndex = try? XCTUnwrap(pretty.range(of: "\"a\"")).lowerBound
        let bIndex = try? XCTUnwrap(pretty.range(of: "\"b\"")).lowerBound
        XCTAssertNotNil(aIndex)
        XCTAssertNotNil(bIndex)
        if let aIndex, let bIndex { XCTAssertLessThan(aIndex, bIndex) }
    }

    func testPrettyPrintTrimsSurroundingWhitespace() {
        let pretty = BackendToolJSON.prettyPrinted("   {\"x\":1}   ")
        XCTAssertTrue(pretty.hasPrefix("{"))
        XCTAssertTrue(pretty.contains("\"x\""))
    }

    func testPrettyPrintReturnsNonObjectBodyVerbatim() {
        XCTAssertEqual(BackendToolJSON.prettyPrinted("not json"), "not json")
        XCTAssertEqual(BackendToolJSON.prettyPrinted("42"), "42")
        XCTAssertEqual(BackendToolJSON.prettyPrinted("   "), "")
    }

    // Run-status badge projection

    func testStatusHiddenWhileIdleOrRunning() {
        XCTAssertEqual(BackendToolStatus.project(phase: .idle).kind, .hidden)
        XCTAssertEqual(BackendToolStatus.project(phase: .running).kind, .hidden)
    }

    func testStatusSuccessAndFailureProjection() {
        let success = BackendToolStatus.project(phase: .success)
        XCTAssertEqual(success.kind, .success)
        XCTAssertEqual(success.tone, .success)
        XCTAssertEqual(success.labelKey, "Success")

        let failure = BackendToolStatus.project(phase: .failure)
        XCTAssertEqual(failure.kind, .failure)
        XCTAssertEqual(failure.tone, .danger)
        XCTAssertEqual(failure.labelKey, "Failed")
    }

    // Freshness chip projection

    func testConnectionChipMapsEveryState() {
        XCTAssertEqual(BackendToolConnectionChip.project(.live).labelKey, "devtools.tool.live")
        XCTAssertEqual(BackendToolConnectionChip.project(.live).tone, .success)
        XCTAssertEqual(BackendToolConnectionChip.project(.stale).labelKey, "devtools.tool.stale")
        XCTAssertEqual(BackendToolConnectionChip.project(.stale).tone, .warning)
        XCTAssertEqual(BackendToolConnectionChip.project(.offline).labelKey, "devtools.tool.offline")
        XCTAssertEqual(BackendToolConnectionChip.project(.offline).tone, .neutral)
    }

    // Method verb + tone

    func testMethodRawValuesAndTones() {
        XCTAssertEqual(BackendToolMethod.get.rawValue, "GET")
        XCTAssertEqual(BackendToolMethod.post.rawValue, "POST")
        XCTAssertEqual(BackendToolMethod.delete.rawValue, "DELETE")
        XCTAssertEqual(BackendToolMethod.get.tone, .info)
        XCTAssertEqual(BackendToolMethod.post.tone, .success)
        XCTAssertEqual(BackendToolMethod.delete.tone, .danger)
    }

    // Result value flags

    func testResultFlags() {
        let data = BackendToolResult(json: "{}", error: nil, completedAt: Date())
        XCTAssertTrue(data.hasData)
        XCTAssertFalse(data.isError)

        let error = BackendToolResult(json: nil, error: "boom", completedAt: Date())
        XCTAssertFalse(error.hasData)
        XCTAssertTrue(error.isError)
    }

    // Accessibility summaries

    func testRunLabelCombinesActionAndTitle() {
        XCTAssertEqual(BackendToolAccessibility.runLabel(title: "Reset cache", localize: echo), "Run, Reset cache")
        XCTAssertEqual(BackendToolAccessibility.runLabel(title: "", localize: echo), "Run")
    }

    func testResultSummaryAcrossStates() {
        XCTAssertEqual(BackendToolAccessibility.resultSummary(result: nil, localize: echo), "No result yet")

        let error = BackendToolResult(json: nil, error: "boom", completedAt: Date())
        XCTAssertEqual(BackendToolAccessibility.resultSummary(result: error, localize: echo), "Failed. boom")

        let data = BackendToolResult(json: "{}", error: nil, completedAt: Date())
        XCTAssertEqual(BackendToolAccessibility.resultSummary(result: data, localize: echo), "Success")
    }
}

// MARK: - State holder: phases + freshness + telemetry + seam wiring

@MainActor final class BackendToolModelTests: XCTestCase {
    func testInitialStateIsIdle() {
        let model = BackendToolModel(runner: InMemoryBackendToolRunner())
        XCTAssertEqual(model.phase, .idle)
        XCTAssertNil(model.result)
        XCTAssertFalse(model.showsStatusBadge)
        XCTAssertEqual(model.connection, .live)
    }

    func testRunMovesToRunningThenSuccess() throws {
        let runner = InMemoryBackendToolRunner(autoResponds: false)
        let model = BackendToolModel(runner: runner)
        model.run()
        XCTAssertEqual(model.phase, .running)
        XCTAssertFalse(model.showsStatusBadge)

        runner.push(.success(json: "{\"ok\":true}"))
        XCTAssertEqual(model.phase, .success)
        XCTAssertTrue(model.showsStatusBadge)
        XCTAssertEqual(model.connection, .live)
        let result = try XCTUnwrap(model.result)
        XCTAssertTrue(result.hasData)
        XCTAssertTrue(try XCTUnwrap(result.json).contains("ok"))
    }

    func testFailureOutcomeSurfacesError() throws {
        let runner = InMemoryBackendToolRunner(outcome: .failure(message: "404 — not found"))
        let model = BackendToolModel(runner: runner)
        model.run()
        XCTAssertEqual(model.phase, .failure)
        XCTAssertTrue(model.showsStatusBadge)
        let result = try XCTUnwrap(model.result)
        XCTAssertEqual(result.error, "404 — not found")
        XCTAssertFalse(result.hasData)
    }

    func testOfflineKeepsCachedSuccessVisible() throws {
        let runner = InMemoryBackendToolRunner(autoResponds: false)
        let model = BackendToolModel(runner: runner)
        model.run()
        runner.push(.success(json: "{\"cached\":1}"))
        runner.push(.offline(message: "Network unavailable"))

        XCTAssertEqual(model.phase, .success)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        let result = try XCTUnwrap(model.result)
        XCTAssertTrue(result.hasData)
    }

    func testOfflineWithoutCacheBecomesFailure() throws {
        let runner = InMemoryBackendToolRunner(outcome: .offline(message: "No connection"))
        let model = BackendToolModel(runner: runner)
        model.run()
        XCTAssertEqual(model.phase, .failure)
        XCTAssertTrue(model.isOffline)
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(try XCTUnwrap(model.result).error, "No connection")
    }

    func testStaleAfterFreshnessWindow() {
        let clock = BackendToolMutableClock(Date(timeIntervalSince1970: 1_000_000))
        let runner = InMemoryBackendToolRunner(outcome: .success(json: "{\"ok\":1}"))
        let model = BackendToolModel(runner: runner, now: { clock.now() }, stalenessWindow: 30)
        model.run()
        XCTAssertFalse(model.isStale)
        XCTAssertEqual(model.connection, .live)

        clock.current = Date(timeIntervalSince1970: 1_000_200)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.connection, .stale)
    }

    func testRunIsGuardedWhileRunning() {
        let runner = InMemoryBackendToolRunner(autoResponds: false)
        let model = BackendToolModel(runner: runner)
        model.run()
        model.run()
        XCTAssertEqual(runner.runCount, 1)

        runner.push(.success(json: "{}"))
        model.run()
        XCTAssertEqual(runner.runCount, 2)
    }

    func testStartEmitsViewOpenedOnce() {
        let spy = SpyBackendToolTelemetry()
        let model = BackendToolModel(runner: InMemoryBackendToolRunner(), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [BackendToolSurface.slug])
        XCTAssertEqual(BackendToolSurface.slug, "BackendTool")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyBackendToolTelemetry: BackendToolTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

/// A settable clock so the freshness window can be crossed deterministically.
private final class BackendToolMutableClock: @unchecked Sendable {
    var current: Date
    init(_ start: Date) {
        current = start
    }

    func now() -> Date {
        current
    }
}
