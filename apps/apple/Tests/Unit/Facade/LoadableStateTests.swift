import XCTest
@testable import TeslaSync

/// Pure-logic tests for `LoadableState` — no framework dependency, so these run
/// independently of the KMP `Shared.xcframework`.
@MainActor final class LoadableStateTests: XCTestCase {
    func testLoadedExposesValueAndFreshness() {
        let state = LoadableState.loaded(42, stale: false)
        XCTAssertEqual(state.value, 42)
        XCTAssertFalse(state.isStale)
        XCTAssertFalse(state.isLoading)
        XCTAssertNil(state.error)
    }

    func testLoadingKeepsCachedValueAndReportsLoading() {
        let state = LoadableState.loading(cached: 7, stale: true)
        XCTAssertEqual(state.value, 7)
        XCTAssertTrue(state.isLoading)
        XCTAssertTrue(state.isStale)
    }

    func testFailedExposesErrorAndCachedValue() {
        let state = LoadableState.failed(.offline, cached: 5, stale: true)
        XCTAssertEqual(state.value, 5)
        XCTAssertEqual(state.error, .offline)
        XCTAssertTrue(state.isStale)
        XCTAssertFalse(state.isLoading)
    }

    func testEmptyAndIdleHaveNoValue() {
        XCTAssertNil(LoadableState<Int>.empty(stale: false).value)
        XCTAssertNil(LoadableState<Int>.idle.value)
        XCTAssertFalse(LoadableState<Int>.idle.isStale)
    }

    func testFacadeErrorRetryability() {
        XCTAssertTrue(FacadeError.timeout(message: "x").isRetryable)
        XCTAssertTrue(FacadeError.api(status: 503, code: nil, body: nil).isRetryable)
        XCTAssertTrue(FacadeError.api(status: 429, code: nil, body: nil).isRetryable)
        XCTAssertFalse(FacadeError.api(status: 404, code: nil, body: nil).isRetryable)
        XCTAssertFalse(FacadeError.auth(message: "x").isRetryable)
    }
}
