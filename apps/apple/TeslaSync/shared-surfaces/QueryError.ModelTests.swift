//
//  QueryError.ModelTests.swift
//  TeslaSync — P4 shared surface · 0133 · QueryError (Apple)
//
//  State-holder coverage for the QueryError surface, kept apart from the pure adapter/projection
//  tests for the lint file-length budget. Drives the `@MainActor` `QueryErrorModel` over the
//  in-memory source + recording navigator + a telemetry spy:
//    • `view.opened` telemetry — emitted once per `start`, re-armed by `stop`.
//    • CTA dispatch — Back-to-list / Sign-in route through the navigator (web `useNavigate`); Retry
//      runs the host handler (web `onRetry`) + re-requests the source; a disabled CTA is a no-op.
//    • Auto-retry on reconnect — the web `window 'online'` effect: a one-shot refetch when the
//      browser returns on a pure-network failure, and never for a status-bearing failure.
//    • Freshness — the one-shot auto-refresh on the transition into stale.
//

import XCTest
@testable import TeslaSync

/// Records `view.opened` calls in a thread-safe box so the model assertions can read them after the
/// MainActor `start()` without an isolation mismatch on the `Sendable` telemetry seam.
private final class SpyQueryErrorTelemetry: QueryErrorTelemetry, @unchecked Sendable {
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

/// Counts host `onRetry` invocations (web query refetch). MainActor-isolated to match the model's
/// `@MainActor` retry handler.
@MainActor
private final class RetryRecorder {
    private(set) var count = 0
    func fire() {
        count += 1
    }
}

@MainActor
final class QueryErrorModelTests: XCTestCase {
    func testStartEmitsViewOpenedOnceAndIsIdempotent() {
        let telemetry = SpyQueryErrorTelemetry()
        let model = QueryErrorModel(
            source: InMemoryQueryErrorSource(),
            navigator: RecordingQueryErrorNavigator(),
            telemetry: telemetry
        )
        model.start()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 1)
        XCTAssertEqual(telemetry.lastSurface, "QueryError")
    }

    func testStopReArmsViewOpened() {
        let telemetry = SpyQueryErrorTelemetry()
        let model = QueryErrorModel(
            source: InMemoryQueryErrorSource(),
            navigator: RecordingQueryErrorNavigator(),
            telemetry: telemetry
        )
        model.start()
        model.stop()
        model.start()
        XCTAssertEqual(telemetry.openedCount, 2)
    }

    func testCanRetryReflectsHandlerPresence() {
        let withRetry = QueryErrorModel(
            source: InMemoryQueryErrorSource(),
            navigator: RecordingQueryErrorNavigator(),
            onRetry: {}
        )
        XCTAssertTrue(withRetry.canRetry)

        let noRetry = QueryErrorModel(
            source: InMemoryQueryErrorSource(),
            navigator: RecordingQueryErrorNavigator()
        )
        XCTAssertFalse(noRetry.canRetry)
    }

    func testPerformBackToListNavigatesToListHref() {
        let navigator = RecordingQueryErrorNavigator()
        let model = QueryErrorModel(source: InMemoryQueryErrorSource(), navigator: navigator)
        let action = QueryErrorAction(
            kind: .backToList,
            label: .verbatim("Back"),
            isEnabled: true,
            destination: "/drives"
        )
        model.perform(action)
        XCTAssertEqual(navigator.destinations, ["/drives"])
    }

    func testPerformSignInNavigatesToLogin() {
        let navigator = RecordingQueryErrorNavigator()
        let model = QueryErrorModel(source: InMemoryQueryErrorSource(), navigator: navigator)
        let action = QueryErrorAction(
            kind: .signIn,
            label: .verbatim("Sign in"),
            isEnabled: true,
            destination: "/login"
        )
        model.perform(action)
        XCTAssertEqual(navigator.destinations, ["/login"])
    }

    func testPerformRetryRunsHandlerAndRefreshesSource() {
        let source = InMemoryQueryErrorSource()
        let recorder = RetryRecorder()
        let model = QueryErrorModel(source: source, navigator: RecordingQueryErrorNavigator()) { recorder.fire() }
        let action = QueryErrorAction(kind: .retry, label: .verbatim("Retry"), isEnabled: true, destination: nil)
        model.perform(action)
        XCTAssertEqual(recorder.count, 1)
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testPerformDisabledActionIsNoOp() {
        let source = InMemoryQueryErrorSource()
        let recorder = RetryRecorder()
        let model = QueryErrorModel(source: source, navigator: RecordingQueryErrorNavigator()) { recorder.fire() }
        let disabled = QueryErrorAction(
            kind: .retryWhenOnline,
            label: .verbatim("Retry when online"),
            isEnabled: false,
            destination: nil
        )
        model.perform(disabled)
        XCTAssertEqual(recorder.count, 0)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testAutoRetryFiresOnceWhenReconnectingOnNetworkFailure() {
        let source = InMemoryQueryErrorSource()
        let recorder = RetryRecorder()
        let model = QueryErrorModel(source: source, navigator: RecordingQueryErrorNavigator()) { recorder.fire() }
        model.start()
        source.push(QueryErrorInput(failure: .network, online: false))
        XCTAssertEqual(recorder.count, 0)
        source.push(QueryErrorInput(failure: .network, online: true))
        XCTAssertEqual(recorder.count, 1)
        // A second online snapshot does not re-fire (one-shot, web `{ once: true }`).
        source.push(QueryErrorInput(failure: .network, online: true))
        XCTAssertEqual(recorder.count, 1)
    }

    func testAutoRetryDoesNotFireForStatusedFailure() {
        let source = InMemoryQueryErrorSource()
        let recorder = RetryRecorder()
        let model = QueryErrorModel(source: source, navigator: RecordingQueryErrorNavigator()) { recorder.fire() }
        model.start()
        // Web arms only when `status === undefined`; a 5xx offline → online must not auto-retry.
        source.push(QueryErrorInput(failure: .http(500), online: false))
        source.push(QueryErrorInput(failure: .http(500), online: true))
        XCTAssertEqual(recorder.count, 0)
    }

    func testStaleTransitionTriggersAutoRefresh() {
        let source = InMemoryQueryErrorSource()
        let model = QueryErrorModel(source: source, navigator: RecordingQueryErrorNavigator(), onRetry: {})
        model.start()
        source.push(QueryErrorInput(failure: .http(500), online: true, isStale: false))
        XCTAssertEqual(source.refreshCount, 0)
        source.push(QueryErrorInput(failure: .http(500), online: true, isStale: true))
        XCTAssertEqual(source.refreshCount, 1)
        XCTAssertEqual(model.connection, .stale)
    }
}
