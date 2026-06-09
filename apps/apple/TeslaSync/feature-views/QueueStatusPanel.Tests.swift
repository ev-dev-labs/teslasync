//
//  QueueStatusPanel.Tests.swift
//  TeslaSync — P4 feature view · 0037 · QueueStatusPanel (Apple)
//
//  Unit coverage for the QueueStatusPanel surface:
//    • Adapter — the snake_case wire decode (incl. lenient severity + defaulted
//      counts + ISO timestamp parsing), the fmtNumber grouping/precision parity,
//      the formatRelative + formatDurationMsLong ports, and the per-card
//      projection (queue-depth total, MetricBar fraction, branch flags).
//    • State holder — `QueueStatusProjection` phase resolution across loading /
//      error / empty / data plus the stale / offline overlays, the
//      `QueueStatusModel` wiring, and the P1/S11 `view.opened` telemetry.
//    • Accessibility — the VoiceOver card summary.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryQueueStatusSource`.
//

import XCTest

// MARK: - Wire decode (snake_case → model)

@MainActor final class QueueStatusDecodeTests: XCTestCase {
    private func decode(_ json: String) -> QueueStatusSnapshot? {
        QueueStatusSnapshot.decode(Data(json.utf8))
    }

    func testDecodesSnakeCaseEnvelope() {
        let snapshot = decode("""
        {
          "generated_at": "2026-06-09T20:00:00Z",
          "workers": [
            {
              "worker": "notification", "display_name": "Notification worker",
              "pending": 3, "in_progress": 1, "succeeded_24h": 1842, "failed_24h": 0,
              "oldest_pending_age_seconds": 0, "heartbeat_severity": "ok",
              "heartbeat_detail": "Last beat 8s ago",
              "last_heartbeat_at": "2026-06-09T19:59:52Z",
              "host": "notification-worker-1", "version": "1.8.2"
            },
            {
              "worker": "export", "display_name": "Export worker",
              "pending": 12, "in_progress": 2, "succeeded_24h": 96, "failed_24h": 3,
              "oldest_pending_age_seconds": 185, "heartbeat_severity": "warn",
              "heartbeat_detail": "", "host": "export-worker-1", "version": "1.8.2"
            }
          ]
        }
        """)
        XCTAssertNotNil(snapshot)
        XCTAssertNotNil(snapshot?.generatedAt)
        XCTAssertEqual(snapshot?.workers.count, 2)
        XCTAssertEqual(snapshot?.workers[0].worker, "notification")
        XCTAssertEqual(snapshot?.workers[0].displayName, "Notification worker")
        XCTAssertEqual(snapshot?.workers[0].pending, 3)
        XCTAssertEqual(snapshot?.workers[0].inProgress, 1)
        XCTAssertEqual(snapshot?.workers[0].succeeded24h, 1842)
        XCTAssertEqual(snapshot?.workers[0].heartbeatSeverity, .ok)
        XCTAssertNotNil(snapshot?.workers[0].lastHeartbeatAt)
        XCTAssertEqual(snapshot?.workers[1].heartbeatSeverity, .warn)
        XCTAssertEqual(snapshot?.workers[1].oldestPendingAgeSeconds, 185)
        XCTAssertNil(snapshot?.workers[1].lastHeartbeatAt)
    }

    func testUnknownSeverityBecomesDownAndCountsDefault() {
        let snapshot = decode("""
        {"workers": [{"worker": "x", "display_name": "X", "heartbeat_severity": "bananas"}]}
        """)
        XCTAssertEqual(snapshot?.workers.first?.heartbeatSeverity, .down)
        XCTAssertEqual(snapshot?.workers.first?.pending, 0)
        XCTAssertEqual(snapshot?.workers.first?.inProgress, 0)
        XCTAssertEqual(snapshot?.workers.first?.succeeded24h, 0)
        XCTAssertEqual(snapshot?.workers.first?.failed24h, 0)
        XCTAssertEqual(snapshot?.workers.first?.heartbeatDetail, "")
        XCTAssertNil(snapshot?.workers.first?.host)
    }

    func testDisplayNameFallsBackToWorkerId() {
        let snapshot = decode("""
        {"workers": [{"worker": "automation"}]}
        """)
        XCTAssertEqual(snapshot?.workers.first?.displayName, "automation")
    }

    func testEmptyWorkersDecodes() {
        let snapshot = decode("""
        {"generated_at": "2026-06-09T20:00:00Z", "workers": []}
        """)
        XCTAssertEqual(snapshot?.workers.count, 0)
        XCTAssertNotNil(snapshot?.generatedAt)
    }

    func testFractionalSecondsTimestampParses() {
        let date = QueueStatusAdapter.parseTimestamp("2026-06-09T20:00:00.123Z")
        XCTAssertNotNil(date)
        XCTAssertNil(QueueStatusAdapter.parseTimestamp("not-a-date"))
        XCTAssertNil(QueueStatusAdapter.parseTimestamp(nil))
    }
}

// MARK: - Number formatting (port of web fmtNumber)

@MainActor final class QueueStatusNumberTests: XCTestCase {
    private let enUS = Locale(identifier: "en_US")

    func testGroupsThousandsWithTwoDecimalsByDefault() {
        XCTAssertEqual(QueueStatusAdapter.number(5, locale: enUS), "5.00")
        XCTAssertEqual(QueueStatusAdapter.number(1842, locale: enUS), "1,842.00")
        XCTAssertEqual(QueueStatusAdapter.number(0, locale: enUS), "0.00")
    }

    func testHonorsExplicitPrecision() {
        XCTAssertEqual(QueueStatusAdapter.number(1234, precision: 0, locale: enUS), "1,234")
        XCTAssertEqual(QueueStatusAdapter.number(7, precision: 1, locale: enUS), "7.0")
    }
}

// MARK: - Relative time (port of web formatRelative)

@MainActor final class QueueStatusRelativeTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_700_000_000)
    private let locale = Locale(identifier: "en_US_POSIX")
    private let zone = TimeZone.gmt

    private func label(_ secondsAgo: TimeInterval) -> String {
        QueueStatusAdapter.relativeLabel(
            now.addingTimeInterval(-secondsAgo),
            now: now,
            locale: locale,
            timeZone: zone
        )
    }

    func testNilIsDash() {
        XCTAssertEqual(QueueStatusAdapter.relativeLabel(nil, now: now), "—")
    }

    func testRolloverThresholds() {
        XCTAssertEqual(label(30), "just now")
        XCTAssertEqual(label(59), "just now")
        XCTAssertEqual(label(60), "1m ago")
        XCTAssertEqual(label(59 * 60), "59m ago")
        XCTAssertEqual(label(60 * 60), "1h ago")
        XCTAssertEqual(label(23 * 3600), "23h ago")
        XCTAssertEqual(label(24 * 3600), "1d ago")
        XCTAssertEqual(label(6 * 86400), "6d ago")
    }

    func testWeekOrMoreFallsBackToMediumDate() {
        let old = now.addingTimeInterval(-8 * 86400)
        let formatter = DateFormatter()
        formatter.locale = locale
        formatter.timeZone = zone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        XCTAssertEqual(label(8 * 86400), formatter.string(from: old))
    }
}

// MARK: - Duration (port of web formatDurationMsLong)

@MainActor final class QueueStatusDurationTests: XCTestCase {
    func testNonPositiveAndNonFiniteAreDash() {
        XCTAssertEqual(QueueStatusAdapter.durationLong(nil), "—")
        XCTAssertEqual(QueueStatusAdapter.durationLong(0), "—")
        XCTAssertEqual(QueueStatusAdapter.durationLong(-5), "—")
        XCTAssertEqual(QueueStatusAdapter.durationLong(.infinity), "—")
        XCTAssertEqual(QueueStatusAdapter.durationLong(.nan), "—")
    }

    func testSubSecondMinuteAndCompound() {
        XCTAssertEqual(QueueStatusAdapter.durationLong(500), "500ms")
        XCTAssertEqual(QueueStatusAdapter.durationLong(1500), "1.5s")
        XCTAssertEqual(QueueStatusAdapter.durationLong(59000), "59.0s")
        XCTAssertEqual(QueueStatusAdapter.durationLong(65000), "1m 5s")
        XCTAssertEqual(QueueStatusAdapter.durationLong(185_000), "3m 5s")
    }
}

// MARK: - Projection (web WorkerCard derivations)

@MainActor final class QueueStatusProjectionRowTests: XCTestCase {
    func testDerivesTotalsFractionAndFlags() {
        let projection = QueueStatusAdapter.project(
            QueueStat(
                worker: "export",
                displayName: "Export worker",
                pending: 12,
                inProgress: 2,
                succeeded24h: 96,
                failed24h: 3,
                oldestPendingAgeSeconds: 185,
                heartbeatSeverity: .warn,
                host: "export-worker-1",
                version: "1.8.2"
            )
        )
        XCTAssertEqual(projection.total, 14)
        XCTAssertEqual(projection.barFraction, 1)
        XCTAssertTrue(projection.hasFailures)
        XCTAssertTrue(projection.hasBacklog)
        XCTAssertTrue(projection.hasHost)
        XCTAssertEqual(projection.oldestPendingMilliseconds, 185_000)
    }

    func testZeroDepthEmptyHostNoFailuresNoBacklog() {
        let projection = QueueStatusAdapter.project(
            QueueStat(
                worker: "automation",
                displayName: "Automation worker",
                pending: 0,
                inProgress: 0,
                succeeded24h: 540,
                failed24h: 0,
                oldestPendingAgeSeconds: 0,
                heartbeatSeverity: .down,
                host: "",
                version: ""
            )
        )
        XCTAssertEqual(projection.total, 0)
        XCTAssertEqual(projection.barFraction, 0)
        XCTAssertFalse(projection.hasFailures)
        XCTAssertFalse(projection.hasBacklog)
        XCTAssertFalse(projection.hasHost)
        XCTAssertNil(projection.host)
        XCTAssertNil(projection.version)
    }

    func testListProjectionPreservesOrder() {
        let projections = QueueStatusAdapter.project([
            QueueStat(worker: "notification", displayName: "N"),
            QueueStat(worker: "export", displayName: "E"),
            QueueStat(worker: "automation", displayName: "A")
        ])
        XCTAssertEqual(projections.map(\.worker), ["notification", "export", "automation"])
    }
}

// MARK: - State-holder projection: phase resolution + overlays

@MainActor final class QueueStatusPhaseTests: XCTestCase {
    private func response(_ count: Int) -> QueueStatusSnapshot {
        let workers = (0 ..< count).map { index in
            QueueStat(worker: "worker-\(index)", displayName: "Worker \(index)", heartbeatSeverity: .ok)
        }
        return QueueStatusSnapshot(generatedAt: Date(), workers: workers)
    }

    func testLoadingTakesPrecedenceOverData() {
        let input = QueueStatusInput(isLoading: true, response: response(3))
        XCTAssertEqual(QueueStatusProjection.resolve(input).phase, .loading)
    }

    func testErrorTakesPrecedenceOverCachedData() {
        let input = QueueStatusInput(errorMessage: "boom", response: response(3))
        XCTAssertEqual(QueueStatusProjection.resolve(input).phase, .error("boom"))
    }

    func testEmptyWhenResponseNil() {
        XCTAssertEqual(QueueStatusProjection.resolve(QueueStatusInput()).phase, .empty)
    }

    func testEmptyWhenZeroWorkers() {
        let resolved = QueueStatusProjection.resolve(QueueStatusInput(response: response(0)))
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertTrue(resolved.workers.isEmpty)
    }

    func testDataWhenWorkersPresent() {
        let resolved = QueueStatusProjection.resolve(QueueStatusInput(response: response(3)))
        XCTAssertEqual(resolved.phase, .data)
        XCTAssertEqual(resolved.workers.count, 3)
        XCTAssertNotNil(resolved.generatedAt)
    }

    func testStaleAndOfflineRequireContent() {
        let withData = QueueStatusInput(response: response(1), isStale: true, isOffline: true)
        let resolvedWith = QueueStatusProjection.resolve(withData)
        XCTAssertTrue(resolvedWith.isStale)
        XCTAssertTrue(resolvedWith.isOffline)

        let noData = QueueStatusInput(isLoading: true, isStale: true, isOffline: true)
        let resolvedWithout = QueueStatusProjection.resolve(noData)
        XCTAssertFalse(resolvedWithout.isStale)
        XCTAssertFalse(resolvedWithout.isOffline)
    }

    func testFetchingFlagPassesThrough() {
        let input = QueueStatusInput(isFetching: true, response: response(1))
        XCTAssertTrue(QueueStatusProjection.resolve(input).isFetching)
    }
}

// MARK: - State holder: wiring + telemetry

@MainActor final class QueueStatusModelTests: XCTestCase {
    private func response(_ count: Int) -> QueueStatusSnapshot {
        let workers = (0 ..< count).map { index in
            QueueStat(worker: "worker-\(index)", displayName: "Worker \(index)")
        }
        return QueueStatusSnapshot(workers: workers)
    }

    private func makeModel(
        _ input: QueueStatusInput,
        telemetry: QueueStatusTelemetry = OSLogQueueStatusTelemetry()
    ) -> (QueueStatusModel, InMemoryQueueStatusSource) {
        let source = InMemoryQueueStatusSource(initial: input)
        let model = QueueStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyQueueStatusTelemetry()
        let (model, source) = makeModel(QueueStatusInput(response: response(3)), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .data)
        XCTAssertEqual(model.workers.count, 3)
        XCTAssertEqual(spy.surfaces, [QueueStatusPanel.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(QueueStatusInput(isLoading: true))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(QueueStatusInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(QueueStatusInput(isFetching: true, response: response(2), isStale: true))
        XCTAssertEqual(model.phase, .data)
        XCTAssertTrue(model.isFetching)
        XCTAssertTrue(model.isStale)
        XCTAssertEqual(model.workers.count, 2)
    }

    func testStopHaltsSource() {
        let (model, source) = makeModel(QueueStatusInput(response: response(1)))
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
    }
}

// MARK: - Accessibility summary content

@MainActor final class QueueStatusAccessibilityTests: XCTestCase {
    func testCardSummaryJoinsResolvedFragments() {
        let summary = QueueStatusAccessibility.cardSummary(
            name: "Export worker",
            severity: "warn",
            depth: "12 pending · 2 in progress",
            counts: "Succeeded 24h 96, Failed 24h 3",
            heartbeat: "Last beat 1m ago"
        )
        XCTAssertEqual(
            summary,
            "Export worker, warn, 12 pending · 2 in progress, Succeeded 24h 96, Failed 24h 3, Last beat 1m ago"
        )
    }

    func testCardSummaryDropsEmptyFragments() {
        let summary = QueueStatusAccessibility.cardSummary(
            name: "Automation worker",
            severity: "down",
            depth: "0 pending · 0 in progress",
            counts: "Succeeded 24h 540, Failed 24h 0",
            heartbeat: ""
        )
        XCTAssertFalse(summary.hasSuffix(", "))
        XCTAssertTrue(summary.hasSuffix("Failed 24h 0"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyQueueStatusTelemetry: QueueStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}

@testable import TeslaSync
