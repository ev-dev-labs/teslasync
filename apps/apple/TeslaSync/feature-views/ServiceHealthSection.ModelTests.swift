//
//  ServiceHealthSection.ModelTests.swift
//  TeslaSync — P4 feature view · 0252 · ServiceHealthSection (Apple)
//
//  State-holder + accessibility coverage for the ServiceHealthSection surface,
//  split from `.Tests` (which holds the pure formatter / classification / projection
//  suites) so each file stays within the lint length budget:
//    • `ServiceHealthModel` wiring — initial apply, the P1/S11 `view.opened`
//      telemetry (emitted once), push-driven projection updates, the one-shot stale
//      auto-refresh + its re-arm on returning live, offline never refreshing, the
//      manual refresh + stop/re-arm lifecycle, and the surface slug.
//    • Accessibility — the per-row + section VoiceOver label content.
//
//  These run in the TeslaSync(/-macOS) XCTest targets, driven by
//  `InMemoryServiceHealthSource` with no network and no real store.
//

import XCTest
@testable import TeslaSync

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

private func telemetry(vehicles: [StreamingVehicleDTO]) -> TelemetryStatusDTO {
    TelemetryStatusDTO(
        enabled: true,
        mode: "fleet-telemetry",
        aggregate: AggregateStatsDTO(totalSignalsReceived: 286_534, avgSignalsPerSecond: "20.5"),
        vehicles: vehicles
    )
}

// MARK: - State holder: wiring, telemetry, freshness

@MainActor final class ServiceHealthModelTests: XCTestCase {
    private func makeModel(
        _ input: ServiceHealthInput,
        telemetry telemetrySeam: ServiceHealthTelemetry = OSLogServiceHealthTelemetry()
    ) -> (ServiceHealthModel, InMemoryServiceHealthSource) {
        let source = InMemoryServiceHealthSource(initial: input)
        let model = ServiceHealthModel(source: source, telemetry: telemetrySeam)
        return (model, source)
    }

    private var dataInput: ServiceHealthInput {
        ServiceHealthInput(telemetry: telemetry(vehicles: [
            vehicle(vin: "AAA", isStreaming: true),
            vehicle(vin: "BBB", isStreaming: false)
        ]))
    }

    func testStartAppliesInitialAndEmitsTelemetryOnce() {
        let spy = SpyServiceHealthTelemetry()
        let (model, source) = makeModel(dataInput, telemetry: spy)
        model.start()
        model.start()
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.resolved.streamingCount, 1)
        XCTAssertEqual(spy.surfaces, [ServiceHealthSurface.slug])
        XCTAssertEqual(source.startCount, 1)
    }

    func testInitialLoadingProjectsLoadingPhase() {
        let (model, _) = makeModel(ServiceHealthInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
    }

    func testPushUpdatesProjection() {
        let (model, source) = makeModel(ServiceHealthInput(isLoading: true))
        model.start()
        XCTAssertEqual(model.phase, .loading)
        source.push(dataInput)
        XCTAssertEqual(model.phase, .content)
        XCTAssertEqual(model.resolved.vehicles.count, 2)
    }

    func testEmptyPushProjectsEmptyPhase() {
        let (model, source) = makeModel(ServiceHealthInput(isLoading: true))
        model.start()
        source.push(ServiceHealthInput())
        XCTAssertEqual(model.phase, .empty)
    }

    func testStaleTransitionAutoRefreshesOnce() {
        let (model, source) = makeModel(dataInput)
        model.start()
        XCTAssertEqual(model.connection, .live)
        XCTAssertEqual(source.refreshCount, 0)

        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .stale))
        XCTAssertEqual(model.connection, .stale)
        XCTAssertEqual(source.refreshCount, 1)

        // Staying stale must not re-trigger the one-shot auto-refresh.
        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testReturningLiveReArmsStaleAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .stale))
        XCTAssertEqual(source.refreshCount, 1)
        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .live))
        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .stale))
        XCTAssertEqual(source.refreshCount, 2)
    }

    func testOfflineDoesNotAutoRefresh() {
        let (model, source) = makeModel(dataInput)
        model.start()
        source.push(ServiceHealthInput(telemetry: dataInput.telemetry, connection: .offline))
        XCTAssertEqual(model.connection, .offline)
        XCTAssertEqual(source.refreshCount, 0)
    }

    func testManualRefreshDelegatesToSource() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.refresh()
        XCTAssertEqual(source.refreshCount, 1)
    }

    func testStopDelegatesAndReArms() {
        let (model, source) = makeModel(dataInput)
        model.start()
        model.stop()
        XCTAssertEqual(source.stopCount, 1)
        model.start()
        XCTAssertEqual(source.startCount, 2)
    }

    func testSurfaceSlug() {
        XCTAssertEqual(ServiceHealthSection.surfaceSlug, "ServiceHealthSection")
        XCTAssertEqual(ServiceHealthSurface.slug, "ServiceHealthSection")
    }
}

// MARK: - Accessibility summary content

@MainActor final class ServiceHealthAccessibilityTests: XCTestCase {
    func testVehicleLabelJoinsCellsInReadingOrder() {
        let label = ServiceHealthAccessibility.vehicleLabel(ServiceVehicleSpoken(
            status: "Streaming",
            vin: "VIN 5YJ3E1EA7KF000001",
            signals: "184,204 Signals",
            rate: "12.4 Signals/s",
            latency: "42 ms",
            lastReceived: "Apr 4, 2026, 9:05 AM"
        ))
        XCTAssertEqual(
            label,
            "Streaming, VIN 5YJ3E1EA7KF000001, 184,204 Signals, 12.4 Signals/s, 42 ms, Apr 4, 2026, 9:05 AM"
        )
    }

    func testSectionSummaryUsesStreamingCountWhenVehiclesPresent() {
        let summary = ServiceHealthAccessibility.sectionSummary(
            title: "Service Health",
            enabled: "Enabled",
            streamingCount: 3,
            hasVehicles: true,
            streamingLabel: "streaming"
        )
        XCTAssertEqual(summary, "Service Health: 3 streaming")
    }

    func testSectionSummaryFallsBackToEnabledWhenNoVehicles() {
        let summary = ServiceHealthAccessibility.sectionSummary(
            title: "Service Health",
            enabled: "Disabled",
            streamingCount: 0,
            hasVehicles: false,
            streamingLabel: "streaming"
        )
        XCTAssertEqual(summary, "Service Health: Disabled")
    }
}

// MARK: - Test doubles

/// Records `viewOpened` surfaces so the telemetry contract can be asserted.
private final class SpyServiceHealthTelemetry: ServiceHealthTelemetry, @unchecked Sendable {
    private(set) var surfaces: [String] = []
    func viewOpened(surface: String) {
        surfaces.append(surface)
    }
}
