//
//  ImpersonationBanner.SourceTests.swift
//  TeslaSync — P4 shared surface · 0123 · ImpersonationBanner (Apple)
//
//  Seam coverage for the production polling source + the gateway it drives: the start sequence
//  (loading → loaded), the transport-drop classification (cached status preserved behind the offline
//  chip), the server-error classification (the retryable error phase), the end mutation
//  (optimistic-inactive then confirming reload, web `endMut` priming the cache), the refresh reload,
//  and the closure gateway forwarding to the embedder's transport. Driven through a recording gateway
//  double — no real networking.
//

import XCTest
@testable import TeslaSync

@MainActor
final class DefaultImpersonationBannerSourceTests: XCTestCase {
    private func subject() -> ImpersonationBannerSubject {
        ImpersonationBannerSubject(
            target: "subject-aa10",
            originalAdmin: "admin-root",
            expiresAt: Date(timeIntervalSince1970: 1_700_000_000)
        )
    }

    /// A long poll interval keeps the background poll out of the (sub-second) test window so each
    /// assertion observes only the load it triggered.
    private func makeSource(_ gateway: RecordingImpersonationBannerGateway) -> DefaultImpersonationBannerSource {
        DefaultImpersonationBannerSource(gateway: gateway, pollInterval: 10000, staleAfter: 10000)
    }

    /// Drives the source via `trigger` until a recorded input matches `predicate`, or it times out.
    private func wait(
        _ description: String,
        on recorder: ImpersonationBannerInputRecorder,
        for predicate: @escaping (ImpersonationBannerInput) -> Bool,
        trigger: () -> Void
    ) async {
        let satisfied = expectation(description: description)
        satisfied.assertForOverFulfill = false
        recorder.onInput = { if predicate($0) { satisfied.fulfill() } }
        trigger()
        await fulfillment(of: [satisfied], timeout: 2)
        recorder.onInput = nil
    }

    private func isActive(_ input: ImpersonationBannerInput) -> Bool {
        if case .active = input.status { return !input.isLoading && !input.isEnding }
        return false
    }

    private func isInactive(_ input: ImpersonationBannerInput) -> Bool {
        if case .inactive = input.status { return !input.isLoading && !input.isEnding }
        return false
    }

    func testStartEmitsLoadingThenLoadedActive() async {
        let gateway = RecordingImpersonationBannerGateway(results: [.status(.active(subject()))])
        let source = makeSource(gateway)
        let recorder = ImpersonationBannerInputRecorder()
        source.onUpdate = { recorder.record($0) }

        await wait("loaded", on: recorder, for: isActive) { source.start() }

        XCTAssertEqual(recorder.inputs.first?.isLoading, true)
        XCTAssertEqual(recorder.inputs.last?.status, .active(subject()))
        XCTAssertEqual(recorder.inputs.last?.connection, .live)
        XCTAssertEqual(gateway.loadCount, 1)
        source.stop()
    }

    func testTransportFailureKeepsCachedStatusOffline() async {
        let gateway = RecordingImpersonationBannerGateway(results: [
            .status(.active(subject())),
            .failure(.offline(message: "network down"))
        ])
        let source = makeSource(gateway)
        let recorder = ImpersonationBannerInputRecorder()
        source.onUpdate = { recorder.record($0) }

        await wait("live", on: recorder, for: isActive) { source.start() }
        await wait("offline", on: recorder, for: { $0.connection == .offline }, trigger: { source.refresh() })

        XCTAssertEqual(recorder.inputs.last?.status, .active(subject()))
        XCTAssertEqual(recorder.inputs.last?.connection, .offline)
        XCTAssertNil(recorder.inputs.last?.errorMessage)
        source.stop()
    }

    func testServerFailureSurfacesErrorPhase() async {
        let gateway = RecordingImpersonationBannerGateway(results: [.failure(.failure(message: "500"))])
        let source = makeSource(gateway)
        let recorder = ImpersonationBannerInputRecorder()
        source.onUpdate = { recorder.record($0) }

        await wait("failed", on: recorder, for: { $0.errorMessage != nil }, trigger: { source.start() })

        XCTAssertEqual(recorder.inputs.last?.errorMessage, "500")
        XCTAssertEqual(recorder.inputs.last?.connection, .live)
        source.stop()
    }

    func testEndOptimisticallyClearsThenReloadsInactive() async {
        let gateway = RecordingImpersonationBannerGateway(results: [
            .status(.active(subject())),
            .status(.inactive)
        ])
        let source = makeSource(gateway)
        let recorder = ImpersonationBannerInputRecorder()
        source.onUpdate = { recorder.record($0) }

        await wait("active", on: recorder, for: isActive) { source.start() }
        await wait("cleared", on: recorder, for: isInactive) { source.endImpersonation() }

        XCTAssertEqual(gateway.endCount, 1)
        XCTAssertTrue(recorder.inputs.contains { $0.isEnding && $0.status == .active(subject()) })
        source.stop()
    }

    func testRefreshTriggersReload() async {
        let gateway = RecordingImpersonationBannerGateway(results: [
            .status(.inactive),
            .status(.active(subject()))
        ])
        let source = makeSource(gateway)
        let recorder = ImpersonationBannerInputRecorder()
        source.onUpdate = { recorder.record($0) }

        await wait("first", on: recorder, for: isInactive) { source.start() }
        await wait("second", on: recorder, for: isActive) { source.refresh() }

        XCTAssertEqual(gateway.loadCount, 2)
        XCTAssertEqual(recorder.inputs.last?.status, .active(subject()))
        source.stop()
    }
}

// MARK: - Closure gateway

@MainActor
final class ClosureImpersonationBannerGatewayTests: XCTestCase {
    func testForwardsLoadAndEndToClosures() async throws {
        let ended = LockedFlag()
        let gateway = ClosureImpersonationBannerGateway(
            loadStatus: { .active(ImpersonationBannerSubject(target: "z", originalAdmin: "a", expiresAt: nil)) },
            endImpersonation: { ended.set() }
        )

        let status = try await gateway.loadStatus()
        XCTAssertEqual(status.activeSubject?.target, "z")

        try await gateway.endImpersonation()
        XCTAssertTrue(ended.value)
    }
}

// MARK: - Test doubles

/// Collects the inputs the source emits and notifies an optional predicate hook. `@MainActor`-bound
/// so it is captured as a reference (never a mutable local) by the escaping `onUpdate` closure.
@MainActor
final class ImpersonationBannerInputRecorder {
    private(set) var inputs: [ImpersonationBannerInput] = []
    var onInput: ((ImpersonationBannerInput) -> Void)?

    func record(_ input: ImpersonationBannerInput) {
        inputs.append(input)
        onInput?(input)
    }
}

/// Records the gateway calls and returns seeded results per `loadStatus` call (the last result
/// repeats), throwing a seeded error from `endImpersonation` when configured. Lock-guarded so it
/// satisfies the `Sendable` gateway seam under Swift 6 strict concurrency.
final class RecordingImpersonationBannerGateway: ImpersonationBannerGateway, @unchecked Sendable {
    enum LoadResult {
        case status(ImpersonationBannerStatus)
        case failure(ImpersonationBannerGatewayError)
    }

    private let lock = NSLock()
    private let results: [LoadResult]
    private let endError: ImpersonationBannerGatewayError?
    private var loadCalls = 0
    private var endCalls = 0

    init(results: [LoadResult] = [.status(.inactive)], endError: ImpersonationBannerGatewayError? = nil) {
        self.results = results
        self.endError = endError
    }

    var loadCount: Int {
        lock.withLock { loadCalls }
    }

    var endCount: Int {
        lock.withLock { endCalls }
    }

    func loadStatus() async throws -> ImpersonationBannerStatus {
        let result: LoadResult = lock.withLock {
            let index = min(loadCalls, max(0, results.count - 1))
            loadCalls += 1
            return results.isEmpty ? .status(.inactive) : results[index]
        }
        switch result {
        case let .status(status): return status
        case let .failure(error): throw error
        }
    }

    func endImpersonation() async throws {
        lock.withLock { endCalls += 1 }
        if let endError { throw endError }
    }
}

/// A tiny lock-guarded boolean the closure-gateway test flips from a `@Sendable` closure.
private final class LockedFlag: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    var value: Bool {
        lock.withLock { flag }
    }

    func set() {
        lock.withLock { flag = true }
    }
}
