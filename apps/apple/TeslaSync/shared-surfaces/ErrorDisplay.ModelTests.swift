//
//  ErrorDisplay.ModelTests.swift
//  TeslaSync — P4 shared surface · 0120 · ErrorDisplay (Apple)
//
//  State-holder coverage for the ErrorDisplay surface, kept apart from the pure adapter/projection
//  tests for the lint file-length budget. Drives the `@MainActor` `ErrorDisplayModel` over the
//  in-memory source + recording navigator + a telemetry spy:
//    • `view.opened` telemetry — emitted once per `start`, re-armed by `stop`.
//    • CTA dispatch — Back-to-list / Sign-in route through the navigator (web `useNavigate`); Retry
//      runs the host handler (web `onRetry`) + re-requests the source; a disabled CTA is a no-op.
//    • NO reconnect auto-retry — the web `ErrorDisplay` has no `useEffect`, so a browser reconnect on a
//      network failure must NOT fire `onRetry` (the delta from `QueryError`).
//    • Density — `model.density` tracks the `compact` input (web `compact` prop).
//    • Freshness — the one-shot auto-refresh on the transition into stale.
//

import XCTest
@testable import TeslaSync

/// Records `view.opened` calls in a thread-safe box so the model assertions can read them after the
/// MainActor `start()` without an isolation mismatch on the `Sendable` telemetry seam.
private final class SpyErrorDisplayTelemetry: ErrorDisplayTelemetry, @unchecked Sendable {
    private let lock = NSLock()
    private var surfaces: [String] = []

    func viewOpened(surface: String) {
        lock.lock()
        defer { lock.unlock() }
        surfaces.append(surface)
    }

    var openedCount: Int {
        lock.lock()
        defer { lock.unlock() }
        return surfaces.count
    }

    var lastSurface: String? {
        lock.lock()
        defer { lock.unlock() }
        return surfaces.last
    }
}

/// Counts host `onRetry` invocations (web operation re-run). MainActor-isolated to match the model's
/// `@MainActor` retry handler.
@MainActor
private final class RetryRecorder {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}

@MainActor
final class ErrorDisplayModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyErrorDisplayTelemetry()
        let model = ErrorDisplayModel(
            source: InMemoryErrorDisplaySource(),
            navigator: RecordingErrorDisplayNavigator(),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 1)
        XCTAssertEqual(telemetry.lastSurface, "ErrorDisplay")
    }

    func testStopReArmsViewOpened() {
        let telemetry = SpyErrorDisplayTelemetry()
        let model = ErrorDisplayModel(
            source: InMemoryErrorDisplaySource(),
            navigator: RecordingErrorDisplayNavigator(),
            telemetry: telemetry
        )
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 2)
    }

    func testCanRetryReflectsHandlerPresence() {
        let withRetry = ErrorDisplayModel(
            source: InMemoryErrorDisplaySource(),
            navigator: RecordingErrorDisplayNavigator(),
            onRetry: {}
        )
        XCTAssertTrue(withRetry.canRetry)

        let noRetry = ErrorDisplayModel(
            source: InMemoryErrorDisplaySource(),
            navigator: RecordingErrorDisplayNavigator()
        )
        XCTAssertFalse(noRetry.canRetry)
    }

    func testPerformBackToListNavigatesToListHref() {
        let navigator = RecordingErrorDisplayNavigator()
        let model = ErrorDisplayModel(source: InMemoryErrorDisplaySource(), navigator: navigator)
        let action = ErrorDisplayAction(
            kind: .backToList,
            label: .verbatim("Back"),
            isEnabled: true,
            destination: "/drives"
        )
        model.perform(action)
        XCTAssertEqual(navigator.destinations, ["/drives"])
    }

    func testPerformSignInNavigatesToLogin() {
        let navigator = RecordingErrorDisplayNavigator()
        let model = ErrorDisplayModel(source: InMemoryErrorDisplaySource(), navigator: navigator)
        let action = ErrorDisplayAction(
            kind: .signIn,
            label: .verbatim("Sign in"),
            isEnabled: true,
            destination: "/login"
        )
        model.perform(action)
        XCTAssertEqual(navigator.destinations, ["/login"])
    }

    func testPerformRetryRunsHandlerAndRefreshesSource() {
        let source = InMemoryErrorDisplaySource()
        let recorder = RetryRecorder()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator()) { recorder.fire() }
        let action = ErrorDisplayAction(kind: .retry, label: .verbatim("Retry"), isEnabled: true, destination: nil)
        model.perform(action)
        XCTAssertEqual(recorder.count, 1)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testPerformDisabledActionIsNoOp() {
        let source = InMemoryErrorDisplaySource()
        let recorder = RetryRecorder()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator()) { recorder.fire() }
        let disabled = ErrorDisplayAction(
            kind: .retryWhenOnline,
            label: .verbatim("Retry when online"),
            isEnabled: false,
            destination: nil
        )
        model.perform(disabled)
        XCTAssertEqual(recorder.count, 0)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testReconnectDoesNotAutoRetry() {
        // The delta from QueryError: ErrorDisplay has no `window 'online'` effect, so reconnecting on a
        // pure-network failure must NOT fire `onRetry` — only the user-driven Retry recovers it.
        let source = InMemoryErrorDisplaySource()
        let recorder = RetryRecorder()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator()) { recorder.fire() }
        model.start()
        source.push(ErrorDisplayInput(failure: .network, online: false))
        XCTAssertEqual(recorder.count, 0)
        source.push(ErrorDisplayInput(failure: .network, online: true))
        XCTAssertEqual(recorder.count, 0, "ErrorDisplay must not auto-retry on reconnect")
    }

    func testDensityTracksCompactInput() {
        let source = InMemoryErrorDisplaySource()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator())
        model.start()
        XCTAssertEqual(model.density, .comfortable)
        source.push(ErrorDisplayInput(failure: .http(500), compact: true))
        XCTAssertEqual(model.density, .compact)
        source.push(ErrorDisplayInput(failure: .http(500), compact: false))
        XCTAssertEqual(model.density, .comfortable)
    }

    func testStaleTransitionTriggersAutoRefreshOnce() {
        let source = InMemoryErrorDisplaySource()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator(), onRetry: {})
        model.start()
        source.push(ErrorDisplayInput(failure: .http(500), online: true, isStale: false))
        XCTAssertEqual(source.refreshCount, 0)
        source.push(ErrorDisplayInput(failure: .http(500), online: true, isStale: true))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)
        // Staying stale must not re-fire the one-shot auto-refresh.
        source.push(ErrorDisplayInput(failure: .http(500), online: true, isStale: true))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStaleAutoRefreshReArmsAfterReturningToLive() {
        let source = InMemoryErrorDisplaySource()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator())
        model.start()
        source.push(ErrorDisplayInput(failure: .http(500), isStale: true))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ErrorDisplayInput(failure: .http(500), isStale: false))
        XCTAssertEqual(model.connection, .live)
        source.push(ErrorDisplayInput(failure: .http(500), isStale: true))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPhaseTracksPushedFailure() {
        let source = InMemoryErrorDisplaySource()
        let model = ErrorDisplayModel(source: source, navigator: RecordingErrorDisplayNavigator())
        model.start()
        XCTAssertEqual(model.phase, .empty)
        source.push(ErrorDisplayInput(failure: .http(401)))
        XCTAssertEqual(model.phase, .failure)
        XCTAssertEqual(model.resolved.content?.mode, .unauthorized)
    }
}

// MARK: - Controlled source (production parity of the web host)

@MainActor
final class StaticErrorDisplaySourceTests: XCTestCase {
    func testStartAndRefreshReEmitTheControlledSnapshot() {
        let source = StaticErrorDisplaySource(failure: .http(500))
        var inputs: [ErrorDisplayInput] = []
        source.onUpdate = { inputs.append($0) }
        source.start()
        XCTAssertEqual(inputs.last?.failure?.status, 500)
        source.refresh()
        XCTAssertEqual(inputs.count, 2)
    }

    func testUpdateReplacesAndReEmits() {
        let source = StaticErrorDisplaySource(failure: .http(500))
        var inputs: [ErrorDisplayInput] = []
        source.onUpdate = { inputs.append($0) }
        source.update(ErrorDisplayInput(failure: .offline, compact: true, online: false))
        XCTAssertEqual(inputs.last?.failure, .offline)
        XCTAssertEqual(inputs.last?.connection, .offline)
        XCTAssertEqual(inputs.last?.density, .compact)
    }
}
