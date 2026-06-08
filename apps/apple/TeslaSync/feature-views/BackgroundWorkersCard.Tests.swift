//
//  BackgroundWorkersCard.Tests.swift
//  TeslaSync — P4 feature view · 0240 · BackgroundWorkersCard (Apple)
//
//  Unit coverage for the BackgroundWorkersCard surface:
//    • Adapter — the snake_case wire decode (incl. lenient status / counts), the
//      shortHost normalisation, the latency rounding, the per-name grouping +
//      severity rollup, and the two-axis summary.
//    • State holder — `WorkersProjection` phase resolution across loading / error /
//      empty / data plus the stale / offline overlays, the `BackgroundWorkersModel`
//      wiring, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver group + instance summaries.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryWorkersSource`.
//

import XCTest
@testable import TeslaSync

// MARK: - Wire decode (snake_case → model)

@MainActor final class WorkersDecodeTests: XCTestCase {
    private func decode(_ json: String) -> WorkersHealthSnapshot? {
        WorkersHealthSnapshot.decode(Data(json.utf8))
    }

    func testDecodesSnakeCaseEnvelope() {
        let snapshot = decode("""
        {
          "workers": [
            {"name": "notification-worker", "host": "http://notification-worker:8081/healthz",
             "status": "healthy", "latency_ms": 12},
            {"name": "export-worker", "host": "http://export-worker:8082/healthz",
             "status": "down", "latency_ms": 0, "error": "dial tcp: connection refused"}
          ],
          "total": 2,
          "healthy_count": 1
        }
        """)
        XCTAssertNotNil(snapshot)
        XCTAssertEqual(snapshot?.workers.count, 2)
        XCTAssertEqual(snapshot?.total, 2)
        XCTAssertEqual(snapshot?.healthyCount, 1)
        XCTAssertEqual(snapshot?.workers[0].status, .healthy)
        XCTAssertEqual(snapshot?.workers[0].latencyMs, 12)
        XCTAssertNil(snapshot?.workers[0].error)
        XCTAssertEqual(snapshot?.workers[1].status, .down)
        XCTAssertEqual(snapshot?.workers[1].error, "dial tcp: connection refused")
    }

    func testUnknownStatusBecomesDownAndCountsAreDerived() {
        let snapshot = decode("""
        {"workers": [{"name": "x", "host": "http://h:1/healthz", "status": "bananas"}]}
        """)
        XCTAssertEqual(snapshot?.workers.first?.status, .down)
        XCTAssertNil(snapshot?.workers.first?.latencyMs)
        // total / healthy_count absent → derived from the rows.
        XCTAssertEqual(snapshot?.total, 1)
        XCTAssertEqual(snapshot?.healthyCount, 0)
    }

    func testEmptyWorkersDecodes() {
        let snapshot = decode("""
        {"workers": [], "total": 0, "healthy_count": 0}
        """)
        XCTAssertEqual(snapshot?.workers.count, 0)
        XCTAssertEqual(snapshot?.total, 0)
    }
}

// MARK: - Host normalisation (port of web shortHost)

@MainActor final class WorkersShortHostTests: XCTestCase {
    func testStripsSchemeAndHealthzSuffix() {
        XCTAssertEqual(WorkersAdapter.shortHost("http://notification-worker:8081/healthz"), "notification-worker:8081")
        XCTAssertEqual(WorkersAdapter.shortHost("https://nw-1:8081/healthz"), "nw-1:8081")
    }

    func testStripsTrailingSlashVariant() {
        XCTAssertEqual(WorkersAdapter.shortHost("http://e1:8082/healthz/"), "e1:8082")
    }

    func testLeavesBareHostUntouched() {
        XCTAssertEqual(WorkersAdapter.shortHost("automation-worker:8083"), "automation-worker:8083")
    }
}

// MARK: - Latency rounding (port of web fmtLatency)

@MainActor final class WorkersLatencyTests: XCTestCase {
    func testNilAndNonFiniteReturnNil() {
        XCTAssertNil(WorkersAdapter.roundedLatencyMs(nil))
        XCTAssertNil(WorkersAdapter.roundedLatencyMs(.infinity))
        XCTAssertNil(WorkersAdapter.roundedLatencyMs(.nan))
    }

    func testRoundsToWholeMilliseconds() {
        XCTAssertEqual(WorkersAdapter.roundedLatencyMs(23), 23)
        XCTAssertEqual(WorkersAdapter.roundedLatencyMs(11.4), 11)
        XCTAssertEqual(WorkersAdapter.roundedLatencyMs(11.6), 12)
        XCTAssertEqual(WorkersAdapter.roundedLatencyMs(12.5), 13)
        XCTAssertEqual(WorkersAdapter.roundedLatencyMs(0), 0)
    }
}

// MARK: - Grouping + severity rollup (port of web groupByName)

@MainActor final class WorkersGroupingTests: XCTestCase {
    private func instance(
        _ name: String,
        _ host: String,
        _ status: WorkerInstanceStatus,
        latency: Double? = nil,
        error: String? = nil
    ) -> WorkerInstance {
        WorkerInstance(name: name, host: host, status: status, latencyMs: latency, error: error)
    }

    func testGroupsByNameSortedAlphabetically() {
        let groups = WorkersAdapter.group([
            instance("notification-worker", "http://notification-worker:8081/healthz", .healthy),
            instance("export-worker", "http://export-worker:8082/healthz", .healthy),
            instance("automation-worker", "http://automation-worker:8083/healthz", .healthy)
        ])
        XCTAssertEqual(groups.map(\.name), ["automation-worker", "export-worker", "notification-worker"])
        XCTAssertTrue(groups.allSatisfy { $0.total == 1 && !$0.isMulti })
    }

    func testMultipleInstancesGroupUnderOneNameAndProjectEachHost() {
        let groups = WorkersAdapter.group([
            instance("notification-worker", "http://nw-1:8081/healthz", .healthy, latency: 8),
            instance("notification-worker", "http://nw-2:8081/healthz", .healthy, latency: 14),
            instance("notification-worker", "http://nw-3:8081/healthz", .healthy, latency: 9)
        ])
        XCTAssertEqual(groups.count, 1)
        let group = groups[0]
        XCTAssertEqual(group.total, 3)
        XCTAssertTrue(group.isMulti)
        XCTAssertEqual(group.healthyCount, 3)
        XCTAssertEqual(group.severity, .healthy)
        XCTAssertEqual(group.instances.map(\.shortHost), ["nw-1:8081", "nw-2:8081", "nw-3:8081"])
        XCTAssertEqual(group.instances[0].id, "notification-worker::http://nw-1:8081/healthz")
    }

    func testDegradedWhenOneInstanceUnhealthy() {
        let groups = WorkersAdapter.group([
            instance("notification-worker", "http://nw-1:8081/healthz", .healthy),
            instance("notification-worker", "http://nw-2:8081/healthz", .unhealthy)
        ])
        XCTAssertEqual(groups[0].severity, .degraded)
        XCTAssertEqual(groups[0].healthyCount, 1)
        XCTAssertEqual(groups[0].total, 2)
    }

    func testDownWhenEveryInstanceDown() {
        let groups = WorkersAdapter.group([
            instance("export-worker", "http://e1:8082/healthz", .down),
            instance("export-worker", "http://e2:8082/healthz", .down)
        ])
        XCTAssertEqual(groups[0].severity, .down)
        XCTAssertEqual(groups[0].healthyCount, 0)
    }

    func testAllUnhealthyIsDegradedNotDown() {
        let groups = WorkersAdapter.group([
            instance("export-worker", "http://e1:8082/healthz", .unhealthy),
            instance("export-worker", "http://e2:8082/healthz", .unhealthy)
        ])
        XCTAssertEqual(groups[0].severity, .degraded)
    }

    func testErrorNormalisedAndLatencyProjected() {
        let groups = WorkersAdapter.group([
            instance("automation-worker", "http://aw-1:8083/healthz", .down, error: "connection refused"),
            instance("export-worker", "http://export-worker:8082/healthz", .healthy, latency: 23),
            instance("notification-worker", "http://nw:8081/healthz", .healthy, latency: nil, error: "")
        ])
        let automation = groups.first { $0.name == "automation-worker" }
        XCTAssertEqual(automation?.instances.first?.error, "connection refused")
        XCTAssertTrue(automation?.instances.first?.hasError ?? false)
        let export = groups.first { $0.name == "export-worker" }
        XCTAssertEqual(export?.instances.first?.latencyMs, 23)
        let notification = groups.first { $0.name == "notification-worker" }
        XCTAssertNil(notification?.instances.first?.error)
        XCTAssertNil(notification?.instances.first?.latencyMs)
        XCTAssertFalse(notification?.instances.first?.hasError ?? true)
    }
}

// MARK: - Two-axis summary (web top-line counts)

@MainActor final class WorkersSummaryTests: XCTestCase {
    private func instance(_ name: String, _ host: String, _ status: WorkerInstanceStatus) -> WorkerInstance {
        WorkerInstance(name: name, host: host, status: status)
    }

    func testSingleInstanceEachIsNotReplicated() {
        let groups = WorkersAdapter.group([
            instance("notification-worker", "http://nw:8081/healthz", .healthy),
            instance("export-worker", "http://ew:8082/healthz", .healthy),
            instance("automation-worker", "http://aw:8083/healthz", .healthy)
        ])
        let summary = WorkersAdapter.summary(of: groups)
        XCTAssertEqual(summary.groupCount, 3)
        XCTAssertEqual(summary.healthyGroups, 3)
        XCTAssertEqual(summary.totalInstances, 3)
        XCTAssertEqual(summary.healthyInstances, 3)
        XCTAssertEqual(summary.multiInstanceGroups, 0)
        XCTAssertFalse(summary.isReplicated)
    }

    func testReplicatedDegradedSummary() {
        let groups = WorkersAdapter.group([
            instance("notification-worker", "http://nw-1:8081/healthz", .healthy),
            instance("notification-worker", "http://nw-2:8081/healthz", .unhealthy),
            instance("notification-worker", "http://nw-3:8081/healthz", .down),
            instance("export-worker", "http://ew:8082/healthz", .healthy),
            instance("automation-worker", "http://aw:8083/healthz", .healthy)
        ])
        let summary = WorkersAdapter.summary(of: groups)
        XCTAssertEqual(summary.groupCount, 3)
        XCTAssertEqual(summary.healthyGroups, 2)
        XCTAssertEqual(summary.totalInstances, 5)
        XCTAssertEqual(summary.healthyInstances, 3)
        XCTAssertEqual(summary.multiInstanceGroups, 1)
        XCTAssertTrue(summary.isReplicated)
    }
}

// MARK: - Projection: phase resolution + overlays

@MainActor final class WorkersProjectionTests: XCTestCase {
    private func response(_ count: Int) -> WorkersHealthSnapshot {
        let workers = (0 ..< count).map { index in
            WorkerInstance(
                name: "worker-\(index)",
                host: "http://w\(index):80/healthz",
                status: .healthy,
                latencyMs: 10
            )
        }
        return WorkersHealthSnapshot(workers: workers)
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = WorkersInput(isLoading: true, response: response(3))
        XCTAssertEqual(WorkersProjection.resolve(input).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = WorkersInput(errorMessage: "boom", response: response(3))
        XCTAssertEqual(WorkersProjection.resolve(input).phase, .error("boom"))
    }

    func testEmptyWhenResponseNil() {
        XCTAssertEqual(WorkersProjection.resolve(WorkersInput()).phase, .empty)
    }

    func testEmptyWhenZeroWorkers() {
        let resolved = WorkersProjection.resolve(WorkersInput(response: response(0)))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.groups.isEmpty)
    }

    func testDataWhenWorkersPresent() {
        let resolved = WorkersProjection.resolve(WorkersInput(response: response(3)))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.groups.count, 3)
        XCTAssertEqual(resolved.summary.totalInstances, 3)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = WorkersInput(response: response(1), isStale: true, isOffline: true)
        let resolvedWith = WorkersProjection.resolve(withData)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = WorkersInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = WorkersProjection.resolve(noData)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }

    func testFetchingFlagPassesThrough() {
        let input = WorkersInput(isFetching: true, response: response(1))
        XCTAssertTrue(WorkersProjection.resolve(input).isFetching)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class BackgroundWorkersModelTests: XCTestCase {
    private func response(_ count: Int) -> WorkersHealthSnapshot {
        let workers = (0 ..< count).map { index in
            WorkerInstance(name: "worker-\(index)", host: "http://w\(index):80/healthz", status: .healthy)
        }
        return WorkersHealthSnapshot(workers: workers)
    }

    private func makeModel(
        _ input: WorkersInput,
        telemetry: BackgroundWorkersTelemetry = OSLogBackgroundWorkersTelemetry()
    ) -> (BackgroundWorkersModel, InMemoryWorkersSource) {
        let source = InMemoryWorkersSource(initial: input)
        let model = BackgroundWorkersModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyWorkersTelemetry()
        let (model, source) = makeModel(WorkersInput(response: response(3)), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.groups.count, 3)
        XCTAssertEqual(model.summary.totalInstances, 3)
        XCTAssertEqual(spy.surfaces, [BackgroundWorkersCard.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(WorkersInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(WorkersInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(WorkersInput(isFetching: true, response: response(2), isStale: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.isFetching)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.groups.count, 2)
    }

    func testStopHaltsSource() {
        let (model, source) = makeModel(WorkersInput(response: response(1)))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summary content

@MainActor final class WorkersAccessibilityTests: XCTestCase {
    func testGroupSummaryJoinsResolvedFragments() {
        let summary = WorkersAccessibility.groupSummary(
            name: "notification-worker",
            status: "degraded",
            count: "1 / 2 healthy"
        )
        XCTAssertEqual(summary, "notification-worker, degraded, 1 / 2 healthy")
    }

    func testInstanceSummaryJoinsAllFragments() {
        let summary = WorkersAccessibility.instanceSummary(
            host: "http://nw-1:8081/healthz",
            status: "down",
            latency: "—",
            error: "connection refused"
        )
        XCTAssertEqual(summary, "http://nw-1:8081/healthz, down, —, connection refused")
    }

    func testInstanceSummaryDropsNilAndEmptyFragments() {
        let summary = WorkersAccessibility.instanceSummary(
            host: "export-worker:8082",
            status: "healthy",
            latency: "23 ms",
            error: nil
        )
        XCTAssertEqual(summary, "export-worker:8082, healthy, 23 ms")
        XCTAssertFalse(summary.hasSuffix(", "))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyWorkersTelemetry: BackgroundWorkersTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
