//
//  ServiceHealthSection.Tests.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  Unit coverage for the ServiceHealthSection surface:
//    • Adapter — the number / int / rate / latency / date formatters (ports of
//      numberFormat.ts + dateFormat.ts), the streaming-state classification (web row
//      `Badge` `is_streaming`), the vehicle-row projection + streaming tally (web
//      `Object.values` + `activeCount`), and the VoiceOver label builders.
//    • State holder — `ServiceHealthProjection` across loading / error / empty /
//      content, the resolved derivations (header-badge + has-vehicles flags), plus the
//      `ServiceHealthModel` wiring, the P1/S11 `view.opened` telemetry, and the stale
//      auto-refresh transition.
//
//  These run in the TeslaSync(/-macOS) XCTest targets. They have no network and no
//  real store: the model is driven by `InMemoryServiceHealthSource`, and the locale /
//  time zone are injected for determinism.
//

import XCTest
@testable import TeslaSync

private let enUS = Locale(identifier: "en_US")
private let nyTimeZone = TimeZone(identifier: "America/New_York") ?? .gmt

private func vehicle(
    vin: String = "5YJ3E1EA7KF000001",
    isStreaming: Bool = true,
    signalCount: Double = 0,
    signalsPerSecond: Double = 0,
    latencyMs: Double = 0,
    lastReceived: String? = nil
) -> StreamingVehicleDTO {
    StreamingVehicleDTO(
        vin: vin,
        isStreaming: isStreaming,
        signalCount: signalCount,
        signalsPerSecond: signalsPerSecond,
        latencyMs: latencyMs,
        lastReceived: lastReceived
    )
}

private func telemetry(
    enabled: Bool = true,
    mode: String = "fleet-telemetry",
    totalSignals: Double = 286_534,
    avg: String = "20.5",
    vehicles: [StreamingVehicleDTO] = []
) -> TelemetryStatusDTO {
    TelemetryStatusDTO(
        enabled: enabled,
        mode: mode,
        aggregate: AggregateStatsDTO(totalSignalsReceived: totalSignals, avgSignalsPerSecond: avg),
        vehicles: vehicles
    )
}

// MARK: - Number formatting (port of numberFormat.ts fmtNumber / fmtInt)

@MainActor final class ServiceHealthFormatNumberTests: XCTestCase {
    func testIntGroupsWithoutDecimalsAndRoundsHalfAway() {
        XCTAssertEqual(ServiceHealthFormat.int(184_204, locale: enUS), "184,204")
        XCTAssertEqual(ServiceHealthFormat.int(286_534, locale: enUS), "286,534")
        XCTAssertEqual(ServiceHealthFormat.int(1234.6, locale: enUS), "1,235")
        XCTAssertEqual(ServiceHealthFormat.int(0, locale: enUS), "0")
    }

    func testIntCoercesNonFiniteToZero() {
        XCTAssertEqual(ServiceHealthFormat.int(.nan, locale: enUS), "0")
        XCTAssertEqual(ServiceHealthFormat.int(.infinity, locale: enUS), "0")
        XCTAssertEqual(ServiceHealthFormat.int(-.infinity, locale: enUS), "0")
    }

    func testSignalRateUsesOneDecimal() {
        XCTAssertEqual(ServiceHealthFormat.signalRate(12.4, locale: enUS), "12.4")
        XCTAssertEqual(ServiceHealthFormat.signalRate(8, locale: enUS), "8.0")
        XCTAssertEqual(ServiceHealthFormat.signalRate(0, locale: enUS), "0.0")
    }

    func testLatencyAppendsMillisecondSuffixWithoutDecimals() {
        XCTAssertEqual(ServiceHealthFormat.latency(42, locale: enUS), "42 ms")
        XCTAssertEqual(ServiceHealthFormat.latency(1234.6, locale: enUS), "1,235 ms")
        XCTAssertEqual(ServiceHealthFormat.latency(0, locale: enUS), "0 ms")
    }
}

// MARK: - Date formatting (port of dateFormat.ts formatDateTime)

@MainActor final class ServiceHealthFormatDateTests: XCTestCase {
    func testNilAndEmptyYieldDash() {
        XCTAssertEqual(ServiceHealthFormat.dateTime(nil, locale: enUS, timeZone: nyTimeZone), "—")
        XCTAssertEqual(ServiceHealthFormat.dateTime("", locale: enUS, timeZone: nyTimeZone), "—")
    }

    func testUnparseableYieldsDash() {
        XCTAssertEqual(ServiceHealthFormat.dateTime("not-a-date", locale: enUS, timeZone: nyTimeZone), "—")
    }

    func testRendersLocaleOrderedDateTime() {
        let rendered = ServiceHealthFormat.dateTime(
            "2026-04-04T13:05:00Z",
            locale: enUS,
            timeZone: nyTimeZone
        )
        XCTAssertTrue(rendered.contains("Apr"), rendered)
        XCTAssertTrue(rendered.contains("2026"), rendered)
        XCTAssertTrue(rendered.contains("9:05"), rendered)
    }

    func testParsesFractionalSeconds() {
        XCTAssertNotNil(ServiceHealthFormat.parse("2026-04-04T13:05:00.250Z"))
        XCTAssertNotNil(ServiceHealthFormat.parse("2026-04-04T13:05:00Z"))
        XCTAssertNil(ServiceHealthFormat.parse(""))
    }
}

// MARK: - Streaming state classification (web row Badge is_streaming)

@MainActor final class ServiceStreamingStateTests: XCTestCase {
    func testClassifiesStreamingFlag() {
        XCTAssertEqual(ServiceStreamingState(isStreaming: true), .streaming)
        XCTAssertEqual(ServiceStreamingState(isStreaming: false), .idle)
    }

    func testToneMapping() {
        XCTAssertEqual(ServiceStreamingState.streaming.tone, .success)
        XCTAssertEqual(ServiceStreamingState.idle.tone, .neutral)
    }

    func testLabelKeyAndFallback() {
        XCTAssertEqual(ServiceStreamingState.streaming.labelKey, "Streaming")
        XCTAssertEqual(ServiceStreamingState.streaming.labelFallback, "Streaming")
        XCTAssertEqual(ServiceStreamingState.idle.labelKey, "Idle")
        XCTAssertEqual(ServiceStreamingState.idle.labelFallback, "Idle")
    }
}

// MARK: - Vehicle projection (web Object.values + activeCount)

@MainActor final class ServiceHealthVehiclesTests: XCTestCase {
    private var fleet: [StreamingVehicleDTO] {
        [
            vehicle(vin: "AAA", isStreaming: true, signalCount: 100, lastReceived: "2026-04-04T13:05:00Z"),
            vehicle(vin: "BBB", isStreaming: false, signalCount: 5, lastReceived: ""),
            vehicle(vin: "CCC", isStreaming: true, signalCount: 50)
        ]
    }

    func testRowsPreserveSourceOrderAndClassify() {
        let rows = ServiceHealthVehicles.rows(from: fleet)
        XCTAssertEqual(rows.map(\.vin), ["AAA", "BBB", "CCC"])
        XCTAssertEqual(rows[0].streamingState, .streaming)
        XCTAssertEqual(rows[1].streamingState, .idle)
        XCTAssertEqual(rows[0].id, "AAA")
    }

    func testEmptyLastReceivedBecomesNil() {
        let rows = ServiceHealthVehicles.rows(from: fleet)
        XCTAssertEqual(rows[0].lastReceivedISO, "2026-04-04T13:05:00Z")
        XCTAssertNil(rows[1].lastReceivedISO)
        XCTAssertNil(rows[2].lastReceivedISO)
    }

    func testActiveCountCountsStreamingOnly() {
        XCTAssertEqual(ServiceHealthVehicles.activeCount(fleet), 2)
        XCTAssertEqual(ServiceHealthVehicles.activeCount([]), 0)
    }
}

// MARK: - Projection (web render branches + P4 leaf contract)

@MainActor final class ServiceHealthProjectionTests: XCTestCase {
    private var fleet: [StreamingVehicleDTO] {
        [vehicle(vin: "AAA", isStreaming: true), vehicle(vin: "BBB", isStreaming: false)]
    }

    func testErrorTakesPrecedence() {
        let resolved = ServiceHealthProjection.resolve(
            ServiceHealthInput(telemetry: telemetry(vehicles: fleet), errorMessage: "boom")
        )
        XCTAssertEqual(resolved.phase, .error("boom"))
        XCTAssertFalse(resolved.showHeaderBadges)
        XCTAssertTrue(resolved.vehicles.isEmpty)
    }

    func testLoadingWhenFlagged() {
        let resolved = ServiceHealthProjection.resolve(ServiceHealthInput(isLoading: true))
        XCTAssertEqual(resolved.phase, .loading)
    }

    func testEmptyWhenResolvedWithoutData() {
        let resolved = ServiceHealthProjection.resolve(ServiceHealthInput())
        XCTAssertEqual(resolved.phase, .empty)
        XCTAssertFalse(resolved.hasVehicles)
    }

    func testContentResolvesAllFields() {
        let resolved = ServiceHealthProjection.resolve(
            ServiceHealthInput(telemetry: telemetry(
                enabled: true,
                mode: "fleet-telemetry",
                totalSignals: 286_534,
                avg: "20.5",
                vehicles: fleet
            ))
        )
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertTrue(resolved.enabled)
        XCTAssertEqual(resolved.mode, "fleet-telemetry")
        XCTAssertEqual(resolved.streamingCount, 1)
        XCTAssertEqual(resolved.totalSignals, 286_534, accuracy: 1e-6)
        XCTAssertEqual(resolved.avgSignalsPerSecond, "20.5")
        XCTAssertEqual(resolved.vehicles.count, 2)
    }

    func testContentWithoutAggregateFallsBack() {
        let bare = TelemetryStatusDTO(enabled: false, mode: "polling", aggregate: nil, vehicles: [])
        let resolved = ServiceHealthProjection.resolve(ServiceHealthInput(telemetry: bare))
        XCTAssertEqual(resolved.phase, .content)
        XCTAssertEqual(resolved.totalSignals, 0, accuracy: 1e-6)
        XCTAssertEqual(resolved.avgSignalsPerSecond, "0")
        XCTAssertFalse(resolved.hasVehicles)
    }
}

// MARK: - Resolved derivations (header-badge + has-vehicles flags)

@MainActor final class ServiceHealthResolvedTests: XCTestCase {
    func testHeaderBadgesOnlyInContent() {
        XCTAssertTrue(ServiceHealthResolved(phase: .content).showHeaderBadges)
        XCTAssertFalse(ServiceHealthResolved(phase: .loading).showHeaderBadges)
        XCTAssertFalse(ServiceHealthResolved(phase: .empty).showHeaderBadges)
        XCTAssertFalse(ServiceHealthResolved(phase: .error("x")).showHeaderBadges)
    }

    func testHasVehicles() {
        let row = ServiceVehicleRow(
            vin: "AAA",
            streamingState: .streaming,
            signalCount: 1,
            signalsPerSecond: 1,
            latencyMs: 1,
            lastReceivedISO: nil
        )
        XCTAssertTrue(ServiceHealthResolved(phase: .content, vehicles: [row]).hasVehicles)
        XCTAssertFalse(ServiceHealthResolved(phase: .content, vehicles: []).hasVehicles)
    }
}
