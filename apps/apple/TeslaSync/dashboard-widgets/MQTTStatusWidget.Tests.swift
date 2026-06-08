//
//  MQTTStatusWidget.Tests.swift
//  TeslaSync — P4 dashboard widget · 0068 · MQTTStatusWidget (Apple)
//
//  Unit coverage for the MQTTStatusWidget surface:
//    • Adapter (cached → projection) — `MQTTStatusProjection` parity with the web
//      `stats` useMemo, plus the fmtNumber/fmtInt/formatRelative formatters.
//    • State holder — `MQTTStatusModel` phase resolution across loading / empty /
//      error / content, freshness tracking, plus the P1/S11 `view.opened`
//      telemetry + source wiring.
//    • Registry — canonical `mqtt-status` metadata + size clamping.
//    • Accessibility — the VoiceOver summary content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and
//  no real store: the model is driven by `InMemoryMQTTStatusSource`.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")

// MARK: - Adapter: cached payload → projection (port parity with the web useMemo)

final class MQTTStatusProjectionTests: XCTestCase {
    func testEmptyVehiclesYieldsZeros() {
        let stats = MQTTStatusProjection.stats(from: MQTTStatusData(connected: true, broker: "b", vehicles: []))
        XCTAssertEqual(stats.totalMessages, 0)
        XCTAssertEqual(stats.messagesPerSecond, 0, accuracy: 0.0001)
        XCTAssertNil(stats.lastMessage)
    }

    func testStatsSumSignalCountAndPerSecondWithNilHandling() {
        let data = MQTTStatusData(
            connected: true,
            broker: "mqtt",
            vehicles: [
                MQTTVehicleTelemetry(vin: "a", signalCount: 100, signalsPerSecond: 1.5),
                MQTTVehicleTelemetry(vin: "b", signalCount: 50, signalsPerSecond: nil),
                MQTTVehicleTelemetry(vin: "c", signalCount: 25, signalsPerSecond: 2.0)
            ]
        )
        let stats = MQTTStatusProjection.stats(from: data)
        XCTAssertEqual(stats.totalMessages, 175)
        XCTAssertEqual(stats.messagesPerSecond, 3.5, accuracy: 0.0001)
    }

    func testLastMessageIsLatestReceived() {
        let early = Date(timeIntervalSince1970: 1000)
        let late = Date(timeIntervalSince1970: 5000)
        let data = MQTTStatusData(
            connected: true,
            vehicles: [
                MQTTVehicleTelemetry(vin: "a", signalCount: 1, lastReceived: early),
                MQTTVehicleTelemetry(vin: "b", signalCount: 1, lastReceived: late),
                MQTTVehicleTelemetry(vin: "c", signalCount: 1, lastReceived: nil)
            ]
        )
        XCTAssertEqual(MQTTStatusProjection.stats(from: data).lastMessage, late)
    }

    func testNegativeSignalCountClampedToZero() {
        let data = MQTTStatusData(
            vehicles: [
                MQTTVehicleTelemetry(vin: "a", signalCount: -5),
                MQTTVehicleTelemetry(vin: "b", signalCount: 10)
            ]
        )
        XCTAssertEqual(MQTTStatusProjection.stats(from: data).totalMessages, 10)
    }

    func testBrokerLabelFallsBackToEmDash() {
        XCTAssertEqual(MQTTStatusProjection.brokerLabel(for: MQTTStatusData(broker: nil)), "—")
        XCTAssertEqual(MQTTStatusProjection.brokerLabel(for: MQTTStatusData(broker: "   ")), "—")
        XCTAssertEqual(MQTTStatusProjection.brokerLabel(for: MQTTStatusData(broker: "host:8883")), "host:8883")
    }
}

// MARK: - Formatters: fmtNumber / fmtInt / formatRelative parity

final class MQTTStatusFormatTests: XCTestCase {
    func testNumberFixedDecimalsAndGrouping() {
        XCTAssertEqual(MQTTStatusFormat.number(1234.56, decimals: 1, locale: enUS), "1,234.6")
        XCTAssertEqual(MQTTStatusFormat.number(0, decimals: 1, locale: enUS), "0.0")
        XCTAssertEqual(MQTTStatusFormat.number(12.34, decimals: 0, locale: enUS), "12")
    }

    func testIntGrouping() {
        XCTAssertEqual(MQTTStatusFormat.int(18234, locale: enUS), "18,234")
        XCTAssertEqual(MQTTStatusFormat.int(0, locale: enUS), "0")
    }

    func testSafeDropsNonFinite() {
        XCTAssertEqual(MQTTStatusFormat.safe(.nan), 0)
        XCTAssertEqual(MQTTStatusFormat.safe(.infinity), 0)
        XCTAssertEqual(MQTTStatusFormat.safe(42.5), 42.5)
    }

    func testRelativeBuckets() {
        let now = Date(timeIntervalSince1970: 1_000_000)
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-30), now: now), .justNow)
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-300), now: now), .minutes(5))
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-3 * 3600), now: now), .hours(3))
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-2 * 86400), now: now), .days(2))
        let old = now.addingTimeInterval(-10 * 86400)
        XCTAssertEqual(MQTTStatusFormat.relative(old, now: now), .absolute(old))
    }

    func testRelativeBoundaries() {
        let now = Date(timeIntervalSince1970: 2_000_000)
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-59), now: now), .justNow)
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-60), now: now), .minutes(1))
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-3600), now: now), .hours(1))
        XCTAssertEqual(MQTTStatusFormat.relative(now.addingTimeInterval(-86400), now: now), .days(1))
    }

    func testLastMessageTextNilIsEmDash() {
        XCTAssertEqual(MQTTStatusFormat.lastMessageText(nil), "—")
    }

    func testRelativeTextResolvesBuckets() {
        XCTAssertEqual(MQTTStatusFormat.relativeText(.justNow), "just now")
        XCTAssertEqual(MQTTStatusFormat.relativeText(.minutes(5)), "5m ago")
        XCTAssertEqual(MQTTStatusFormat.relativeText(.hours(3)), "3h ago")
        XCTAssertEqual(MQTTStatusFormat.relativeText(.days(2)), "2d ago")
    }
}

// MARK: - State holder: phases + freshness + telemetry + source wiring

@MainActor
final class MQTTStatusModelTests: XCTestCase {
    private func makeModel(
        _ update: MQTTStatusUpdate,
        telemetry: MQTTStatusTelemetry = OSLogMQTTStatusTelemetry()
    ) -> (MQTTStatusModel, InMemoryMQTTStatusSource) {
        let source = InMemoryMQTTStatusSource(initial: update)
        let model = MQTTStatusModel(source: source, telemetry: telemetry)
        return (model, source)
    }

    func testLoadingWithoutDataShowsLoading() {
        let (model, _) = makeModel(MQTTStatusUpdate(status: .loading, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testLoadedWithoutDataShowsEmpty() {
        let (model, _) = makeModel(MQTTStatusUpdate(status: .loaded, data: nil))
        model.start()
        XCTAssertEqual(model.phase, .empty)
    }

    func testFailedWithoutCacheShowsError() {
        let (model, _) = makeModel(MQTTStatusUpdate(status: .failed("boom"), data: nil))
        model.start()
        XCTAssertEqual(model.phase, .error("boom"))
    }

    func testDataPresentShowsContentEvenWhileFetchingOrFailed() {
        let data = MQTTStatusData(connected: true, broker: "b", vehicles: [MQTTVehicleTelemetry(vin: "v")])
        let (loading, _) = makeModel(MQTTStatusUpdate(status: .loading, data: data))
        loading.start()
        XCTAssertEqual(loading.phase, .content)

        let (failed, _) = makeModel(MQTTStatusUpdate(status: .failed("net"), data: data))
        failed.start()
        XCTAssertEqual(failed.phase, .content)
    }

    func testStartEmitsViewOpenedTelemetryOnce() {
        let spy = SpyMQTTStatusTelemetry()
        let (model, source) = makeModel(MQTTStatusUpdate(status: .loading, data: nil), telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(spy.surfaces, [MQTTStatusWidget.surfaceSlug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testRefreshDelegatesToSource() {
        let (model, source) = makeModel(MQTTStatusUpdate(status: .loaded, data: nil))
        model.start()
        model.refresh()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testConnectionStatsAndBrokerTrackUpdates() {
        let (model, source) = makeModel(MQTTStatusUpdate(status: .loading, data: nil))
        model.start()
        source.push(
            MQTTStatusUpdate(
                status: .loaded,
                connection: .offline,
                data: MQTTStatusData(
                    connected: false,
                    broker: "mqtts://host:8883",
                    vehicles: [MQTTVehicleTelemetry(vin: "v", signalCount: 42, signalsPerSecond: 3.5)]
                ),
                updatedAt: Date()
            )
        )
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.stats.totalMessages, 42)
        XCTAssertEqual(model.stats.messagesPerSecond, 3.5, accuracy: 0.0001)
        XCTAssertFalse(model.brokerConnected)
        XCTAssertEqual(model.brokerLabel, "mqtts://host:8883")
    }

    func testIsCompactThreshold() {
        XCTAssertTrue(MQTTStatusModel.isCompact(DashboardWidgetSize(cols: 1, rows: 2)))
        XCTAssertFalse(MQTTStatusModel.isCompact(DashboardWidgetSize(cols: 2, rows: 2)))
    }
}

// MARK: - Registry parity

final class MQTTStatusRegistryTests: XCTestCase {
    func testRegistrationMatchesCanonical() {
        let registration = MQTTStatusWidget.registration
        XCTAssertEqual(registration.id, "mqtt-status")
        XCTAssertEqual(registration.category, "system")
        XCTAssertEqual(registration.defaultSize, DashboardWidgetSize(cols: 2, rows: 2))
        XCTAssertEqual(registration.minSize, DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(registration.maxSize, DashboardWidgetSize(cols: 3, rows: 40))
    }

    func testClampHonorsMinAndMax() {
        let registration = MQTTStatusWidget.registration
        XCTAssertEqual(registration.clamp(DashboardWidgetSize(cols: 0, rows: 1)), DashboardWidgetSize(cols: 1, rows: 2))
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 9, rows: 99)),
            DashboardWidgetSize(cols: 3, rows: 40)
        )
        XCTAssertEqual(
            registration.clamp(DashboardWidgetSize(cols: 2, rows: 12)),
            DashboardWidgetSize(cols: 2, rows: 12)
        )
    }
}

// MARK: - Accessibility summary content

final class MQTTStatusAccessibilityTests: XCTestCase {
    func testSummaryIncludesStatusAndCounts() {
        let summary = MQTTStatusAccessibility.summary(
            brokerConnected: true,
            messagesPerSecondText: "12.4",
            totalMessagesText: "27,444",
            lastMessageText: "8m ago"
        )
        XCTAssertTrue(summary.contains("Online"))
        XCTAssertTrue(summary.contains("12.4"))
        XCTAssertTrue(summary.contains("27,444"))
        XCTAssertTrue(summary.contains("8m ago"))
    }

    func testSummaryReflectsOfflineBroker() {
        let summary = MQTTStatusAccessibility.summary(
            brokerConnected: false,
            messagesPerSecondText: "0.0",
            totalMessagesText: "0",
            lastMessageText: "—"
        )
        XCTAssertTrue(summary.contains("Offline"))
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyMQTTStatusTelemetry: MQTTStatusTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
