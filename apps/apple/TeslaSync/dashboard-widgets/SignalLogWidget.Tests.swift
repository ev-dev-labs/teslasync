//
//  SignalLogWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0089 · SignalLogWidget (Apple)
//
//  Unit coverage for the SignalLogWidget surface:
//    • Adapter (cached → projection) — value formatting, source label/tone mapping,
//      row projection + id shape, the descending sort + 20-row cap, signals/sec
//      aggregation, phase / freshness / relative-time resolution (port parity with
//      the web source).
//    • State holder — SignalLogModel phase/freshness/connection tracking, the
//      pause/resume freeze, plus the P1/S11 view.opened telemetry + source wiring.
//    • Registry — canonical "signal-log" metadata + size clamping.
//    • Accessibility — the VoiceOver row / freshness / rate copy.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by InMemorySignalLogSource. The pure adapter
//  subset is additionally proven by an executed headless harness.
//

import XCTest
@testable import TeslaSync

// MARK: - Adapter: cached DTO → projection

final class SignalLogAdapterTests: XCTestCase {
    private func observation(
        ts: TimeInterval = 0,
        name: String? = "BatteryLevel",
        numeric: Double? = nil,
        text: String? = nil,
        bool: Bool? = nil,
        source: SignalLogSourceKind = .fleetTelemetry
    ) -> SignalObservationDTO {
        SignalObservationDTO(
            timestamp: Date(timeIntervalSince1970: ts),
            signalName: name,
            valueNumeric: numeric,
            valueText: text,
            valueBool: bool,
            source: source
        )
    }

    func testFormatSignalValuePrefersNumericThenTextThenBool() {
        XCTAssertEqual(SignalLogBuilder.formatSignalValue(observation(numeric: 76.4)), "76.4")
        XCTAssertEqual(SignalLogBuilder.formatSignalValue(observation(text: "Charging")), "Charging")
        XCTAssertEqual(SignalLogBuilder.formatSignalValue(observation(bool: true)), "true")
        XCTAssertEqual(SignalLogBuilder.formatSignalValue(observation(bool: false)), "false")
        XCTAssertEqual(SignalLogBuilder.formatSignalValue(observation()), "—")
    }

    func testFormatNumberIsLocaleIndependentAndTrimsZeros() {
        XCTAssertEqual(SignalLogBuilder.formatNumber(42), "42")
        XCTAssertEqual(SignalLogBuilder.formatNumber(0), "0")
        XCTAssertEqual(SignalLogBuilder.formatNumber(76.4), "76.4")
        XCTAssertEqual(SignalLogBuilder.formatNumber(-3.4), "-3.4")
        XCTAssertEqual(SignalLogBuilder.formatNumber(48211.2), "48211.2")
        XCTAssertEqual(SignalLogBuilder.formatNumber(.nan), "—")
        XCTAssertEqual(SignalLogBuilder.formatNumber(.infinity), "—")
    }

    func testSourceLabelToneAndLiveBadge() {
        XCTAssertEqual(SignalLogSourceKind.fleetTelemetry.label, "MQTT")
        XCTAssertEqual(SignalLogSourceKind.fleetApi.label, "API")
        XCTAssertEqual(SignalLogSourceKind.manual.label, "Manual")
        XCTAssertEqual(SignalLogSourceKind.backfill.label, "Cache")
        XCTAssertEqual(SignalLogSourceKind.fleetTelemetry.tone, .success)
        XCTAssertEqual(SignalLogSourceKind.fleetApi.tone, .accent)
        XCTAssertEqual(SignalLogSourceKind.manual.tone, .warning)
        XCTAssertEqual(SignalLogSourceKind.backfill.tone, .muted)
        XCTAssertTrue(SignalLogSourceKind.fleetTelemetry.isLiveBadge)
        XCTAssertFalse(SignalLogSourceKind.fleetApi.isLiveBadge)
    }

    func testSourceFromWireFallsBackForMissingAndUnknown() {
        XCTAssertEqual(SignalLogSourceKind.from(wire: "fleet_telemetry"), .fleetTelemetry)
        XCTAssertEqual(SignalLogSourceKind.from(wire: nil), .backfill)
        XCTAssertEqual(SignalLogSourceKind.from(wire: "gateway"), .other("gateway"))
        XCTAssertEqual(SignalLogSourceKind.from(wire: "gateway").label, "gateway")
        XCTAssertEqual(SignalLogSourceKind.from(wire: "gateway").tone, .muted)
    }

    func testProjectRowCarriesIdTitleValueAndSourceVisuals() {
        let row = SignalLogBuilder.projectRow(
            observation(ts: 1000, name: "ChargeState", text: "Charging", source: .fleetApi),
            index: 3
        )
        XCTAssertEqual(row.title, "ChargeState")
        XCTAssertEqual(row.value, "Charging")
        XCTAssertEqual(row.sourceLabel, "API")
        XCTAssertEqual(row.tone, .accent)
        XCTAssertFalse(row.isLiveBadge)
        XCTAssertTrue(row.id.hasSuffix("-ChargeState-3"))
    }

    func testProjectRowMissingNameRendersDash() {
        let row = SignalLogBuilder.projectRow(observation(name: nil), index: 0)
        XCTAssertEqual(row.title, "—")
    }

    func testProjectFeedSortsNewestFirstAndCapsAtTwenty() {
        let observations = (0 ..< 25).map { index in
            observation(ts: TimeInterval(index), name: "Sig\(index)", numeric: Double(index))
        }
        let update = SignalLogUpdate(status: .loaded, observations: observations)
        let rows = SignalLogBuilder.projectFeed(update)
        XCTAssertEqual(rows.count, SignalLogBuilder.maxItems)
        XCTAssertEqual(rows.first?.title, "Sig24")
        XCTAssertEqual(rows.last?.title, "Sig5")
    }

    func testAggregateRateSumsAndIgnoresNonFinite() {
        XCTAssertEqual(SignalLogBuilder.aggregateRate([4.2, 3.1, 1.6]), 8.9, accuracy: 0.0001)
        XCTAssertEqual(SignalLogBuilder.aggregateRate([]), 0)
        XCTAssertEqual(SignalLogBuilder.aggregateRate([2, .nan, 3]), 5, accuracy: 0.0001)
    }

    func testRoundedRateMatchesMathRound() {
        XCTAssertEqual(SignalLogBuilder.roundedRate(8.9), 9)
        XCTAssertEqual(SignalLogBuilder.roundedRate(8.4), 8)
        XCTAssertEqual(SignalLogBuilder.roundedRate(.nan), 0)
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(SignalLogBuilder.isCompact(cols: 0))
        XCTAssertTrue(SignalLogBuilder.isCompact(cols: 1))
        XCTAssertFalse(SignalLogBuilder.isCompact(cols: 2))
    }

    func testResolvePhase() {
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .loading, itemCount: 0), .loading)
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .loaded, itemCount: 0), .empty)
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .empty, itemCount: 0), .empty)
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .failed("x"), itemCount: 0), .error("x"))
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .loaded, itemCount: 3), .content)
        XCTAssertEqual(SignalLogBuilder.resolvePhase(status: .loading, itemCount: 2), .content)
    }

    func testResolveFreshnessPrecedence() {
        func freshness(
            connection: SignalLogConnection,
            isFetching: Bool,
            isError: Bool
        ) -> SignalLogFreshness {
            SignalLogBuilder.resolveFreshness(
                SignalLogUpdate(connection: connection, isFetching: isFetching, isError: isError)
            )
        }
        XCTAssertEqual(freshness(connection: .offline, isFetching: true, isError: true), .offline)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: true), .error)
        XCTAssertEqual(freshness(connection: .live, isFetching: true, isError: false), .fetching)
        XCTAssertEqual(freshness(connection: .stale, isFetching: false, isError: false), .stale)
        XCTAssertEqual(freshness(connection: .live, isFetching: false, isError: false), .fresh)
    }

    func testFeedRelativeTimeBuckets() {
        let now = Date()
        XCTAssertTrue(SignalLogBuilder.feedRelativeTime(since: now, now: now).contains("Just"))
        XCTAssertTrue(
            SignalLogBuilder.feedRelativeTime(since: now.addingTimeInterval(-120), now: now).contains("2m")
        )
        XCTAssertTrue(
            SignalLogBuilder.feedRelativeTime(since: now.addingTimeInterval(-7200), now: now).contains("2h")
        )
        let dayAgo = SignalLogBuilder.feedRelativeTime(since: now.addingTimeInterval(-172_800), now: now)
        XCTAssertFalse(dayAgo.isEmpty)
        XCTAssertFalse(dayAgo.contains("ago"))
    }
}

// MARK: - State holder: phase / freshness / pause / telemetry / wiring

@MainActor
final class SignalLogModelTests: XCTestCase {
    private func observation(ts: TimeInterval, name: String) -> SignalObservationDTO {
        SignalObservationDTO(
            timestamp: Date(timeIntervalSince1970: ts),
            signalName: name,
            valueNumeric: ts,
            source: .fleetTelemetry
        )
    }

    private func makeModel(
        _ update: SignalLogUpdate,
        telemetry: SignalLogTelemetry = OSLogSignalLogTelemetry()
    ) -> (SignalLogModel, InMemorySignalLogSource) {
        let source = InMemorySignalLogSource(initial: update)
        let model = SignalLogModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutObservationsShowsLoading() {
        let (model, _) = makeModel(SignalLogUpdate(status: .loading))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutObservationsShowsEmpty() {
        let (model, _) = makeModel(SignalLogUpdate(status: .loaded, observations: []))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutObservationsShowsError() {
        let (model, _) = makeModel(SignalLogUpdate(status: .failed("boom"), observations: []))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testObservationsPresentShowContent() {
        let (model, _) = makeModel(
            SignalLogUpdate(status: .loaded, observations: [observation(ts: 1, name: "BatteryLevel")])
        )
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.displayItems.count, 1)
        XCTAssertEqual(model.displayItems.first?.title, "BatteryLevel")
    }

    func testFreshnessTracksUpdate() {
        let (model, source) = makeModel(SignalLogUpdate(status: .loading))
        model.start()
        source.push(SignalLogUpdate(status: .loaded, connection: .offline, updatedAt: Date()))
        XCTAssertEqual(model.freshness, .offline)
        XCTAssertEqual(model.connection, .offline)

        source.push(SignalLogUpdate(status: .loaded, isError: true))
        XCTAssertEqual(model.freshness, .error)
    }

    func testPauseFreezesDisplayedFeedUntilResumed() {
        let first = [observation(ts: 1, name: "A"), observation(ts: 2, name: "B")]
        let (model, source) = makeModel(SignalLogUpdate(status: .loaded, observations: first))
        model.start()
        XCTAssertEqual(model.displayItems.count, 2)

        model.togglePause()
        XCTAssertTrue(model.paused)

        let second = [
            observation(ts: 3, name: "C"),
            observation(ts: 4, name: "D"),
            observation(ts: 5, name: "E")
        ]
        source.push(SignalLogUpdate(status: .loaded, observations: second))
        XCTAssertEqual(model.displayItems.count, 2, "paused feed must stay frozen")
        XCTAssertEqual(model.displayItems.first?.title, "B")

        model.togglePause()
        XCTAssertFalse(model.paused)
        XCTAssertEqual(model.displayItems.count, 3, "resuming catches the feed up")
        XCTAssertEqual(model.displayItems.first?.title, "E")
    }

    func testRateAggregatesFromMQTTRates() {
        let (model, _) = makeModel(SignalLogUpdate(status: .loaded, signalRates: [4.2, 3.1, 1.6]))
        model.start()
        XCTAssertEqual(model.signalsPerSecond, 8.9, accuracy: 0.0001)
        XCTAssertEqual(model.roundedRate, 9)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpySignalLogTelemetry()
        let (model, source) = makeModel(SignalLogUpdate(status: .loading), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [SignalLogWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(SignalLogUpdate(status: .loaded))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testProjectionTracksUpdatesAndTimestamp() {
        let (model, source) = makeModel(SignalLogUpdate(status: .loading))
        model.start()
        let stamp = Date()
        source.push(
            SignalLogUpdate(
                status: .loaded,
                connection: .live,
                observations: [observation(ts: 10, name: "VehicleSpeed")],
                updatedAt: stamp
            )
        )
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.displayItems.count, 1)
        XCTAssertEqual(model.displayItems.first?.value, "10")
        XCTAssertEqual(model.updatedAt, stamp)
    }
}

// MARK: - Registry parity

final class SignalLogRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = SignalLogWidget.registration
        XCTAssertEqual(registration.id, "signal-log")
        XCTAssertEqual(registration.category, "telemetry")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 2, rows: 4))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 4, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = SignalLogWidget.registration
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 1, rows: 1)),
            DashboardWidgetSize(cols: 2, rows: 4)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 4, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 3, rows: 12)),
            DashboardWidgetSize(cols: 3, rows: 12)
        )
    }

    func testSurfaceSlugMatchesDiagnosticsContract() {
        XCTAssertEqual(SignalLogWidget.surfaceSlug, "SignalLogWidget")
    }
}

// MARK: - Accessibility copy

final class SignalLogAccessibilityTests: XCTestCase {
    func testRowLabelIncludesNameValueSourceAndTime() {
        let now = Date()
        let row = SignalLogRowProjection(
            id: "x",
            sourceLabel: "MQTT",
            tone: .success,
            isLiveBadge: true,
            title: "Battery Level",
            value: "76.4",
            timestamp: now
        )
        let label = SignalLogAccessibility.rowLabel(for: row, now: now)
        XCTAssertTrue(label.contains("Battery Level"))
        XCTAssertTrue(label.contains("76.4"))
        XCTAssertTrue(label.contains("MQTT"))
        XCTAssertTrue(label.contains("Just"))
    }

    func testFreshnessAndRateCopy() {
        XCTAssertEqual(SignalLogAccessibility.freshnessLabel(.offline), "Offline")
        XCTAssertEqual(SignalLogAccessibility.freshnessLabel(.fresh), "Live")
        let rate = SignalLogAccessibility.rateLabel(9)
        XCTAssertTrue(rate.contains("9"))
        XCTAssertTrue(rate.contains("signals/sec"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpySignalLogTelemetry: SignalLogTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
